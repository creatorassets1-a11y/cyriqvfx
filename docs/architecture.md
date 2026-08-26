# Architecture

## Shape of the system

Two workspaces, cleanly separated. The backend owns all data and file access;
the frontend never talks to storage or the database directly.

```
browser ──► Express API ──► PostgreSQL   (metadata, relationships, activity)
   │              │
   │              └──────► Cloudflare R2 (every byte of every file)
   │
   └──────────────────────► R2 directly, via short-lived signed URLs
```

The third arrow is the important one. Uploads go from the browser straight to
R2, and downloads are served straight from R2. The Node process authorises the
transfer and records it, but never carries the bytes, so a 5 GB scene pack costs
the API a database row, not an hour of streaming.

## Domain model

PostgreSQL holds metadata, relationships and activity. It is not the file
store.

- **Resource** is the core entity, with `ResourceVersion` as a first-class
  child. The `currentVersionId` pointer is what "download" resolves to;
  historical versions stay downloadable by explicit request.
- **Category** is a real table, not a frontend constant, with one level of
  nesting. Everything the owner can rename or reorder lives in the database.
- Many-to-many joins (`ResourceTag`, `ResourceSoftware`, `TutorialResource`,
  `RelatedResource`) are normalised because they are searched, filtered and
  joined. Nothing that needs an index is buried in JSON.
- **DownloadEvent** records every issued download; the denormalised
  `downloadCount` on `Resource` is what listings read, and is de-duplicated so
  three impatient clicks are one download.
- **AuditLog** records owner actions with actor, target and timestamp.

### Status model

`DRAFT → SCHEDULED → PUBLISHED`, plus `UNLISTED` and `ARCHIVED`.

- `DRAFT` and `ARCHIVED` are invisible to the public; a draft URL 404s.
- `UNLISTED` works by direct link but never appears in listings, search or the
  sitemap.
- `ARCHIVED` downloads return **410 Gone** rather than 404, because it existed, and
  saying so is more useful to both people and crawlers.
- A resource cannot be published without a downloadable file. The API refuses
  it, so a published resource is never a dead end.

## Request pipeline

Every request runs the same order, and authorization is never a frontend
concern:

```
request id → security headers → CORS (API only) → cookies → body parse
  → identity → rate limit → authorization → validation → handler → errors
```

- **Identity** resolves the session cookie on every request but never rejects;
  route guards decide what an anonymous caller may do.
- **Authorization** is server-side. A hidden button is not a control.
- **Validation** is Zod at the edge of every handler, returning per-field
  messages the UI attaches to the right input.
- **Errors** funnel through one handler that decides what is safe to show.
  Client errors carry their message; server errors do not.

## Storage

`StorageDriver` has two implementations behind one interface:

- **R2Storage**: the production driver, using the S3-compatible API for
  presigned PUT/GET and multipart uploads.
- **LocalStorage**: development and test. It implements the same contract
  *including* expiring signed URLs, multipart assembly and range reads, so the
  code paths under test are the code paths that run in production. `env.ts`
  refuses to boot production with this driver.

Object keys are generated server-side and deterministic:

```
resources/{resourceId}/versions/{versionId}/file
resources/{resourceId}/previews/{previewId}
resources/{resourceId}/thumbnail
tutorials/{tutorialId}/cover
staging/{uploadSessionId}/file
```

The uploaded filename is never a key. It is stored separately for display and
for the `Content-Disposition` on download. Uploads land in `staging/` and are
promoted to their final key only once the owning record exists, so an abandoned
upload is always safe to delete.

### Upload flow

1. The browser asks for an upload session. The server validates extension, MIME
   type and size against a per-purpose allowlist **before** anything is stored,
   and warns if the checksum matches an existing file.
2. Under the multipart threshold the browser gets one presigned PUT. Above it,
   the server opens a multipart upload and signs parts on demand; the client
   uploads several in parallel with real progress, and a dropped part costs one
   chunk rather than the whole file.
3. On completion the server re-checks the stored object: actual size against
   declared size, magic bytes against the claimed extension, and, for archives,
   entry names for path traversal. Anything that fails is deleted, and the
   session is marked `FAILED`.
4. A background job aborts and cleans up sessions abandoned for a day.

### Download flow

The public URL (`/download/{token}`) is permanent and shareable. It reveals
nothing about storage. On request the server checks status, confirms the object
exists, records the event, then returns a short-lived signed URL. That signed
URL is a bearer token: never logged, never the canonical share link.

## Search

PostgreSQL full-text with weighted fields (`title` > summary > body), plus
`pg_trgm` word similarity as a fallback so a typo still finds the resource.
Ranking takes the better of the two scores. No search cluster, because a
personal library does not need one, and the query lives in one module, so
replacing it later is a contained change.

## SEO

The backend serves the built SPA and injects real per-page metadata into the
shell: title, description, canonical, Open Graph, Twitter card and JSON-LD,
resolved from the database for resource, tutorial and category routes. Private
areas are marked `noindex`; unlisted content is `noindex` but reachable.
Missing content returns a genuine 404 status, not a 200 with an error page.

This gets correct crawling and link unfurling without adopting a full SSR
framework. A deliberate trade, recorded in [decisions.md](decisions.md).

The same handler embeds the owner's site settings in the shell as
`<script type="application/json" id="site-settings">`, and the auth provider
seeds its initial state from it. The first render therefore carries the real
headline and tagline instead of a built-in placeholder that a later fetch would
replace, which is what keeps measured layout shift at zero. When the element is
absent, as it is under the Vite dev server, the settings simply arrive with the
first fetch as before.

## Background jobs

An in-process scheduler, not a queue: publishing scheduled content, cleaning up
abandoned uploads, pruning expired sessions and old analytics rows. Every job is
idempotent, failures are logged without taking the process down, and none of it
sits in an HTTP request. A queue can be introduced when something actually needs
retries across processes.

## Frontend

- Route-based code splitting. The admin CMS and account area never reach a
  visitor who does not open them, asserted by a test.
- Design tokens for colour, type, spacing, radii, shadows, motion and
  breakpoints. Four durations, three easings, no per-component timing.
- `prefers-reduced-motion` collapses every duration to 1 ms at the token level,
  so it applies everywhere at once.
- Data fetching aborts on unmount and on changed inputs, so a fast typist never
  sees a stale result.
- Media reserves its dimensions before loading and video preloads nothing until
  someone presses play.

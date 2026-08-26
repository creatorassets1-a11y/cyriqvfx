# Decisions

The choices worth explaining, and what was deliberately left out.

## Express + Vite SPA, not Next.js

The PRD asks for SSR-quality SEO but warns against complexity adopted for
popularity. What this product actually needs from SSR is correct `<head>`
content: title, description, canonical, OG/Twitter and JSON-LD, resolved per
resource and tutorial, plus honest HTTP status codes.

The backend serves the built SPA and injects that metadata from the database,
with a crawler-visible summary in `<noscript>`. Crawlers and link unfurlers get
what they need; the app stays a plain SPA. Full SSR would buy faster first
contentful paint for content pages. Measured LCP is ~1.1 s under 4× CPU
throttling, so that was not the binding constraint.

**Revisit if** content pages need to render meaningfully before JavaScript, or
the catalogue grows large enough that client-side routing feels slow.

## PostgreSQL full-text search, not a search service

Weighted `tsvector` plus `pg_trgm` word similarity handles typos and ranks
sensibly. `similarity()` alone scores badly against multi-word titles;
`word_similarity()` compares against the best-matching word extent, which is
what makes "halatoin" find "Halation Film LUT Pack".

One database, no sync problem, no second thing to operate. The query lives in
one module so replacing it is contained.

**Revisit if** the catalogue reaches thousands of items or search latency
becomes visible.

## An in-process scheduler, not a job queue

Scheduled publishing and cleanup are idempotent, low-frequency and tolerant of a
missed tick. A queue would add infrastructure to solve a problem this workload
does not have.

**Revisit if** jobs need retries across processes, or more than one instance
runs (two instances would both fire the same tick, which is harmless because the jobs
are idempotent, but wasteful).

## Two storage drivers behind one interface

The local driver is not a mock. It implements expiring signed URLs, multipart
assembly and range reads, so tests exercise the same code paths that run in
production, and development needs no cloud credentials. `env.ts` refuses to boot
production with it, so the safety is enforced rather than documented.

## Session cookies, not JWTs

Sessions are revocable. Suspending an account, changing a password or signing
out a device all take effect immediately, which stateless tokens cannot do
without a revocation list, which is a session table with extra steps.

## Denormalised counters alongside event rows

`downloadCount` on `Resource` is what listings read; `DownloadEvent` rows are
what analytics read. Counting rows per card would be a query per card. Downloads
are de-duplicated per visitor per 30 minutes, so three impatient clicks are one
download while the person still gets their file each time.

## The platform's own font stack

The design originally loaded Inter from a font CDN. That is a render-blocking
request to a third party on the critical path, and it made the site slower on
exactly the connection the PRD cares about. The platform UI stack renders
instantly, costs nothing, and each OS renders the face it hints best.

## What was deliberately left out

- **Collections, starter packs and build-a-pack**: the PRD marks these V1.5/V2.
  Building them now would add surface area before there is a catalogue big
  enough to need curation.
- **Bulk CSV import**: V2 in the PRD, and it needs the same validation as the
  interactive path to be safe. Not worth it for a catalogue this size.
- **Payments**: the PRD says not to implement them. Nothing in the schema
  prevents adding them: resources already have licenses and versions, and a
  price column plus an entitlement check is an additive change.
- **Malware scanning of archives**: signature and structure checks catch
  disguises and traversal, not a genuinely malicious payload. Recorded in
  [security.md](security.md) as a known gap rather than papered over.

## Bugs worth remembering

Found by testing rather than by reading, and each one was a class of mistake
rather than a one-off:

- **CORS threw on a refused origin**, turning a policy decision into a 500 that
  broke every same-origin static asset. Refusing by omitting headers is correct.
- **Grid items default to `min-width: auto`** and will not shrink below their
  content, so one long list overflowed narrow phones. `min-w-0` on grid children
  is not optional.
- **The immutable-cache regex expected `name.hash.ext`** while the build emits
  `name-hash.ext`, so hashed assets were being served with a five-minute cache.
- **The footer rendered high on an empty first paint** and was pushed down as
  data arrived, at 0.22 CLS from a single missing `min-height` on `main`.
- **A required-field asterisk inside `<label>`** became part of every field's
  accessible name.

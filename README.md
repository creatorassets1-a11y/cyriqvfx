# Cyriq VFX, a creator resource platform

A personal, creator-owned library where the owner publishes free editing
resources and tutorials for video editors. Visitors browse, preview and
download without an account. Registered users get download history, saved
resources and update notifications. A single owner account controls everything
through a CMS, with no code editing required.

- **Guests** browse, search, filter, preview, share and download. No signup, ever.
- **Registered users** additionally get history, favourites, notifications and preferences.
- **The owner** publishes resources and tutorials, manages taxonomy and licenses,
  and sees analytics that answer product questions.

## Architecture

```
cyriqvfx/
├── backend/          Node + TypeScript + Express + Prisma + PostgreSQL
│   ├── prisma/       schema, migrations, seed
│   └── src/
│       ├── config/   environment validation (fails fast, no unsafe defaults)
│       ├── lib/      storage drivers, file validation, crypto, errors, logging
│       ├── middleware/ auth, validation, rate limiting, caching, errors
│       ├── modules/  DTOs, notifications, settings, audit, email
│       ├── routes/   public API, account API, admin API
│       └── jobs/     scheduled publishing and cleanup
├── frontend/         React + TypeScript + Vite + Tailwind
│   └── src/
│       ├── ui/       design-system primitives: buttons, fields, dialogs, menus
│       ├── components/ site chrome, cards, previews, download and upload
│       ├── pages/    public, account and admin routes (code-split)
│       ├── lib/      API client, typed API surface, session, hooks, formatting
│       └── styles/   design and motion tokens
├── e2e/              Playwright: public, account, admin, failure, performance
└── docs/             architecture, deployment, security, decisions
```

The frontend and backend are separate workspaces. In production the backend
also serves the built frontend and injects per-page SEO metadata into the
shell, so resource and tutorial pages are properly crawlable and unfurl
correctly when shared, without adopting a heavier framework than this product
needs. See [docs/architecture.md](docs/architecture.md).

Files live in **Cloudflare R2**, never on the application server's disk.
Uploads go browser → R2 directly via short-lived signed URLs, and downloads are
served straight from R2, so large files never pass through the Node process.

## Running it locally

Requirements: Node 20.11+, PostgreSQL 16+.

```bash
npm install

# Configure the backend. Every value is validated at boot.
cp backend/.env.example backend/.env
$EDITOR backend/.env          # set DATABASE_URL and AUTH_SECRET at minimum

npm run db:migrate            # apply migrations
npm run db:seed               # owner account + a real starter catalogue

npm run dev                   # API on :4000, Vite on :5173
```

The seed creates the owner account from `ADMIN_EMAIL` / `ADMIN_PASSWORD` and a
catalogue of resources with genuine downloadable files and preview images, so
nothing points at a placeholder. Download and view counts start at zero, so
every number the UI shows is real activity.

For a production-shaped run (backend serves the built frontend on one origin):

```bash
npm run build
npm start                     # http://localhost:4000
```

`scripts/dev-server.sh` starts PostgreSQL, the API and Vite together, and
`scripts/dev-server.sh stop` shuts them down.

## Storage

`STORAGE_DRIVER=r2` is required in production, and the app refuses to boot
otherwise. A `local` driver implements the identical contract (expiring signed
URLs, multipart uploads, range reads) so every upload and download path is
exercised for real in development and tests rather than being mocked.

R2 bucket CORS must allow `PUT` from your site origin and expose `ETag`, or
browser uploads will fail their preflight. See
[docs/deployment.md](docs/deployment.md).

## Design

Black ground, white type, one light blue accent taken from the mark. Headlines
are set in a serif at large sizes; the interface, numbers and metadata sit in
the platform UI and monospace faces. Structure comes from hairlines, alignment
and space: lists are ruled rows, sections sit under a rule, and long-form copy
is held to a readable measure. Content is not wrapped in a card unless the
container does something, which in practice means the download panel, the
popovers and overlays, and the upload drop target.

Tokens live in [frontend/src/styles/tokens.css](frontend/src/styles/tokens.css)
and are exposed to Tailwind by name, so a colour, radius or duration is changed
in one place. The mark itself is `frontend/public/logo.png`, used for the
masthead, the colophon, the avatar fallback and the favicon.

## Testing

```bash
npm run typecheck    # backend + frontend
npm run lint         # eslint across the repo
npm test             # vitest: unit + integration against a real database
npm run test:e2e     # playwright: desktop and mobile
```

The e2e suites need the app running and seeded; `npm run build && npm start`
first, then `npm run test:e2e`. Run them with `RATE_LIMIT_DISABLED=true`: every
request comes from one address, so the production abuse limiter would throttle
the suite rather than tell us anything. The limiter itself is verified against a
real app instance in `backend/tests/rate-limit.test.ts`.

| Suite | What it covers |
| --- | --- |
| `backend/tests/unit.test.ts` | Upload validation, file signatures, archive inspection, tokens, error semantics |
| `backend/tests/integration.test.ts` | Auth, authorization, the full resource lifecycle, downloads, versions, notifications, search, audit log, cache headers |
| `e2e/public.spec.ts` | The visitor journey, responsive layout, accessibility, SEO metadata |
| `e2e/account.spec.ts` | Register → download → history → save → preferences → sign out and back in |
| `e2e/admin.spec.ts` | The owner journey: upload a real file, publish, download it, link a tutorial |
| `backend/tests/rate-limit.test.ts` | The abuse limiter engages, advertises itself, and leaves ordinary browsing alone |
| `e2e/failures.spec.ts` | Invalid tokens, forged sessions, disguised executables, oversized files, truncated uploads, tampered signed URLs, traversal |
| `e2e/performance.spec.ts` | Payload budgets, LCP and CLS under 4× CPU throttling, shell-embedded settings, lazy media, cache headers |

Measured on the seeded catalogue under 4× CPU throttling and a simulated 4G
connection:

| Metric | Budget | Measured |
| --- | --- | --- |
| Initial JavaScript | ≤ 260 KB | 209 KB |
| Initial CSS | ≤ 60 KB | 28 KB |
| Largest Contentful Paint | < 3000 ms | ~590 ms |
| Cumulative Layout Shift | < 0.05 | 0.000 |
| Longest blocking task | < 250 ms | 0 ms |
| Search round trip | < 4000 ms | ~105 ms |

No webfont is loaded. The display face is a system serif and the interface face
is the platform UI stack, so the first paint is never blocked on a font and
nothing reflows when one arrives. The server also embeds the owner's site
settings in the shell, so the first render already carries the real headline
instead of a placeholder a later fetch would replace. Between them, measured
layout shift is zero.

## Documentation

- [Architecture](docs/architecture.md): domain model, request pipeline, storage, SEO strategy
- [Deployment](docs/deployment.md): environment, R2 setup, backups, recovery
- [Security](docs/security.md): threat model and the controls that answer it
- [Decisions](docs/decisions.md): the choices worth explaining, and what was deliberately left out

## License

The application code is MIT. Resources published *through* the platform carry
their own licenses, set per resource by the owner.

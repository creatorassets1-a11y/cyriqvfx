# Deployment

## What has to exist first

1. **PostgreSQL 16+** with the `pg_trgm` and `unaccent` extensions available
   (the migration creates them).
2. **A Cloudflare R2 bucket** and an API token scoped to it.
3. **A host that can run a Node 20+ process** and hold a `.env`.

## Environment

Copy `backend/.env.example` and fill it in. Every value is validated at boot;
the process exits with the exact list of what is missing rather than starting in
a half-configured state.

Production additionally refuses to start unless:

- `STORAGE_DRIVER=r2`: local disk is never the source of truth.
- `COOKIE_SECURE=true`.
- All four R2 credentials are present.

Generate `AUTH_SECRET` with `openssl rand -base64 32`. Rotating it signs
everyone out and invalidates outstanding verification and reset links.

## R2 bucket CORS

Browser uploads go directly to R2, so the bucket must allow them. Without this,
uploads fail at the preflight and the admin uploader stalls at 0%.

```json
[
  {
    "AllowedOrigins": ["https://your-site.example"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`ExposeHeaders: ["ETag"]` is required: multipart completion reports each part's
ETag, and the browser cannot read it otherwise.

Set a lifecycle rule to abort incomplete multipart uploads after a day. The
application also cleans up its own abandoned sessions, but the bucket rule
catches anything that never reached the database.

Optionally put a CDN in front of the bucket for public media and set
`R2_PUBLIC_BASE_URL`. Thumbnails and previews then never touch the origin.

## Deploying

```bash
npm ci
npm run db:migrate      # prisma migrate deploy, safe to re-run
npm run build           # backend to dist/, frontend to frontend/dist/
npm start
```

The backend serves the built frontend, so one process and one origin is a
complete deployment. Behind a proxy, set `TRUST_PROXY=true` so rate limiting
sees real client addresses.

Seed the owner account once:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a real password' npm run db:seed
```

The seed is idempotent. Re-running it refreshes the catalogue copy and stills
rather than duplicating anything.

## Health

`GET /api/health` returns 200 only after a real database round trip, so a load
balancer removes an instance that has lost its database rather than one that
merely has a listening socket.

## Backups and recovery

**Database.** Nightly `pg_dump`, retained for at least 30 days, stored off the
database host. This is the only irreplaceable state: users, download history,
metadata and audit log.

```bash
pg_dump "$DATABASE_URL" --format=custom --file=cyriqvfx-$(date +%F).dump
```

**Objects.** Enable R2 versioning and set a lifecycle policy matching your
retention appetite. Old resource versions stay referenced by the database until
the owner retires them, so object lifetime should be at least as long as the
database backup window.

**Restore.**

```bash
createdb cyriqvfx_restored
pg_restore --dbname=cyriqvfx_restored cyriqvfx-YYYY-MM-DD.dump
DATABASE_URL=...cyriqvfx_restored npm run db:migrate
```

Then point the app at the restored database. Because object keys are derived
from record ids, a restored database matches the objects still in the bucket,
no reconciliation step.

**Verify it.** A backup that has never been restored is a hypothesis. Restore
into a scratch database quarterly and boot the app against it.

## Failure modes worth knowing

| Symptom | Likely cause |
| --- | --- |
| Boots then exits with a config list | A required variable is missing; the message names each one |
| Health check fails, app otherwise runs | Database unreachable; the check does a real query |
| Admin uploader stalls at 0% | R2 bucket CORS missing `PUT` or the site origin |
| Multipart upload never completes | `ExposeHeaders: ["ETag"]` missing from bucket CORS |
| Downloads 410 | The resource is archived; that is the correct answer |
| Scheduled resource never publishes | It has no attached file; the job logs this each run |

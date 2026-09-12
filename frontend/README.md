# Cyriq VFX

A free, mobile-first resource hub for video editors. The repository has been reset to a new Next.js foundation and is ready for the production storage/auth wiring.

## Routes
- `/` — landing page
- `/resources` — library
- `/categories` — category browser
- `/admin/login` — creator login
- `/admin` — creator studio

## Setup
Requires Node 20+. Run `npm install` then `npm run dev`.

Production integrations are intentionally environment-driven: Supabase for auth/database and Cloudflare R2 for large assets. Never commit credentials.

# Cyriq VFX

Production-oriented creator resource library. Guests can browse and download files without accounts. The owner manages publishing through Creator Studio.

## Stack

Next.js App Router, Supabase Auth/Postgres, Cloudflare R2 private object storage, signed uploads/downloads, and Vercel.

## Production setup

1. Run `supabase/schema.sql` in the production Supabase database.
2. Create an R2 bucket and S3 API token with object read/write access restricted to that bucket.
3. Configure the environment variables in `.env.example` in Vercel.
4. Create the owner account in Supabase Auth using the exact `ADMIN_EMAIL` address, then set its password securely.
5. Point your domain to the Vercel project.

The application never exposes R2 credentials to browsers. Uploads use short-lived presigned PUT URLs; downloads use short-lived presigned GET URLs. Supabase server-side auth uses cookie sessions. RLS protects user-facing database access, while the server-side service-role client is only used after the owner email has been verified.

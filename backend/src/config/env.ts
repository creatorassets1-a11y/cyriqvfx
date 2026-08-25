import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Loads a local .env for development. In production the platform supplies real
 * environment variables and no file exists, so this is a no-op. Values already
 * present in the environment always win.
 */
function loadEnvFile(): void {
  const file = path.resolve(process.cwd(), process.env.ENV_FILE ?? '.env');
  if (!existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch {
    // A malformed or unreadable .env must not stop the schema below from
    // reporting exactly which variables are missing.
  }
}

loadEnvFile();

/**
 * All configuration comes from the environment. Nothing here has a production
 * default that could silently ship an insecure value (PRD §111).
 */
const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /** Public origin of the site, used for canonical URLs, OG tags and share links. */
  PUBLIC_SITE_URL: z.string().url().default('http://localhost:5173'),
  /** Public origin of this API. */
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  /** Comma-separated list of browser origins allowed to call the API with credentials. */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  /** 32+ byte secret used to derive session/token hashes. */
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: bool(false),

  /** Storage driver: r2 in production, local only for development/tests. */
  STORAGE_DRIVER: z.enum(['r2', 'local']).default('local'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  /** Optional public CDN base for cacheable media (thumbnails, previews). */
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
  /** Local driver storage root, for development only. */
  LOCAL_STORAGE_DIR: z.string().default('.storage'),

  DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024 * 1024),
  MULTIPART_THRESHOLD_BYTES: z.coerce.number().int().positive().default(64 * 1024 * 1024),

  /** Bootstrap owner account, created by the seed if absent. */
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),

  EMAIL_DRIVER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Cyriq VFX <noreply@example.com>'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: bool(false),
  RATE_LIMIT_DISABLED: bool(false),
  JOBS_ENABLED: bool(true),
});

export type Env = z.infer<typeof schema> & {
  isProduction: boolean;
  isTest: boolean;
  corsOrigins: string[];
};

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const value = parsed.data;

  if (value.NODE_ENV === 'production') {
    if (value.STORAGE_DRIVER !== 'r2') {
      throw new Error('STORAGE_DRIVER must be "r2" in production. Local disk is not a source of truth.');
    }
    if (!value.COOKIE_SECURE) {
      throw new Error('COOKIE_SECURE must be true in production.');
    }
  }

  if (value.STORAGE_DRIVER === 'r2') {
    const missing = (
      ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const
    ).filter((k) => !value[k]);
    if (missing.length) {
      throw new Error(`STORAGE_DRIVER=r2 requires: ${missing.join(', ')}`);
    }
  }

  return {
    ...value,
    isProduction: value.NODE_ENV === 'production',
    isTest: value.NODE_ENV === 'test',
    corsOrigins: value.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export const env = load();

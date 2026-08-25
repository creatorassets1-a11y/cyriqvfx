/**
 * Test environment. Uses a dedicated database so a run can never touch
 * development data, and disables rate limits so suites stay deterministic.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5432/cyriqvfx_test?schema=public';
process.env.AUTH_SECRET = 'test-only-secret-key-at-least-32-characters-long';
process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_STORAGE_DIR = '.storage-test';
process.env.RATE_LIMIT_DISABLED = 'true';
process.env.JOBS_ENABLED = 'false';
process.env.LOG_LEVEL = 'silent';
process.env.PUBLIC_SITE_URL = 'http://localhost:4000';
process.env.PUBLIC_API_URL = 'http://localhost:4000';

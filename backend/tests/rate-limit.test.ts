import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

/**
 * Rate limiting (PRD §61, §62).
 *
 * Built in its own file with limits switched on, so the control is verified
 * against a real app instance. The end-to-end suites run with limits disabled:
 * every request there comes from one address, so a production abuse control
 * would otherwise throttle the tests rather than tell us anything.
 */

let app: Express;

beforeAll(async () => {
  // The limiters are constructed from the environment at import time, so the
  // override has to happen before the module graph is loaded.
  process.env.RATE_LIMIT_DISABLED = 'false';
  const { createApp } = await import('../src/app.js');
  app = createApp();
});

describe('abuse protection', () => {
  it('throttles repeated failed sign-ins and says so in a way a person can act on', async () => {
    let limited: { status: number; message: string } | null = null;

    for (let attempt = 0; attempt < 60; attempt++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ identifier: `guess-${attempt}@test.local`, password: 'wrong-password-here' });

      if (res.status === 429) {
        limited = { status: res.status, message: res.body.error.message };
        break;
      }
    }

    expect(limited, 'brute-force attempts must eventually be refused').not.toBeNull();
    expect(limited!.message).toMatch(/too many requests/i);
    // A bare status code is not actionable; the message tells them to wait.
    expect(limited!.message).toMatch(/try again/i);
  });

  it('advertises the limit through standard headers', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'someone@test.local', password: 'wrong-password-here' });

    // draft-7 headers let a well-behaved client back off on its own.
    expect(res.headers['ratelimit']).toBeDefined();
  });

  it('does not throttle ordinary browsing', async () => {
    // Reading a library is not an attack; the read limit must not bite here.
    const statuses = await Promise.all(
      Array.from({ length: 40 }, () => request(app).get('/api/resources').then((r) => r.status)),
    );
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});

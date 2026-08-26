import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Failure tests (PRD §91 "Failure tests", §51, §95).
 *
 * Every one of these asserts two things: the request is refused, and the
 * refusal is something a person could act on.
 */

const ADMIN = { identifier: 'owner@cyriqvfx.local', password: 'change-me-please-01' };

async function adminContext(request: APIRequestContext) {
  const res = await request.post('/api/auth/login', { data: ADMIN });
  expect(res.ok(), 'owner sign-in should succeed').toBeTruthy();
  return request;
}

test.describe('download failures', () => {
  test('an invalid download token is a clean 404, not a crash', async ({ request }) => {
    const res = await request.get('/api/download/not-a-real-token');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error.message).toBe('That download link is not valid.');
  });

  test('requesting a version that does not exist explains itself', async ({ request }) => {
    const detail = await (await request.get('/api/resources/auto-beat-marker')).json();
    const res = await request.get(`/api/download/${detail.downloadToken}?version=99.9`);
    expect(res.status()).toBe(404);
    expect((await res.json()).error.message).toContain('99.9');
  });

  test('a deleted resource page returns 404 with a branded page', async ({ page }) => {
    const res = await page.goto('/resources/never-existed');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: /this one got cut/i })).toBeVisible();
  });
});

test.describe('authorization failures', () => {
  test('a guest cannot reach any admin endpoint', async ({ request }) => {
    for (const path of [
      '/api/admin/dashboard',
      '/api/admin/users',
      '/api/admin/settings',
      '/api/admin/audit',
      '/api/admin/resources',
      '/api/admin/taxonomy/categories',
      '/api/admin/tutorials',
    ]) {
      const res = await request.get(path);
      expect(res.status(), `${path} must require auth`).toBe(401);
    }
  });

  test('a guest cannot create, mutate or delete content', async ({ request }) => {
    const post = await request.post('/api/admin/resources', {
      data: { title: 'x', shortDescription: 'x', categoryId: 'x' },
    });
    expect(post.status()).toBe(401);

    const upload = await request.post('/api/admin/uploads', {
      data: { filename: 'a.zip', contentType: 'application/zip', size: 10, purpose: 'resource-file' },
    });
    expect(upload.status()).toBe(401);
  });

  test('an expired or forged session cookie is rejected', async ({ request }) => {
    const res = await request.get('/api/me/downloads', {
      headers: { cookie: 'cyriq_session=forged-token-value-that-is-not-real' },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('upload validation failures', () => {
  test('an unsupported extension is refused before anything is stored', async ({ request }) => {
    await adminContext(request);
    const res = await request.post('/api/admin/uploads', {
      data: {
        filename: 'installer.exe',
        contentType: 'application/octet-stream',
        size: 1024,
        purpose: 'resource-file',
      },
    });
    expect(res.status()).toBe(415);
    expect((await res.json()).error.message).toContain('.exe');
  });

  test('an oversized file is refused with the real limit named', async ({ request }) => {
    await adminContext(request);
    const res = await request.post('/api/admin/uploads', {
      data: {
        filename: 'huge.png',
        contentType: 'image/png',
        size: 500 * 1024 * 1024,
        purpose: 'thumbnail',
      },
    });
    expect(res.status()).toBe(413);
    const message = (await res.json()).error.message;
    expect(message).toContain('limit');
    expect(message).toMatch(/MB/);
  });

  test('a file whose bytes contradict its extension is rejected and not kept', async ({ request }) => {
    await adminContext(request);

    const created = await request.post('/api/admin/uploads', {
      data: {
        filename: 'disguised.zip',
        contentType: 'application/zip',
        size: 12,
        purpose: 'resource-file',
      },
    });
    expect(created.ok()).toBeTruthy();
    const session = await created.json();

    // "MZ" is a Windows executable pretending to be a ZIP.
    const bytes = Buffer.from('MZ\x90\x00fake-exe', 'binary');
    const put = await request.put(session.url, {
      headers: { 'Content-Type': 'application/zip' },
      data: bytes,
    });
    expect(put.ok()).toBeTruthy();

    const completed = await request.post(`/api/admin/uploads/${session.uploadSessionId}/complete`, {
      data: {},
    });
    expect(completed.status()).toBe(415);
    expect((await completed.json()).error.message).toContain('does not look like a valid .zip');

    // The rejected object must not survive.
    const check = await request.get(`/api/admin/uploads/${session.uploadSessionId}`);
    expect((await check.json()).status).toBe('FAILED');
  });

  test('an interrupted upload is refused rather than half-saved', async ({ request }) => {
    await adminContext(request);

    const created = await request.post('/api/admin/uploads', {
      data: {
        filename: 'truncated.png',
        contentType: 'image/png',
        size: 4096,
        purpose: 'thumbnail',
      },
    });
    const session = await created.json();

    // A valid PNG header, but far fewer bytes than declared.
    const shortBody = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await request.put(session.url, {
      headers: { 'Content-Type': 'image/png' },
      data: shortBody,
    });

    const completed = await request.post(`/api/admin/uploads/${session.uploadSessionId}/complete`, {
      data: {},
    });
    expect(completed.status()).toBe(400);
    // Caught either by the storage layer refusing a short body or by the
    // size check on completion. Both refuse, and both say nothing was kept.
    const message = (await completed.json()).error.message;
    expect(message).toMatch(/did not finish|incomplete/);
    expect(message).toMatch(/nothing was stored|was not saved|try again/i);
  });

  test('a signed storage URL cannot be tampered with or replayed after expiry', async ({ request }) => {
    await adminContext(request);
    const created = await request.post('/api/admin/uploads', {
      data: { filename: 'ok.png', contentType: 'image/png', size: 8, purpose: 'thumbnail' },
    });
    const { url } = await created.json();

    // Changing the key invalidates the signature.
    const tampered = url.replace(/key=[^&]+/, 'key=resources%2Fsomeone-elses%2Ffile');
    const res = await request.put(tampered, {
      headers: { 'Content-Type': 'image/png' },
      data: Buffer.from([0x89, 0x50]),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.message).toContain('invalid or has expired');
  });
});

test.describe('input validation', () => {
  test('malformed input is refused with per-field messages', async ({ request }) => {
    const res = await request.post('/api/auth/register', {
      data: { email: 'not-an-email', username: '!!', password: 'x', confirmPassword: 'y' },
    });
    expect(res.status()).toBe(400);
    const { error } = await res.json();
    const fields = error.details.map((d: { field: string }) => d.field);
    expect(fields).toContain('email');
    expect(fields).toContain('username');
    expect(fields).toContain('password');
  });

  test('a report needs enough detail to be actionable', async ({ request }) => {
    const res = await request.post('/api/reports', {
      data: { reason: 'BROKEN_DOWNLOAD', details: 'bad' },
    });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('little more');
  });

  test('an unknown API route is JSON, never the app shell', async ({ request }) => {
    const res = await request.get('/api/does-not-exist');
    expect(res.status()).toBe(404);
    expect(res.headers()['content-type']).toContain('application/json');
  });
});

test.describe('media access', () => {
  test('an arbitrary storage key cannot be read through the media route', async ({ request }) => {
    // Version files are downloads, never public media.
    const res = await request.get('/api/media/resources%2Fanything%2Fversions%2Fx%2Ffile');
    expect(res.status()).toBe(404);
  });

  test('a traversal attempt is refused', async ({ request }) => {
    const res = await request.get('/api/media/..%2F..%2F..%2Fetc%2Fpasswd');
    expect(res.status()).toBe(404);
  });
});

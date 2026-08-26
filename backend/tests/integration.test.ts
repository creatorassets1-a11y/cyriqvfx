import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { hashPassword } from '../src/lib/crypto.js';
import { storage, objectKeys } from '../src/lib/storage/index.js';

/**
 * Integration tests (PRD §91) against a real PostgreSQL database and the real
 * storage driver: auth, authorization, downloads, versions, notifications
 * and the tutorial/resource relationship.
 */

let app: Express;
const OWNER = { email: 'it-owner@test.local', username: 'itowner', password: 'test-password-1234' };
const USER = { email: 'it-user@test.local', username: 'ituser', password: 'test-password-1234' };

/** A real, minimal ZIP so signature checks run rather than being bypassed. */
const ZIP_BYTES = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.alloc(18),
]);

let categoryId = '';
let licenseId = '';
let resourceId = '';
let downloadToken = '';
let versionId = '';

beforeAll(async () => {
  app = createApp();

  // A clean slate, in dependency order.
  await prisma.$transaction([
    prisma.downloadEvent.deleteMany(),
    prisma.savedResource.deleteMany(),
    prisma.resourceView.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.tutorialResource.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.uploadSession.deleteMany(),
    prisma.searchQuery.deleteMany(),
  ]);
  await prisma.resource.updateMany({ data: { currentVersionId: null } });
  await prisma.$transaction([
    prisma.resourceVersion.deleteMany(),
    prisma.resource.deleteMany(),
    prisma.tutorial.deleteMany(),
    prisma.session.deleteMany(),
    prisma.emailToken.deleteMany(),
    prisma.notificationPreference.deleteMany(),
    prisma.user.deleteMany(),
    prisma.category.deleteMany(),
    prisma.license.deleteMany(),
  ]);

  await prisma.user.create({
    data: {
      email: OWNER.email,
      username: OWNER.username,
      displayName: 'Owner',
      passwordHash: await hashPassword(OWNER.password),
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
      preference: { create: {} },
    },
  });

  const category = await prisma.category.create({
    data: { name: 'Integration Cat', slug: 'integration-cat', position: 0 },
  });
  categoryId = category.id;

  const license = await prisma.license.create({
    data: {
      name: 'Test License',
      slug: 'test-license',
      summary: 'For tests.',
      commercialUse: true,
      isDefault: true,
    },
  });
  licenseId = license.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Signs in and returns the raw Cookie header for subsequent requests. */
async function signIn(identifier: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ identifier, password });
  expect(res.status, `sign-in for ${identifier}`).toBe(200);
  const cookies = res.headers['set-cookie'] as unknown as string[];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

describe('authentication', () => {
  it('registers a user, hashes the password, and never returns it', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: USER.email,
      username: USER.username,
      password: USER.password,
      confirmPassword: USER.password,
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(USER.email);
    expect(res.body).not.toHaveProperty('user.passwordHash');
    expect(JSON.stringify(res.body)).not.toContain(USER.password);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: USER.email } });
    expect(stored.passwordHash).not.toBe(USER.password);
    expect(stored.passwordHash.startsWith('$argon2')).toBe(true);
  });

  it('creates notification preferences alongside the account', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: USER.email },
      include: { preference: true },
    });
    expect(user.preference).not.toBeNull();
    expect(user.preference?.enabled).toBe(true);
  });

  it('refuses a duplicate email and says which field clashed', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: USER.email,
      username: 'someoneelse',
      password: USER.password,
      confirmPassword: USER.password,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('email');
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ identifier: USER.email, password: 'not-the-password' });
    const unknownUser = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'nobody@test.local', password: 'not-the-password' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownUser.body.error.message);
  });

  it('issues an httpOnly session cookie', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: USER.email, password: USER.password });
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('cyriq_session='),
    );
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('stores only a hash of the session token', async () => {
    const session = await prisma.session.findFirst({ orderBy: { createdAt: 'desc' } });
    expect(session).not.toBeNull();
    expect(session!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not reveal whether an address has an account on password reset', async () => {
    const known = await request(app).post('/api/auth/forgot-password').send({ email: USER.email });
    const unknown = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@test.local' });
    expect(known.body).toEqual(unknown.body);
  });
});

describe('authorization', () => {
  it('refuses admin routes to guests and to ordinary users', async () => {
    const guest = await request(app).get('/api/admin/dashboard');
    expect(guest.status).toBe(401);

    const userCookie = await signIn(USER.email, USER.password);
    const asUser = await request(app).get('/api/admin/dashboard').set('Cookie', userCookie);
    expect(asUser.status).toBe(403);
  });

  it('lets the owner through', async () => {
    const cookie = await signIn(OWNER.email, OWNER.password);
    const res = await request(app).get('/api/admin/dashboard').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.metrics).toBeDefined();
  });

  it('ends every session of a suspended account immediately', async () => {
    const cookie = await signIn(USER.email, USER.password);
    expect((await request(app).get('/api/me/saved').set('Cookie', cookie)).status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: USER.email } });
    const ownerCookie = await signIn(OWNER.email, OWNER.password);
    await request(app)
      .post(`/api/admin/users/${user.id}/suspension`)
      .set('Cookie', ownerCookie)
      .send({ suspended: true, reason: 'test' });

    expect((await request(app).get('/api/me/saved').set('Cookie', cookie)).status).toBe(401);

    await request(app)
      .post(`/api/admin/users/${user.id}/suspension`)
      .set('Cookie', ownerCookie)
      .send({ suspended: false });
  });

  it('will not let an owner account be suspended or deleted', async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
    const cookie = await signIn(OWNER.email, OWNER.password);

    const suspend = await request(app)
      .post(`/api/admin/users/${owner.id}/suspension`)
      .set('Cookie', cookie)
      .send({ suspended: true });
    expect(suspend.status).toBe(400);

    const remove = await request(app).delete(`/api/admin/users/${owner.id}`).set('Cookie', cookie);
    expect(remove.status).toBe(400);
  });
});

describe('resource lifecycle', () => {
  it('creates a resource as a draft, invisible to the public', async () => {
    const cookie = await signIn(OWNER.email, OWNER.password);
    const res = await request(app)
      .post('/api/admin/resources')
      .set('Cookie', cookie)
      .send({
        title: 'Integration Resource',
        shortDescription: 'Created by the integration test.',
        categoryId,
        licenseId,
        tags: ['integration', 'test'],
      });

    expect(res.status).toBe(201);
    resourceId = res.body.resource.id;
    downloadToken = res.body.resource.downloadToken;
    expect(res.body.resource.status).toBe('DRAFT');

    // Not listed, and not readable, before publication.
    const list = await request(app).get('/api/resources');
    expect(list.body.items.find((r: { id: string }) => r.id === resourceId)).toBeUndefined();
    expect((await request(app).get('/api/resources/integration-resource')).status).toBe(404);
  });

  it('refuses to publish a resource that has no downloadable file', async () => {
    const cookie = await signIn(OWNER.email, OWNER.password);
    const res = await request(app)
      .post(`/api/admin/resources/${resourceId}/status`)
      .set('Cookie', cookie)
      .send({ status: 'PUBLISHED' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('downloadable file');
  });

  it('attaches a version through the real upload flow', async () => {
    const cookie = await signIn(OWNER.email, OWNER.password);

    const created = await request(app)
      .post('/api/admin/uploads')
      .set('Cookie', cookie)
      .send({
        filename: 'integration.zip',
        contentType: 'application/zip',
        size: ZIP_BYTES.length,
        purpose: 'resource-file',
      });
    expect(created.status).toBe(201);
    const sessionId = created.body.uploadSessionId;

    // Upload through the signed URL exactly as the browser would.
    const signedPath = created.body.url.replace(/^https?:\/\/[^/]+/, '');
    const put = await request(app)
      .put(signedPath)
      .set('Content-Type', 'application/zip')
      .send(ZIP_BYTES);
    expect(put.status).toBe(200);

    const completed = await request(app)
      .post(`/api/admin/uploads/${sessionId}/complete`)
      .set('Cookie', cookie)
      .send({});
    expect(completed.status).toBe(200);
    expect(completed.body.checksum).toMatch(/^[a-f0-9]{64}$/);

    const version = await request(app)
      .post(`/api/admin/resources/${resourceId}/versions`)
      .set('Cookie', cookie)
      .send({ uploadSessionId: sessionId, version: '1.0', releaseNotes: 'First.', makeCurrent: true });

    expect(version.status).toBe(201);
    versionId = version.body.version.id;
    expect(version.body.version.fileSize).toBe(ZIP_BYTES.length);
  });

  it('stores the file under a server-generated key, never the uploaded name', async () => {
    const version = await prisma.resourceVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(version.objectKey).toBe(objectKeys.resourceVersion(resourceId, versionId));
    expect(version.objectKey).not.toContain('integration.zip');
    // The display name is kept separately.
    expect(version.originalName).toBe('integration.zip');
    expect(await storage.head(version.objectKey)).not.toBeNull();
  });

  it('publishes, and only then becomes publicly visible', async () => {
    const cookie = await signIn(OWNER.email, OWNER.password);
    const res = await request(app)
      .post(`/api/admin/resources/${resourceId}/status`)
      .set('Cookie', cookie)
      .send({ status: 'PUBLISHED', notify: true });
    expect(res.status).toBe(200);

    const detail = await request(app).get('/api/resources/integration-resource');
    expect(detail.status).toBe(200);
    expect(detail.body.license.name).toBe('Test License');
    expect(detail.body.tags.map((t: { name: string }) => t.name).sort()).toEqual([
      'integration',
      'test',
    ]);
  });

  it('notifies subscribers on publication, and nobody else', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: USER.email } });
    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('NEW_RESOURCE');
    expect(notifications[0].link).toBe('/resources/integration-resource');

    // The owner opted into nothing in particular but is a subscriber too;
    // what matters is that nobody outside the preference set is notified.
    const total = await prisma.notification.count();
    const eligible = await prisma.notificationPreference.count({
      where: { enabled: true, newResource: true },
    });
    expect(total).toBeLessThanOrEqual(eligible);
  });
});

describe('downloads', () => {
  it('serves a guest a short-lived URL and records the event', async () => {
    const before = await prisma.downloadEvent.count({ where: { resourceId } });

    const res = await request(app).get(`/api/download/${downloadToken}`);
    expect(res.status).toBe(200);
    expect(res.body.filename).toBe('integration.zip');
    expect(res.body.suggestAccount).toBe(true);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // The public token must not leak the storage layout.
    expect(res.body).not.toHaveProperty('objectKey');
    expect(JSON.stringify(res.body)).not.toContain('resources/');

    const after = await prisma.downloadEvent.count({ where: { resourceId } });
    expect(after).toBe(before + 1);
  });

  it('actually serves the stored bytes through that URL', async () => {
    const grant = await request(app).get(`/api/download/${downloadToken}`);
    const signedPath = grant.body.url.replace(/^https?:\/\/[^/]+/, '');
    const file = await request(app).get(signedPath).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    expect((file.body as Buffer).length).toBe(ZIP_BYTES.length);
    expect((file.body as Buffer).equals(ZIP_BYTES)).toBe(true);
    expect(file.headers['content-disposition']).toContain('integration.zip');
  });

  it('counts repeated clicks from one visitor once', async () => {
    const fresh = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    const startCount = fresh.downloadCount;

    const agent = request.agent(app);
    await agent.get(`/api/download/${downloadToken}`);
    await agent.get(`/api/download/${downloadToken}`);
    await agent.get(`/api/download/${downloadToken}`);

    const after = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(after.downloadCount).toBe(startCount + 1);
  });

  it('attributes a signed-in download to that user', async () => {
    const cookie = await signIn(USER.email, USER.password);
    await request(app).get(`/api/download/${downloadToken}`).set('Cookie', cookie);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: USER.email } });
    const events = await prisma.downloadEvent.findMany({ where: { userId: user.id } });
    expect(events.length).toBeGreaterThan(0);

    const history = await request(app).get('/api/me/downloads').set('Cookie', cookie);
    expect(history.body.items[0].title).toBe('Integration Resource');
    expect(history.body.items[0].downloadedVersion).toBe('1.0');
  });

  it('flags an update when a newer version exists', async () => {
    const ownerCookie = await signIn(OWNER.email, OWNER.password);

    const created = await request(app)
      .post('/api/admin/uploads')
      .set('Cookie', ownerCookie)
      .send({
        filename: 'integration-v2.zip',
        contentType: 'application/zip',
        size: ZIP_BYTES.length,
        purpose: 'resource-file',
      });
    const signedPath = created.body.url.replace(/^https?:\/\/[^/]+/, '');
    await request(app).put(signedPath).set('Content-Type', 'application/zip').send(ZIP_BYTES);
    await request(app)
      .post(`/api/admin/uploads/${created.body.uploadSessionId}/complete`)
      .set('Cookie', ownerCookie)
      .send({});

    await request(app)
      .post(`/api/admin/resources/${resourceId}/versions`)
      .set('Cookie', ownerCookie)
      .send({
        uploadSessionId: created.body.uploadSessionId,
        version: '2.0',
        releaseNotes: 'Second.',
        makeCurrent: true,
        notifyDownloaders: true,
      });

    const userCookie = await signIn(USER.email, USER.password);
    const history = await request(app).get('/api/me/downloads').set('Cookie', userCookie);
    const row = history.body.items.find((i: { id: string }) => i.id === resourceId);
    expect(row.downloadedVersion).toBe('1.0');
    expect(row.currentVersion).toBe('2.0');
    expect(row.updateAvailable).toBe(true);

    // And the person who downloaded it was told (PRD §22).
    const user = await prisma.user.findUniqueOrThrow({ where: { email: USER.email } });
    const updates = await prisma.notification.findMany({
      where: { userId: user.id, type: 'RESOURCE_UPDATED' },
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].title).toContain('2.0');
  });

  it('can still serve a specific older version', async () => {
    const res = await request(app).get(`/api/download/${downloadToken}?version=1.0`);
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('1.0');
  });

  it('returns 410 once a resource is archived', async () => {
    const cookie = await signIn(OWNER.email, OWNER.password);
    await request(app)
      .post(`/api/admin/resources/${resourceId}/status`)
      .set('Cookie', cookie)
      .send({ status: 'ARCHIVED' });

    const res = await request(app).get(`/api/download/${downloadToken}`);
    expect(res.status).toBe(410);

    // Restore for the remaining tests.
    await request(app)
      .post(`/api/admin/resources/${resourceId}/status`)
      .set('Cookie', cookie)
      .send({ status: 'PUBLISHED' });
  });

  it('keeps an unlisted resource reachable by link but out of listings', async () => {
    const cookie = await signIn(OWNER.email, OWNER.password);
    await request(app)
      .post(`/api/admin/resources/${resourceId}/status`)
      .set('Cookie', cookie)
      .send({ status: 'UNLISTED' });

    expect((await request(app).get(`/api/download/${downloadToken}`)).status).toBe(200);
    expect((await request(app).get('/api/resources/integration-resource')).status).toBe(200);

    const list = await request(app).get('/api/resources');
    expect(list.body.items.find((r: { id: string }) => r.id === resourceId)).toBeUndefined();

    const search = await request(app).get('/api/search?q=integration');
    expect(search.body.resources.find((r: { id: string }) => r.id === resourceId)).toBeUndefined();

    await request(app)
      .post(`/api/admin/resources/${resourceId}/status`)
      .set('Cookie', cookie)
      .send({ status: 'PUBLISHED' });
  });
});

describe('saved resources', () => {
  it('saves, reads back and unsaves, keeping the count honest', async () => {
    const cookie = await signIn(USER.email, USER.password);

    const saved = await request(app).put(`/api/me/saved/${resourceId}`).set('Cookie', cookie);
    expect(saved.body).toEqual({ saved: true });

    // Saving twice must not double-count.
    await request(app).put(`/api/me/saved/${resourceId}`).set('Cookie', cookie);
    let resource = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(resource.saveCount).toBe(1);

    const list = await request(app).get('/api/me/saved').set('Cookie', cookie);
    expect(list.body.items).toHaveLength(1);

    await request(app).delete(`/api/me/saved/${resourceId}`).set('Cookie', cookie);
    resource = await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } });
    expect(resource.saveCount).toBe(0);
  });
});

describe('tutorials and their resource links', () => {
  it('links a tutorial to a resource in both directions', async () => {
    const cookie = await signIn(OWNER.email, OWNER.password);

    const created = await request(app)
      .post('/api/admin/tutorials')
      .set('Cookie', cookie)
      .send({
        title: 'Integration Tutorial',
        summary: 'Shows the resource in use.',
        body: 'Written steps.',
        resourceIds: [resourceId],
      });
    expect(created.status).toBe(201);
    const tutorialId = created.body.tutorial.id;

    await request(app)
      .post(`/api/admin/tutorials/${tutorialId}/status`)
      .set('Cookie', cookie)
      .send({ status: 'PUBLISHED' });

    const tutorial = await request(app).get('/api/tutorials/integration-tutorial');
    expect(tutorial.status).toBe(200);
    expect(tutorial.body.resources).toHaveLength(1);
    expect(tutorial.body.resources[0].id).toBe(resourceId);

    const resource = await request(app).get('/api/resources/integration-resource');
    expect(resource.body.tutorials).toHaveLength(1);
    expect(resource.body.tutorials[0].slug).toBe('integration-tutorial');
  });

  it('hides a draft tutorial from the resource page', async () => {
    const cookie = await signIn(OWNER.email, OWNER.password);
    const tutorial = await prisma.tutorial.findUniqueOrThrow({
      where: { slug: 'integration-tutorial' },
    });
    await request(app)
      .post(`/api/admin/tutorials/${tutorial.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'DRAFT' });

    const resource = await request(app).get('/api/resources/integration-resource');
    expect(resource.body.tutorials).toHaveLength(0);
  });
});

/**
 * Polls until a value appears, for the handful of writes the API deliberately
 * performs after responding. Fails by returning null rather than hanging.
 */
async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 2000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('search', () => {
  it('finds a resource by title and records the query', async () => {
    // Analytics are written after the response is sent, so the search itself is
    // never slowed by them. That means the row lands shortly after this
    // request returns, and the assertion has to wait for it rather than
    // racing it and reading a row from an earlier run.
    const startedAt = new Date();
    const res = await request(app).get('/api/search?q=integration');
    expect(res.status).toBe(200);
    expect(res.body.resources.length).toBeGreaterThan(0);

    const logged = await waitFor(() =>
      prisma.searchQuery.findFirst({
        where: { query: 'integration', createdAt: { gte: startedAt } },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(logged, 'the search should be recorded').not.toBeNull();
    expect(logged!.resultCount).toBeGreaterThan(0);
  });

  it('records a miss and offers somewhere else to go', async () => {
    const res = await request(app).get('/api/search?q=zzzznothingatall');
    expect(res.body.total).toBe(0);
    expect(res.body.suggestions.length).toBeGreaterThan(0);

    const logged = await prisma.searchQuery.findFirst({ where: { query: 'zzzznothingatall' } });
    expect(logged!.resultCount).toBe(0);
  });

  it('tolerates a typo', async () => {
    // "integraton" is one letter short of the indexed title.
    const res = await request(app).get('/api/search?q=integraton');
    expect(res.body.resources.length).toBeGreaterThan(0);
  });
});

describe('audit log', () => {
  it('records what the owner did, without recording secrets', async () => {
    const cookie = await signIn(OWNER.email, OWNER.password);
    const res = await request(app).get('/api/admin/audit').set('Cookie', cookie);
    expect(res.status).toBe(200);

    const actions = res.body.items.map((i: { action: string }) => i.action);
    expect(actions).toContain('admin.login');
    expect(actions).toContain('resource.created');
    expect(actions).toContain('resource.published');
    expect(actions).toContain('version.created');

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(OWNER.password);
    expect(serialized).not.toContain('passwordHash');
  });
});

describe('caching and headers', () => {
  it('marks public listings cacheable and private data not', async () => {
    const publicRes = await request(app).get('/api/resources');
    expect(publicRes.headers['cache-control']).toContain('s-maxage');

    const cookie = await signIn(USER.email, USER.password);
    const privateRes = await request(app).get('/api/me/downloads').set('Cookie', cookie);
    expect(privateRes.headers['cache-control']).toContain('no-store');
  });

  it('never marks a signed-in listing as shared-cacheable', async () => {
    const cookie = await signIn(USER.email, USER.password);
    const res = await request(app).get('/api/resources').set('Cookie', cookie);
    expect(res.headers['cache-control']).toContain('no-store');
  });
});

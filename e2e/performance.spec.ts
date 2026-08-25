import { test, expect } from '@playwright/test';

/**
 * Performance acceptance (PRD §94). These are measurements against explicit
 * budgets, not a one-off score. Everything runs under 4× CPU throttling and a
 * simulated mobile connection, because that is the device the PRD cares about.
 */

/** Budgets, chosen against the PRD's "mid-range phone on mobile data" target. */
const BUDGET = {
  initialJsKb: 260,
  initialCssKb: 60,
  /** Largest Contentful Paint, throttled. */
  lcpMs: 3000,
  /** Cumulative Layout Shift. The PRD asks for no major shift. */
  cls: 0.05,
  /** Any single task blocking the main thread for longer than this is a stall. */
  longTaskMs: 250,
};

async function throttle(page: import('@playwright/test').Page) {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    // Roughly a good 4G connection.
    latency: 70,
    downloadThroughput: (4 * 1024 * 1024) / 8,
    uploadThroughput: (1 * 1024 * 1024) / 8,
  });
  return client;
}

test('the initial payload stays inside its budget', async ({ page }) => {
  const bytes = { js: 0, css: 0 };

  // Responses are compressed, so content-length is absent. Measure what the
  // browser actually received over the wire.
  const pending: Promise<void>[] = [];
  page.on('response', (response) => {
    const url = response.url();
    if (!url.includes('/assets/')) return;
    pending.push(
      response
        .body()
        .then((buf) => {
          if (url.endsWith('.js')) bytes.js += buf.length;
          if (url.endsWith('.css')) bytes.css += buf.length;
        })
        .catch(() => {}),
    );
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Latest drops' })).toBeVisible();
  await Promise.all(pending);

  const jsKb = Math.round(bytes.js / 1024);
  const cssKb = Math.round(bytes.css / 1024);
  console.log(`  initial payload: ${jsKb} KB JS, ${cssKb} KB CSS`);

  expect(jsKb, 'initial JavaScript').toBeLessThanOrEqual(BUDGET.initialJsKb);
  expect(cssKb, 'initial CSS').toBeLessThanOrEqual(BUDGET.initialCssKb);
});

test('admin and account code never reaches a visitor who does not open them', async ({ page }) => {
  const loaded: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/assets/') && r.url().endsWith('.js')) loaded.push(r.url());
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Latest drops' })).toBeVisible();
  await page.goto('/resources');
  await expect(page.locator('article').first()).toBeVisible();

  const joined = loaded.join(' ');
  expect(joined, 'admin bundle must be lazy').not.toMatch(/Admin|ResourceEditor|TutorialEditor/);
  expect(joined, 'account bundle must be lazy').not.toMatch(/Account|Preferences|Profile/);
  expect(joined, 'uploader must be lazy').not.toMatch(/Uploader/);
});

test('the homepage paints quickly and does not shift under throttling', async ({ page }) => {
  await throttle(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Latest drops' })).toBeVisible();

  const vitals = await page.evaluate(
    () =>
      new Promise<{ lcp: number; cls: number }>((resolve) => {
        let lcp = 0;
        let cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) lcp = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });

        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
            // Shifts caused by a user interaction are not layout instability.
            if (!shift.hadRecentInput) cls += shift.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });

        // Give observers a moment to flush, then report.
        setTimeout(() => resolve({ lcp, cls }), 1500);
      }),
  );

  console.log(`  throttled LCP: ${Math.round(vitals.lcp)}ms, CLS: ${vitals.cls.toFixed(4)}`);

  expect(vitals.lcp, 'largest contentful paint under 4x CPU throttling').toBeLessThan(BUDGET.lcpMs);
  expect(vitals.cls, 'cumulative layout shift').toBeLessThan(BUDGET.cls);
});

test('the owner\'s copy is in the shell, so the headline never swaps after load', async ({
  page,
  request,
}) => {
  // The shell carries the settings, which is what keeps CLS at zero: without
  // it the app paints a built-in placeholder and then replaces it with the
  // owner's copy, moving everything below by however much the lengths differ.
  const shell = await (await request.get('/')).text();
  expect(shell, 'the shell must embed the site settings').toContain('id="site-settings"');

  const settings = await (await request.get('/api/site')).json();
  const heroTitle: string = settings.settings.heroTitle;

  await page.goto('/');
  // Read the headline before any fetch could have replaced it, then again
  // after everything has settled. It must be the owner's copy both times.
  const first = await page.locator('main h1').first().textContent();
  expect(first?.trim()).toBe(heroTitle);

  await page.waitForLoadState('networkidle');
  const settled = await page.locator('main h1').first().textContent();
  expect(settled?.trim()).toBe(heroTitle);
});

test('the resource grid stays responsive under CPU throttling', async ({ page }) => {
  await throttle(page);
  await page.goto('/resources');
  await expect(page.locator('article').first()).toBeVisible();

  // Typing into search must not block the main thread.
  const started = Date.now();
  await page.getByLabel('Search resources', { exact: true }).fill('anime scene pack');
  await expect(page.getByRole('heading', { name: /anime scene pack/i })).toBeVisible();
  const elapsed = Date.now() - started;

  console.log(`  throttled search round trip: ${elapsed}ms`);
  expect(elapsed, 'debounced search should still feel immediate').toBeLessThan(4000);

  const longest = await page.evaluate(() => {
    const tasks = performance.getEntriesByType('longtask');
    return tasks.reduce((max, t) => Math.max(max, t.duration), 0);
  });
  console.log(`  longest blocking task: ${Math.round(longest)}ms`);
  expect(longest, 'no single task should stall the main thread').toBeLessThan(BUDGET.longTaskMs);
});

test('below-the-fold media is deferred, and dimensions are reserved', async ({ page }) => {
  await page.goto('/resources');
  await expect(page.locator('article').first()).toBeVisible();

  const images = await page.locator('article img').evaluateAll((nodes) =>
    nodes.map((n) => {
      const img = n as HTMLImageElement;
      return {
        loading: img.getAttribute('loading'),
        hasWidth: !!img.getAttribute('width'),
        hasHeight: !!img.getAttribute('height'),
      };
    }),
  );

  expect(images.length).toBeGreaterThan(0);
  for (const img of images) {
    expect(img.loading, 'card images must be lazy').toBe('lazy');
    // Explicit dimensions are what stop the grid reflowing as images arrive.
    expect(img.hasWidth && img.hasHeight, 'card images must reserve their box').toBe(true);
  }
});

test('a video preview does not download until someone asks for it', async ({ page }) => {
  const mediaRequests: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'media') mediaRequests.push(r.url());
  });

  await page.goto('/resources/auto-beat-marker');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(1200);

  // The poster is an image; the video itself must wait for a click.
  expect(mediaRequests, 'preview video must not autoload').toHaveLength(0);
});

test('public listings are cacheable at the edge and private data is not', async ({ request }) => {
  const listing = await request.get('/api/resources');
  expect(listing.headers()['cache-control']).toContain('s-maxage');

  const download = await request.get('/api/download/anything');
  expect(download.headers()['cache-control']).toContain('no-store');
});

test('hashed assets are immutably cacheable', async ({ page }) => {
  const headers: Record<string, string> = {};
  page.on('response', (r) => {
    if (/\/assets\/.+-[0-9a-zA-Z_-]{8,}\.(?:js|css)$/.test(r.url())) {
      headers[r.url()] = r.headers()['cache-control'] ?? '';
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Latest drops' })).toBeVisible();

  const values = Object.values(headers);
  expect(values.length).toBeGreaterThan(0);
  for (const value of values) {
    expect(value, 'content-hashed assets should be immutable').toContain('immutable');
  }
});

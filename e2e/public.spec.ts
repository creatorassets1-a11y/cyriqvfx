import { test, expect } from '@playwright/test';

/**
 * Public journey (PRD §91 E2E 1–4, §98).
 *
 * The acceptance test the PRD ends on: an editor arrives from a link, gets it,
 * previews it, understands the license, and downloads it without an account.
 */

test.describe('public browsing', () => {
  test('homepage communicates the product immediately', async ({ page }) => {
    await page.goto('/');

    // 1. What is this site?
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // 3. Is it actually free / do I need an account?
    await expect(
      page.getByText('No account required to download', { exact: true }),
    ).toBeVisible();
    // 2. What can I get here?
    await expect(page.getByRole('heading', { name: 'Latest drops' })).toBeVisible();
    await expect(page.getByRole('link', { name: /browse resources/i }).first()).toBeVisible();

    // Real resource cards, not placeholders.
    const cards = page.locator('article');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(3);
  });

  test('no horizontal overflow at any tested width', async ({ page }) => {
    for (const width of [320, 360, 390, 768, 1024, 1366]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      // The page must actually be rendered before measuring it.
      await expect(page.getByRole('heading', { name: 'Latest drops' })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
  });

  test('library filters are URL-synced and shareable', async ({ page }) => {
    await page.goto('/resources');
    await expect(page.getByRole('heading', { name: 'Resources', level: 1 })).toBeVisible();

    const total = await page.getByRole('status').first().textContent();
    expect(total).toBeTruthy();

    // Filtering by category via the URL must produce a narrower result set.
    await page.goto('/resources?category=after-effects');
    const filtered = page.locator('article');
    await expect(filtered.first()).toBeVisible();
    // Every visible card should belong to the filtered category.
    const categories = await page.locator('article').evaluateAll((nodes) =>
      nodes.map((n) => n.textContent ?? ''),
    );
    for (const text of categories) {
      expect(text).toContain('After Effects');
    }
  });

  test('search finds resources and handles a miss gracefully', async ({ page }) => {
    await page.goto('/resources?q=beat');
    await expect(page.getByRole('heading', { name: /auto beat marker/i })).toBeVisible();

    // A no-result search must never be a blank page (PRD §50).
    await page.goto('/resources?q=zzzznothingmatches');
    await expect(page.getByText(/nothing matched that search/i)).toBeVisible();
  });

  test('resource page answers "can I use this?" before the details', async ({ page }) => {
    await page.goto('/resources/auto-beat-marker');

    await expect(page.getByRole('heading', { name: 'Auto Beat Marker', level: 1 })).toBeVisible();
    // Compatibility and license are stated up front.
    await expect(page.getByRole('heading', { name: 'Works with' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'License' })).toBeVisible();
    await expect(page.getByText('After Effects').first()).toBeVisible();
    await expect(page.getByText('Free', { exact: true }).locator('visible=true').first()).toBeVisible();

    // Version history and install steps are real content, not placeholders.
    await expect(page.getByRole('heading', { name: 'How to install it' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
    await expect(page.getByText('v1.4').locator('visible=true').first()).toBeVisible();
  });

  test('guest downloads without an account and gets the real file', async ({ page }) => {
    await page.goto('/resources/auto-beat-marker');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /download free/i }).first().click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('auto-beat-marker-v1.4.zip');

    // The file must actually arrive with content.
    const path = await download.path();
    expect(path).toBeTruthy();
    const { statSync } = await import('node:fs');
    expect(statSync(path!).size).toBeGreaterThan(500);

    // Only after the download does the account nudge appear (PRD §16).
    await expect(page.getByText(/create a free account/i)).toBeVisible({ timeout: 5000 });
  });

  test('permanent share link downloads for a guest', async ({ page, request }) => {
    const detail = await request.get('/api/resources/auto-beat-marker');
    const { downloadToken } = await detail.json();

    await page.goto(`/download/${downloadToken}`);
    await expect(page.getByRole('heading', { name: 'Auto Beat Marker' })).toBeVisible();
    await expect(page.getByText('Free / No account required')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /download free/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.zip');
  });

  test('tutorial links its resources both ways', async ({ page }) => {
    await page.goto('/tutorials');
    await page.getByRole('heading', { name: /build a fast-paced anime edit/i }).click();

    await expect(page.getByRole('heading', { name: 'Resources used' })).toBeVisible();
    await expect(page.getByRole('link', { name: /anime scene pack/i }).first()).toBeVisible();

    // And the resource page shows the tutorial back.
    await page.goto('/resources/anime-scene-pack-vol-4');
    await expect(page.getByRole('heading', { name: 'Tutorials using this' })).toBeVisible();
  });

  test('404 is branded with real recovery actions', async ({ page }) => {
    const response = await page.goto('/resources/this-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: /this one got cut/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /browse resources/i })).toBeVisible();
  });

  test('categories and updates render real content', async ({ page }) => {
    await page.goto('/categories');
    await expect(page.getByRole('heading', { name: 'Categories', level: 1 })).toBeVisible();
    await page.getByRole('heading', { name: 'After Effects' }).click();
    await expect(page.getByRole('heading', { name: 'After Effects', level: 1 })).toBeVisible();

    await page.goto('/updates');
    await expect(page.getByRole('heading', { name: 'Updates', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /auto beat marker 1\.4/i })).toBeVisible();
  });
});

test.describe('accessibility and motion', () => {
  test('keyboard reaches the skip link and primary actions', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();

    // Focus must be visible, not suppressed.
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      return getComputedStyle(el).outlineStyle;
    });
    expect(outline).not.toBe('none');
  });

  test('every image has an alt attribute', async ({ page }) => {
    await page.goto('/resources');
    await expect(page.locator('article').first()).toBeVisible();
    const missing = await page.locator('img:not([alt])').count();
    expect(missing).toBe(0);
  });

  test('reduced motion is honoured', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const duration = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--t-normal').trim(),
    );
    expect(duration).toBe('1ms');
  });

  test('resource detail has exactly one h1', async ({ page }) => {
    await page.goto('/resources/auto-beat-marker');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.locator('h1').count()).toBe(1);
  });
});

test.describe('SEO', () => {
  test('resource page carries full metadata and JSON-LD', async ({ page }) => {
    await page.goto('/resources/halation-film-lut-pack');

    await expect(page).toHaveTitle(/Halation Film LUT Pack/);
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description).toContain('Free download');

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toContain('/resources/halation-film-lut-pack');

    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(ogTitle).toContain('Halation');

    const twitterCard = await page.locator('meta[name="twitter:card"]').getAttribute('content');
    expect(twitterCard).toBe('summary_large_image');

    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
    const parsed = JSON.parse(jsonLd!);
    expect(parsed['@type']).toBe('CreativeWork');
    expect(parsed.offers.price).toBe('0');
  });

  test('private areas are marked noindex', async ({ page }) => {
    await page.goto('/login');
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
  });

  test('sitemap and robots are served', async ({ request }) => {
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    expect(xml).toContain('/resources/auto-beat-marker');
    expect(xml).toContain('/tutorials/');

    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    const txt = await robots.text();
    expect(txt).toContain('Sitemap:');
    expect(txt).toContain('Disallow: /admin');
  });
});

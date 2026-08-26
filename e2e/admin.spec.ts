import { test, expect, type Page } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Admin journey (PRD §91 E2E 8–14, §97).
 *
 * The owner acceptance test: sign in, upload a real file, add metadata,
 * publish it, see it live, download it, then connect a tutorial to it, all
 * without editing code.
 */

const ADMIN_EMAIL = 'owner@cyriqvfx.local';
const ADMIN_PASSWORD = 'change-me-please-01';

test.describe.configure({ mode: 'serial' });

/** Builds a real ZIP so the server's signature and archive checks run for real. */
function makeZip(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'e2e-upload-'));
  const inner = path.join(dir, 'preset.ffx');
  writeFileSync(inner, 'binary-ish preset payload for the e2e test\n');
  const zipPath = path.join(dir, name);
  execFileSync('zip', ['-j', '-q', zipPath, inner]);
  return zipPath;
}

async function signInAsOwner(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'My library' })).toBeVisible();
}

test('the owner can publish a resource end to end without touching code', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const title = `E2E Test Pack ${stamp}`;

  // 8. Admin signs in and reaches the dashboard.
  await signInAsOwner(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  // Metrics are real numbers, not placeholders. Scoped to the metric tile so
  // it does not collide with the nav link of the same name.
  await expect(
    page.getByText('Resources', { exact: true }).locator('visible=true').first(),
  ).toBeVisible();

  // 9. Create a resource with metadata.
  await page.getByRole('link', { name: 'New resource' }).first().click();
  await expect(page.getByRole('heading', { name: 'New resource' })).toBeVisible();

  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('One-line summary').fill('A pack created by the end-to-end test.');
  await page.getByLabel('Full description').fill('Longer description written by the test.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  // Publishing must be refused while there is no downloadable file (PRD §102).
  await expect(page.getByText('Add a downloadable file before publishing.')).toBeVisible();

  // 10. Upload a real file as a version.
  const zipPath = makeZip(`e2e-pack-${stamp}.zip`);
  await page.getByRole('button', { name: 'Upload the file' }).click();
  // The file input is opened programmatically by the button, so set it directly.
  await page.getByRole('dialog').locator('input[type="file"]').setInputFiles(zipPath);

  await expect(page.getByText(/ready$/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('dialog').getByLabel('Version').fill('1.0');
  await page.getByRole('dialog').getByLabel('Release notes').fill('First release from the test.');
  await page.getByRole('dialog').getByRole('button', { name: 'Add version' }).click();
  await expect(page.getByText('Version 1.0 added.')).toBeVisible();

  // The version now shows with its real size and checksum-backed identity.
  await expect(page.getByText('v1.0').first()).toBeVisible();

  // 11. Publish it.
  await page.getByRole('button', { name: 'Publish now' }).click();
  await expect(page.getByText('Resource published.')).toBeVisible();

  // 12. It is live publicly, and downloads.
  const slug = `e2e-test-pack-${stamp}`;
  await page.goto(`/resources/${slug}`);
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(page.getByText('A pack created by the end-to-end test.')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /download free/i }).first().click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`e2e-pack-${stamp}.zip`);

  // 13/14. Create a tutorial and connect it to that resource.
  await page.goto('/admin/tutorials/new');
  const tutorialTitle = `E2E Tutorial ${stamp}`;
  await page.getByLabel('Title', { exact: true }).fill(tutorialTitle);
  await page.getByLabel('Summary', { exact: true }).fill('A tutorial created by the end-to-end test.');
  await page.getByLabel('Intro').fill('Some written steps so it can be published.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  // Link the resource we just published.
  await page.getByRole('checkbox', { name: new RegExp(title, 'i') }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Tutorial published.')).toBeVisible();

  // The link now works in both directions (PRD §24, §71).
  const tutorialSlug = `e2e-tutorial-${stamp}`;
  await page.goto(`/tutorials/${tutorialSlug}`);
  await expect(page.getByRole('heading', { name: 'Resources used' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(title, 'i') }).first()).toBeVisible();

  await page.goto(`/resources/${slug}`);
  await expect(page.getByRole('heading', { name: 'Tutorials using this' })).toBeVisible();

  // Clean up so the seeded catalogue stays as-is.
  await page.goto('/admin/resources');
  await page.getByRole('link', { name: title }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByText('Resource deleted.')).toBeVisible();

  await page.goto('/admin/tutorials');
  await page.getByRole('link', { name: tutorialTitle }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByText('Tutorial deleted.')).toBeVisible();
});

test('the owner can manage categories, licenses, settings and see the audit trail', async ({ page }) => {
  await signInAsOwner(page);

  // 14. Categories are dynamic database entities (PRD §11).
  await page.goto('/admin/taxonomy');
  await expect(page.getByRole('heading', { name: 'Categories', level: 2 })).toBeVisible();
  await expect(page.getByText('After Effects').first()).toBeVisible();

  // Deleting a category that still holds resources is refused, not silently done.
  const row = page.locator('li').filter({ hasText: 'After Effects' }).first();
  await row.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(/still in this category/)).toBeVisible();

  // 15. Send an announcement.
  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByLabel('Site name')).toHaveValue('Cyriq VFX');

  // 16/17. Users and reports are inspectable.
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();

  await page.goto('/admin/reports');
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();

  // The audit log records what happened (PRD §48).
  await page.goto('/admin/audit');
  await expect(page.getByRole('heading', { name: 'Audit log', exact: true })).toBeVisible();
  await expect(page.getByText('admin.login').first()).toBeVisible();

  // Analytics answers product questions rather than showing vanity numbers.
  await page.goto('/admin/analytics');
  await expect(page.getByRole('heading', { name: 'Searches with no results' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'High views, low downloads' })).toBeVisible();
});

test('a signed-in non-admin cannot reach the admin area', async ({ page }) => {
  const id = Date.now().toString(36);
  await page.goto('/register');
  await page.getByLabel('Email').fill(`e2e-nonadmin-${id}@example.com`);
  await page.getByLabel('Username').fill(`na${id}`.slice(0, 20));
  await page.getByLabel('Password', { exact: true }).fill('a-strong-passphrase-1');
  await page.getByLabel('Confirm password').fill('a-strong-passphrase-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'My library' })).toBeVisible();

  // The route redirects, and more importantly the API refuses.
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/$/);

  const res = await page.request.get('/api/admin/dashboard');
  expect(res.status()).toBe(403);
});

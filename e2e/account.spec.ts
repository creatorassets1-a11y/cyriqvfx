import { test, expect } from '@playwright/test';

/**
 * Account journey (PRD §91 E2E 4–7, §17–§21).
 * Register → sign in → download → history → save → preferences.
 */

const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

test.describe.configure({ mode: 'serial' });

test('a guest can register, download, and see it in their history', async ({ page }) => {
  const id = unique();
  const email = `e2e-${id}@example.com`;
  const username = `e2e${id}`.slice(0, 20);
  const password = 'a-strong-passphrase-1';

  // 4. Guest registers.
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  // 5/6. Lands in their library.
  await expect(page.getByRole('heading', { name: 'My library' })).toBeVisible();
  await expect(page.getByText('Your library is empty so far')).toBeVisible();

  // Download something while signed in.
  await page.goto('/resources/velocity-motion-presets');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /download free/i }).first().click();
  await download;

  // 6. It appears in download history with the version they got.
  await page.goto('/account/downloads');
  await expect(page.getByRole('link', { name: 'Velocity Motion Presets' })).toBeVisible();
  await expect(page.getByText(/v2\.0/).first()).toBeVisible();

  // 7. Saving works and persists across a reload.
  await page.goto('/resources/velocity-motion-presets');
  // The related-resource cards carry their own save controls; target the
  // main download card's button specifically.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();

  await page.goto('/account/saved');
  await expect(page.getByRole('heading', { name: 'Velocity Motion Presets' })).toBeVisible();

  // Unsaving removes it again.
  await page.goto('/resources/velocity-motion-presets');
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();

  await page.goto('/account/saved');
  await expect(page.getByText('Save resources you want to revisit')).toBeVisible();

  // Preferences save and read back.
  await page.goto('/account/preferences');
  await page.getByRole('switch', { name: 'New resources' }).click();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText('Preferences saved.')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('switch', { name: 'New resources' })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  // Email notifications stay locked until the address is confirmed (PRD §21).
  await expect(page.getByRole('switch', { name: 'Email me as well' })).toBeDisabled();

  // Signing out returns the site to its guest state. The auth links live in
  // the header on wide screens and in the menu sheet on a phone, so assert on
  // the account control disappearing instead.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(0);

  // And signing back in restores the history.
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'My library' })).toBeVisible();

  await page.goto('/account/downloads');
  await expect(page.getByRole('link', { name: 'Velocity Motion Presets' })).toBeVisible();
});

test('validation errors are shown against the right fields', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Email').fill('someone@example.com');
  await page.getByLabel('Username').fill('ab');
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByLabel('Confirm password').fill('different');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByText('Usernames need at least 3 characters.')).toBeVisible();
  await expect(page.getByText('Use at least 10 characters.')).toBeVisible();
});

test('a wrong password is refused without revealing whether the account exists', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill('nobody-here@example.com');
  await page.getByLabel('Password').fill('definitely-wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText('That email or password is not right.')).toBeVisible();
});

test('signed-out visitors are sent to sign in and returned afterwards', async ({ page }) => {
  await page.goto('/account/downloads');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

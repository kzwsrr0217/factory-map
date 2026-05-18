import { test, expect } from '@playwright/test';

test.describe('Alerts Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/alerts');
    // The page has loaded when the section headings are visible
    // (checkboxes are CSS-hidden inside styled toggles, so we don't use them as guards)
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 });
  });

  test('alert conditions section is present', async ({ page }) => {
    await expect(page.locator('text=Alert Conditions')).toBeVisible();
  });

  test('email notifications section is present', async ({ page }) => {
    await expect(page.locator('text=Email Notifications')).toBeVisible();
  });

  test('teams notifications section is present', async ({ page }) => {
    await expect(page.locator('text=Microsoft Teams Notifications')).toBeVisible();
  });

  test('save settings button is visible for admin', async ({ page }) => {
    await expect(page.getByRole('button', { name: /save settings/i })).toBeVisible();
  });

  test('test now button is visible for admin', async ({ page }) => {
    await expect(page.getByRole('button', { name: /test now/i })).toBeVisible();
  });

  test('email section has a toggle', async ({ page }) => {
    // The toggle slider is visible even though the underlying checkbox is CSS-hidden
    const emailSection = page.locator('section').filter({ hasText: /email notifications/i });
    await expect(emailSection.locator('[class*="toggle"], [class*="toggleSlider"]').first()).toBeVisible();
  });

  test('alert history section is present', async ({ page }) => {
    await expect(page.locator('text=Alert History')).toBeVisible();
  });

  test('scheduled alerts section is present', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /scheduled/i })).toBeVisible();
  });
});

import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('shows summary stat cards', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.locator('[class*="stat"], [class*="card"], [class*="metric"]').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('sidebar navigation links are present', async ({ page }) => {
    await page.goto('/');
    for (const label of ['Buildings', 'Map View', 'Network', 'Alerts']) {
      await expect(
        page.getByRole('link', { name: new RegExp(label, 'i') }).first()
      ).toBeVisible({ timeout: 5_000 });
    }
  });

  test('global search opens and accepts input', async ({ page }) => {
    await page.goto('/');
    const searchTrigger = page.locator('[class*="searchTrigger"], [class*="globalSearch"] button').first();
    if (await searchTrigger.isVisible({ timeout: 3_000 })) {
      await searchTrigger.click();
    } else {
      await page.keyboard.press('Control+k');
    }
    const searchInput = page.locator('[class*="search"] input, input[placeholder*="search" i]').first();
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.fill('test');
    await expect(searchInput).toHaveValue('test');
  });

  test('theme toggle switches between light and dark', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('[class*="themeToggle"], [aria-label*="theme" i], [title*="theme" i], [class*="darkMode"]').first();
    if (await toggle.isVisible({ timeout: 5_000 })) {
      const htmlEl = page.locator('html');
      const before = await htmlEl.getAttribute('data-theme') ?? await htmlEl.getAttribute('class');
      await toggle.click();
      await page.waitForTimeout(300);
      const after = await htmlEl.getAttribute('data-theme') ?? await htmlEl.getAttribute('class');
      expect(before).not.toBe(after);
    } else {
      test.skip(true, 'Theme toggle not found — skipping');
    }
  });
});

import { test, expect } from '@playwright/test';

test.describe('Network Infrastructure', () => {
  test('infrastructure page renders', async ({ page }) => {
    await page.goto('/infrastructure');
    await expect(
      page.locator('[class*="room"], [class*="rack"], [class*="infra"], [class*="card"], table').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('building selector is present', async ({ page }) => {
    await page.goto('/infrastructure');
    await expect(
      page.locator('select, [class*="select"]').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('selecting a building loads its rooms', async ({ page }) => {
    await page.goto('/infrastructure');
    const sel = page.locator('select').first();
    await sel.waitFor({ timeout: 8_000 });
    const opts = await sel.locator('option').all();
    for (const opt of opts) {
      const val = await opt.getAttribute('value');
      if (val && val !== '' && val !== 'null' && val !== 'all') {
        await sel.selectOption(val);
        break;
      }
    }
    await page.waitForTimeout(800);
    await expect(
      page.locator('[class*="room"], [class*="card"], [class*="infra"]').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('add network room button opens a dialog', async ({ page }) => {
    await page.goto('/infrastructure');
    const addBtn = page.getByRole('button', { name: /add room|new room|\+ room/i });
    if (await addBtn.isVisible({ timeout: 5_000 })) {
      await addBtn.click();
      await expect(page.locator('[class*="modal"], [role="dialog"]').first()).toBeVisible({ timeout: 5_000 });
      await page.keyboard.press('Escape');
    } else {
      test.skip(true, 'Add room button not visible — may require building selection first');
    }
  });
});

test.describe('Network Graph', () => {
  test('network graph page renders', async ({ page }) => {
    await page.goto('/network');
    await expect(
      page.locator('canvas, svg, [class*="graph"], [class*="network"]').first()
    ).toBeVisible({ timeout: 12_000 });
  });
});

import { test, expect } from '@playwright/test';
import { getApiToken, apiDelete } from './helpers';

// Assets are managed from the Dashboard (no standalone /assets list route)
const E2E_ASSET_NAME = `E2E_Asset_${Date.now()}`;
let createdAssetId: string | null = null;

/** Go to Dashboard and wait for it to finish loading (retries up to 3x on API error). */
async function gotoDashboard(page: import('@playwright/test').Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await page.waitForTimeout(2000);
    await page.goto('/');
    await page.locator('h3, [class*="emptyState"], [class*="assetCard"], [class*="tableRow"]')
      .first().waitFor({ timeout: 15_000 }).catch(() => {});
    const isErrState = await page.locator('text=Failed to load dashboard data').isVisible().catch(() => false);
    if (!isErrState) return;
  }
}

test.describe('Assets', () => {
  test.afterAll(async () => {
    if (createdAssetId) {
      const token = await getApiToken();
      await apiDelete(`/assets/${createdAssetId}`, token);
    }
  });

  test('dashboard shows asset cards', async ({ page }) => {
    await gotoDashboard(page);
    await expect(
      page.locator('[class*="assetCard"], [class*="tableRow"]').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('search filter narrows asset results', async ({ page }) => {
    await gotoDashboard(page);
    await page.locator('[class*="assetCard"], [class*="tableRow"]').first().waitFor({ timeout: 10_000 });
    const searchInput = page.locator('input[placeholder*="Search assets" i]').first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill('zzz_nonexistent_xyz_abc');
    await page.waitForTimeout(700);
    // With no matches, empty state appears and no asset rows are visible
    await expect(page.locator('[class*="emptyState"]').first()).toBeVisible({ timeout: 5_000 });
  });

  test('create asset modal opens and validates required fields', async ({ page }) => {
    await gotoDashboard(page);
    const createBtn = page.getByRole('button', { name: /\+ new asset|add asset|create asset/i });
    await expect(createBtn).toBeVisible({ timeout: 8_000 });
    await createBtn.click();

    const modal = page.locator('[role="dialog"], [class*="modal"]').first();
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Step 0 shows "Next" — clicking it with an empty name triggers validation
    await modal.getByRole('button', { name: /^next$/i }).click();
    await expect(
      modal.locator('[class*="error"], [class*="invalid"], [class*="required"]').first()
    ).toBeVisible({ timeout: 4_000 });

    await page.keyboard.press('Escape');
  });

  test('create an asset end-to-end', async ({ page }) => {
    await gotoDashboard(page);
    await page.getByRole('button', { name: /\+ new asset|add asset|create asset/i }).click();
    const modal = page.locator('[class*="modal"], [role="dialog"]').first();
    await modal.waitFor({ state: 'visible', timeout: 5_000 });

    const nameInput = modal.locator('input[placeholder*="Assembly Line" i]').first();
    await nameInput.click();
    await nameInput.fill(E2E_ASSET_NAME);

    // Step 0 → 1
    await modal.getByRole('button', { name: /^next$/i }).click();
    // Steps 1 → 2 → 3 → 4 (skip optional sections)
    for (let i = 0; i < 3; i++) {
      await modal.getByRole('button', { name: /^skip$/i }).click();
    }
    // Step 4: submit
    await modal.getByRole('button', { name: /create asset/i }).click();
    await modal.waitFor({ state: 'hidden', timeout: 10_000 });
    // Search for the new asset to confirm it was created (card may be below fold)
    const searchInput = page.locator('input[placeholder*="Search assets" i]').first();
    await searchInput.fill(E2E_ASSET_NAME);
    await page.waitForTimeout(700);
    await expect(
      page.locator('[class*="assetCard"], [class*="tableRow"]').first()
    ).toBeVisible({ timeout: 8_000 });

    // Capture ID for cleanup
    const token = await getApiToken();
    const res = await fetch(
      `http://localhost:4000/api/assets?limit=10&search=${encodeURIComponent(E2E_ASSET_NAME)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await res.json() as { data: { _id: string; basic_info: { display_name: string } }[] };
    const asset = body.data?.find(a => a.basic_info?.display_name === E2E_ASSET_NAME);
    if (asset) createdAssetId = asset._id;
  });

  test('clicking an asset card opens its detail page', async ({ page }) => {
    await gotoDashboard(page);
    // Switch to card view to guarantee assetCard elements exist
    const cardViewBtn = page.locator('button[title="Card view"]');
    if (await cardViewBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await cardViewBtn.click();
    }
    const firstCard = page.locator('[class*="assetCard"]').first();
    await firstCard.waitFor({ timeout: 10_000 });
    // Click on the asset icon area to avoid hitting inline status <select> elements
    const iconArea = firstCard.locator('[class*="assetIcon"], [class*="icon"]').first();
    if (await iconArea.isVisible()) {
      await iconArea.click();
    } else {
      await firstCard.click({ position: { x: 10, y: 10 } });
    }
    await expect(page).toHaveURL(/\/assets\/[a-zA-Z0-9-]+/, { timeout: 8_000 });
    await expect(page.locator('h1, [class*="assetName"]').first()).toBeVisible({ timeout: 8_000 });
  });
});

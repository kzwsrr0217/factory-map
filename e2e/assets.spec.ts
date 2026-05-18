import { test, expect } from '@playwright/test';
import { getApiToken, apiDelete } from './helpers';

// Assets are managed from the Dashboard (no standalone /assets list route)
const E2E_ASSET_NAME = `E2E_Asset_${Date.now()}`;
let createdAssetId: string | null = null;

test.describe('Assets', () => {
  test.afterAll(async () => {
    if (createdAssetId) {
      const token = await getApiToken();
      await apiDelete(`/assets/${createdAssetId}`, token);
    }
  });

  test('dashboard shows asset cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[class*="assetCard"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('search filter narrows asset results', async ({ page }) => {
    await page.goto('/');
    await page.locator('[class*="assetCard"]').first().waitFor({ timeout: 10_000 });
    const searchInput = page.locator('input[placeholder*="Search assets" i]').first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill('zzz_nonexistent_xyz_abc');
    await page.waitForTimeout(700);
    // With no matches, the empty state or zero cards should appear
    const cards = page.locator('[class*="assetCard"]');
    expect(await cards.count()).toBe(0);
  });

  test('create asset modal opens and validates required fields', async ({ page }) => {
    await page.goto('/');
    const createBtn = page.getByRole('button', { name: /\+ new asset|add asset|create asset/i });
    await expect(createBtn).toBeVisible({ timeout: 8_000 });
    await createBtn.click();

    await expect(page.locator('[class*="modal"], [role="dialog"]').first()).toBeVisible({ timeout: 5_000 });

    // Submit with empty name — should show validation error
    await page.getByRole('button', { name: /save|create|submit/i }).first().click();
    await expect(
      page.locator('[class*="error"], [class*="invalid"], [class*="required"]').first()
    ).toBeVisible({ timeout: 4_000 });

    await page.keyboard.press('Escape');
  });

  test('create an asset end-to-end', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /\+ new asset|add asset|create asset/i }).click();
    const modal = page.locator('[class*="modal"], [role="dialog"]').first();
    await modal.waitFor({ state: 'visible', timeout: 5_000 });

    // The display name input uses placeholder "e.g., John's Workstation"
    const nameInput = modal.locator('input[placeholder*="Workstation" i]').first();
    await nameInput.click();
    await nameInput.fill(E2E_ASSET_NAME);

    await modal.getByRole('button', { name: /save|create asset/i }).click();
    await modal.waitFor({ state: 'hidden', timeout: 10_000 });
    // Search for the new asset to confirm it was created (card may be below fold)
    const searchInput = page.locator('input[placeholder*="Search assets" i]').first();
    await searchInput.fill(E2E_ASSET_NAME);
    await page.waitForTimeout(700);
    await expect(page.locator('[class*="assetCard"]').first()).toBeVisible({ timeout: 8_000 });

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
    await page.goto('/');
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

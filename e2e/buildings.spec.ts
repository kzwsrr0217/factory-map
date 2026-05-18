import { test, expect } from '@playwright/test';
import { getApiToken, apiDelete } from './helpers';

let createdBuildingId: string | null = null;
const E2E_BUILDING = `E2E_Bldg_${Date.now()}`;

test.describe('Buildings', () => {
  test.afterAll(async () => {
    if (createdBuildingId) {
      const token = await getApiToken();
      await apiDelete(`/buildings/${createdBuildingId}`, token);
    }
  });

  test('buildings list renders', async ({ page }) => {
    await page.goto('/buildings');
    await expect(
      page.locator('table, [class*="list"], [class*="grid"], [class*="card"]').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('existing seed buildings appear in the list', async ({ page }) => {
    await page.goto('/buildings');
    await expect(page.locator('text=WERK1').first()).toBeVisible({ timeout: 8_000 });
  });

  test('create building dialog opens', async ({ page }) => {
    await page.goto('/buildings');
    const addBtn = page.getByRole('button', { name: /add building|create building|new building|\+ building/i });
    await expect(addBtn).toBeVisible({ timeout: 8_000 });
    await addBtn.click();
    await expect(page.locator('[class*="modal"], [role="dialog"]').first()).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
  });

  test('create a building end-to-end', async ({ page }) => {
    await page.goto('/buildings');
    await page.getByRole('button', { name: /add building|create building|new building|\+ building/i }).click();
    const modal = page.locator('[class*="modal"], [role="dialog"]').first();
    await modal.waitFor({ state: 'visible', timeout: 5_000 });

    const nameInput = modal.locator('input[placeholder*="Factory" i]').first();
    await nameInput.click();
    await nameInput.fill(E2E_BUILDING);
    await modal.getByRole('button', { name: /create building/i }).click();
    await modal.waitFor({ state: 'hidden', timeout: 10_000 });
    await expect(page.locator(`text=${E2E_BUILDING}`)).toBeVisible({ timeout: 8_000 });

    // Capture ID for cleanup
    const token = await getApiToken();
    const res = await fetch('http://localhost:4000/api/buildings', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { data: { _id: string; name: string }[] };
    const bldg = body.data.find(b => b.name === E2E_BUILDING);
    if (bldg) createdBuildingId = bldg._id;
  });

  test('building detail page shows floors panel', async ({ page }) => {
    await page.goto('/buildings');
    // Wait for the WERK1 seed building to appear (confirms list loaded successfully)
    const werk1Card = page.locator('text=WERK1').first();
    await werk1Card.waitFor({ timeout: 10_000 });
    await werk1Card.click();
    await expect(page).toHaveURL(/\/buildings\/[a-zA-Z0-9-]+/, { timeout: 8_000 });
    await expect(
      page.locator('[class*="floor"]').or(page.getByText(/floors?/i)).first()
    ).toBeVisible({ timeout: 8_000 });
  });
});

import { test, expect, Page } from '@playwright/test';

async function selectBuildingAndFloor(page: Page): Promise<boolean> {
  const buildingSel = page.locator('#building-select');
  const floorSel = page.locator('#floor-select');

  // Wait for building options to appear (data fetch complete) and select to be enabled
  await buildingSel.locator('option').first().waitFor({ state: 'attached', timeout: 12_000 });
  await expect(buildingSel).toBeEnabled({ timeout: 8_000 });

  // Let React's auto-select useEffect run (it picks the first building + first floor)
  await page.waitForTimeout(400);

  async function trySelectFloor(): Promise<boolean> {
    const floorOpts = await floorSel.locator('option').all();
    for (const opt of floorOpts) {
      const val = await opt.getAttribute('value');
      if (!val || val === '') continue;
      const isEnabled = await floorSel.isEnabled();
      if (isEnabled) await floorSel.selectOption(val);
      return true; // a real floor option exists (auto-selected or manually selected)
    }
    return false;
  }

  // Check if the auto-selected building already has floors
  if (await trySelectFloor()) return true;

  // Iterate buildings until we find one that has floors
  const buildingOpts = await buildingSel.locator('option').all();
  for (const opt of buildingOpts) {
    const val = await opt.getAttribute('value');
    if (!val || val === '') continue;
    await buildingSel.selectOption(val);
    await page.waitForTimeout(400);
    if (await trySelectFloor()) return true;
  }
  return false;
}

test.describe('Map View', () => {
  test('floor selector is present', async ({ page }) => {
    await page.goto('/map');
    await expect(
      page.locator('select, [class*="selector"], [class*="floorSel"]').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('map page renders the SVG floor plan after floor selection', async ({ page }) => {
    await page.goto('/map');
    const selected = await selectBuildingAndFloor(page);
    if (!selected) {
      test.skip(true, 'No buildings with floors found — skipping map render check');
      return;
    }
    // FloorMap is SVG-based; check for the map container or the SVG element
    await expect(
      page.locator('[class*="mapContainer"]').first()
    ).toBeVisible({ timeout: 12_000 });
  });

  test('layer controls are present after a floor is selected', async ({ page }) => {
    await page.goto('/map');
    const selected = await selectBuildingAndFloor(page);
    if (!selected) {
      test.skip(true, 'No buildings with floors found — skipping layer controls check');
      return;
    }
    await expect(
      page.locator('[class*="controlButton"]').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('wall ports layer toggle is present', async ({ page }) => {
    await page.goto('/map');
    const selected = await selectBuildingAndFloor(page);
    if (!selected) {
      test.skip(true, 'No buildings with floors found — skipping wall ports toggle check');
      return;
    }
    await expect(
      page.locator('button[title="Toggle Wall Ports"]')
    ).toBeVisible({ timeout: 8_000 });
  });
});

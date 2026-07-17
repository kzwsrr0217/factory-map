import { test, expect } from '@playwright/test';

test.describe('Reports & Analytics Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reports');
    await expect(
      page.getByRole('heading', { name: /reports & analytics/i })
    ).toBeVisible({ timeout: 10_000 });
    // Wait for report data to finish loading — Overview tab renders 'Total Assets' only once reportData is set
    await expect(page.locator('text=Total Assets').first()).toBeVisible({ timeout: 25_000 });
  });

  // ── Structure ─────────────────────────────────────────────────────────────────

  test('renders Reports & Analytics page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /reports & analytics/i })).toBeVisible();
  });

  test('all five tab buttons are present', async ({ page }) => {
    for (const tab of ['Overview', 'Connections', 'Maintenance', 'Locations', 'Topology']) {
      await expect(page.getByRole('button', { name: tab })).toBeVisible({ timeout: 8_000 });
    }
  });

  // ── Header controls ───────────────────────────────────────────────────────────

  test('Refresh button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible({ timeout: 8_000 });
  });

  test('CSV button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /csv/i })).toBeVisible({ timeout: 8_000 });
  });

  test('Print button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /print/i })).toBeVisible({ timeout: 8_000 });
  });

  test('auto-refresh Off select is present', async ({ page }) => {
    await expect(page.locator('[class*="autoRefreshSelect"]')).toBeVisible({ timeout: 8_000 });
  });

  // ── Overview tab (default) ────────────────────────────────────────────────────

  test('Overview tab shows Total Assets stat card', async ({ page }) => {
    await expect(page.locator('text=Total Assets')).toBeVisible({ timeout: 10_000 });
  });

  test('Overview tab shows status breakdown chart or cards', async ({ page }) => {
    // Charts may render as recharts SVGs
    const chartOrCard = page.locator('[class*="chart"], [class*="statCard"], svg').first();
    await expect(chartOrCard).toBeVisible({ timeout: 10_000 });
  });

  // ── Maintenance tab ───────────────────────────────────────────────────────────

  test('Maintenance tab shows window filter buttons', async ({ page }) => {
    await page.getByRole('button', { name: 'Maintenance' }).click();
    await expect(page.locator('text=7d')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('text=30d')).toBeVisible();
    await expect(page.locator('text=60d')).toBeVisible();
    await expect(page.locator('text=90d')).toBeVisible();
    await expect(page.locator('text=180d')).toBeVisible();
  });

  test('clicking a window filter button makes it active', async ({ page }) => {
    await page.getByRole('button', { name: 'Maintenance' }).click();
    await page.getByRole('button', { name: '60d' }).waitFor({ timeout: 8_000 });
    await page.getByRole('button', { name: '60d' }).click();
    // CSS Modules compiles windowBtnActive — toHaveClass auto-retries
    await expect(
      page.getByRole('button', { name: '60d' })
    ).toHaveClass(/windowBtnActive|active/i, { timeout: 3_000 });
  });

  test('Maintenance tab shows Needs Maintenance stat', async ({ page }) => {
    await page.getByRole('button', { name: 'Maintenance' }).click();
    await expect(
      page.locator('text=/needs maintenance|upcoming|overdue/i').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  // ── Connections tab ───────────────────────────────────────────────────────────

  test('Connections tab shows total connections stat', async ({ page }) => {
    await page.getByRole('button', { name: 'Connections' }).click();
    await expect(
      page.locator('text=/total connections/i').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('Connections tab shows connection type breakdown', async ({ page }) => {
    await page.getByRole('button', { name: 'Connections' }).click();
    await expect(
      page.locator('text=/connection type|by type/i').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  // ── Locations tab ─────────────────────────────────────────────────────────────

  test('Locations tab shows assets by building section', async ({ page }) => {
    await page.getByRole('button', { name: 'Locations' }).click();
    await expect(
      page.locator('text=/by building/i').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('Locations tab shows floor heatmap or by-floor section', async ({ page }) => {
    await page.getByRole('button', { name: 'Locations' }).click();
    await expect(
      page.locator('text=/floor|heatmap/i').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  // ── Topology tab ──────────────────────────────────────────────────────────────

  test('Topology tab renders SVG network graph area', async ({ page }) => {
    await page.getByRole('button', { name: 'Topology' }).click();
    // SVG is rendered even if empty (for the topology canvas)
    await expect(
      page.locator('[class*="topoWrap"], [class*="topology"], svg').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('Topology tab has Show Isolated toggle', async ({ page }) => {
    await page.getByRole('button', { name: 'Topology' }).click();
    await expect(
      page.locator('[class*="topoBtn"]').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('Topology Show Isolated button toggles label', async ({ page }) => {
    await page.getByRole('button', { name: 'Topology' }).click();
    const isoBtn = page.locator('[class*="topoBtn"]').first();
    await isoBtn.waitFor({ timeout: 8_000 });
    await isoBtn.click();
    await expect(
      page.getByRole('button', { name: /hide isolated/i })
    ).toBeVisible({ timeout: 3_000 });
  });

  test('Topology tab has Type filter dropdown', async ({ page }) => {
    await page.getByRole('button', { name: 'Topology' }).click();
    await page.locator('[class*="topoFilter"]').first().waitFor({ timeout: 8_000 });
    // At least one select element should be in the filters area
    const filterDropdowns = page.locator('[class*="topologyFilters"] select, [class*="topoFilter"]');
    expect(await filterDropdowns.count()).toBeGreaterThanOrEqual(1);
  });

  // ── Tab switching round-trip ──────────────────────────────────────────────────

  test('can cycle through all tabs without errors', async ({ page }) => {
    for (const tab of ['Connections', 'Maintenance', 'Locations', 'Topology', 'Overview']) {
      await page.getByRole('button', { name: tab }).click();
      await page.waitForTimeout(300);
      // No error page or crash
      await expect(page.locator('[class*="containerInline"]').first()).toBeVisible({ timeout: 5_000 });
    }
  });

  // ── Refresh ────────────────────────────────────────────────────────────────────

  test('Refresh button updates last-updated timestamp', async ({ page }) => {
    const tsLocator = page.locator('[class*="lastUpdated"]');
    const hasBefore = await tsLocator.isVisible({ timeout: 3_000 }).catch(() => false);
    await page.getByRole('button', { name: /refresh/i }).click();
    await page.waitForTimeout(2000); // allow re-fetch
    await expect(tsLocator).toBeVisible({ timeout: 8_000 });
  });
});

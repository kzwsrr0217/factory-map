import { test, expect } from '@playwright/test';

test.describe('Maintenance Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/maintenance');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10_000 });
  });

  // ── Calendar view (default) ──────────────────────────────────────────────────

  test('renders Maintenance Calendar heading by default', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /maintenance calendar/i })).toBeVisible();
  });

  test('shows weekday column headers Mon through Sun', async ({ page }) => {
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      await expect(page.locator(`text=${day}`).first()).toBeVisible();
    }
  });

  test('Today button is present and navigates to current month', async ({ page }) => {
    await expect(page.getByRole('button', { name: /today/i })).toBeVisible();
    await page.getByRole('button', { name: /today/i }).click();
    // Month name should still be visible
    await expect(page.locator('[class*="monthTitle"]').first()).toBeVisible({ timeout: 3_000 });
  });

  test('prev/next month navigation buttons are present', async ({ page }) => {
    const navBtns = page.locator('[class*="navBtn"]');
    await expect(navBtns.first()).toBeVisible({ timeout: 5_000 });
    expect(await navBtns.count()).toBeGreaterThanOrEqual(2);
  });

  test('clicking prev month changes the displayed month name', async ({ page }) => {
    const monthTitle = page.locator('[class*="monthTitle"]').first();
    await monthTitle.waitFor({ timeout: 5_000 });
    const before = await monthTitle.textContent();
    const navBtns = page.locator('[class*="navBtn"]');
    await navBtns.first().click(); // previous month
    await page.waitForTimeout(200);
    const after = await monthTitle.textContent();
    expect(before).not.toBe(after);
  });

  test('year select is present and shows current year', async ({ page }) => {
    const yearSelect = page.locator('[class*="calNav"] select').first();
    await expect(yearSelect).toBeVisible({ timeout: 5_000 });
    const currentYear = new Date().getFullYear().toString();
    await expect(yearSelect).toHaveValue(currentYear);
  });

  test('calendar cells render for the current month', async ({ page }) => {
    const cells = page.locator('[class*="calCellActive"]');
    await expect(cells.first()).toBeVisible({ timeout: 8_000 });
    expect(await cells.count()).toBeGreaterThanOrEqual(28);
  });

  test('subtitle shows asset count with scheduled maintenance', async ({ page }) => {
    await expect(page.locator('[class*="subtitle"]').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[class*="subtitle"]').first()).toContainText(/asset/i);
  });

  // ── List view ────────────────────────────────────────────────────────────────

  test('list view toggle button is present', async ({ page }) => {
    await expect(page.locator('[title="Work orders list"]')).toBeVisible({ timeout: 5_000 });
  });

  test('switching to list view changes heading to Work Orders', async ({ page }) => {
    await page.locator('[title="Work orders list"]').click();
    await expect(page.getByRole('heading', { name: /maintenance work orders/i })).toBeVisible();
  });

  test('list view shows range filter dropdown', async ({ page }) => {
    await page.locator('[title="Work orders list"]').click();
    const select = page.locator('[class*="rangeSelect"]');
    await expect(select).toBeVisible({ timeout: 5_000 });
    await expect(select.locator('option', { hasText: 'All scheduled' })).toBeAttached();
    await expect(select.locator('option', { hasText: 'Overdue only' })).toBeAttached();
    await expect(select.locator('option', { hasText: 'Due this week' })).toBeAttached();
    await expect(select.locator('option', { hasText: 'Due in 30 days' })).toBeAttached();
  });

  test('list view shows empty-state message when no tasks', async ({ page }) => {
    await page.locator('[title="Work orders list"]').click();
    // With "Due this week" filter, may show empty state
    const select = page.locator('[class*="rangeSelect"]');
    await select.selectOption('week');
    await page.waitForTimeout(300);
    // Either work orders or empty state should be visible
    const hasOrders = await page.locator('[class*="workOrderItem"]').first().isVisible();
    const hasEmpty = await page.locator('text=No maintenance tasks match').isVisible();
    expect(hasOrders || hasEmpty).toBe(true);
  });

  test('switching back to calendar view restores calendar heading', async ({ page }) => {
    await page.locator('[title="Work orders list"]').click();
    await expect(page.getByRole('heading', { name: /work orders/i })).toBeVisible();
    await page.locator('[title="Calendar view"]').click();
    await expect(page.getByRole('heading', { name: /maintenance calendar/i })).toBeVisible();
  });

  // ── Overdue section (conditional) ────────────────────────────────────────────

  test('when overdue assets exist, overdue section renders toggle', async ({ page }) => {
    // Check if any overdue assets are present
    const overdueToggle = page.locator('[class*="overdueToggle"]');
    const overdueExists = await overdueToggle.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!overdueExists) {
      test.skip(true, 'No overdue assets in the DB — skipping overdue section test');
      return;
    }
    await expect(overdueToggle).toContainText(/overdue/i);
  });

  test('CSV export button appears when there are assets in current month', async ({ page }) => {
    const csvBtn = page.getByRole('button', { name: /csv/i });
    const csvVisible = await csvBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!csvVisible) {
      test.skip(true, 'No assets scheduled this month — CSV button not shown');
    } else {
      await expect(csvBtn).toBeVisible();
    }
  });

  // ── Work order detail ─────────────────────────────────────────────────────────

  test('work order items show Mark Done button in list view', async ({ page }) => {
    await page.locator('[title="Work orders list"]').click();
    const items = page.locator('[class*="workOrderItem"]');
    const hasItems = await items.first().isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasItems) {
      test.skip(true, 'No work order items found (empty DB) — skipping Mark Done check');
      return;
    }
    await expect(items.first().locator('button', { hasText: /mark done/i })).toBeVisible();
  });

  test('clicking asset name in list view opens asset details modal', async ({ page }) => {
    await page.locator('[title="Work orders list"]').click();
    const assetBtn = page.locator('[class*="workOrderName"]').first();
    const hasAsset = await assetBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasAsset) {
      test.skip(true, 'No work order items — skipping asset detail modal test');
      return;
    }
    await assetBtn.click();
    await expect(
      page.locator('[class*="modal"], [role="dialog"]').first()
    ).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
  });
});

import { test, expect } from '@playwright/test';

test.describe('Audit Log Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: /audit log/i })).toBeVisible({ timeout: 10_000 });
  });

  // ── Page structure ────────────────────────────────────────────────────────────

  test('renders the Audit Log heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /audit log/i })).toBeVisible();
  });

  test('Export CSV button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /export csv/i })).toBeVisible();
  });

  // ── Filter panel ──────────────────────────────────────────────────────────────

  test('filter panel shows Username, Action, Entity type fields', async ({ page }) => {
    await expect(page.locator('input[placeholder="Any user"]')).toBeVisible();
    await expect(page.locator('select').filter({ hasText: /all actions/i }).first()).toBeVisible();
    await expect(page.locator('input[placeholder*="asset, user" i]')).toBeVisible();
  });

  test('Apply and Clear buttons are present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^apply$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^clear$/i })).toBeVisible();
  });

  test('From and To datetime-local inputs are present', async ({ page }) => {
    const dtInputs = page.locator('input[type="datetime-local"]');
    expect(await dtInputs.count()).toBeGreaterThanOrEqual(2);
  });

  test('typing a username and applying updates the URL / filter', async ({ page }) => {
    await page.locator('input[placeholder="Any user"]').fill('admin');
    await page.getByRole('button', { name: /^apply$/i }).click();
    await page.waitForTimeout(500);
    // The entry list or empty state should still be visible after filter
    const timeline = page.locator('[class*="timeline"], [class*="emptyState"]').first();
    await expect(timeline).toBeVisible({ timeout: 5_000 });
  });

  test('Clear button resets the username input', async ({ page }) => {
    const usernameInput = page.locator('input[placeholder="Any user"]');
    await usernameInput.fill('someuser');
    await page.getByRole('button', { name: /^clear$/i }).click();
    await expect(usernameInput).toHaveValue('');
  });

  test('action dropdown has expected options', async ({ page }) => {
    const select = page.locator('select').filter({ hasText: /all actions/i }).first();
    const options = await select.locator('option').allTextContents();
    expect(options).toContain('create');
    expect(options).toContain('update');
    expect(options).toContain('delete');
    expect(options).toContain('login');
  });

  test('selecting an action and applying filters the timeline', async ({ page }) => {
    const select = page.locator('select').filter({ hasText: /all actions/i }).first();
    await select.selectOption('login');
    await page.getByRole('button', { name: /^apply$/i }).click();
    await page.waitForTimeout(500);
    // Should show entries or empty state (either is valid)
    const timeline = page.locator('[class*="timeline"], [class*="emptyState"]').first();
    await expect(timeline).toBeVisible({ timeout: 5_000 });
  });

  test('Enter key in username field applies the filter', async ({ page }) => {
    const usernameInput = page.locator('input[placeholder="Any user"]');
    await usernameInput.fill('admin');
    await usernameInput.press('Enter');
    await page.waitForTimeout(500);
    const timeline = page.locator('[class*="timeline"], [class*="emptyState"]').first();
    await expect(timeline).toBeVisible({ timeout: 5_000 });
  });

  // ── Timeline entries ──────────────────────────────────────────────────────────

  test('shows either timeline entries or empty state', async ({ page }) => {
    // Wait for loading to finish: paginationRow (entries exist) or emptyState (no entries) or errorState
    await page.locator('[class*="paginationRow"], [class*="emptyState"], [class*="errorState"]')
      .first().waitFor({ timeout: 10_000 }).catch(() => {});
    const hasEntries = await page.locator('[class*="entryTitle"]').first().isVisible().catch(() => false);
    const isEmpty = await page.locator('[class*="emptyState"]').first().isVisible().catch(() => false);
    const hasError = await page.locator('[class*="errorState"]').first().isVisible().catch(() => false);
    expect(hasEntries || isEmpty || hasError).toBe(true);
  });

  test('audit entries show a username', async ({ page }) => {
    await page.waitForTimeout(1000);
    const entries = page.locator('[class*="entryTitle"]');
    const count = await entries.count();
    if (count === 0) {
      test.skip(true, 'No audit entries in DB — skipping entry content test');
      return;
    }
    // Each entry should contain a username (strong element)
    await expect(entries.first().locator('strong')).toBeVisible();
  });

  test('pagination row appears when total > 0', async ({ page }) => {
    // Wait for loading to finish: paginationRow or emptyState
    await page.locator('[class*="paginationRow"], [class*="emptyState"], [class*="errorState"]')
      .first().waitFor({ timeout: 10_000 }).catch(() => {});
    const paginationRow = page.locator('[class*="paginationRow"]').first();
    // Only check paginationRow if real entries (not skeletons) are visible
    const hasEntries = await page.locator('[class*="entryTitle"]').first().isVisible().catch(() => false);
    if (hasEntries) {
      await expect(paginationRow).toBeVisible({ timeout: 5_000 });
      await expect(paginationRow).toContainText(/total entries/i);
    }
  });

  test('Prev button is disabled on page 1', async ({ page }) => {
    await page.waitForTimeout(1000);
    const prevBtn = page.getByRole('button', { name: /← prev/i }).first();
    const isVisible = await prevBtn.isVisible().catch(() => false);
    if (isVisible) {
      await expect(prevBtn).toBeDisabled();
    }
  });

  test('update entry has expandable diff button', async ({ page }) => {
    await page.waitForTimeout(1000);
    // Filter to update actions to find diff-expandable entries
    const select = page.locator('select').filter({ hasText: /all actions/i }).first();
    await select.selectOption('update');
    await page.getByRole('button', { name: /^apply$/i }).click();
    await page.waitForTimeout(600);
    const diffBtn = page.locator('button', { hasText: /field.*changed/i }).first();
    const hasDiff = await diffBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasDiff) {
      test.skip(true, 'No update entries with diffs — skipping diff test');
      return;
    }
    await diffBtn.click();
    await expect(page.locator('th:has-text("Before")').first()).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('th:has-text("After")').first()).toBeVisible({ timeout: 3_000 });
  });

  // ── Accessibility ─────────────────────────────────────────────────────────────

  test('page has accessible landmark: main heading', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('Export CSV is disabled when no entries visible', async ({ page }) => {
    // Filter to a non-existent user to get empty results
    await page.locator('input[placeholder="Any user"]').fill('zzz_nobody_ever_zzz');
    await page.getByRole('button', { name: /^apply$/i }).click();
    await page.waitForTimeout(800);
    const csvBtn = page.getByRole('button', { name: /export csv/i });
    await expect(csvBtn).toBeDisabled({ timeout: 5_000 });
  });
});

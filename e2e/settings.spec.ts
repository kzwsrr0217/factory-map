import { test, expect } from '@playwright/test';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /settings/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  // ── Page structure ────────────────────────────────────────────────────────────

  test('renders Settings heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /settings/i }).first()).toBeVisible();
  });

  test('shows all major sections', async ({ page }) => {
    for (const section of ['Appearance', 'Display', 'Map', 'Security', 'Active Sessions', 'Account']) {
      await expect(page.locator(`text=${section}`).first()).toBeVisible();
    }
  });

  test('Save settings and Reset to defaults buttons are present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /save settings/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /reset to defaults/i })).toBeVisible();
  });

  // ── Appearance ────────────────────────────────────────────────────────────────

  test('Light and Dark theme buttons are present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /^light$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^dark$/i })).toBeVisible();
  });

  test('clicking Dark then Light switches theme back', async ({ page }) => {
    const htmlEl = page.locator('html');
    await page.getByRole('button', { name: /^dark$/i }).click();
    await page.waitForTimeout(300);
    const darkTheme = await htmlEl.getAttribute('data-theme');
    await page.getByRole('button', { name: /^light$/i }).click();
    await page.waitForTimeout(300);
    const lightTheme = await htmlEl.getAttribute('data-theme');
    expect(darkTheme).not.toBe(lightTheme);
  });

  // ── Display ───────────────────────────────────────────────────────────────────

  test('items-per-page chip buttons are present', async ({ page }) => {
    for (const n of ['10', '25', '50', '100']) {
      await expect(page.getByRole('button', { name: n }).first()).toBeVisible();
    }
  });

  test('clicking a chip changes the active selection', async ({ page }) => {
    const btn100 = page.getByRole('button', { name: '100' }).first();
    await btn100.click();
    await expect(btn100).toHaveClass(/active/i);
  });

  test('date format chips are present', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Relative', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Short', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Long', exact: true })).toBeVisible();
  });

  // ── Map ────────────────────────────────────────────────────────────────────────

  test('Map section grid size buttons are present', async ({ page }) => {
    for (const size of ['10px', '20px', '40px', '80px']) {
      await expect(page.getByRole('button', { name: size })).toBeVisible();
    }
  });

  test('Snap to grid toggle is present', async ({ page }) => {
    const toggle = page.locator('[class*="toggle"]').first();
    await expect(toggle).toBeVisible({ timeout: 5_000 });
  });

  // ── Security / Password form ──────────────────────────────────────────────────

  test('password form shows all three input labels', async ({ page }) => {
    await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
    await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Confirm new password', { exact: true })).toBeVisible();
  });

  test('submitting empty password form shows required-fields error', async ({ page }) => {
    await page.getByRole('button', { name: /change password/i }).click();
    await expect(page.locator('text=All fields are required.')).toBeVisible({ timeout: 4_000 });
  });

  test('mismatched passwords show mismatch error', async ({ page }) => {
    await page.getByLabel('Current password', { exact: true }).fill('Current@1234');
    await page.getByLabel('New password', { exact: true }).fill('NewPass@1234');
    await page.getByLabel('Confirm new password', { exact: true }).fill('Different@1234');
    await page.getByRole('button', { name: /change password/i }).click();
    await expect(page.locator('text=New passwords do not match.')).toBeVisible({ timeout: 4_000 });
  });

  test('weak password shows requirements error', async ({ page }) => {
    await page.getByLabel('Current password', { exact: true }).fill('Current@1234');
    await page.getByLabel('New password', { exact: true }).fill('weakonly'); // no uppercase, no number, no special
    await page.getByLabel('Confirm new password', { exact: true }).fill('weakonly');
    await page.getByRole('button', { name: /change password/i }).click();
    await expect(
      page.locator('text=New password does not meet all requirements.')
    ).toBeVisible({ timeout: 4_000 });
  });

  test('typing in new password field shows strength indicator', async ({ page }) => {
    await page.getByLabel('New password', { exact: true }).fill('Test@1234');
    await expect(page.locator('text=/strength:/i')).toBeVisible({ timeout: 3_000 });
  });

  test('password rule checklist appears when typing new password', async ({ page }) => {
    await page.getByLabel('New password', { exact: true }).fill('T');
    await expect(page.locator('text=At least 8 characters')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('text=One uppercase letter')).toBeVisible();
    await expect(page.locator('text=One lowercase letter')).toBeVisible();
    await expect(page.locator('text=One number')).toBeVisible();
    await expect(page.locator('text=One special character')).toBeVisible();
  });

  // ── Sessions section ──────────────────────────────────────────────────────────

  test('Active Sessions section shows session info or empty state', async ({ page }) => {
    // Either sessions are listed, or "No active sessions found."
    await page.waitForTimeout(1000); // let sessions load
    const hasSessions = await page.locator('[class*="sessionRow"]').first().isVisible().catch(() => false);
    const isEmpty = await page.locator('text=No active sessions found.').isVisible().catch(() => false);
    expect(hasSessions || isEmpty).toBe(true);
  });

  test('current session shows "Current" badge', async ({ page }) => {
    await page.waitForTimeout(1000);
    const hasSessions = await page.locator('[class*="sessionRow"]').first().isVisible().catch(() => false);
    if (!hasSessions) {
      test.skip(true, 'No sessions visible — skipping current session badge test');
      return;
    }
    await expect(page.locator('[class*="sessionCurrentBadge"]').first()).toBeVisible();
  });

  // ── Account section ────────────────────────────────────────────────────────────

  test('Account section shows signed-in username', async ({ page }) => {
    await expect(page.locator('[class*="userChip"]').first()).toContainText('admin');
  });

  test('Account section shows role pill', async ({ page }) => {
    await expect(page.locator('[class*="rolePill"]').first()).toBeVisible();
  });

  test('email address input is present', async ({ page }) => {
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 5_000 });
  });

  test('link to audit log is present', async ({ page }) => {
    await expect(page.getByRole('link', { name: /view audit log/i })).toBeVisible();
  });

  test('Save settings shows Saved confirmation', async ({ page }) => {
    await page.getByRole('button', { name: /save settings/i }).click();
    await expect(page.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 3_000 });
  });

  // ── Admin: User Management link ───────────────────────────────────────────────

  test('admin user sees Manage users link', async ({ page }) => {
    await expect(page.getByRole('link', { name: /manage users/i })).toBeVisible({ timeout: 5_000 });
  });
});

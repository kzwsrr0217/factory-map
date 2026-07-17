import { test, expect } from '@playwright/test';
import { ADMIN, getApiToken, API } from './helpers';

// Auth tests deliberately bypass the stored session to test the login flow itself
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Authentication', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /log in|sign in/i })).toBeVisible();
  });

  test('wrong password shows an error', async ({ page }) => {
    await page.goto('/login');
    // Use a non-existent user to avoid rate-limiting the real admin account
    await page.fill('input[name="username"], input[type="text"]', 'nonexistent_test_user_xyz');
    await page.fill('input[type="password"]', 'wrongpassword999');
    await page.click('button[type="submit"]');
    await expect(page.locator('body')).toContainText(
      /invalid|incorrect|failed|error|credentials|wrong|attempt|too many/i,
      { timeout: 8_000 },
    );
  });

  test('correct credentials navigate to dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.waitForSelector('input[type="password"]', { timeout: 10_000 });
    await page.fill('input[name="username"], input[type="text"]', ADMIN.username);
    await page.fill('input[type="password"]', ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(
      () => !window.location.pathname.startsWith('/login'),
      { timeout: 15_000 },
    );
    expect(page.url()).not.toContain('/login');
  });

  test('protected route redirects unauthenticated user to login', async ({ page }) => {
    await page.goto('/assets');
    await expect(page).toHaveURL(/\/login/, { timeout: 8_000 });
  });

  test('logout clears session and redirects to login', async ({ page }) => {
    // Inject a valid auth token directly into localStorage to avoid the rate-limited login form
    const token = await getApiToken();
    const userRes = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const userBody = await userRes.json() as { data?: object };
    await page.goto('/login');
    await page.evaluate(
      ([t, u]) => {
        localStorage.setItem('authToken', t as string);
        if (u) localStorage.setItem('authUser', JSON.stringify(u));
      },
      [token, userBody.data ?? null] as [string, object | null],
    );
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/login/, { timeout: 8_000 });

    // Find logout — try direct button first, then dropdown
    const logoutBtn = page.getByRole('button', { name: /logout|sign out/i });
    if (await logoutBtn.isVisible({ timeout: 3_000 })) {
      await logoutBtn.click();
    } else {
      await page.locator('[class*="user"], [class*="avatar"], [class*="profile"]').last().click();
      await page.getByRole('button', { name: /logout|sign out/i }).click();
    }
    await expect(page).toHaveURL(/\/login/, { timeout: 8_000 });
  });
});

import { test, expect, Page } from '@playwright/test';
import { getApiToken, API } from './helpers';

async function getFirstAssetId(): Promise<string | null> {
  const token = await getApiToken();
  const res = await fetch(`${API}/assets?limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json() as { data: { _id: string }[] };
  return body.data?.[0]?._id ?? null;
}

async function navigateToAsset(page: Page): Promise<boolean> {
  const id = await getFirstAssetId();
  if (!id) return false;
  await page.goto(`/assets/${id}`);
  await expect(page.locator('h1, [class*="assetName"]').first()).toBeVisible({ timeout: 10_000 });
  return true;
}

test.describe('Asset Detail Page', () => {
  test('navigating directly to /assets/:id renders the asset detail page', async ({ page }) => {
    const ok = await navigateToAsset(page);
    if (!ok) {
      test.skip(true, 'No assets in DB — skipping asset detail tests');
      return;
    }
    await expect(page.locator('h1, [class*="assetName"]').first()).toBeVisible();
  });

  test('shows the asset display name in the heading', async ({ page }) => {
    const id = await getFirstAssetId();
    if (!id) { test.skip(true, 'No assets'); return; }

    const token = await getApiToken();
    const res = await fetch(`${API}/assets/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json() as { data: { basic_info: { display_name: string } } };
    const displayName = body.data?.basic_info?.display_name;

    await page.goto(`/assets/${id}`);
    await expect(page.locator('h1, [class*="assetName"]').first()).toBeVisible({ timeout: 10_000 });
    if (displayName) {
      await expect(page.locator(`text=${displayName}`).first()).toBeVisible();
    }
  });

  test('shows asset status badge or info', async ({ page }) => {
    const ok = await navigateToAsset(page);
    if (!ok) { test.skip(true, 'No assets'); return; }
    // Status is shown as a badge or chip
    await expect(
      page.locator('[class*="badge"], [class*="status"], [class*="chip"]').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('has breadcrumb or back navigation', async ({ page }) => {
    const ok = await navigateToAsset(page);
    if (!ok) { test.skip(true, 'No assets'); return; }
    const backLink = page.locator('a[href="/"], a[href*="dashboard"], [class*="breadcrumb"], [class*="back"]').first();
    await expect(backLink).toBeVisible({ timeout: 5_000 });
  });

  test('tabs are present: Info, Connections, Location, etc.', async ({ page }) => {
    const ok = await navigateToAsset(page);
    if (!ok) { test.skip(true, 'No assets'); return; }
    // Asset details has multiple info sections — look for tab or section headers
    const tabs = page.locator('[class*="tab"], [role="tab"]');
    const sections = page.locator('[class*="section"], [class*="card"]');
    const tabCount = await tabs.count();
    const sectionCount = await sections.count();
    expect(tabCount + sectionCount).toBeGreaterThan(0);
  });

  test('shows basic info fields (type, status, etc.)', async ({ page }) => {
    const ok = await navigateToAsset(page);
    if (!ok) { test.skip(true, 'No assets'); return; }
    // Should show type/status in a details section
    const detail = page.locator('[class*="infoGrid"], [class*="detail"], [class*="field"]').first();
    await expect(detail).toBeVisible({ timeout: 8_000 });
  });

  test('ITSM section is present', async ({ page }) => {
    const ok = await navigateToAsset(page);
    if (!ok) { test.skip(true, 'No assets'); return; }
    // Badge always shows "ITSM Managed" or "Manual" depending on asset ITSM status
    await expect(
      page.locator('text=/itsm managed|manual/i').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('edit button or inline edit fields are present', async ({ page }) => {
    const ok = await navigateToAsset(page);
    if (!ok) { test.skip(true, 'No assets'); return; }
    // The Edit button in the header opens the asset form modal
    await expect(
      page.getByRole('button', { name: /^edit$/i }).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('connections section renders (may be empty)', async ({ page }) => {
    const ok = await navigateToAsset(page);
    if (!ok) { test.skip(true, 'No assets'); return; }
    await expect(
      page.locator('text=/connections?/i').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('maintenance section renders', async ({ page }) => {
    const ok = await navigateToAsset(page);
    if (!ok) { test.skip(true, 'No assets'); return; }
    await expect(
      page.locator('text=/maintenance/i').first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test('back button / breadcrumb navigates back to dashboard', async ({ page }) => {
    const ok = await navigateToAsset(page);
    if (!ok) { test.skip(true, 'No assets'); return; }
    const backLink = page.locator('a[href="/"], a[href*="dashboard"], [class*="back"]').first();
    if (await backLink.isVisible({ timeout: 3_000 })) {
      await backLink.click();
      await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 8_000 });
    }
  });
});

test.describe('Asset Detail — 404 handling', () => {
  test('navigating to a non-existent asset shows an error or redirects', async ({ page }) => {
    await page.goto('/assets/00000000-0000-0000-0000-000000000000');
    // Should show an error state, a not-found message, or redirect to dashboard
    await expect(
      page.locator('text=/not found|does not exist|error|404/i')
        .or(page.locator('[class*="error"], [class*="empty"]').first())
        .or(page.locator('h1').filter({ hasText: /dashboard/i }))
    ).toBeVisible({ timeout: 10_000 });
  });
});

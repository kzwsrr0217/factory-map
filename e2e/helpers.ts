import { Page } from '@playwright/test';

export const ADMIN = { username: 'admin', password: 'Admin@1234' };
export const API = 'http://localhost:4000/api';

export async function login(page: Page, username = ADMIN.username, password = ADMIN.password) {
  await page.goto('/login');
  await page.waitForSelector('input[name="username"], input[type="text"]', { timeout: 10_000 });
  await page.fill('input[name="username"], input[type="text"]', username);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard)?$/, { timeout: 15_000 });
}

/** Get a Bearer token via the API (for cleanup calls). Cached per worker process. */
let _cachedToken: string | null = null;
export async function getApiToken(): Promise<string> {
  if (_cachedToken) return _cachedToken;
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  const body = await res.json() as { data?: { token: string }; error?: string };
  if (!body.data?.token) {
    throw new Error(`getApiToken failed: ${body.error ?? 'no token in response'}`);
  }
  _cachedToken = body.data.token;
  return _cachedToken;
}

/** Delete an entity via the API — used for test cleanup. */
export async function apiDelete(path: string, token: string) {
  await fetch(`${API}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

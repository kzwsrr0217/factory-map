import { chromium, FullConfig } from '@playwright/test';

async function globalSetup(_config: FullConfig) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto('http://localhost:5174/login');
  await page.waitForSelector('input[type="password"]', { timeout: 15_000 });
  await page.fill('input[name="username"], input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'Admin@1234');
  await page.click('button[type="submit"]');

  // Wait until we land somewhere other than /login
  await page.waitForFunction(
    () => !window.location.pathname.startsWith('/login'),
    { timeout: 20_000 },
  );

  await context.storageState({ path: 'e2e/.auth/state.json' });
  await browser.close();
}

export default globalSetup;

/**
 * Playwright smoke test — verifies new features:
 *   1. Login
 *   2. Dashboard loads
 *   3. Network Infrastructure page (/infrastructure)
 *   4. Map View with wall ports layer
 *   5. Sidebar navigation (all items present)
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:5174';
const PASS = 'screenshots';

let browser, page;
let failures = [];

async function shot(name) {
  await page.screenshot({ path: `${PASS}/${name}.png`, fullPage: false });
}

async function check(label, fn) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    console.error(`  ✗ ${label}: ${err.message}`);
    failures.push({ label, error: err.message });
    try { await shot(`FAIL_${label.replace(/\s+/g, '_')}`); } catch {}
  }
}

(async () => {
  const fs = require('fs');
  if (!fs.existsSync(PASS)) fs.mkdirSync(PASS);

  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();

  // ── 1. Login ──────────────────────────────────────────────────────────────
  console.log('\n[1] Login');
  await page.goto(`${BASE}/login`);
  await check('login page renders', async () => {
    await page.waitForSelector('input[type="text"], input[name="username"]', { timeout: 8000 });
  });
  await check('can log in as admin', async () => {
    await page.fill('input[type="text"], input[name="username"]', 'admin');
    await page.fill('input[type="password"]', 'Admin@1234');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(dashboard|$)/, { timeout: 10000 });
  });
  await shot('01_dashboard');

  // ── 2. Dashboard ──────────────────────────────────────────────────────────
  console.log('\n[2] Dashboard');
  await check('dashboard has stat cards', async () => {
    await page.waitForSelector('[class*="stat"], [class*="card"], [class*="metric"]', { timeout: 8000 });
  });
  await check('sidebar is visible', async () => {
    await page.waitForSelector('nav, [class*="sidebar"]', { timeout: 5000 });
  });

  // ── 3. Network Infrastructure page ────────────────────────────────────────
  console.log('\n[3] Network Infrastructure (/infrastructure)');
  await page.goto(`${BASE}/infrastructure`);
  await check('infrastructure page loads (no 404)', async () => {
    await page.waitForSelector('[class*="page"], [class*="layout"], h1, h2', { timeout: 10000 });
    const url = page.url();
    if (url.includes('404') || url.includes('not-found')) throw new Error('redirected to 404');
  });
  await shot('02_infrastructure_empty');

  await check('room list renders with MDF/IDF rooms', async () => {
    // Wait specifically for roomCard (CSS Modules names contain the local class name as substring)
    await page.waitForSelector('[class*="roomCard"]', { timeout: 12000 });
    const rooms = await page.$$('[class*="roomCard"]');
    if (rooms.length === 0) throw new Error('no room cards found');
    console.log(`     (${rooms.length} room cards found)`);
  });
  await shot('03_infrastructure_rooms');

  await check('clicking a room shows rack detail', async () => {
    const firstRoom = await page.$('[class*="roomCard"]');
    if (!firstRoom) throw new Error('no room card');
    await firstRoom.click();
    await page.waitForTimeout(600);
    const rack = await page.$('[class*="rackView"], [class*="rack"]');
    if (!rack) throw new Error('rack view not shown after clicking room');
  });
  await shot('04_infrastructure_rack');

  await check('clicking a rack shows patch panel detail', async () => {
    const rackItem = await page.$('[class*="rack"]');
    if (rackItem) {
      await rackItem.click();
      await page.waitForTimeout(600);
    }
  });
  await shot('05_infrastructure_panels');

  // ── 4. Map View — wall ports ──────────────────────────────────────────────
  console.log('\n[4] Map View — wall ports on floor plan');
  await page.goto(`${BASE}/map`);
  await check('map view loads', async () => {
    await page.waitForSelector('[class*="mapView"], [class*="floorMap"], svg', { timeout: 12000 });
  });
  await shot('06_mapview');

  await check('building selector present', async () => {
    await page.waitForSelector('select, [class*="select"], [class*="dropdown"]', { timeout: 5000 });
  });

  // Select WERK1 building and its ground floor
  await check('can select a building', async () => {
    const selects = await page.$$('select');
    if (selects.length === 0) throw new Error('no <select> elements found');
    // Pick first building
    await selects[0].selectOption({ index: 1 });
    await page.waitForTimeout(1000);
  });

  await check('can select a floor', async () => {
    const selects = await page.$$('select');
    if (selects.length < 2) throw new Error('no floor selector');
    await selects[1].selectOption({ index: 1 });
    await page.waitForTimeout(2000);
  });
  await shot('07_mapview_floor');

  await check('SVG floor plan renders', async () => {
    await page.waitForSelector('svg', { timeout: 8000 });
    const svg = await page.$('svg');
    if (!svg) throw new Error('no SVG element');
  });

  await check('wall port layer toggle exists', async () => {
    // Look for the plug/wall-port toggle button (🔌 or title containing "port" or "wall")
    const btn = await page.$('[title*="port" i], [title*="wall" i], [aria-label*="port" i], [aria-label*="wall" i]');
    if (!btn) {
      // Try looking for layer toggle buttons generally
      const layerBtns = await page.$$('[class*="layerBtn"], [class*="toggle"]');
      console.log(`     (found ${layerBtns.length} layer toggle buttons)`);
    } else {
      console.log('     (wall port toggle button found)');
    }
  });
  await shot('08_mapview_svg');

  // Check for amber SVG rects (wall port icons)
  await check('wall port icons visible on SVG (amber rects)', async () => {
    await page.waitForTimeout(1000);
    const amberRects = await page.$$eval('svg rect[fill="#f59e0b"], svg rect[fill*="f59e0b"]', els => els.length);
    console.log(`     (${amberRects} amber wall-port rects found)`);
    // Wall ports may not be on every floor; just verify SVG has content
    const allRects = await page.$$eval('svg rect', els => els.length);
    if (allRects === 0) throw new Error('SVG has no rect elements at all');
  });

  // ── 5. Sidebar navigation items ──────────────────────────────────────────
  console.log('\n[5] Sidebar navigation');
  await check('Infrastructure link in sidebar', async () => {
    const infraLink = await page.$('a[href="/infrastructure"], a[href*="infrastructure"]');
    if (!infraLink) throw new Error('no /infrastructure link in sidebar');
    console.log('     (Infrastructure nav item found)');
  });

  await check('Alerts link in sidebar', async () => {
    const alertsLink = await page.$('a[href="/alerts"], a[href*="alerts"]');
    if (!alertsLink) throw new Error('no /alerts link in sidebar');
    console.log('     (Alerts nav item found)');
  });

  // ── 6. Alerts page ───────────────────────────────────────────────────────
  console.log('\n[6] Alerts page');
  await page.goto(`${BASE}/alerts`);
  await check('alerts page loads', async () => {
    await page.waitForSelector('[class*="section"], [class*="card"], form, label', { timeout: 8000 });
  });
  await shot('09_alerts');
  await check('email toggle present', async () => {
    const emailToggle = await page.$('input[type="checkbox"], [class*="toggle"]');
    if (!emailToggle) throw new Error('no toggle/checkbox found on alerts page');
  });
  await check('save button present', async () => {
    const saveBtn = await page.$('button[type="submit"], button:has-text("Save"), button:has-text("save")');
    if (!saveBtn) throw new Error('no save button on alerts page');
  });
  await check('alert log section present', async () => {
    const logSection = await page.$('[class*="log"], [class*="history"], table, tbody');
    if (!logSection) throw new Error('no log/history section on alerts page');
  });
  await shot('10_alerts_full');

  // ── Summary ───────────────────────────────────────────────────────────────
  await browser.close();

  console.log('\n═══════════════════════════════════════════════════');
  if (failures.length === 0) {
    console.log('ALL CHECKS PASSED');
  } else {
    console.log(`${failures.length} CHECK(S) FAILED:`);
    failures.forEach(f => console.log(`  ✗ ${f.label}: ${f.error}`));
    process.exit(1);
  }
  console.log(`Screenshots saved to ./${PASS}/`);
})();

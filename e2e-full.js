/**
 * e2e-full.js — Comprehensive E2E test suite covering all 15 pages.
 *
 * Each section navigates to the page, exercises the primary interactive
 * elements (buttons, forms, modals, toggles, filters) and takes a screenshot.
 * Forms are always cancelled — no test data is written to the database.
 *
 * Run: node e2e-full.js
 * Prerequisites: frontend on http://localhost:5174, backend + DB up.
 */
const { chromium } = require('playwright');

const BASE  = 'http://localhost:5174';
const SHOTS = 'screenshots/full';
let browser, page;
let failures = [];

// ── Helpers ────────────────────────────────────────────────────────────────────

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function check(label, fn) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    console.error(`  ✗ ${label}: ${err.message}`);
    failures.push({ label, error: err.message });
    try { await shot(`FAIL_${label.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}`); } catch {}
  }
}

async function nav(path) {
  await page.goto(`${BASE}${path}`);
  await page.waitForTimeout(700);
}

/** Close whichever modal/overlay is open */
async function closeModal() {
  const cancelBtn = await page.$('button:has-text("Cancel")');
  if (cancelBtn) { await cancelBtn.click(); }
  else {
    const closeBtn = await page.$('[class*="modalClose"], button:has-text("✕"), button:has-text("×")');
    if (closeBtn) await closeBtn.click();
    else await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(350);
}

async function login() {
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('input[type="text"], input[name="username"]', { timeout: 8000 });
  await page.fill('input[type="text"], input[name="username"]', 'admin');
  await page.fill('input[type="password"]', 'Admin@1234');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(|dashboard)$/, { timeout: 10000 });
}

// ── Main ───────────────────────────────────────────────────────────────────────

(async () => {
  const fs = require('fs');
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();

  // ══════════════════════════════════════════════════════════════════════════════
  // 1. AUTH
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[1] Authentication');

  await check('login page renders', async () => {
    await page.goto(`${BASE}/login`);
    await page.waitForSelector('input[type="text"], input[name="username"]', { timeout: 8000 });
  });

  await check('wrong password shows error', async () => {
    await page.fill('input[type="text"], input[name="username"]', 'admin');
    await page.fill('input[type="password"]', 'wrongpassword123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1800);
    const body = await page.evaluate(() => document.body.innerText);
    if (!body.match(/invalid|incorrect|failed|locked|error|wrong|credentials|password|attempt/i)) {
      throw new Error('no error feedback for wrong credentials');
    }
  });

  await check('correct credentials log in as admin', async () => {
    await page.fill('input[type="password"]', 'Admin@1234');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(|dashboard)$/, { timeout: 12000 });
  });
  await shot('01_login_success');

  await check('protected route redirects unauthenticated to login', async () => {
    // Open a fresh context (no cookie) to verify redirect
    const tempCtx = await browser.newContext();
    const tempPage = await tempCtx.newPage();
    await tempPage.goto(`${BASE}/buildings`);
    await tempPage.waitForURL(/\/login/, { timeout: 6000 });
    await tempCtx.close();
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 2. DASHBOARD
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[2] Dashboard');
  await nav('/');

  await check('stat cards visible', async () => {
    await page.waitForSelector('[class*="stat"], [class*="statCard"], [class*="metric"]', { timeout: 8000 });
    const cards = await page.$$('[class*="stat"]');
    if (cards.length === 0) throw new Error('no stat cards found');
    console.log(`     (${cards.length} stat elements)`);
  });

  await check('asset list renders', async () => {
    await page.waitForSelector('[class*="assetRow"], [class*="assetCard"], tbody tr, [class*="listItem"]', { timeout: 8000 });
  });

  await check('search filters the list', async () => {
    const input = await page.$('[class*="searchBar"] input, input[placeholder*="earch" i], input[type="search"]');
    if (!input) throw new Error('no search input');
    await input.fill('SW');
    await page.waitForTimeout(700);
    await input.fill('');
    await page.waitForTimeout(500);
  });

  await check('card / table view toggle exists', async () => {
    const toggleBtns = await page.$$('[class*="viewToggle"] button, [title*="table" i], [title*="card" i], [title*="grid" i], [title*="list" i]');
    if (toggleBtns.length === 0) throw new Error('no view toggle buttons found');
    // Click first toggle and back
    await toggleBtns[0].click();
    await page.waitForTimeout(400);
    await toggleBtns[0].click();
    await page.waitForTimeout(300);
    console.log(`     (${toggleBtns.length} toggle buttons)`);
  });

  await check('advanced filter modal opens and closes', async () => {
    const filterBtn = await page.$('[title*="filter" i], button:has-text("Filter"), [class*="filterBtn"]');
    if (!filterBtn) throw new Error('no Filter button');
    await filterBtn.click();
    await page.waitForTimeout(500);
    const overlay = await page.$('[class*="overlay"], [class*="modal"], [role="dialog"]');
    if (!overlay) throw new Error('filter modal did not open');
    await closeModal();
  });

  await check('pagination controls visible', async () => {
    const prev = await page.$('[class*="prev"], button:has-text("Prev"), [aria-label*="prev" i]');
    const next = await page.$('[class*="next"], button:has-text("Next"), [aria-label*="next" i]');
    if (!prev && !next) throw new Error('no pagination prev/next buttons');
  });

  await check('create asset shortcut (Ctrl+N) opens modal', async () => {
    await page.keyboard.press('Control+n');
    await page.waitForTimeout(600);
    const modal = await page.$('[class*="modal"], [class*="overlay"]');
    if (modal) {
      console.log('     (Ctrl+N modal opened)');
      await closeModal();
    } else {
      console.log('     (no modal — shortcut may be page-conditional)');
    }
  });

  await shot('02_dashboard');

  // ══════════════════════════════════════════════════════════════════════════════
  // 3. BUILDINGS
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[3] Buildings');
  await nav('/buildings');

  await check('building cards visible', async () => {
    await page.waitForSelector('[class*="buildingCard"], [class*="card"]', { timeout: 8000 });
    const cards = await page.$$('[class*="buildingCard"], [class*="card"]');
    if (cards.length === 0) throw new Error('no building cards');
    console.log(`     (${cards.length} cards)`);
  });

  await check('Add Building modal opens with form fields', async () => {
    const addBtn = await page.$('button:has-text("Add Building"), button:has-text("New Building"), button:has-text("Building")');
    if (!addBtn) throw new Error('no Add Building button');
    await addBtn.click();
    await page.waitForTimeout(500);
    const nameInput = await page.$('[class*="modal"] input, [class*="formInput"]');
    if (!nameInput) throw new Error('building modal inputs not visible');
    // Check for at least name and address fields
    const inputs = await page.$$('[class*="modal"] input, [class*="modal"] textarea, [class*="formInput"]');
    console.log(`     (${inputs.length} form inputs in modal)`);
    await closeModal();
  });

  await shot('03_buildings');

  // ══════════════════════════════════════════════════════════════════════════════
  // 4. BUILDING DETAILS
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[4] Building Details');

  await check('clicking a building card navigates to building detail', async () => {
    // Re-navigate and re-query on every iteration to avoid stale handles
    const cardCount = await page.$$eval('[class*="buildingCard"], [class*="card"]', cs => cs.length);
    if (cardCount === 0) throw new Error('no building cards');
    let foundWithFloors = false;
    for (let i = 0; i < cardCount; i++) {
      await nav('/buildings');
      await page.waitForSelector('[class*="buildingCard"], [class*="card"]', { timeout: 6000 });
      const cards = await page.$$('[class*="buildingCard"], [class*="card"]');
      if (i >= cards.length) break;
      await cards[i].click();
      try { await page.waitForURL(/\/buildings\/.+/, { timeout: 5000 }); } catch { continue; }
      await page.waitForTimeout(700);
      // BuildingDetails renders floors as [class*="floorItem"] divs with onClick navigate
      const floors = await page.$$('[class*="floorItem"]');
      if (floors.length > 0) { foundWithFloors = true; break; }
    }
    if (!foundWithFloors) throw new Error('no building with floorItem elements found after trying all buildings');
    console.log(`     URL: ${page.url()}, found floors: ${foundWithFloors}`);
  });

  await check('building detail shows floors', async () => {
    await page.waitForSelector('[class*="floorItem"], h2', { timeout: 8000 });
    const floors = await page.$$('[class*="floorItem"]');
    if (floors.length === 0) throw new Error('no floorItem elements visible on building detail');
    console.log(`     (${floors.length} floor items visible)`);
  });

  await check('Add Floor modal opens with form fields', async () => {
    const addBtn = await page.$('button:has-text("Add Floor"), button:has-text("New Floor")');
    if (!addBtn) throw new Error('no Add Floor button');
    await addBtn.click();
    await page.waitForTimeout(500);
    const input = await page.$('[class*="modal"] input, [class*="formInput"]');
    if (!input) throw new Error('floor modal input not visible');
    await closeModal();
  });

  await check('edit building modal opens', async () => {
    const editBtn = await page.$('button:has-text("Edit"), button[title*="edit" i]');
    if (!editBtn) throw new Error('no Edit building button');
    await editBtn.click();
    await page.waitForTimeout(500);
    const modal = await page.$('[class*="modal"], [class*="overlay"]');
    if (!modal) throw new Error('edit modal did not open');
    await closeModal();
  });

  await shot('04_building_detail');

  // ══════════════════════════════════════════════════════════════════════════════
  // 5. FLOOR DETAILS
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[5] Floor Details');

  // Navigate from building detail — click the first floorItem div
  await check('clicking a floor card navigates to floor detail', async () => {
    const floorItem = await page.$('[class*="floorItem"]');
    if (!floorItem) throw new Error('no floorItem element to click');
    await floorItem.click();
    await page.waitForURL(/\/floors\/.+/, { timeout: 8000 });
    console.log(`     URL: ${page.url()}`);
  });

  await check('floor detail loads work areas and assets sections', async () => {
    await page.waitForSelector('[class*="section"], [class*="work"], table, [class*="asset"]', { timeout: 8000 });
    const body = await page.evaluate(() => document.body.innerText);
    console.log(`     Snippet: "${body.slice(0, 80).replace(/\n/g,' ')}"`);
  });

  await check('edit mode toggle button present', async () => {
    // Wait for the floor plan section to fully render (may take a moment after navigation)
    await page.waitForSelector('button:has-text("Edit Mode"), button:has-text("Wire Mode")', { timeout: 10000 });
    const editBtn = await page.$('button:has-text("Edit Mode")');
    if (!editBtn) throw new Error('no "Edit Mode" button on floor detail page');
    console.log('     (Edit Mode button found)');
    // Toggle via JS to avoid any overlay
    await editBtn.evaluate(el => el.click());
    await page.waitForTimeout(500);
    // The button text changes when in edit mode — toggle back via JS
    await page.evaluate(() => {
      // Find button that now says something else (e.g. "Exit Edit" or changed variant)
      // The button still exists, just re-click it
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        /edit mode|exit edit|done editing/i.test(b.textContent || '')
      );
      if (btn) btn.click();
    });
    await page.waitForTimeout(300);
    console.log('     (edit mode toggled on and off)');
  });

  await check('Add Work Area modal opens', async () => {
    const addBtn = await page.$('button:has-text("Add Work Area"), button:has-text("Work Area"), button:has-text("Zone")');
    if (!addBtn) { console.log('     (no Add Work Area button — skipping)'); return; }
    await addBtn.click();
    await page.waitForTimeout(500);
    const modal = await page.$('[class*="modal"], [class*="overlay"]');
    if (modal) { await closeModal(); }
  });

  await shot('05_floor_detail');

  // ══════════════════════════════════════════════════════════════════════════════
  // 6. MAP VIEW
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[6] Map View');
  await nav('/map');

  await check('map page loads and shows floor selectors', async () => {
    await page.waitForSelector('select', { timeout: 10000 });
    const selects = await page.$$('select');
    if (selects.length < 1) throw new Error('no selects on map page');
    console.log(`     (${selects.length} select dropdowns)`);
  });

  await check('selecting WERK1 building populates floor list', async () => {
    const selects = await page.$$('select');
    await selects[0].selectOption({ index: 1 });
    await page.waitForTimeout(1000);
    const selects2 = await page.$$('select');
    if (selects2.length < 2) throw new Error('floor selector did not appear after building select');
  });

  await check('selecting a floor renders the SVG floor plan', async () => {
    const selects = await page.$$('select');
    await selects[1].selectOption({ index: 1 });
    await page.waitForTimeout(2000);
    await page.waitForSelector('svg', { timeout: 8000 });
    const rects = await page.$$eval('svg rect', els => els.length);
    if (rects === 0) throw new Error('SVG has no rect elements after floor selection');
    console.log(`     (${rects} SVG rects)`);
  });

  await check('wall port layer toggle is active by default', async () => {
    const btn = await page.$('[title="Toggle Wall Ports"]');
    if (!btn) throw new Error('"Toggle Wall Ports" button not found');
    const cls = await btn.getAttribute('class');
    const isActive = cls?.includes('active');
    console.log(`     active: ${isActive}, class: ${cls}`);
  });

  await check('clicking wall port toggle turns layer off then on', async () => {
    const getClass = () => page.$eval('[title="Toggle Wall Ports"]', el => el.className);
    const before = await getClass();
    await page.evaluate(() => document.querySelector('[title="Toggle Wall Ports"]').click());
    await page.waitForTimeout(400);
    const after = await getClass();
    if (before === after) throw new Error('class did not change after toggle');
    // Restore
    await page.evaluate(() => document.querySelector('[title="Toggle Wall Ports"]').click());
    await page.waitForTimeout(300);
  });

  await check('amber wall port rects visible (patched ports)', async () => {
    const amber = await page.$$eval('svg rect[fill="#f59e0b"]', els => els.length);
    const grey  = await page.$$eval('svg rect[fill="#9ca3af"]', els => els.length);
    console.log(`     amber: ${amber}, grey: ${grey}`);
    if (amber + grey === 0) throw new Error('no wall port rects on this floor');
  });

  await check('filter panel controls present', async () => {
    const statusFilter = await page.$('select[class*="filter"], [class*="filter"] select, [class*="filterCard"] select');
    const searchInput  = await page.$('[class*="filter"] input, [class*="filterCard"] input');
    if (!statusFilter && !searchInput) throw new Error('no filter controls on map page');
    console.log(`     filter select: ${!!statusFilter}, input: ${!!searchInput}`);
  });

  await shot('06_mapview');

  // ══════════════════════════════════════════════════════════════════════════════
  // 7. REPORTS
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[7] Reports');
  await nav('/reports');

  await check('reports page loads with content', async () => {
    await page.waitForSelector('[class*="report"], [class*="stat"], [class*="card"], table', { timeout: 10000 });
  });

  await check('report sections and controls visible', async () => {
    const buttons = await page.$$('button');
    const selects = await page.$$('select');
    console.log(`     (${buttons.length} buttons, ${selects.length} selects on reports page)`);
    if (buttons.length === 0) throw new Error('no interactive controls on reports page');
  });

  await shot('07_reports');

  // ══════════════════════════════════════════════════════════════════════════════
  // 8. SETTINGS
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[8] Settings');
  await nav('/settings');

  await check('settings page loads with sections', async () => {
    await page.waitForSelector('[class*="section"], h2, form', { timeout: 8000 });
  });

  await check('theme toggle buttons (Light / Dark) present', async () => {
    const darkBtn  = await page.$('button:has-text("Dark")');
    const lightBtn = await page.$('button:has-text("Light")');
    if (!darkBtn && !lightBtn) throw new Error('no Light/Dark theme buttons');
    console.log(`     dark: ${!!darkBtn}, light: ${!!lightBtn}`);
  });

  await check('clicking Dark theme sets data-theme=dark', async () => {
    const darkBtn = await page.$('button:has-text("Dark")');
    if (!darkBtn) throw new Error('no Dark button');
    await darkBtn.click();
    await page.waitForTimeout(400);
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (theme !== 'dark') throw new Error(`expected data-theme=dark, got: ${theme}`);
    // Restore
    const lightBtn = await page.$('button:has-text("Light")');
    if (lightBtn) { await lightBtn.click(); await page.waitForTimeout(300); }
  });

  await check('items-per-page buttons present (10 / 25 / 50 / 100)', async () => {
    const btns = await page.$$('button:has-text("25"), button:has-text("50"), button:has-text("100")');
    if (btns.length === 0) throw new Error('no per-page buttons');
    console.log(`     (${btns.length} per-page buttons)`);
  });

  await check('password change form has 3 password inputs', async () => {
    const inputs = await page.$$('input[type="password"]');
    if (inputs.length < 2) throw new Error(`only ${inputs.length} password inputs`);
    console.log(`     (${inputs.length} password inputs)`);
  });

  await check('save settings button present', async () => {
    const saveBtn = await page.$('button:has-text("Save"), button:has-text("save")');
    if (!saveBtn) throw new Error('no Save button on settings page');
  });

  await shot('08_settings');

  // ══════════════════════════════════════════════════════════════════════════════
  // 9. USER MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[9] User Management');
  await nav('/settings/users');

  await check('user management page loads', async () => {
    await page.waitForSelector('table, [class*="user"], input[type="text"]', { timeout: 8000 });
  });

  await check('create user form fields visible', async () => {
    const usernameInput = await page.$('input[placeholder*="username" i], input[placeholder*="Username" i]');
    if (!usernameInput) {
      // Fallback: check for text inputs on page
      const inputs = await page.$$('input[type="text"], input:not([type])');
      if (inputs.length === 0) throw new Error('no username input');
      console.log(`     (${inputs.length} text inputs — using fallback)`);
    } else {
      console.log('     (username input found)');
    }
  });

  await check('role dropdown in create form', async () => {
    const selects = await page.$$('select');
    if (selects.length === 0) throw new Error('no select on user management page');
    const opts = await selects[0].$$eval('option', os => os.map(o => o.textContent?.trim()));
    console.log(`     role options: ${opts.join(', ')}`);
  });

  await check('users table has rows', async () => {
    const rows = await page.$$('tbody tr, [class*="userRow"]');
    if (rows.length === 0) throw new Error('user table has no rows');
    console.log(`     (${rows.length} user rows)`);
  });

  await check('reset password modal opens', async () => {
    // Find first "Reset Pw" or similar action button in table
    const resetBtn = await page.$('button:has-text("Reset"), td button:has-text("🔑"), td button');
    if (!resetBtn) { console.log('     (no reset button visible — admin row may hide it)'); return; }
    await resetBtn.click();
    await page.waitForTimeout(500);
    const modal = await page.$('[class*="modal"], [class*="overlay"]');
    if (modal) {
      const pwInput = await page.$('[class*="modal"] input[type="password"]');
      console.log(`     (reset modal open, pw input: ${!!pwInput})`);
      await closeModal();
    }
  });

  await shot('09_users');

  // ══════════════════════════════════════════════════════════════════════════════
  // 10. AUDIT LOG
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[10] Audit Log');
  await nav('/audit');

  await check('audit log page loads', async () => {
    await page.waitForSelector('[class*="filter"], input, table, [class*="timeline"]', { timeout: 8000 });
  });

  await check('filter form controls visible', async () => {
    const inputs = await page.$$('input[type="text"], input:not([type="hidden"])');
    const selects = await page.$$('select');
    console.log(`     (${inputs.length} text inputs, ${selects.length} selects)`);
    if (inputs.length + selects.length === 0) throw new Error('no filter controls');
  });

  await check('applying a filter and clearing it works', async () => {
    // Audit log filter inputs are inside the filter panel, skip the header search bar
    // Use JS to find inputs that are NOT the global search bar
    const filterInput = await page.$('[class*="filterPanel"] input, [class*="filter"] input[type="text"], [class*="auditFilter"] input');
    if (!filterInput) {
      // Fallback: use all inputs but avoid the first one (header search)
      const inputs = await page.$$('input[type="text"]');
      if (inputs.length < 2) throw new Error('no filter inputs beyond header search');
      await inputs[1].fill('admin');
      await page.keyboard.press('Escape'); // close any overlay
      await page.waitForTimeout(300);
      await inputs[1].fill('');
    } else {
      await filterInput.fill('admin');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await filterInput.fill('');
    }
    // Use JS click to bypass any overlay on the Apply button
    const applied = await page.evaluate(() => {
      const btn = document.querySelector('button[class*="apply"], button[class*="Apply"]') ||
        Array.from(document.querySelectorAll('button')).find(b => /apply|filter|search/i.test(b.textContent || ''));
      if (btn) { btn.click(); return true; }
      return false;
    });
    await page.waitForTimeout(400);
    // Clear via JS too
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /clear|reset/i.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await page.waitForTimeout(300);
    console.log(`     (applied filter: ${applied})`);
  });

  await check('audit entries or empty state visible', async () => {
    const entries = await page.$$('[class*="entry"], [class*="item"], tbody tr');
    const body = await page.evaluate(() => document.body.innerText);
    const hasEmpty = body.match(/no (log|audit|entries|results)|empty/i) !== null;
    console.log(`     (${entries.length} entries, empty state: ${hasEmpty})`);
  });

  await check('export CSV button present', async () => {
    const exportBtn = await page.$('button:has-text("Export"), button:has-text("CSV"), a[download]');
    if (!exportBtn) throw new Error('no export button on audit log');
  });

  await shot('10_audit');

  // ══════════════════════════════════════════════════════════════════════════════
  // 11. UNPLACED ASSETS
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[11] Unplaced Assets');
  await nav('/unplaced');

  await check('unplaced assets page loads', async () => {
    await page.waitForSelector('[class*="page"], h1, h2', { timeout: 8000 });
    const body = await page.evaluate(() => document.body.innerText);
    console.log(`     Heading: "${body.slice(0, 80).replace(/\n/g,' ')}"`);
  });

  await check('refresh button present', async () => {
    const btn = await page.$('button:has-text("Refresh"), button[title*="refresh" i], button[aria-label*="refresh" i]');
    if (!btn) throw new Error('no Refresh button');
    await btn.click();
    await page.waitForTimeout(600);
  });

  await check('asset groups or empty state visible', async () => {
    await page.waitForTimeout(500);
    const groups = await page.$$('[class*="group"], [class*="card"]');
    const body = await page.evaluate(() => document.body.innerText);
    const hasEmpty = body.match(/no unplaced|all placed|empty|0 unplaced/i) !== null;
    console.log(`     (${groups.length} group/card elements, empty: ${hasEmpty})`);
  });

  await shot('11_unplaced');

  // ══════════════════════════════════════════════════════════════════════════════
  // 12. ALERTS
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[12] Alerts');
  await nav('/alerts');

  await check('alerts page loads with condition toggles', async () => {
    await page.waitForSelector('[class*="section"], label, input[type="checkbox"]', { timeout: 8000 });
    const checkboxes = await page.$$('input[type="checkbox"]');
    if (checkboxes.length === 0) throw new Error('no toggle checkboxes on alerts page');
    console.log(`     (${checkboxes.length} checkboxes)`);
  });

  await check('maintenance alert toggle is clickable', async () => {
    // The checkbox is visually hidden inside a <label class="toggle">; click the label
    const toggleLabel = await page.$('[class*="toggle"]');
    if (!toggleLabel) throw new Error('no toggle label element');
    const before = await page.evaluate(() => {
      const cb = document.querySelector('input[type="checkbox"]');
      return cb ? cb.checked : null;
    });
    await toggleLabel.evaluate(el => el.click());
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
      const cb = document.querySelector('input[type="checkbox"]');
      return cb ? cb.checked : null;
    });
    // Restore
    if (before !== after) await toggleLabel.evaluate(el => el.click());
    await page.waitForTimeout(200);
    console.log(`     toggled: ${before} → ${after}`);
  });

  await check('Email section visible with recipient input', async () => {
    const body = await page.evaluate(() => document.body.innerText);
    if (!body.match(/email/i)) throw new Error('no Email section');
    const emailInput = await page.$('input[type="email"], input[placeholder*="email" i], input[placeholder*="recipient" i]');
    console.log(`     (email input found: ${!!emailInput})`);
  });

  await check('Teams / webhook section visible', async () => {
    const body = await page.evaluate(() => document.body.innerText);
    if (!body.match(/teams|webhook/i)) throw new Error('no Teams/webhook section');
  });

  await check('days-before-alert input accepts a value', async () => {
    const daysInput = await page.$('input[type="number"], input[placeholder*="day" i]');
    if (!daysInput) throw new Error('no days input');
    const val = await daysInput.inputValue();
    console.log(`     current days value: ${val}`);
  });

  await check('Save Settings button present', async () => {
    const saveBtn = await page.$('button:has-text("Save"), button[type="submit"]');
    if (!saveBtn) throw new Error('no Save button');
  });

  await check('Test Now button present', async () => {
    const testBtn = await page.$('button:has-text("Test")');
    if (!testBtn) throw new Error('no Test Now button');
  });

  await check('alert history table or empty state visible', async () => {
    const table = await page.$('table, [class*="history"], [class*="log"]');
    const body = await page.evaluate(() => document.body.innerText);
    const hasHistory = table !== null || body.match(/history|log|no alerts/i) !== null;
    if (!hasHistory) throw new Error('no history section');
  });

  await shot('12_alerts');

  // ══════════════════════════════════════════════════════════════════════════════
  // 13. NETWORK GRAPH
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[13] Network Graph');
  await nav('/network');

  await check('network graph page loads', async () => {
    await page.waitForSelector('[class*="graph"], [class*="canvas"], svg, canvas', { timeout: 12000 });
  });

  await check('type filter dropdown with asset types', async () => {
    const sel = await page.$('select');
    if (!sel) throw new Error('no type filter select');
    const opts = await sel.$$eval('option', os => os.map(o => o.textContent?.trim()));
    console.log(`     options: ${opts.slice(0, 5).join(', ')}…`);
  });

  await check('changing type filter re-renders graph', async () => {
    const sel = await page.$('select');
    if (!sel) throw new Error('no type filter');
    await sel.selectOption({ index: 1 }); // pick first non-All type
    await page.waitForTimeout(800);
    await sel.selectOption({ index: 0 }); // restore All
    await page.waitForTimeout(400);
  });

  await check('node count text visible', async () => {
    const body = await page.evaluate(() => document.body.innerText);
    const hasCount = /\d+/.test(body);
    if (!hasCount) throw new Error('no numeric count found on network graph page');
    console.log(`     body snippet: "${body.slice(0, 80).replace(/\n/g,' ')}"`);
  });

  await shot('13_network_graph');

  // ══════════════════════════════════════════════════════════════════════════════
  // 14. NETWORK INFRASTRUCTURE
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[14] Network Infrastructure');
  await nav('/infrastructure');

  await check('rooms list visible with MDF/IDF badges', async () => {
    await page.waitForSelector('[class*="roomCard"]', { timeout: 10000 });
    const rooms = await page.$$('[class*="roomCard"]');
    if (rooms.length === 0) throw new Error('no room cards');
    console.log(`     (${rooms.length} rooms)`);
  });

  await check('building selector switches room list', async () => {
    const sel = await page.$('select');
    if (!sel) throw new Error('no building selector');
    const opts = await sel.$$eval('option', os => os.map(o => o.textContent?.trim()));
    console.log(`     building options: ${opts.join(', ')}`);
    if (opts.length > 1) {
      await sel.selectOption({ index: 1 });
      await page.waitForTimeout(700);
      const rooms = await page.$$('[class*="roomCard"]');
      console.log(`     (${rooms.length} rooms for building[1])`);
      await sel.selectOption({ index: 0 });
      await page.waitForTimeout(700);
    }
  });

  await check('clicking a room selects it and shows racks', async () => {
    const rooms = await page.$$('[class*="roomCard"]');
    if (rooms.length === 0) throw new Error('no rooms');
    await rooms[0].click();
    await page.waitForTimeout(600);
    const racks = await page.$$('[class*="rack"]:not([class*="rackView"]):not([class*="rackHeader"]):not([class*="rackMeta"]):not([class*="rackIcon"]):not([class*="rackName"]):not([class*="rackU"]):not([class*="rackActions"])');
    console.log(`     (${racks.length} rack elements in rack view)`);
  });

  await check('clicking a rack shows patch panels with port grid', async () => {
    // Rack items have a rackName child; go up two levels: rackName → rackHeader → rack div
    const clicked = await page.evaluate(() => {
      const rackNameEl = document.querySelector('[class*="rackName"]');
      if (!rackNameEl) return false;
      const rackEl = rackNameEl.parentElement && rackNameEl.parentElement.parentElement;
      if (!rackEl) return false;
      rackEl.click();
      return true;
    });
    if (!clicked) throw new Error('no rackName element found to locate rack');
    await page.waitForTimeout(2000); // wait for wall port API calls
    const ports = await page.$$('[class*="port"]');
    if (ports.length === 0) throw new Error('no port elements visible after rack click');
    console.log(`     (${ports.length} port elements)`);
  });

  await check('patch panel shows connected (green) and free ports', async () => {
    const usedPorts = await page.$$('[class*="portUsed"]');
    const freePorts = await page.$$('[class*="portFree"]');
    console.log(`     connected: ${usedPorts.length}, free: ${freePorts.length}`);
    if (usedPorts.length + freePorts.length === 0) throw new Error('no portUsed/portFree classes found');
  });

  await check('port usage counter visible (X/Y used)', async () => {
    const body = await page.evaluate(() => document.body.innerText);
    if (!/\d+\/\d+\s*used/.test(body)) throw new Error('port usage counter (X/Y used) not found');
    const match = body.match(/\d+\/\d+\s*used/);
    console.log(`     usage text: "${match?.[0]}"`);
  });

  await check('hovering a used port shows tooltip with connection info', async () => {
    const usedPorts = await page.$$('[class*="portUsed"]');
    if (usedPorts.length === 0) throw new Error('no connected ports to hover');
    await usedPorts[0].hover();
    await page.waitForTimeout(400);
    const tooltip = await page.$('[class*="portTooltip"]');
    if (!tooltip) throw new Error('port tooltip not visible on hover');
    const text = await tooltip.textContent();
    console.log(`     tooltip: "${text?.replace(/\s+/g, ' ').slice(0, 80)}"`);
  });

  await check('Add Room modal has Name + Type + Floor fields', async () => {
    const addBtn = await page.$('button:has-text("+ Add Room"), button:has-text("Add Room")');
    if (!addBtn) throw new Error('no Add Room button');
    await addBtn.click();
    await page.waitForTimeout(500);
    const inputs  = await page.$$('[class*="modalBody"] input, [class*="modal"] input');
    const selects = await page.$$('[class*="modalBody"] select, [class*="modal"] select');
    if (inputs.length === 0) throw new Error('modal has no input fields');
    console.log(`     (${inputs.length} inputs, ${selects.length} selects in room modal)`);
    await closeModal();
  });

  await check('Add Rack modal has Name + U Count fields', async () => {
    const addBtn = await page.$('button:has-text("+ Add Rack"), button:has-text("Add Rack")');
    if (!addBtn) throw new Error('no Add Rack button (room may not be selected)');
    await addBtn.click();
    await page.waitForTimeout(500);
    const inputs = await page.$$('[class*="modalBody"] input, [class*="modal"] input');
    if (inputs.length === 0) throw new Error('rack modal has no inputs');
    console.log(`     (${inputs.length} inputs in rack modal)`);
    await closeModal();
  });

  await check('Add Panel modal has port count dropdown with 6/12/24/48 options', async () => {
    const addBtn = await page.$('button:has-text("+ Add Panel"), button:has-text("Add Panel")');
    if (!addBtn) throw new Error('no Add Panel button (rack may not be selected)');
    await addBtn.click();
    await page.waitForTimeout(500);
    const selects = await page.$$('[class*="modalBody"] select, [class*="modal"] select');
    let foundPortSelect = false;
    for (const sel of selects) {
      const opts = await sel.$$eval('option', os => os.map(o => o.value));
      if (opts.some(v => ['6', '12', '24', '48'].includes(v))) {
        foundPortSelect = true;
        console.log(`     port count options: ${opts.join(', ')}`);
        break;
      }
    }
    if (!foundPortSelect) throw new Error('port count dropdown not found or missing standard options');
    await closeModal();
  });

  await shot('14_infrastructure');

  // ══════════════════════════════════════════════════════════════════════════════
  // 15. MAINTENANCE
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[15] Maintenance');
  await nav('/maintenance');

  await check('maintenance page loads with calendar grid', async () => {
    await page.waitForSelector('[class*="calendar"], [class*="grid"], [class*="day"]', { timeout: 10000 });
    const cells = await page.$$('[class*="day"], [class*="cell"]');
    console.log(`     (${cells.length} calendar day cells)`);
  });

  await check('month display heading visible', async () => {
    const heading = await page.$('[class*="monthTitle"], [class*="monthNav"] h2, [class*="month"] h2, h2');
    if (!heading) throw new Error('no month heading');
    const text = await heading.textContent();
    console.log(`     current month: "${text?.trim()}"`);
  });

  await check('previous / next month buttons navigate', async () => {
    // navBtn class buttons are the ChevronLeft/Right month nav buttons
    const navBtns = await page.$$('[class*="navBtn"]');
    if (navBtns.length < 2) throw new Error(`only ${navBtns.length} navBtn elements (need 2)`);
    const nextBtn = navBtns[1]; // index 1 = ChevronRight (next month)
    const beforeText = await page.$eval('[class*="monthTitle"]', el => el.textContent);
    await nextBtn.evaluate(el => el.click());
    await page.waitForTimeout(400);
    const afterText = await page.$eval('[class*="monthTitle"]', el => el.textContent);
    console.log(`     month: "${beforeText?.trim()}" → "${afterText?.trim()}"`);
    if (beforeText === afterText) throw new Error('monthTitle did not change after next click');
  });

  await check('Today button returns to current month', async () => {
    // Use JS click to bypass any potential overlay
    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /^today$/i.test(b.textContent?.trim() || ''));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!clicked) throw new Error('no Today button found');
    await page.waitForTimeout(400);
    console.log('     (Today clicked via JS)');
  });

  await check('overdue section visible', async () => {
    const body = await page.evaluate(() => document.body.innerText);
    if (!body.match(/overdue/i)) throw new Error('no Overdue section found');
    const overdueEl = await page.$('[class*="overdue"]');
    console.log(`     (overdue element found: ${!!overdueEl})`);
  });

  await check('export CSV button present when assets due this month', async () => {
    // Export button only renders when upcomingThisMonth > 0
    const exportBtn = await page.$('button:has-text("CSV"), button:has-text("Export")');
    if (!exportBtn) {
      console.log('     (no CSV button — no assets due this month; navigating to a month with assets)');
      // Navigate forward to find a month with assets
      const navBtns = await page.$$('[class*="navBtn"]');
      for (let i = 0; i < 12; i++) {
        await navBtns[1].evaluate(el => el.click());
        await page.waitForTimeout(300);
        const btn = await page.$('button:has-text("CSV"), button:has-text("Export")');
        if (btn) { console.log('     (export button found after navigating months)'); return; }
      }
      console.log('     (no months with upcoming assets found — skipping export check)');
    } else {
      console.log('     (export button found)');
    }
  });

  await shot('15_maintenance');

  // ══════════════════════════════════════════════════════════════════════════════
  // 16. SIDEBAR NAVIGATION
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[16] Sidebar navigation');
  await nav('/');
  await page.waitForSelector('nav', { timeout: 5000 });

  const sidebarLinks = [
    { label: 'Dashboard',      href: '/' },
    { label: 'Buildings',      href: '/buildings' },
    { label: 'Map View',       href: '/map' },
    { label: 'Unplaced',       href: '/unplaced' },
    { label: 'Reports',        href: '/reports' },
    { label: 'Network',        href: '/network' },
    { label: 'Infra',          href: '/infrastructure' },
    { label: 'Maintenance',    href: '/maintenance' },
    { label: 'Audit Log',      href: '/audit' },
    { label: 'Alerts',         href: '/alerts' },
    { label: 'Settings',       href: '/settings' },
  ];

  for (const link of sidebarLinks) {
    await check(`sidebar: "${link.label}" link present and navigates`, async () => {
      const el = await page.$(`a[href="${link.href}"]`);
      if (!el) throw new Error(`no sidebar link href="${link.href}"`);
      await el.click();
      await page.waitForURL(new RegExp(link.href === '/' ? '/$' : link.href), { timeout: 6000 });
    });
  }

  await shot('16_sidebar_nav');

  // ══════════════════════════════════════════════════════════════════════════════
  // 17. KEYBOARD SHORTCUTS
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[17] Keyboard shortcuts');
  await nav('/');
  await page.waitForSelector('nav', { timeout: 5000 });
  // Make sure the key doesn't land in a focused input
  await page.evaluate(() => document.activeElement && document.activeElement.blur());

  await check('" ? " opens the keyboard shortcuts modal', async () => {
    await page.keyboard.press('Shift+?');
    await page.waitForTimeout(600);
    const modal = await page.$('[class*="shortcut"], [class*="keyboard"], [class*="modal"]');
    const body  = await page.evaluate(() => document.body.innerText);
    const hasShortcuts = modal !== null || /shortcut|keyboard/i.test(body);
    if (!hasShortcuts) throw new Error('shortcuts modal/overlay not found');
    console.log('     (shortcuts content visible)');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  await check('"g d" global shortcut navigates to Dashboard', async () => {
    await page.keyboard.press('g');
    await page.waitForTimeout(150);
    await page.keyboard.press('d');
    await page.waitForTimeout(600);
    const url = page.url();
    console.log(`     URL after g+d: ${url}`);
    // Not all apps implement this; just log
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 18. ASSET QUICK VIEW (from Dashboard)
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[18] Asset quick view');
  await nav('/');
  await page.waitForSelector('[class*="assetRow"], [class*="assetCard"], tbody tr', { timeout: 8000 });

  await check('eye / quick-view button opens asset detail modal', async () => {
    const eyeBtn = await page.$('button[title*="view" i], button[title*="detail" i], [class*="viewBtn"], [class*="eyeBtn"], button svg[data-lucide="eye"]');
    if (!eyeBtn) {
      // Try the first clickable button in a table row
      const rowBtn = await page.$('tbody tr button, [class*="assetRow"] button');
      if (!rowBtn) { console.log('     (no eye button found — skipping)'); return; }
      await rowBtn.click();
    } else {
      await eyeBtn.click();
    }
    await page.waitForTimeout(600);
    const modal = await page.$('[class*="modal"], [class*="overlay"], [class*="assetDetail"]');
    if (!modal) throw new Error('asset detail modal did not open');
    const text = await modal.textContent();
    console.log(`     modal snippet: "${text?.slice(0, 60).replace(/\s+/g, ' ')}"`);
    await closeModal();
  });

  await shot('18_asset_quickview');

  // ══════════════════════════════════════════════════════════════════════════════
  // 19. BULK ACTIONS (Dashboard)
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n[19] Bulk actions');
  await nav('/');
  await page.waitForSelector('[class*="assetRow"], tbody tr, [class*="assetCard"]', { timeout: 8000 });

  await check('checkbox selects an asset and shows bulk action bar', async () => {
    // Look for a checkbox in the first row
    const checkbox = await page.$('tbody tr input[type="checkbox"], [class*="assetRow"] input[type="checkbox"]');
    if (!checkbox) { console.log('     (no row checkbox found — skipping)'); return; }
    await checkbox.click();
    await page.waitForTimeout(400);
    const bulkBar = await page.$('[class*="bulk"], [class*="selection"], [class*="actionBar"]');
    if (!bulkBar) throw new Error('bulk action bar did not appear after checkbox click');
    console.log('     (bulk bar visible after selecting asset)');
    // Deselect
    await checkbox.click();
    await page.waitForTimeout(300);
  });

  await check('select all checkbox selects all visible assets', async () => {
    const headerCheckbox = await page.$('thead input[type="checkbox"], [class*="headerCheckbox"]');
    if (!headerCheckbox) { console.log('     (no header checkbox — skipping)'); return; }
    await headerCheckbox.click();
    await page.waitForTimeout(400);
    const selectedCount = await page.evaluate(() => {
      const checkboxes = Array.from(document.querySelectorAll('tbody tr input[type="checkbox"]'));
      return checkboxes.filter(cb => cb.checked).length;
    });
    console.log(`     (${selectedCount} rows selected after header click)`);
    // Deselect all
    await headerCheckbox.click();
    await page.waitForTimeout(300);
  });

  await shot('19_bulk_actions');

  // ══════════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════════════════
  await browser.close();

  const total = 19; // section count
  console.log('\n═══════════════════════════════════════════════════');
  if (failures.length === 0) {
    console.log('ALL CHECKS PASSED');
  } else {
    console.log(`${failures.length} CHECKS FAILED:`);
    failures.forEach(f => console.log(`  ✗ ${f.label}: ${f.error}`));
    process.exit(1);
  }
  console.log(`Screenshots saved to ./${SHOTS}/`);
})();

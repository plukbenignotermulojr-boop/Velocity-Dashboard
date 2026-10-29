// Run with the bundled Playwright directory on NODE_PATH. No production data is used.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const records = new Map();
let failOperation = '', sequence = 0;
function db(operation, args) {
  if (failOperation === operation) { failOperation = ''; return { error: { message: `Simulated ${operation} failure` } }; }
  if (operation === 'upload') {
    assert.equal(args.options.upsert, false, 'Project saves must be immutable');
    if (records.has(args.path)) return { error: { message: 'Already exists' } };
    records.set(args.path, { json: args.json, time: ++sequence });
    return { data: { path: args.path }, error: null };
  }
  if (operation === 'download') return records.has(args.path) ? { data: records.get(args.path).json, error: null } : { error: { message: 'Not found' } };
  const prefix = args.prefix + '/';
  const entries = new Map();
  for (const [key, record] of records) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length), first = rest.split('/')[0];
    entries.set(first, { name: first, id: rest.includes('/') ? null : first, time: record.time });
  }
  let list = [...entries.values()];
  const { sortBy, offset = 0, limit = 100 } = args.options;
  list.sort((a, b) => sortBy.column === 'name' ? a.name.localeCompare(b.name) : b.time - a.time);
  return { data: list.slice(offset, offset + limit), error: null };
}
async function main() {
  for (const [, attrs, code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (!/\bsrc\s*=/.test(attrs) && code.trim()) new Function(code);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const output = process.env.GAINS_SCREENSHOT_DIR;
  async function pageFor(name = 'Ben') {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.exposeFunction('__projectDb', db);
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'gains.test') return route.abort();
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') });
      const filename = path.resolve(root, '.' + url.pathname);
      if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) return route.abort();
      return route.fulfill({ contentType: filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') ? 'text/javascript' : 'image/png', body: fs.readFileSync(filename) });
    });
    await page.goto('https://gains.test/');
    await page.addStyleTag({ content: '#login-page{display:none!important}#app{display:flex!important}.page{animation:none!important}*{transition:none!important}' });
    await page.addScriptTag({ content: `var currentUser={name:${JSON.stringify(name)}};var isGuestMode=${name === 'Guest'};function showToast(){};var sb={storage:{from(bucket){if(bucket!=='research-files')throw Error('Unexpected bucket');return{list:(prefix,options)=>__projectDb('list',{prefix,options}),download:async(path)=>{const r=await __projectDb('download',{path});return r.error?r:{data:new Blob([r.data]),error:null}},upload:async(path,blob,options)=>__projectDb('upload',{path,json:await blob.text(),options})}}}};` });
    await page.addScriptTag({ content: html.match(/const PAGE_TITLES = [^\n]+/)[0] + '\n' + html.match(/function showPage\([^]*?^}/m)[0] + '\n' + html.match(/function applyTheme\([^]*?^}/m)[0] });
    await page.addScriptTag({ url: 'https://gains.test/external/ai-projects.js' });
    await page.locator('.nav-item[title="AI Projects · Team & Roles"]').click();
    return { page, errors };
  }
  async function status(page) {
    await page.locator('#ai-tab-status').click();
    await page.waitForFunction(() => document.getElementById('ai-project-sync').textContent.startsWith('Shared with'));
  }
  async function saved(page) { await page.waitForFunction(() => !document.getElementById('ai-project-dialog').open && document.getElementById('ai-project-save').textContent === 'Save project'); }
  async function shot(page, filename) { if (output) await page.screenshot({ path: path.join(output, filename) }); }
  try {
    const { page, errors } = await pageFor();
    assert.equal(await page.locator('.ai-role-image').count(), 4);
    assert.equal(await page.locator('#ai-pane-roles [data-ai-image]').count(), 11);
    assert.equal(await page.locator('#ai-pane-roles a[target="_blank"]').count(), 0);
    await page.locator('.ai-workflow-reference').click();
    await page.waitForFunction(() => document.getElementById('ai-image-full').naturalWidth > 0);
    assert.equal(await page.locator('#ai-image-dialog').evaluate(e => e.open), true);
    const fit = await page.locator('#ai-image-full').evaluate(e => e.getBoundingClientRect().width);
    await page.locator('[data-ai-zoom=in]').click();
    assert.ok(await page.locator('#ai-image-full').evaluate(e => e.getBoundingClientRect().width) > fit);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#ai-image-dialog').evaluate(e => e.open), false);
    assert.equal(page.context().pages().length, 1);
    await shot(page, 'gains-ai-roles-workflow-dark.png');
    await page.evaluate(() => applyTheme('light'));
    await shot(page, 'gains-ai-roles-workflow-light.png');
    await status(page);
    assert.equal(records.size, 0, 'Viewing an empty portfolio must not seed fake projects');
    await page.locator('#ai-add-project').click();
    await page.locator('#ai-p-title').fill('Research brief workflow');
    await page.locator('#ai-p-summary').fill('Reduce repeated preparation while keeping source links.');
    await page.locator('#ai-p-kind').selectOption('team');
    await page.locator('[name=ai-member][value=Jeff]').check();
    await page.locator('#ai-p-function').selectOption('RAI');
    await page.locator('#ai-p-status').selectOption('in_progress');
    for (const title of ['Define scope', 'Build prototype', 'Pilot with the team']) {
      await page.locator('#ai-p-milestone-new').fill(title);
      await page.locator('#ai-p-milestone-add').click();
    }
    await page.locator('[data-ai-milestone-check="0"]').check();
    assert.equal(await page.locator('#ai-p-progress').inputValue(), '33');
    assert.equal(await page.locator('#ai-p-progress').evaluate(e => e.readOnly), true);
    await page.locator('#ai-p-note').fill('Scope is documented.');
    await page.locator('#ai-project-save').click();
    await saved(page);
    assert.equal(records.size, 1);
    assert.equal(await page.locator('[role=progressbar]').getAttribute('aria-valuenow'), '33');
    assert.ok((await page.locator('.ai-project-people').textContent()).includes('Ben, Jeff'));
    await page.locator('[data-ai-edit]').click();
    await page.locator('#ai-p-note').fill('Prototype started.');
    failOperation = 'upload';
    await page.locator('#ai-project-save').click();
    await page.waitForFunction(() => document.getElementById('ai-project-save-error').textContent.includes('not saved'));
    assert.equal(records.size, 1);
    assert.equal(await page.locator('#ai-project-dialog').evaluate(e => e.open), true);
    await page.locator('#ai-project-save').click();
    await saved(page);
    assert.equal(records.size, 2, 'An update retains the previous revision');
    await page.locator('[data-ai-edit]').click();
    const newest = [...records.entries()].sort((a, b) => b[1].time - a[1].time)[0];
    const external = JSON.parse(newest[1].json);
    external.updateNote = 'Another teammate changed the project.';
    external.updatedBy = 'Jeff';
    external.parentVersion = newest[0].split('/').pop();
    db('upload', { path: `ai-projects-v1/${external.id}/${Date.now()}-11111111-1111-4111-8111-111111111111.json`, json: JSON.stringify(external), options: { upsert: false } });
    await page.locator('#ai-p-note').fill('Stale editor update');
    await page.locator('#ai-project-save').click();
    await page.waitForFunction(() => document.getElementById('ai-project-save-error').textContent.includes('Another teammate'));
    assert.equal(records.size, 3, 'A stale editor cannot silently replace another update');
    await page.locator('#ai-project-cancel').click();
    await page.locator('#ai-refresh-projects').click();
    await page.waitForFunction(() => document.querySelector('.ai-project-result').textContent.includes('Another teammate'));
    await page.locator('[data-ai-edit]').click();
    await page.locator('#ai-p-status').selectOption('completed');
    assert.equal(await page.locator('#ai-p-progress').inputValue(), '100');
    await page.locator('#ai-p-note').fill('Delivered and reviewed by the team.');
    await page.locator('#ai-project-save').click();
    await saved(page);
    assert.equal(await page.locator('[data-ai-view=completed]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[role=progressbar]').getAttribute('aria-valuenow'), '100');
    const { page: teammate, errors: teammateErrors } = await pageFor('Jeff');
    await status(teammate);
    await teammate.locator('[data-ai-view=completed]').click();
    assert.equal(await teammate.locator('.ai-project-card h2').textContent(), 'Research brief workflow');
    await page.locator('[data-ai-edit]').click();
    await page.locator('#ai-p-status').selectOption('in_progress');
    await page.locator('[data-ai-milestone-check="2"]').uncheck();
    await page.locator('#ai-project-save').click();
    await saved(page);
    assert.equal(await page.locator('[data-ai-view=active]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[role=progressbar]').getAttribute('aria-valuenow'), '67');
    await page.locator('#ai-add-project').click();
    await page.locator('#ai-p-title').fill('Platform integration inventory');
    await page.locator('#ai-p-owner').selectOption('Jeff');
    await page.locator('#ai-p-function').selectOption('PATS');
    await page.locator('#ai-p-status').selectOption('blocked');
    await page.locator('#ai-p-progress').fill('45');
    await page.locator('#ai-p-blocker').fill('Waiting for the integration requirements.');
    await page.locator('#ai-project-save').click();
    await saved(page);
    assert.equal(await page.locator('.ai-project-card').count(), 2);
    await page.locator('#ai-project-type-filter').selectOption('individual');
    assert.equal(await page.locator('.ai-project-card').count(), 1);
    await page.locator('#ai-project-type-filter').selectOption('');
    await page.locator('#ai-project-search').fill('no-such-project');
    assert.equal(await page.locator('.ai-project-card').count(), 0);
    await page.locator('#ai-project-search').fill('');
    await shot(page, 'gains-ai-status-light.png');
    await page.evaluate(() => applyTheme('dark'));
    await shot(page, 'gains-ai-status-dark.png');
    failOperation = 'list';
    await page.locator('#ai-refresh-projects').click();
    await page.waitForFunction(() => document.getElementById('ai-project-notice').textContent.includes('Unable to refresh'));
    assert.equal(await page.locator('.ai-project-card').count(), 2, 'Connection errors preserve the last loaded list');
    const { page: guest, errors: guestErrors } = await pageFor('Guest');
    await status(guest);
    assert.equal(await guest.locator('#ai-add-project').isVisible(), false);
    await guest.locator('[data-ai-edit]').first().click();
    assert.equal(await guest.locator('#ai-p-title').isDisabled(), true);
    assert.equal(await guest.locator('#ai-project-save').isVisible(), false);
    await guest.locator('#ai-project-cancel').click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator('#ai-pane-status').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
    await shot(page, 'gains-ai-status-mobile.png');
    await page.locator('#ai-tab-roles').click();
    assert.ok(await page.locator('#ai-pane-roles').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
    assert.deepEqual([...errors, ...teammateErrors, ...guestErrors], []);
    console.log('PASS: image overlays/zoom/Escape, both sections, shared saves, milestone/manual progress, failure recovery, stale-update protection, completed/reopened projects, filters, guest access, dark/light/mobile layouts.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

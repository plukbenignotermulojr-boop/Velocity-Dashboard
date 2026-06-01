/* app.js — all tab logic.
 *
 * Sections:
 *   ── Helpers ──
 *   ── Toasts ──
 *   ── Schema validator ──
 *   ── Tab switching ──
 *   ── Screener tab ──
 *   ── Candidate scan (Task 07) ──
 *   ── Traction badges (Task 08) ──
 *   ── News tab ──
 *   ── Movers tab ──
 *   ── Macro tab ──
 *   ── Footer / boot ──
 */

/* ══════════ Helpers ══════════ */

const todayISO = () => new Date().toISOString().slice(0, 10);
const nowISO   = () => new Date().toISOString();

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function fmtNum(n, digits = 1) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return Number(n).toFixed(digits);
}

function fmtMoney(n) {
  if (!isFinite(n) || n === null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6)  return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3)  return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function fmtPct(n, digits = 1) {
  if (!isFinite(n) || n === null) return '—';
  return (n >= 0 ? '+' : '') + Number(n).toFixed(digits) + '%';
}

function fmtRelTime(iso) {
  const d = Date.parse(iso);
  if (!isFinite(d)) return '';
  const secs = Math.max(1, (Date.now() - d) / 1000);
  if (secs < 60)    return Math.round(secs) + 's ago';
  if (secs < 3600)  return Math.round(secs / 60) + 'm ago';
  if (secs < 86400) return Math.round(secs / 3600) + 'h ago';
  return Math.round(secs / 86400) + 'd ago';
}

/* Pull the readable headline out of a catalyst string.
 * Input:  `Moved +14.2% on 4.8x average volume. Yahoo: "IonQ announces ..."`
 * Output: `IonQ announces ...`
 * Falls back to the non-prefixed remainder when no quoted headline is present. */
function extractHeadline(catalyst) {
  if (!catalyst) return '';
  const stripped = catalyst.replace(/^Moved [^.]+\.\s*/, '');
  const first = stripped.indexOf('"');
  const last = stripped.lastIndexOf('"');
  if (first !== -1 && last > first) return stripped.slice(first + 1, last);
  return stripped;
}

/* Heuristic classifier. Returns { label, kind } or { label:null, kind:null }
 * when no pattern matches. Runs on the raw headline; no LLM. Deliberately
 * conservative — unclassified headlines just render as the bare headline. */
function classifyCatalyst(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return { label: null, kind: null };

  const earnings = /\b(earnings|revenue|eps|quarterly|q[1-4]\b|fiscal)/.test(t) || /\breports?\s+(results|revenue|earnings)/.test(t);
  const beats    = /\b(beat|beats|tops|exceeds?|surpass(es)?|above estimates|above consensus)\b/.test(t);
  const misses   = /\b(miss(es|ed)?|shortfall|below estimates|below consensus|falls? short)\b/.test(t);
  if (earnings && beats)  return { label: 'Earnings beat',  kind: 'earnings-up' };
  if (earnings && misses) return { label: 'Earnings miss',  kind: 'earnings-down' };
  if (earnings)           return { label: 'Earnings',       kind: 'earnings' };

  if (/\braises?\s+(guidance|forecast|outlook|fy|full[- ]year)/.test(t)) return { label: 'Raised guidance', kind: 'guidance-up' };
  if (/\b(lowers?|cuts?|reduces?|trims?)\s+(guidance|forecast|outlook)/.test(t)) return { label: 'Lowered guidance', kind: 'guidance-down' };

  if (/\bfda\b.*\b(approv|grant|clearance|nod)/.test(t) || /\b(approv|grant|clearance|nod)\b.*\bfda\b/.test(t)) return { label: 'FDA approval', kind: 'fda-up' };
  if (/\bfda\b.*\b(reject|crl|complete response)/.test(t)) return { label: 'FDA reject', kind: 'fda-down' };
  if (/\bphase [123]\b|\bclinical trial|\btop[- ]?line results?/.test(t)) return { label: 'Trial update', kind: 'fda' };

  if (/\b(acquir(es|ed|ing)|acquisition|buyout|takeover|merger|merges? with)\b/.test(t)) return { label: 'M&A', kind: 'ma' };
  if (/\bto (go|be) (taken )?private\b|\bprivate equity deal\b/.test(t)) return { label: 'Going private', kind: 'ma' };

  if (/\b(contract|deal|agreement|awarded|order)\b/.test(t) && /\b(signs?|wins?|awarded|secures?|announces?|receives?)\b/.test(t)) return { label: 'Contract/deal', kind: 'deal' };
  if (/\b(partner(ship)?|collab(oration)?|alliance|joint venture|teams? up)\b/.test(t)) return { label: 'Partnership', kind: 'deal' };

  if (/\b(upgrade[sd]?|upgraded to)\b/.test(t)) return { label: 'Analyst upgrade', kind: 'analyst-up' };
  if (/\b(downgrade[sd]?|downgraded to)\b/.test(t)) return { label: 'Analyst downgrade', kind: 'analyst-down' };
  if (/\bprice target\b|\bpt raised|\bpt cut/.test(t)) return { label: 'Price target change', kind: 'analyst' };

  if (/\b(layoffs?|cuts? jobs|workforce reduction|restructuring|job cuts)\b/.test(t)) return { label: 'Layoffs/restructuring', kind: 'layoffs' };

  if (/\b(offering|ipo|secondary offering|shelf registration|share sale|bond issuance|convertible notes?)\b/.test(t)) return { label: 'Capital raise', kind: 'capital' };
  if (/\b(buyback|share repurchase|repurchase program)\b/.test(t)) return { label: 'Buyback', kind: 'capital-up' };
  if (/\b(dividend (raise|increase|hike)|raises? dividend)/.test(t)) return { label: 'Dividend hike', kind: 'capital-up' };

  if (/\b(lawsuit|sued|settles?|settlement|fine|penalty|investigation|subpoena|probe|doj|ftc|sec charges?)\b/.test(t)) return { label: 'Legal/regulatory', kind: 'legal' };
  if (/\b(short[- ]seller|short report|hindenburg|muddy waters)\b/.test(t)) return { label: 'Short report', kind: 'short' };

  if (/\b(launch(es|ed)?|unveils?|debuts?|introduces?|releases? new|rolls? out)\b/.test(t)) return { label: 'Product launch', kind: 'product' };
  if (/\b(recall|recalls?)\b/.test(t)) return { label: 'Recall', kind: 'product-down' };

  if (/\b(ceo|cfo|coo|cto|president)\b.*\b(steps down|resigns?|appointed|named|hires?|replaces?)/.test(t)) return { label: 'Exec change', kind: 'exec' };

  if (/\b(cyberattack|data breach|ransomware|hack(ed)?|security incident)\b/.test(t)) return { label: 'Security incident', kind: 'legal' };

  return { label: null, kind: null };
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ══════════ Toasts ══════════ */

function showToast(msg, kind) {
  const region = document.getElementById('toast-region');
  if (!region) { console.log('[toast]', msg); return; }
  const div = document.createElement('div');
  div.className = 'toast' + (kind ? ' ' + kind : '');
  div.textContent = msg;
  region.appendChild(div);
  setTimeout(() => { div.remove(); }, 4500);
}

window.addEventListener('error', (e) => {
  console.error('window error:', e.message, e.error);
  showToast('Error: ' + e.message, 'error');
});

/* ══════════ Schema validator ══════════
 *
 * Hand-rolled mini-validator. Only understands the bits we actually use —
 * no $ref resolution, no format beyond `date` / `date-time` / `uri`.
 * Returns { ok: bool, errors: ["path: msg", ...] }.
 */

async function validateAgainst(schemaPath, data) {
  let schema;
  try {
    const res = await fetch(schemaPath);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    schema = await res.json();
  } catch (e) {
    console.error('schema load failed:', schemaPath, e);
    return { ok: false, errors: [`(internal) could not load schema ${schemaPath}: ${e.message}`] };
  }

  const errors = [];
  const defs = schema.$defs || {};
  function resolve(ref) {
    if (!ref.startsWith('#/$defs/')) return null;
    return defs[ref.slice('#/$defs/'.length)];
  }

  function check(node, val, path) {
    if (!node) return;
    if (node.$ref) { check(resolve(node.$ref), val, path); return; }
    if (node.type) {
      const t = Array.isArray(node.type) ? node.type : [node.type];
      const actual = val === null ? 'null' : Array.isArray(val) ? 'array' : typeof val;
      if (!t.includes(actual)) errors.push(`${path || '(root)'}: expected ${t.join('|')}, got ${actual}`);
    }
    if (node.enum && !node.enum.includes(val)) {
      errors.push(`${path}: value "${val}" not in enum [${node.enum.join(', ')}]`);
    }
    if (typeof val === 'string') {
      if (node.minLength !== undefined && val.length < node.minLength) errors.push(`${path}: too short (min ${node.minLength})`);
      if (node.maxLength !== undefined && val.length > node.maxLength) errors.push(`${path}: too long (max ${node.maxLength})`);
      if (node.pattern && !new RegExp(node.pattern).test(val)) errors.push(`${path}: does not match pattern ${node.pattern}`);
      if (node.format === 'uri' && !/^https?:\/\//.test(val)) errors.push(`${path}: invalid URI`);
      if (node.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(val)) errors.push(`${path}: invalid date (YYYY-MM-DD)`);
      if (node.format === 'date-time' && isNaN(Date.parse(val))) errors.push(`${path}: invalid date-time`);
    }
    if (typeof val === 'number') {
      if (node.minimum !== undefined && val < node.minimum) errors.push(`${path}: below minimum ${node.minimum}`);
      if (node.maximum !== undefined && val > node.maximum) errors.push(`${path}: above maximum ${node.maximum}`);
    }
    if (Array.isArray(val)) {
      if (node.minItems !== undefined && val.length < node.minItems) errors.push(`${path}: array too short (min ${node.minItems})`);
      if (node.maxItems !== undefined && val.length > node.maxItems) errors.push(`${path}: array too long (max ${node.maxItems})`);
      if (node.items) val.forEach((v, i) => check(node.items, v, `${path}[${i}]`));
    }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const req = node.required || [];
      for (const k of req) {
        if (!(k in val)) errors.push(`${path}: missing required field "${k}"`);
      }
      const props = node.properties || {};
      for (const k of Object.keys(val)) {
        if (props[k]) check(props[k], val[k], path ? `${path}.${k}` : k);
      }
    }
  }

  check(schema, data, '');
  return { ok: errors.length === 0, errors };
}

/* ══════════ Tab switching ══════════ */

const TABS = ['screener', 'news', 'movers', 'macro'];
let activeTab = 'screener';

function switchTab(name) {
  if (!TABS.includes(name)) return;
  activeTab = name;
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === 'tab-' + name);
  });
  if (name === 'macro') renderMacro();
  if (name === 'movers') refreshMoversCacheLabel();
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-btn');
  if (btn) switchTab(btn.dataset.tab);
});

/* ══════════ Screener tab ══════════ */

let editingTrendId = null;

async function renderScreener() {
  const trends = await db.select('trends');
  const appearances = await computeTractionMap();

  const grid = document.getElementById('screener-grid');
  const metrics = document.getElementById('screener-metrics');

  const byConf = { high: 0, med: 0, low: 0 };
  trends.forEach((t) => { byConf[t.confidence] = (byConf[t.confidence] || 0) + 1; });

  metrics.innerHTML = `
    <div class="metric"><div class="metric-label">Total trends</div><div class="metric-val">${trends.length}</div></div>
    <div class="metric"><div class="metric-label">High confidence</div><div class="metric-val">${byConf.high}</div></div>
    <div class="metric"><div class="metric-label">Medium</div><div class="metric-val">${byConf.med}</div></div>
    <div class="metric"><div class="metric-label">Low</div><div class="metric-val">${byConf.low}</div></div>
  `;

  if (!trends.length) {
    grid.innerHTML = `<div class="empty-state">No trends yet. Click <strong>+ Add trend</strong> or paste a trends JSON into the import area above.</div>`;
    return;
  }

  grid.innerHTML = trends.map((t) => renderTrendCard(t, appearances)).join('');

  grid.querySelectorAll('[data-edit]').forEach((b) => {
    b.addEventListener('click', () => openCustomPanel(b.dataset.edit));
  });
  grid.querySelectorAll('[data-delete]').forEach((b) => {
    b.addEventListener('click', () => deleteTrend(b.dataset.delete));
  });
}

function renderTrendCard(t, appearances) {
  const confClass = 'conf-' + (t.confidence || 'med');
  const drivers = (t.drivers || []).map((d) => `<span class="driver">${escapeHtml(d)}</span>`).join('');
  const companies = (t.companies || []).map((c) => `
    <div class="company-row">
      <span class="ticker-badge">${escapeHtml(c.ticker)}</span>
      <div class="co-info">
        <div class="co-name">${escapeHtml(c.name || c.ticker)}</div>
        <div class="co-reason">${escapeHtml(c.reason || '')}</div>
      </div>
    </div>
  `).join('');

  return `
    <div class="trend-card ${t.custom ? 'custom-trend' : ''}">
      <div class="trend-actions">
        <button class="trend-action" data-edit="${t.id}" title="Edit">✎</button>
        <button class="trend-action danger" data-delete="${t.id}" title="Delete">×</button>
      </div>
      ${t.custom ? '<span class="custom-badge">custom</span>' : ''}
      <div class="trend-top">
        <div style="flex:1;min-width:0">
          <div class="trend-icon">${escapeHtml(t.icon || '●')}</div>
          <div class="trend-name">${escapeHtml(t.name)}</div>
          <div class="trend-sector">${escapeHtml(t.sector || '')}</div>
        </div>
        <span class="conf-pill ${confClass}">${escapeHtml(t.confidence || 'med')}</span>
      </div>
      <div class="trend-desc">${escapeHtml(t.description || '')}</div>
      ${drivers ? `<div class="drivers">${drivers}</div>` : ''}
      ${companies ? `<div class="companies-block"><div class="block-label">Key companies</div>${companies}</div>` : ''}
      ${renderTractionBadge(t, appearances)}
    </div>
  `;
}

/* Reshape a trends-import payload into the canonical shape the dashboard
 * (and the schema) expect, so prompts written with slightly different
 * conventions still import cleanly. Absorbs four common variations:
 *
 *   1. Bare array `[ {...}, {...} ]` instead of `{ generated_at, trends:[] }`
 *      → wrapped, generated_at stamped from the latest detectedDate or now.
 *   2. `detectedDate` (per trend, YYYY-MM-DD) instead of root `generated_at`.
 *      → used to seed generated_at, then dropped from each trend.
 *   3. `confidence: "medium"` instead of the schema's enum value `"med"`.
 *      → normalised to `"med"`.
 *   4. `topCompanies` instead of `companies`.
 *      → renamed.
 *
 * Idempotent — running it on already-canonical input is a no-op. */
function normalizeTrendsImport(input) {
  let envelope;
  if (Array.isArray(input)) {
    envelope = { generated_at: '', trends: input };
  } else if (input && typeof input === 'object') {
    envelope = { ...input };
  } else {
    return input;   // let the validator complain
  }

  /* If generated_at is missing, infer from per-trend detectedDate (most
   * recent wins) or fall back to now. */
  if (!envelope.generated_at) {
    const dates = (envelope.trends || [])
      .map((t) => t && t.detectedDate)
      .filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    if (dates.length) {
      envelope.generated_at = new Date(dates[dates.length - 1] + 'T12:00:00Z').toISOString();
    } else {
      envelope.generated_at = nowISO();
    }
  }

  envelope.trends = (envelope.trends || []).map((t) => {
    if (!t || typeof t !== 'object') return t;
    const out = { ...t };

    /* topCompanies → companies (only if companies isn't already set) */
    if (!Array.isArray(out.companies) && Array.isArray(out.topCompanies)) {
      out.companies = out.topCompanies;
    }
    delete out.topCompanies;
    delete out.detectedDate;

    /* confidence: "medium" → "med" */
    if (out.confidence === 'medium') out.confidence = 'med';

    return out;
  });

  return envelope;
}

/* When an incoming Claude trend collides with an existing custom (hand-
 * authored or hand-edited) trend, collate instead of overwrite:
 *   - User's text fields (name, sector, description, confidence, icon) win
 *   - Companies and drivers are unioned — your manual picks survive,
 *     and Claude's new picks are appended after them, deduped by ticker
 *   - The trend stays marked `custom: true` so future imports also collate
 * Claude-on-Claude updates (no custom flag) still do a clean replace, since
 * the latest scan is the authoritative refresh of those trends. */
function collateIntoCustomTrend(existing, incoming) {
  const tickers = new Set();
  const companies = [];
  for (const c of [...(existing.companies || []), ...(incoming.companies || [])]) {
    if (!c || !c.ticker || tickers.has(c.ticker)) continue;
    tickers.add(c.ticker);
    companies.push(c);
  }
  const drivers = Array.from(new Set([
    ...(existing.drivers  || []),
    ...(incoming.drivers || [])
  ]));
  return {
    ...incoming,        // baseline (anything user never set, comes from Claude)
    ...existing,        // user's text fields override Claude's
    companies,
    drivers,
    custom: true,
    updated_at: nowISO()
  };
}

async function importTrendsJSON() {
  const ta = document.getElementById('screener-import-area');
  const errBox = document.getElementById('screener-import-error');
  errBox.classList.remove('show');
  let parsed;
  try { parsed = JSON.parse(ta.value); }
  catch (e) { errBox.textContent = 'Invalid JSON: ' + e.message; errBox.classList.add('show'); return; }

  /* Absorb the common prompt-shape variations before the strict schema check. */
  parsed = normalizeTrendsImport(parsed);

  const result = await validateAgainst('./schemas/trends.schema.json', parsed);
  if (!result.ok) {
    errBox.textContent = 'Schema errors:\n' + result.errors.slice(0, 10).join('\n');
    errBox.classList.add('show');
    return;
  }

  const existing = await db.select('trends');
  const byId = new Map(existing.map((t) => [t.id, t]));

  const stats = { added: 0, refreshed: 0, collated: 0 };
  const rows = parsed.trends.map((t) => {
    const prev = byId.get(t.id);
    if (!prev) {
      stats.added++;
      return { ...t, custom: false, updated_at: nowISO() };
    }
    if (prev.custom) {
      stats.collated++;
      return collateIntoCustomTrend(prev, t);
    }
    stats.refreshed++;
    return { ...prev, ...t, custom: false, updated_at: nowISO() };
  });

  await db.upsert('trends', rows);
  ta.value = '';
  const parts = [];
  if (stats.added)     parts.push(`${stats.added} new`);
  if (stats.refreshed) parts.push(`${stats.refreshed} refreshed`);
  if (stats.collated)  parts.push(`${stats.collated} merged with your edits`);
  showToast(`Imported ${rows.length} · ${parts.join(' · ')}`);
  await renderScreener();
}

function openCustomPanel(id) {
  editingTrendId = id || null;
  const panel = document.getElementById('screener-custom-panel');
  panel.style.display = 'block';
  renderCustomPanel();
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function renderCustomPanel() {
  const panel = document.getElementById('screener-custom-panel');
  let t = { id: '', name: '', sector: '', description: '', confidence: 'med', icon: '●', drivers: [], companies: [{ ticker: '', name: '', reason: '' }] };
  if (editingTrendId) {
    const rows = await db.select('trends', { id: editingTrendId });
    if (rows[0]) t = JSON.parse(JSON.stringify(rows[0]));
    if (!t.companies || !t.companies.length) t.companies = [{ ticker: '', name: '', reason: '' }];
  }
  panel.innerHTML = `
    <div class="import-title">${editingTrendId ? 'Edit trend' : 'New custom trend'}</div>
    <div class="form-grid">
      <div class="field-group"><label class="field-label">Name</label><input class="field-input" id="ct-name" value="${escapeHtml(t.name)}"></div>
      <div class="field-group"><label class="field-label">Sector</label><input class="field-input" id="ct-sector" value="${escapeHtml(t.sector)}"></div>
      <div class="field-group"><label class="field-label">Icon (emoji, 1 char)</label><input class="field-input" id="ct-icon" maxlength="4" value="${escapeHtml(t.icon)}"></div>
      <div class="field-group"><label class="field-label">Confidence</label>
        <select class="field-select" id="ct-conf">
          <option value="high" ${t.confidence === 'high' ? 'selected' : ''}>High</option>
          <option value="med"  ${t.confidence === 'med'  ? 'selected' : ''}>Medium</option>
          <option value="low"  ${t.confidence === 'low'  ? 'selected' : ''}>Low</option>
        </select>
      </div>
      <div class="field-group full"><label class="field-label">Description</label><textarea class="field-textarea" id="ct-desc">${escapeHtml(t.description)}</textarea></div>
      <div class="field-group full"><label class="field-label">Drivers (comma-separated)</label><input class="field-input" id="ct-drivers" value="${escapeHtml((t.drivers || []).join(', '))}"></div>
      <div class="field-group full">
        <label class="field-label">Companies</label>
        <div id="ct-companies"></div>
        <button class="btn" id="ct-addco" type="button" style="align-self:flex-start;margin-top:4px">+ Add company</button>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" id="ct-cancel">Cancel</button>
      <button class="btn btn-primary" id="ct-save">${editingTrendId ? 'Save changes' : 'Add trend'}</button>
    </div>
  `;

  const cosWrap = document.getElementById('ct-companies');
  function renderCompanies() {
    cosWrap.innerHTML = t.companies.map((c, i) => `
      <div class="company-form-row">
        <input class="field-input" data-coi="${i}" data-ck="ticker" placeholder="AAPL" value="${escapeHtml(c.ticker)}">
        <input class="field-input" data-coi="${i}" data-ck="name" placeholder="Apple Inc." value="${escapeHtml(c.name)}">
        <input class="field-input" data-coi="${i}" data-ck="reason" placeholder="pure-play in X" value="${escapeHtml(c.reason)}">
        <button class="co-remove-btn" data-rm="${i}" type="button">Remove</button>
      </div>
    `).join('');
    cosWrap.querySelectorAll('input[data-coi]').forEach((inp) => {
      inp.addEventListener('input', () => {
        t.companies[+inp.dataset.coi][inp.dataset.ck] = inp.value.toUpperCase && inp.dataset.ck === 'ticker'
          ? inp.value.toUpperCase() : inp.value;
      });
    });
    cosWrap.querySelectorAll('[data-rm]').forEach((b) => {
      b.addEventListener('click', () => {
        t.companies.splice(+b.dataset.rm, 1);
        if (!t.companies.length) t.companies.push({ ticker: '', name: '', reason: '' });
        renderCompanies();
      });
    });
  }
  renderCompanies();

  document.getElementById('ct-addco').addEventListener('click', () => {
    t.companies.push({ ticker: '', name: '', reason: '' });
    renderCompanies();
  });
  document.getElementById('ct-cancel').addEventListener('click', () => {
    editingTrendId = null;
    panel.style.display = 'none';
  });
  document.getElementById('ct-save').addEventListener('click', async () => {
    const name = document.getElementById('ct-name').value.trim();
    const sector = document.getElementById('ct-sector').value.trim();
    const desc = document.getElementById('ct-desc').value.trim();
    const icon = document.getElementById('ct-icon').value.trim() || '●';
    const confidence = document.getElementById('ct-conf').value;
    const drivers = document.getElementById('ct-drivers').value.split(',').map((s) => s.trim()).filter(Boolean);
    if (!name || name.length < 3) { showToast('Name is required (min 3 chars)', 'error'); return; }
    if (!desc || desc.length < 20) { showToast('Description is too short (min 20 chars)', 'error'); return; }
    const companies = t.companies.filter((c) => c.ticker.trim()).map((c) => ({
      ticker: c.ticker.trim().toUpperCase(), name: c.name.trim(), reason: c.reason.trim()
    }));
    const row = {
      id: editingTrendId || slugify(name),
      name, sector, description: desc, confidence, icon, drivers, companies,
      /* Any hand-save promotes the trend to custom so it'll be protected
       * (collated, not overwritten) by future Claude imports. */
      custom: true,
      created_at: t.created_at || nowISO(),
      updated_at: nowISO()
    };
    await db.upsert('trends', [row]);
    showToast(editingTrendId ? 'Trend updated' : 'Trend added');
    editingTrendId = null;
    panel.style.display = 'none';
    renderScreener();
  });
}

/* Copy the current trend registry to the clipboard in a Claude-friendly
 * format. Paste it underneath the "Run candidate scan" command in your
 * Claude Project so Claude can cross-check and exclude what you already
 * track. Falls back to alert() if the browser blocks clipboard access. */
async function copyRegistryToClipboard() {
  const trends = await db.select('trends');
  if (!trends.length) {
    showToast('No trends to copy yet — add or import some first');
    return;
  }
  /* Sort alphabetically by name for predictable output. */
  const sorted = trends.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const lines = sorted.map((t) => `- ${t.id}: ${t.name} (${t.sector || '—'})`);
  /* The clipboard payload is the command + registry, one paste = one full
   * message in your Claude Project. If you only want the registry text
   * (e.g. for the news prompt or as reference), delete the first line
   * after pasting. */
  const text = [
    `Run candidate scan`,
    ``,
    `My current registry — DO NOT propose any of these as candidates. Cross-check by concept, not just id.`,
    ``,
    ...lines,
    ``,
    `Total: ${sorted.length} trends.`
  ].join('\n');

  try {
    await navigator.clipboard.writeText(text);
    showToast(`Copied ${sorted.length} trends to clipboard`);
  } catch (e) {
    console.error('clipboard write failed:', e);
    /* Fallback for browsers/contexts where clipboard API is blocked
     * (e.g. file:// origin or Safari without a user gesture). */
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    if (ok) {
      showToast(`Copied ${sorted.length} trends to clipboard`);
    } else {
      window.prompt('Copy this text manually (Ctrl+C):', text);
      showToast('Clipboard blocked — copy from the dialog manually', 'error');
    }
  }
}

async function deleteTrend(id) {
  const rows = await db.select('trends', { id });
  const name = rows[0]?.name || id;
  if (!confirm(`Delete "${name}"?\nThis removes it from the registry. Historical candidate-scan entries are preserved.`)) return;
  await db.delete('trends', id);
  showToast(`Deleted "${name}"`);
  renderScreener();
}

/* ══════════ Candidate scan (Task 07) ══════════ */

/* Same normalisation pattern as normalizeTrendsImport, scoped to the
 * candidate-scan payload. Accepts:
 *   - Bare JSON array of candidate objects → wraps in { generated_at, candidates }
 *   - detectedDate per candidate → seeds generated_at from the latest
 *   - confidence: "medium" → "med"
 *   - topCompanies → candidate_companies
 * Idempotent. */
function normalizeCandidateScanImport(input) {
  let envelope;
  if (Array.isArray(input)) {
    envelope = { generated_at: '', candidates: input };
  } else if (input && typeof input === 'object') {
    envelope = { ...input };
  } else {
    return input;
  }

  if (!envelope.generated_at) {
    const dates = (envelope.candidates || [])
      .map((c) => c && c.detectedDate)
      .filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    envelope.generated_at = dates.length
      ? new Date(dates[dates.length - 1] + 'T12:00:00Z').toISOString()
      : nowISO();
  }

  envelope.candidates = (envelope.candidates || []).map((c) => {
    if (!c || typeof c !== 'object') return c;
    const out = { ...c };
    if (!Array.isArray(out.candidate_companies) && Array.isArray(out.topCompanies)) {
      out.candidate_companies = out.topCompanies;
    }
    delete out.topCompanies;
    delete out.detectedDate;
    if (out.confidence === 'medium') out.confidence = 'med';
    return out;
  });

  return envelope;
}

async function openCandidateScan() {
  const panel = document.getElementById('screener-candidate-panel');
  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="import-title">Candidate scan</div>
    <div class="import-sub">Paste the output of the <code>candidate-scan.md</code> prompt.</div>
    <textarea class="import-area" id="cs-area" style="margin-top:12px" placeholder='{"generated_at":"...","candidates":[...]}'></textarea>
    <div class="error-box" id="cs-error"></div>
    <div class="import-footer">
      <span class="import-hint">Validates against <code>schemas/candidate-scan.schema.json</code>.</span>
      <button class="btn btn-ghost" id="cs-cancel">Cancel</button>
      <button class="btn btn-primary" id="cs-submit">Load scan</button>
    </div>
    <div id="cs-results" style="margin-top:14px"></div>
  `;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('cs-cancel').addEventListener('click', () => {
    panel.style.display = 'none';
    renderScreener();
  });
  document.getElementById('cs-submit').addEventListener('click', async () => {
    const area = document.getElementById('cs-area');
    const err = document.getElementById('cs-error');
    err.classList.remove('show');
    let parsed;
    try { parsed = JSON.parse(area.value); }
    catch (e) { err.textContent = 'Invalid JSON: ' + e.message; err.classList.add('show'); return; }

    /* Absorb the same prompt-shape variations as the trends import:
     * bare array, detectedDate, "medium", topCompanies → candidate_companies. */
    parsed = normalizeCandidateScanImport(parsed);

    const result = await validateAgainst('./schemas/candidate-scan.schema.json', parsed);
    if (!result.ok) { err.textContent = 'Schema errors:\n' + result.errors.slice(0, 10).join('\n'); err.classList.add('show'); return; }

    const scanId = slugify(parsed.generated_at) || ('scan-' + Date.now());
    const candidates = parsed.candidates.map((c) => ({ ...c, status: 'pending' }));
    const existing = (await db.select('candidate_scans', { id: scanId }))[0];
    if (!existing) {
      await db.insert('candidate_scans', [{ id: scanId, scanned_at: parsed.generated_at || nowISO(), candidates }]);
    }
    await renderCandidateResults(scanId);
  });
}

/* Find existing trends that look similar to a candidate. LLM-free —
 * uses ticker overlap (the strongest concept signal we have) plus an
 * optional sector tiebreaker. Returns up to 3 matches sorted by priority.
 *
 * Match rules:
 *   - Same id          → highest priority (Option 2: id-match merge)
 *   - ≥2 shared tickers → strong concept overlap (Option 3 primary signal)
 *   - 1 shared ticker + same sector → possible overlap (weaker signal)
 *   - Otherwise → not a match (false positives are worse than misses here) */
function findSimilarTrends(candidate, allTrends) {
  const candTickers = new Set((candidate.candidate_companies || []).map((c) => c.ticker).filter(Boolean));
  const candSector = (candidate.sector || '').toLowerCase();
  const matches = [];

  for (const t of allTrends) {
    if (t.id === candidate.id) {
      matches.push({ trend: t, reason: 'same id', kind: 'id', priority: 1000 });
      continue;
    }
    const trendTickers = new Set((t.companies || []).map((c) => c.ticker).filter(Boolean));
    const shared = [...candTickers].filter((tk) => trendTickers.has(tk));
    const sectorEq = candSector && t.sector && candSector === t.sector.toLowerCase();

    if (shared.length >= 2) {
      matches.push({
        trend: t,
        reason: `${shared.length} shared tickers (${shared.slice(0, 3).join(', ')}${shared.length > 3 ? '...' : ''})`,
        kind: 'tickers',
        priority: shared.length * 10
      });
    } else if (shared.length === 1 && sectorEq) {
      matches.push({
        trend: t,
        reason: `same sector + 1 shared ticker (${shared[0]})`,
        kind: 'sector-1',
        priority: 5
      });
    }
  }

  matches.sort((a, b) => b.priority - a.priority);
  return matches.slice(0, 3);
}

async function renderCandidateResults(scanId) {
  const wrap = document.getElementById('cs-results');
  const scan = (await db.select('candidate_scans', { id: scanId }))[0];
  const trends = await db.select('trends');

  wrap.innerHTML = scan.candidates.map((c) => renderCandidateCard(c, findSimilarTrends(c, trends))).join('') +
    `<div class="form-actions"><button class="btn" id="cs-done">Done</button></div>`;

  wrap.querySelectorAll('[data-accept]').forEach((b) => {
    b.addEventListener('click', async () => { await acceptCandidate(scanId, b.dataset.accept); await renderCandidateResults(scanId); });
  });
  wrap.querySelectorAll('[data-merge]').forEach((b) => {
    b.addEventListener('click', async () => {
      await acceptCandidate(scanId, b.dataset.merge, b.dataset.target);
      await renderCandidateResults(scanId);
    });
  });
  wrap.querySelectorAll('[data-dismiss]').forEach((b) => {
    b.addEventListener('click', async () => { await dismissCandidate(scanId, b.dataset.dismiss); await renderCandidateResults(scanId); });
  });
  document.getElementById('cs-done').addEventListener('click', () => {
    document.getElementById('screener-candidate-panel').style.display = 'none';
    renderScreener();
  });
}

function renderCandidateCard(c, similar) {
  const evidence = (c.evidence || []).map((e) => `
    <li>${escapeHtml(e.claim)} — ${e.url ? `<a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${escapeHtml(e.source)}</a>` : escapeHtml(e.source)}</li>
  `).join('');
  const companies = (c.candidate_companies || []).map((co) => `
    <div class="company-row"><span class="ticker-badge">${escapeHtml(co.ticker)}</span><div class="co-info"><div class="co-name">${escapeHtml(co.name || co.ticker)}</div><div class="co-reason">${escapeHtml(co.reason)}</div></div></div>
  `).join('');
  const statusClass = c.status === 'accepted' ? 'accepted' : c.status === 'dismissed' ? 'dismissed' : (similar.length ? 'similar' : '');
  const statusLabel = c.status === 'accepted' ? 'Added to registry' :
                      c.status === 'dismissed' ? 'Dismissed' : '';

  /* Merge-into-existing buttons. The first match is shown as a primary
   * green button if it's an exact id match (Option 2 case); otherwise all
   * matches are shown as neutral buttons next to the default Accept-as-new. */
  const mergeButtons = (c.status === 'pending' && similar.length)
    ? similar.map((m) => `
        <button class="btn ${m.kind === 'id' ? 'btn-primary' : ''}" data-merge="${escapeHtml(c.id)}" data-target="${escapeHtml(m.trend.id)}">
          Merge into "${escapeHtml(m.trend.name)}"
          <span class="merge-reason">· ${escapeHtml(m.reason)}</span>
        </button>
      `).join('')
    : '';

  /* If there's an exact id match, the user shouldn't also create a duplicate
   * new trend (that would conflict on id). Hide the Accept-as-new in that
   * case; the id-merge button is the only sensible action. */
  const hasIdMatch = similar.some((m) => m.kind === 'id');

  const similarBanner = (c.status === 'pending' && similar.length)
    ? `<div class="similar-banner">⚠ Looks similar to ${similar.length === 1 ? 'an existing trend' : 'existing trends'} you already track:</div>`
    : '';

  return `
    <div class="candidate-card ${statusClass}">
      <div class="candidate-header">
        <div>
          <div style="font-size:20px">${escapeHtml(c.icon || '●')}</div>
          <div class="candidate-name">${escapeHtml(c.name)}</div>
          <div class="trend-sector">${escapeHtml(c.sector || '')}</div>
        </div>
        <span class="conf-pill conf-${c.confidence || 'med'}">${escapeHtml(c.confidence || 'med')}</span>
      </div>
      <div class="trend-desc">${escapeHtml(c.description)}</div>
      ${evidence ? `<div class="candidate-evidence"><ul>${evidence}</ul></div>` : ''}
      ${companies ? `<div class="companies-block"><div class="block-label">Candidate companies</div>${companies}</div>` : ''}
      ${similarBanner}
      <div class="candidate-actions">
        ${statusLabel ? `<span class="traction-badge traction-none">${escapeHtml(statusLabel)}</span>` : ''}
        ${c.status === 'pending' && !hasIdMatch ? `
          <button class="btn ${similar.length ? '' : 'btn-primary'}" data-accept="${escapeHtml(c.id)}">Accept → New trend</button>
        ` : ''}
        ${mergeButtons}
        ${c.status === 'pending' ? `
          <button class="btn" data-dismiss="${escapeHtml(c.id)}">Dismiss</button>
        ` : ''}
      </div>
    </div>
  `;
}

/* Accept a candidate. Three modes:
 *   - targetId provided                  → merge candidate's picks into that
 *                                          existing trend (Option 3 path)
 *   - targetId omitted, id collides      → merge into the same-id trend
 *                                          (Option 2 path)
 *   - targetId omitted, no collision     → create a fresh trend
 * Merge always unions companies + drivers. Custom-flagged trends keep their
 * text fields; non-custom existing trends absorb refreshed text from the
 * candidate. The merged trend is always set custom: true going forward,
 * since the user has now actively chosen to fold this candidate in. */
async function acceptCandidate(scanId, candidateId, targetId) {
  const scan = (await db.select('candidate_scans', { id: scanId }))[0];
  if (!scan) return;
  const c = scan.candidates.find((x) => x.id === candidateId);
  if (!c) return;

  const candidateCompanies = (c.candidate_companies || []).map((co) => ({
    ticker: co.ticker,
    name: co.name || co.ticker,
    reason: co.reason
  }));

  const allTrends = await db.select('trends');
  const existing = allTrends.find((t) => t.id === (targetId || c.id));

  let trendRow;
  let toastMsg;

  if (existing) {
    /* Union picks (existing first to preserve user's curation order) */
    const tickers = new Set();
    const mergedCompanies = [];
    for (const co of [...(existing.companies || []), ...candidateCompanies]) {
      if (!co || !co.ticker || tickers.has(co.ticker)) continue;
      tickers.add(co.ticker);
      mergedCompanies.push(co);
    }
    const newPicks = mergedCompanies.length - (existing.companies || []).length;

    /* Drivers — union, dedupe */
    const drivers = Array.from(new Set([...(existing.drivers || []), ...(c.drivers || [])]));

    if (existing.custom) {
      /* Custom (hand-edited) trend: preserve user fields. Just add new picks. */
      trendRow = {
        ...c,                 // baseline (anything missing on existing)
        ...existing,          // user's text fields override
        companies: mergedCompanies,
        drivers,
        custom: true,
        updated_at: nowISO()
      };
    } else {
      /* Non-custom trend: refresh text from the candidate, but only when
       * the candidate's id matches (id-merge case). For different-id
       * targeted merges, keep the existing trend's identity intact —
       * the candidate is donating picks, not its name/description. */
      if (existing.id === c.id) {
        trendRow = {
          ...existing,
          name: c.name,
          sector: c.sector,
          description: c.description,
          confidence: c.confidence || 'med',
          icon: c.icon || existing.icon || '●',
          companies: mergedCompanies,
          drivers,
          custom: true,
          updated_at: nowISO()
        };
      } else {
        trendRow = {
          ...existing,
          companies: mergedCompanies,
          drivers,
          custom: true,
          updated_at: nowISO()
        };
      }
    }
    await db.upsert('trends', [trendRow]);
    c.promoted_trend_id = existing.id;
    toastMsg = existing.id === c.id
      ? `Merged "${c.name}" into existing trend (+${newPicks} new pick${newPicks === 1 ? '' : 's'})`
      : `Merged "${c.name}" picks into "${existing.name}" (+${newPicks} new pick${newPicks === 1 ? '' : 's'})`;
  } else {
    /* No existing trend on either id — fresh create. */
    trendRow = {
      id: c.id,
      name: c.name,
      sector: c.sector,
      description: c.description,
      confidence: c.confidence || 'med',
      icon: c.icon || '●',
      drivers: c.drivers || [],
      companies: candidateCompanies,
      custom: false,
      created_at: nowISO(),
      updated_at: nowISO()
    };
    await db.upsert('trends', [trendRow]);
    c.promoted_trend_id = c.id;
    toastMsg = `Accepted "${c.name}" into registry`;
  }

  c.status = 'accepted';
  await db.upsert('candidate_scans', [scan]);
  showToast(toastMsg);
}

async function dismissCandidate(scanId, candidateId) {
  const scan = (await db.select('candidate_scans', { id: scanId }))[0];
  if (!scan) return;
  const c = scan.candidates.find((x) => x.id === candidateId);
  if (!c) return;
  c.status = 'dismissed';
  await db.upsert('candidate_scans', [scan]);
  await db.upsert('dismissed_candidates', [{
    id: `${scan.id}-${c.id}`,
    candidate_id: c.id,
    name: c.name,
    sector: c.sector,
    dismissed_at: nowISO(),
    first_seen_scan: scan.id
  }]);
  showToast(`Dismissed "${c.name}"`);
}

/* ══════════ Traction badges (Task 08) ══════════ */

async function computeTractionMap() {
  const all = await db.select('candidate_scans');
  const sorted = all.slice().sort((a, b) => (b.scanned_at || '').localeCompare(a.scanned_at || ''));
  const last = sorted.slice(0, 4);
  const totalScans = sorted.length;
  const countByTrendId = {};
  const perScan = last.map((s) => ({ id: s.id, date: s.scanned_at, ids: new Set((s.candidates || []).map((c) => c.promoted_trend_id || c.id)) }));
  last.forEach((scan) => {
    (scan.candidates || []).forEach((c) => {
      const key = c.promoted_trend_id || c.id;
      countByTrendId[key] = (countByTrendId[key] || 0) + 1;
    });
  });
  return { totalScans, last4: last.length, countByTrendId, perScan };
}

function renderTractionBadge(t, appearances) {
  if (t.custom) return '';
  if (!appearances.totalScans) {
    return `<div class="traction-badge traction-none">no scan history yet</div>`;
  }
  const count = appearances.countByTrendId[t.id] || 0;
  const windowN = appearances.last4;
  const tooltip = appearances.perScan.map((s) => {
    const hit = s.ids.has(t.id) ? '✓' : '·';
    return `${hit} ${(s.date || '').slice(0, 10)}`;
  }).join('\n');
  if (windowN < 4) {
    return `<div class="traction-badge traction-none" title="${escapeHtml(tooltip)}">last ${count}/${windowN} scans</div>`;
  }
  if (count >= 2) {
    return `<div class="traction-badge traction-ok" title="${escapeHtml(tooltip)}">last ${count}/4 scans</div>`;
  }
  return `<div class="traction-badge traction-low" title="${escapeHtml(tooltip)}">lower priority · last ${count}/4 scans</div>`;
}

/* ══════════ News tab ══════════ */

let newsFilter = 'all';

async function renderNews() {
  const list = document.getElementById('news-list');
  const all = await db.select('news_items');
  const trends = await db.select('trends');
  const trendName = Object.fromEntries(trends.map((t) => [t.id, t.name]));

  const items = all
    .filter((n) => newsFilter === 'all' || n.type === newsFilter)
    .slice()
    .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));

  if (!items.length) {
    list.innerHTML = `<div class="empty-state">No news yet. Paste a news JSON into the import area above.</div>`;
    return;
  }

  list.innerHTML = items.map((n) => {
    const rel = 'rel-' + (n.relevance || 'med');
    const typeClass = 'type-' + n.type;
    const affected = (n.affected || []).map((a) => `
      <div class="affected-row">
        <span class="imp-dot imp-${a.impact}"></span>
        <span class="aff-ticker">${escapeHtml(a.ticker)}</span>
        <div class="aff-info"><div class="aff-name">${escapeHtml(a.name || a.ticker)}</div>${a.reason ? `<div class="aff-reason">${escapeHtml(a.reason)}</div>` : ''}</div>
      </div>
    `).join('');
    /* Trend badge logic:
     *   - trend_id missing → no badge at all
     *   - trend_id matches registry → one green badge with the friendly name
     *   - trend_id present but no match → TWO badges: amber "Unknown trend"
     *     warning + a muted grey badge showing the raw id Claude assigned,
     *     so we can see at a glance what label Claude was reaching for. */
    let trendBadge = '';
    if (n.trend_id) {
      const known = trendName[n.trend_id];
      if (known) {
        trendBadge = `<span class="type-pill type-validation">${escapeHtml(known)}</span>`;
      } else {
        trendBadge =
          `<span class="type-pill type-disruption" title="Claude assigned this item a trend_id that doesn't match any trend in your registry.">Unknown trend</span>` +
          `<span class="type-pill type-raw-id" title="The raw trend_id Claude used — use this to fix your registry or your news prompt.">${escapeHtml(n.trend_id)}</span>`;
      }
    }
    return `
      <div class="news-card">
        <div class="rel-bar ${rel}"></div>
        <div class="news-body">
          <div class="news-top">
            <div class="news-headline"><a href="${escapeHtml(n.url)}" target="_blank" rel="noopener">${escapeHtml(n.headline)}</a></div>
            <div class="news-pills"><span class="type-pill ${typeClass}">${escapeHtml(n.type)}</span>${trendBadge}</div>
          </div>
          <div class="news-summary">${escapeHtml(n.summary || '')}</div>
          <div class="news-meta">${escapeHtml(n.source || '')} · ${escapeHtml((n.published_at || '').slice(0, 16).replace('T', ' '))}</div>
          ${affected ? `<div class="affected-block">${affected}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

/* Same prompt-shape variations as the trends and candidate-scan imports.
 * Accepts a bare array (wraps it) and `detectedDate` per item (uses the
 * most recent one to seed root `generated_at`). Idempotent. */
function normalizeNewsImport(input) {
  let envelope;
  if (Array.isArray(input)) {
    envelope = { generated_at: '', items: input };
  } else if (input && typeof input === 'object') {
    envelope = { ...input };
  } else {
    return input;
  }

  if (!envelope.generated_at) {
    const dates = (envelope.items || [])
      .map((it) => it && (it.detectedDate || it.published_at))
      .filter((d) => typeof d === 'string')
      .sort();
    envelope.generated_at = dates.length
      ? (dates[dates.length - 1].length === 10
          ? new Date(dates[dates.length - 1] + 'T12:00:00Z').toISOString()
          : new Date(dates[dates.length - 1]).toISOString())
      : nowISO();
  }

  envelope.items = (envelope.items || []).map((it) => {
    if (!it || typeof it !== 'object') return it;
    const out = { ...it };

    /* Field-name aliases — common Claude/JS variations mapped to the
     * canonical schema field names. Only applied when the canonical
     * field is missing, so explicit data always wins. */
    if (!out.url) {
      out.url = out.link || out.articleUrl || out.article_url || out.href || undefined;
    }
    /* Normalise whatever ended up in out.url:
     *  - protocol-relative (`//example.com/x`) → https:
     *  - bare domain (`example.com/x` or `www.example.com/x`) → prepend https://
     *  - anything still without http(s) protocol → drop the field entirely
     *    (schema no longer requires url, so missing is fine; invalid is not). */
    if (typeof out.url === 'string' && out.url.length) {
      const raw = out.url.trim();
      if (/^https?:\/\//i.test(raw)) {
        out.url = raw;
      } else if (/^\/\//.test(raw)) {
        out.url = 'https:' + raw;
      } else if (/^[\w-]+(\.[\w-]+)+([\/?#].*)?$/.test(raw)) {
        out.url = 'https://' + raw;
      } else {
        delete out.url;
      }
    } else {
      delete out.url;
    }
    if (!out.published_at) {
      const candidate = out.publishedAt || out.publishedDate || out.published_date
        || out.published || out.date || out.detectedDate || '';
      if (candidate) {
        out.published_at = (typeof candidate === 'string' && candidate.length === 10)
          ? candidate + 'T12:00:00Z'
          : String(candidate);
      }
    }
    if (!out.trend_id) {
      out.trend_id = out.trendId || out.trend || null;
    }
    if (!out.affected && Array.isArray(out.affectedTickers)) {
      out.affected = out.affectedTickers;
    }
    if (out.relevance === 'medium') out.relevance = 'med';
    /* News classification: be lenient on common synonyms. */
    if (out.type === 'positive') out.type = 'catalyst';
    if (out.type === 'negative') out.type = 'headwind';

    /* Drop the alias keys so they don't clutter storage. */
    delete out.detectedDate;
    delete out.link;
    delete out.articleUrl;
    delete out.article_url;
    delete out.href;
    delete out.publishedAt;
    delete out.publishedDate;
    delete out.published_date;
    delete out.published;
    delete out.date;
    delete out.trendId;
    delete out.trend;
    delete out.affectedTickers;
    return out;
  });

  return envelope;
}

async function importNewsJSON() {
  const ta = document.getElementById('news-import-area');
  const err = document.getElementById('news-import-error');
  err.classList.remove('show');
  let parsed;
  try { parsed = JSON.parse(ta.value); }
  catch (e) { err.textContent = 'Invalid JSON: ' + e.message; err.classList.add('show'); return; }

  /* Absorb prompt-shape variations (bare array, detectedDate) before validation. */
  parsed = normalizeNewsImport(parsed);

  const result = await validateAgainst('./schemas/news.schema.json', parsed);
  if (!result.ok) { err.textContent = 'Schema errors:\n' + result.errors.slice(0, 10).join('\n'); err.classList.add('show'); return; }

  const existing = await db.select('news_items');
  const existingHashes = new Set(existing.map((n) => n.hash));
  let added = 0, dupes = 0;
  const toWrite = [];
  for (const item of parsed.items) {
    const hash = await sha256Hex(item.headline + item.published_at + item.source);
    if (existingHashes.has(hash)) { dupes++; continue; }
    toWrite.push({
      id: hash,
      hash,
      headline: item.headline,
      summary: item.summary,
      source: item.source,
      url: item.url,
      published_at: item.published_at,
      type: item.type,
      relevance: item.relevance || 'med',
      trend_id: item.trend_id || null,
      affected: item.affected || [],
      tags: item.tags || [],
      imported_at: nowISO()
    });
    added++;
  }
  if (toWrite.length) await db.upsert('news_items', toWrite);
  ta.value = '';
  const pruneResult = await db.prune();
  const pruneNote = (pruneResult.movers || pruneResult.news_items) ? ` · pruned ${pruneResult.news_items} old news` : '';
  showToast(`Imported ${added} news item${added === 1 ? '' : 's'}, ${dupes} duplicates ignored${pruneNote}`);
  renderNews();
}

/* Shared PDF palette + helpers (used by Screener, News, Movers exports).
 * Defined as module-level constants so all three exports share a visual
 * language — same accent, same fonts, same card-style elements. */
const PDF_COLORS = {
  textPrimary:   [26, 26, 24],
  textSecondary: [90, 90, 84],
  textMuted:     [154, 154, 146],
  bgSurface:     [240, 239, 233],
  bgCard:        [255, 255, 255],
  border:        [220, 220, 215],
  borderLight:   [240, 240, 235],
  accent:        [29, 158, 117],
  accentDark:    [15, 110, 86],
  accentLight:   [225, 245, 238],
  red:           [226, 75, 74],
  redDark:       [120, 30, 30],
  redLight:      [252, 235, 235],
  blue:          [12, 68, 124],
  blueLight:     [230, 241, 251],
  amber:         [99, 56, 6],
  amberLight:    [250, 238, 218],
  purple:        [60, 52, 137],
  purpleLight:   [238, 237, 254]
};

/* jsPDF's built-in fonts only support WinAnsi/Latin-1. Strip / replace any
 * Unicode that would otherwise render as garbage bytes. Unknown characters
 * are removed silently rather than substituted with '?' — cleaner output,
 * and the typical "loss" is emojis that the PDF font couldn't render anyway. */
function safePDF(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/[—–]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/[▲△]/g, '^')
    .replace(/[▼▽]/g, 'v')
    .replace(/[ ]/g, ' ')
    .replace(/[^\x00-\xFF]/g, '');
}

/* Per-page footer drawn at end of export: separator line, generation
 * timestamp left, page X of N centered, brand right. */
function drawPdfFooter(doc, PAGE_W, PAGE_H, MARGIN) {
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('courier', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...PDF_COLORS.textMuted);
    doc.setDrawColor(...PDF_COLORS.border);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, PAGE_H - 9, PAGE_W - MARGIN, PAGE_H - 9);
    doc.text(`Generated ${nowISO().slice(0, 16).replace('T', ' ')} UTC`, MARGIN, PAGE_H - 5);
    doc.text(`Page ${i} of ${totalPages}`, PAGE_W / 2, PAGE_H - 5, { align: 'center' });
    doc.text('MegaTrend Intelligence', PAGE_W - MARGIN, PAGE_H - 5, { align: 'right' });
  }
}

/* Cover band: large serif title left, date right, accent line under. */
function drawPdfCover(doc, title, dateLine, PAGE_W, MARGIN) {
  doc.setFont('times', 'normal');
  doc.setFontSize(28);
  doc.setTextColor(...PDF_COLORS.textPrimary);
  doc.text(title, MARGIN, 22);
  doc.setFont('courier', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...PDF_COLORS.textSecondary);
  doc.text(dateLine, PAGE_W - MARGIN, 22, { align: 'right' });
  doc.setDrawColor(...PDF_COLORS.accent);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, 26, PAGE_W - MARGIN, 26);
}

/* Four stat tiles below the cover band. Stats array is up to 4 entries of
 * { label, value, color }. */
function drawPdfStatTiles(doc, stats, PAGE_W, MARGIN, y) {
  const contentW = PAGE_W - MARGIN * 2;
  const tileH = 22;
  const gap = 4;
  const tileW = (contentW - gap * (stats.length - 1)) / stats.length;
  stats.forEach((s, i) => {
    const x = MARGIN + i * (tileW + gap);
    doc.setFillColor(...PDF_COLORS.bgSurface);
    doc.rect(x, y, tileW, tileH, 'F');
    doc.setFont('courier', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...PDF_COLORS.textMuted);
    doc.text(safePDF(s.label).toUpperCase(), x + 4, y + 6);
    doc.setFont('times', 'normal');
    doc.setFontSize(20);
    doc.setTextColor(...(s.color || PDF_COLORS.textPrimary));
    doc.text(safePDF(s.value), x + 4, y + 17);
  });
  return y + tileH + 10;
}

/* ──────────── Screener PDF export ────────────────────────────────
 * Each trend renders as a card-style block matching the dashboard's
 * trend-card design: icon + name + sector + confidence pill, description,
 * driver pills, then a "KEY COMPANIES" list with ticker badges + reasons.
 * Custom-trends get an amber left stripe (same convention as on the dashboard). */
async function exportScreenerPDF() {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      showToast('jsPDF failed to load — check network', 'error'); return;
    }
    const { jsPDF } = window.jspdf;
    const trends = await db.select('trends');
    if (!trends.length) { showToast('No trends to export — add or import some first'); return; }

    /* Sort: custom trends first (your stuff visible up top), then
     * alphabetically. Within each tier, alphabetical. */
    const sorted = trends.slice().sort((a, b) => {
      const ac = a.custom ? 0 : 1, bc = b.custom ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return (a.name || '').localeCompare(b.name || '');
    });
    const byConf = { high: 0, med: 0, low: 0 };
    for (const t of sorted) byConf[t.confidence || 'med']++;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const PAGE_W = 297, PAGE_H = 210;
    const MARGIN = 14;
    const CONTENT_W = PAGE_W - MARGIN * 2;
    const COL = PDF_COLORS;

    drawPdfCover(doc, 'MegaTrend Registry', todayISO(), PAGE_W, MARGIN);
    let cursorY = drawPdfStatTiles(doc, [
      { label: 'Total trends', value: String(sorted.length) },
      { label: 'High conf',    value: String(byConf.high), color: COL.accent },
      { label: 'Medium',       value: String(byConf.med),  color: COL.amber },
      { label: 'Low',          value: String(byConf.low),  color: COL.red }
    ], PAGE_W, MARGIN, 32);

    /* Per-trend card — mirrors the HTML .trend-card visual rhythm.
     * Layout (landscape, full-width single column for max line length):
     *
     *   ┌── 5mm padding ───────────────────────────────────────────┐
     *   │ 🤖  Trend name (serif, large)             [CONFIDENCE]   │
     *   │     Sector (mono, small, muted)           [CUSTOM]       │
     *   │                                                          │
     *   │ ─── hairline divider ───                                 │
     *   │ Description (sans, body, secondary colour) ...           │
     *   │                                                          │
     *   │ [pill] [pill] [pill]                                     │
     *   │                                                          │
     *   │ KEY COMPANIES ─────────────────────                      │
     *   │  [TSLA] Tesla Inc.                                       │
     *   │         Reason (wraps comfortably wide)                  │
     *   │  ...                                                     │
     *   └──────────────────────────────────────────────────────────┘
     *
     * Card outline drawn last (after content height is known); custom-trend
     * trends get an amber left stripe. */
    const PAD = 6;           // inner padding
    const RIGHT = MARGIN + CONTENT_W;

    const drawCard = (t, startY) => {
      const drivers   = (t.drivers || []);
      const companies = (t.companies || []);
      const desc      = safePDF(t.description || '');

      /* Pre-measure description height to plan a page break. */
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      const descLines = doc.splitTextToSize(desc, CONTENT_W - PAD * 2);

      /* Rough estimate so we don't orphan a header at the bottom. Exact
       * height is computed after drawing. */
      const estHeight = PAD * 2
                      + 16                                  // header row
                      + 4                                   // divider
                      + descLines.length * 5 + 4            // description
                      + (drivers.length ? 9 : 0)            // driver pill row
                      + (companies.length ? 6 : 0)          // KEY COMPANIES label
                      + companies.length * 9;               // company rows
      if (startY + Math.min(estHeight, 80) > PAGE_H - 14) {
        doc.addPage();
        startY = MARGIN;
      }

      const cardX = MARGIN;
      const cardTop = startY;
      let y = cardTop + PAD;

      /* ── Header: icon + name + sector (left), conf + custom (right) ──
       * jsPDF's built-in fonts can't render anything outside Latin-1, so
       * emoji icons (🏭, 🧬, ⚡, etc.) come back from safePDF as empty.
       * In that case we draw nothing — the slot stays clean and the rest of
       * the header alignment stays consistent. */
      const safeIcon = safePDF(t.icon || '');
      if (safeIcon) {
        doc.setFont('times', 'normal');
        doc.setFontSize(22);
        doc.setTextColor(...COL.textPrimary);
        doc.text(safeIcon, cardX + PAD, y + 6);
      }

      const headerTextX = cardX + PAD + 12;
      doc.setFont('times', 'normal');
      doc.setFontSize(18);
      doc.setTextColor(...COL.textPrimary);
      doc.text(safePDF(t.name || ''), headerTextX, y + 6);

      doc.setFont('courier', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...COL.textMuted);
      doc.text(safePDF(t.sector || ''), headerTextX, y + 12);

      /* Pills (right-aligned, top-right of card). */
      const confKey = t.confidence || 'med';
      const confBg   = confKey === 'high' ? COL.accentLight : confKey === 'low' ? COL.redLight : COL.amberLight;
      const confText = confKey === 'high' ? COL.accentDark  : confKey === 'low' ? COL.redDark  : COL.amber;
      const confLabel = confKey.toUpperCase();
      doc.setFont('courier', 'bold');
      doc.setFontSize(8);
      const confW = doc.getTextWidth(confLabel) + 8;
      const confH = 7;
      const confX = RIGHT - PAD - confW;
      doc.setFillColor(...confBg);
      doc.roundedRect(confX, y + 1, confW, confH, 2.5, 2.5, 'F');
      doc.setTextColor(...confText);
      doc.text(confLabel, confX + confW / 2, y + 6, { align: 'center' });

      if (t.custom) {
        const cLabel = 'CUSTOM';
        doc.setFont('courier', 'bold');
        doc.setFontSize(7);
        const cW = doc.getTextWidth(cLabel) + 6;
        const cX = confX - cW - 3;
        doc.setFillColor(...COL.amberLight);
        doc.roundedRect(cX, y + 1, cW, 7, 2.5, 2.5, 'F');
        doc.setTextColor(...COL.amber);
        doc.text(cLabel, cX + cW / 2, y + 6, { align: 'center' });
      }

      y += 16;

      /* Hairline divider under header. */
      doc.setDrawColor(...COL.borderLight);
      doc.setLineWidth(0.1);
      doc.line(cardX + PAD, y, RIGHT - PAD, y);
      y += 5;

      /* ── Description ── */
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(...COL.textSecondary);
      for (const ln of descLines) {
        if (y > PAGE_H - 14) { doc.addPage(); y = MARGIN + PAD; }
        doc.text(ln, cardX + PAD, y);
        y += 5;
      }
      y += 3;

      /* ── Driver pills ── */
      if (drivers.length) {
        let dx = cardX + PAD;
        doc.setFont('courier', 'normal');
        doc.setFontSize(8);
        for (const d of drivers) {
          const text = safePDF(d);
          const w = doc.getTextWidth(text) + 6;
          if (dx + w > RIGHT - PAD) { dx = cardX + PAD; y += 7; }
          doc.setFillColor(...COL.bgSurface);
          doc.roundedRect(dx, y - 4, w, 6, 2, 2, 'F');
          doc.setTextColor(...COL.textSecondary);
          doc.text(text, dx + 3, y);
          dx += w + 3;
        }
        y += 9;
      }

      /* ── KEY COMPANIES section ── */
      if (companies.length) {
        doc.setFont('courier', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...COL.textMuted);
        const label = 'KEY COMPANIES';
        doc.text(label, cardX + PAD, y);
        const labelW = doc.getTextWidth(label);
        doc.setDrawColor(...COL.borderLight);
        doc.setLineWidth(0.1);
        doc.line(cardX + PAD + labelW + 4, y - 1.3, RIGHT - PAD, y - 1.3);
        y += 5;

        for (const c of companies) {
          /* Pre-measure to keep a company row intact across page breaks. */
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          const ticker = safePDF(c.ticker || '');
          const tickerW = Math.max(doc.getTextWidth(ticker) + 5, 14);
          const textX = cardX + PAD + tickerW + 5;
          const textW = RIGHT - PAD - textX;
          const reasonLines = doc.splitTextToSize(safePDF(c.reason || ''), textW);
          const rowH = 5 + Math.min(reasonLines.length, 3) * 4 + 1;

          if (y + rowH > PAGE_H - 14) { doc.addPage(); y = MARGIN + PAD; }

          /* Ticker badge — blue pill, bold mono. */
          doc.setFillColor(...COL.blueLight);
          doc.roundedRect(cardX + PAD, y - 3.5, tickerW, 6, 1.5, 1.5, 'F');
          doc.setFont('courier', 'bold');
          doc.setFontSize(8);
          doc.setTextColor(...COL.blue);
          doc.text(ticker, cardX + PAD + tickerW / 2, y + 0.5, { align: 'center' });

          /* Company name — bold sans, primary text. */
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.setTextColor(...COL.textPrimary);
          doc.text(safePDF(c.name || c.ticker || ''), textX, y);

          /* Reason — regular sans, secondary, wraps comfortably wide. */
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(...COL.textSecondary);
          let ry = y + 4;
          for (const ln of reasonLines.slice(0, 3)) {
            doc.text(ln, textX, ry);
            ry += 4;
          }
          y = ry + 2;
        }
      }

      /* Card outline drawn last over what we already painted. Bottom padding
       * is baked in here. */
      const cardBottom = y + 1;
      doc.setDrawColor(...COL.border);
      doc.setLineWidth(0.25);
      doc.roundedRect(cardX, cardTop, CONTENT_W, cardBottom - cardTop, 3, 3, 'S');
      if (t.custom) {
        /* Amber left stripe — same convention as the dashboard's
         * .trend-card.custom-trend selector. */
        doc.setFillColor(...COL.amber);
        doc.rect(cardX, cardTop, 1.2, cardBottom - cardTop, 'F');
      }

      return cardBottom + 8;   // inter-card gap
    };

    for (const t of sorted) cursorY = drawCard(t, cursorY);

    drawPdfFooter(doc, PAGE_W, PAGE_H, MARGIN);
    doc.save(`megatrend-registry-${todayISO()}.pdf`);
    showToast(`Registry PDF saved (${sorted.length} trends)`);
  } catch (e) {
    console.error('[exportScreenerPDF] failed:', e);
    showToast('Export failed: ' + (e.message || e), 'error');
  }
}

/* ──────────── News PDF export (redesigned) ───────────────────────
 * Cover band + stats tiles per type, then items grouped by trend, with
 * each trend's section getting a coloured band header. Each item shows a
 * type chip (catalyst/headwind/validation/disruption), bold headline,
 * summary, affected companies, and a clickable source link. */
async function exportNewsPDF() {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      showToast('jsPDF failed to load — check network', 'error'); return;
    }
    const { jsPDF } = window.jspdf;
    const today = todayISO();
    const all = await db.select('news_items');
    const todays = all.filter((n) =>
      (n.imported_at || '').slice(0, 10) === today ||
      (n.published_at || '').slice(0, 10) === today
    );
    if (!todays.length) { showToast('No news for today to export'); return; }

    const trends = await db.select('trends');
    const trendName = Object.fromEntries(trends.map((t) => [t.id, t.name]));

    const byType = { catalyst: 0, headwind: 0, validation: 0, disruption: 0 };
    for (const n of todays) if (byType[n.type] !== undefined) byType[n.type]++;

    /* Group items by trend (with "Unknown trend" bucket for unmatched ids). */
    const byTrend = new Map();
    for (const n of todays) {
      const key = n.trend_id && trendName[n.trend_id] ? n.trend_id : '__unknown__';
      if (!byTrend.has(key)) byTrend.set(key, []);
      byTrend.get(key).push(n);
    }
    /* Largest trend group first, then by trend name. */
    const trendOrder = Array.from(byTrend.keys()).sort((a, b) => {
      const ca = byTrend.get(a).length, cb = byTrend.get(b).length;
      if (ca !== cb) return cb - ca;
      const an = a === '__unknown__' ? 'zzz' : (trendName[a] || a);
      const bn = b === '__unknown__' ? 'zzz' : (trendName[b] || b);
      return an.localeCompare(bn);
    });

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const PAGE_W = 210, PAGE_H = 297;
    const MARGIN = 14;
    const CONTENT_W = PAGE_W - MARGIN * 2;
    const COL = PDF_COLORS;

    drawPdfCover(doc, 'MegaTrend News', today, PAGE_W, MARGIN);
    let cursorY = drawPdfStatTiles(doc, [
      { label: 'Total items', value: String(todays.length) },
      { label: 'Catalyst',    value: String(byType.catalyst),   color: COL.accent },
      { label: 'Headwind',    value: String(byType.headwind),   color: COL.red },
      { label: 'Validation',  value: String(byType.validation), color: COL.blue }
    ], PAGE_W, MARGIN, 32);

    /* Type-chip palette (matches dashboard pills). */
    const typePalette = {
      catalyst:   { bg: COL.accentLight, fg: COL.accentDark },
      headwind:   { bg: COL.redLight,    fg: COL.redDark },
      validation: { bg: COL.blueLight,   fg: COL.blue },
      disruption: { bg: COL.amberLight,  fg: COL.amber }
    };

    const drawTrendBand = (label, count, y) => {
      doc.setFillColor(...COL.textPrimary);
      doc.rect(MARGIN, y, CONTENT_W, 8, 'F');
      doc.setFont('times', 'normal');
      doc.setFontSize(12);
      doc.setTextColor(255, 255, 255);
      doc.text(safePDF(label), MARGIN + 4, y + 6);
      doc.setFont('courier', 'normal');
      doc.setFontSize(8);
      doc.text(`${count} ${count === 1 ? 'item' : 'items'}`, PAGE_W - MARGIN - 4, y + 6, { align: 'right' });
      return y + 11;
    };

    const drawNewsItem = (n, y) => {
      const summary = safePDF(n.summary || '');
      const sumLines = (() => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        return doc.splitTextToSize(summary, CONTENT_W - 8).slice(0, 4);
      })();
      const affectedItems = (n.affected || []).slice(0, 8);
      const estHeight = 12                       // headline
                      + sumLines.length * 4      // summary
                      + (affectedItems.length ? 6 : 0)
                      + 6                        // source line
                      + 4;                       // padding
      if (y + estHeight > PAGE_H - 14) { doc.addPage(); y = MARGIN; }

      const itemTop = y;

      /* Type chip + headline on one row. */
      const palette = typePalette[n.type] || { bg: COL.bgSurface, fg: COL.textSecondary };
      const chipLabel = safePDF((n.type || 'item').toUpperCase());
      doc.setFont('courier', 'bold');
      doc.setFontSize(7);
      const chipW = doc.getTextWidth(chipLabel) + 6;
      doc.setFillColor(...palette.bg);
      doc.roundedRect(MARGIN + 2, y, chipW, 5.5, 1.5, 1.5, 'F');
      doc.setTextColor(...palette.fg);
      doc.text(chipLabel, MARGIN + 2 + chipW / 2, y + 3.8, { align: 'center' });

      doc.setFont('times', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...COL.textPrimary);
      const headline = safePDF(n.headline || '');
      const headlineLines = doc.splitTextToSize(headline, CONTENT_W - chipW - 10);
      doc.text(headlineLines[0] || '', MARGIN + 2 + chipW + 4, y + 4);
      if (headlineLines[1]) {
        doc.text(headlineLines[1], MARGIN + 2 + chipW + 4, y + 8);
        y += 4;
      }
      y += 8;

      /* Summary. */
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...COL.textSecondary);
      for (const ln of sumLines) { doc.text(ln, MARGIN + 4, y); y += 4; }
      y += 1;

      /* Affected companies as inline ticker chips with impact colour. */
      if (affectedItems.length) {
        let ax = MARGIN + 4;
        doc.setFont('courier', 'bold');
        doc.setFontSize(7);
        for (const a of affectedItems) {
          const t = safePDF(a.ticker || '');
          const w = doc.getTextWidth(t) + 6;
          if (ax + w > MARGIN + CONTENT_W - 4) {
            ax = MARGIN + 4;
            y += 6;
          }
          const bg = a.impact === 'pos' ? COL.accentLight : a.impact === 'neg' ? COL.redLight : COL.bgSurface;
          const fg = a.impact === 'pos' ? COL.accentDark  : a.impact === 'neg' ? COL.redDark  : COL.textSecondary;
          doc.setFillColor(...bg);
          doc.roundedRect(ax, y - 3.2, w, 5, 1.5, 1.5, 'F');
          doc.setTextColor(...fg);
          doc.text(t, ax + w / 2, y, { align: 'center' });
          ax += w + 2;
        }
        y += 6;
      }

      /* Source line — clickable if URL present. */
      const sourceText = safePDF(`${n.source || 'source'} · ${(n.published_at || '').slice(0, 10) || '—'}`);
      doc.setFont('courier', 'normal');
      doc.setFontSize(8);
      if (n.url) {
        doc.setTextColor(...COL.blue);
        doc.textWithLink(sourceText, MARGIN + 4, y, { url: n.url });
      } else {
        doc.setTextColor(...COL.textMuted);
        doc.text(sourceText, MARGIN + 4, y);
      }
      y += 4;

      /* Soft separator under item. */
      doc.setDrawColor(...COL.borderLight);
      doc.setLineWidth(0.1);
      doc.line(MARGIN + 4, y, MARGIN + CONTENT_W - 4, y);
      return y + 5;
    };

    for (const trendKey of trendOrder) {
      const items = byTrend.get(trendKey);
      const label = trendKey === '__unknown__' ? 'Unknown trend' : trendName[trendKey];
      /* Force page break if too close to bottom — header looks orphaned otherwise. */
      if (cursorY > PAGE_H - 36) { doc.addPage(); cursorY = MARGIN; }
      cursorY = drawTrendBand(label, items.length, cursorY);
      for (const n of items) cursorY = drawNewsItem(n, cursorY);
      cursorY += 3;
    }

    drawPdfFooter(doc, PAGE_W, PAGE_H, MARGIN);
    doc.save(`megatrend-news-${today}.pdf`);
    showToast(`News PDF saved (${todays.length} items)`);
  } catch (e) {
    console.error('[exportNewsPDF] failed:', e);
    showToast('Export failed: ' + (e.message || e), 'error');
  }
}

/* ══════════ Movers tab ══════════ */

/* Persisted Finnhub key (optional). */
const FINNHUB_KEY = () => localStorage.getItem('mt.finnhub_key') || '';

/* Which sub-tab is visible on the Movers tab: 'gainers' or 'losers'. */
let moversView = 'gainers';

/* ── Movers progress panel ──
 * Shown during a scrape/enrich run, hidden when idle. Supports two modes:
 *   - indeterminate: animated shimmer (used while we wait on TradingView)
 *   - determinate: fills from 0%→100% as catalysts enrich
 */
function updateMoversProgress(label, done, total, indeterminate, sub) {
  const panel = document.getElementById('movers-progress');
  if (!panel) return;
  panel.hidden = false;
  panel.classList.toggle('indeterminate', !!indeterminate);
  document.getElementById('movers-progress-label').textContent = label || '';
  const fill = document.getElementById('movers-progress-fill');
  const count = document.getElementById('movers-progress-count');
  const subEl = document.getElementById('movers-progress-sub');
  if (indeterminate) {
    count.textContent = '';
    fill.style.width = '';   // let the CSS animation drive width
  } else {
    const pct = total ? Math.round(100 * done / total) : 0;
    fill.style.width = pct + '%';
    count.textContent = total ? `${done}/${total} · ${pct}%` : '';
  }
  if (subEl) subEl.textContent = sub || '';
}
function hideMoversProgress(afterMs) {
  const panel = document.getElementById('movers-progress');
  if (!panel) return;
  const doHide = () => { panel.hidden = true; panel.classList.remove('indeterminate'); };
  if (afterMs) setTimeout(doHide, afterMs); else doHide();
}

async function refreshMoversCacheLabel() {
  const runs = await db.select('movers_runs', { run_date: todayISO() });
  const label = document.getElementById('movers-cache-label');
  if (runs.length) {
    label.textContent = `cached · ran ${fmtRelTime(runs[0].ran_at)}${runs[0].forced ? ' (forced)' : ''}`;
  } else {
    label.textContent = '';
  }
}

async function runMovers(forced) {
  const today = todayISO();
  const btn = document.getElementById('movers-run-btn');
  btn.disabled = true;

  try {
    if (!forced) {
      const cached = await db.select('movers', { run_date: today });
      if (cached.length) {
        showToast(`Showing ${cached.length} cached movers for today`);
        await renderMovers();
        await refreshMoversCacheLabel();
        return;
      }
    }

    updateMoversProgress('Scanning TradingView (up + down, general + large-cap + mid-cap)...', 0, 0, true, 'Six parallel POSTs to scanner.tradingview.com');
    const rows = await scrapeMovers(today, (done, total, subLine) => {
      updateMoversProgress('Fetching catalysts', done, total, false, subLine);
    });
    if (!rows.length) throw new Error('TradingView returned 0 qualifying movers');

    updateMoversProgress('Saving...', 0, 0, true, `${rows.length} rows to localStorage`);

    /* Overwrite today's cached rows. Because id = run_date-ticker-direction,
     * upsert replaces naturally. */
    const existing = await db.select('movers', { run_date: today });
    if (forced && existing.length) {
      for (const r of existing) await db.delete('movers', r.id);
    }
    await db.upsert('movers', rows);
    await db.upsert('movers_runs', [{ id: today, run_date: today, ran_at: nowISO(), count: rows.length, forced: !!forced }]);

    const pruneResult = await db.prune();
    if (pruneResult.movers) showToast(`Pruned ${pruneResult.movers} movers older than 30d`, 'muted');

    const up = rows.filter((r) => r.direction === 'up').length;
    const down = rows.filter((r) => r.direction === 'down').length;
    updateMoversProgress(`Done — ${rows.length} movers (${up} up · ${down} down)`, rows.length, rows.length, false, '');
    hideMoversProgress(2000);
    showToast(`${rows.length} movers fetched (${up} up · ${down} down)`);
    await renderMovers();
    await refreshMoversCacheLabel();
  } catch (e) {
    console.error('movers: scrape failed', e);
    updateMoversProgress('Failed', 0, 0, false, e.message || String(e));
    hideMoversProgress(4000);
    showToast('Movers scrape failed: ' + (e.message || e), 'error');
    await renderMovers();
  } finally {
    btn.disabled = false;
  }
}

/* Port of v1's fetchMoversFromTradingView, keyed by run_date for caching.
 * `onProgress(done, total, subLine)` is called as each ticker's catalyst
 * enrichment finishes. Pass null to skip progress reporting. */
async function scrapeMovers(runDate, onProgress) {
  const trends = await db.select('trends');
  const tickerToTrend = {};
  trends.forEach((t) => (t.companies || []).forEach((c) => {
    if (!tickerToTrend[c.ticker]) tickerToTrend[c.ticker] = { id: t.id, name: t.name };
  }));

  /* Two-pass scanner per direction:
   *   - `general`  — top 30 by change among all qualifying tickers ($300M–$200B)
   *   - `largeCap` — top 30 by change among large-caps (≥$10B)
   * Deduped and merged. This guarantees mega-cap movers (like TXN +19% on
   * earnings) surface even when the tape is flooded with small-cap spikes
   * that would otherwise dominate the top-30 rank cap. */
  const buildReq = (direction, mode) => {
    const filter = [
      { left: 'exchange', operation: 'in_range', right: ['NASDAQ', 'NYSE', 'AMEX'] },
      /* Include both plain stocks AND depositary receipts (ADRs) so foreign
       * companies with US listings (STM, TSM, ASML, NVO, etc.) surface.
       * Previously we filtered type=stock only, which excluded them. */
      { left: 'type', operation: 'in_range', right: ['stock', 'dr'] },
      { left: 'change', operation: direction === 'up' ? 'greater' : 'less', right: direction === 'up' ? 5 : -5 },
      { left: 'close', operation: 'greater', right: 1 },
      { left: 'relative_volume_10d_calc', operation: 'greater', right: 1.5 },
      { left: 'Value.Traded', operation: 'egreater', right: 10_000_000 }
      /* Removed `is_primary = true`. For ADRs, "primary" refers to the
       * company's global primary listing (usually Europe/Asia), so this
       * check incorrectly excluded their US-traded shares. We already gate
       * on exchange in [NASDAQ, NYSE, AMEX], which is the right constraint. */
    ];
    if (mode === 'largeCap') {
      filter.push({ left: 'market_cap_basic', operation: 'egreater', right: 10_000_000_000 });
    } else if (mode === 'midCap') {
      /* Dedicated mid-cap lane ($1B–$10B). Without this, mid-caps with
       * modest moves get crowded out of the general scan's top-50 by
       * micro-cap spikes. Lane size is small (top 30) since this is a
       * targeted backstop, not the primary surface. */
      filter.push({ left: 'market_cap_basic', operation: 'in_range', right: [1_000_000_000, 10_000_000_000] });
    } else {
      filter.push({ left: 'market_cap_basic', operation: 'in_range', right: [300_000_000, 700_000_000_000] });
    }
    return {
      filter,
      options: { lang: 'en' },
      symbols: { query: { types: [] }, tickers: [] },
      columns: ['name', 'description', 'close', 'change', 'change_abs', 'volume',
                'market_cap_basic', 'sector', 'industry', 'Value.Traded',
                'average_volume_10d_calc', 'relative_volume_10d_calc',
                /* Two earnings columns — TradingView has been inconsistent
                 * about which one carries the "most recent release" value.
                 * We use whichever produces a timestamp within the last
                 * ~30 hours. */
                'earnings_release_date', 'earnings_release_next_date'],
      sort: { sortBy: 'change', sortOrder: direction === 'up' ? 'desc' : 'asc' },
      range: [0, mode === 'midCap' ? 30 : 50]
    };
  };

  async function doScan(direction, mode) {
    const r = await fetch('https://scanner.tradingview.com/america/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(buildReq(direction, mode))
    });
    if (!r.ok) throw new Error(`TradingView HTTP ${r.status} (${direction}/${mode})`);
    const d = await r.json();
    if (!d.data) throw new Error(`TradingView returned no data (${direction}/${mode})`);
    return d.data.map((row) => {
      const [name, description, close, change, changeAbs, volume, marketCap, sector, industry, valueTraded, avg10dVol, relVol10d, earningsTsA, earningsTsB] = row.d;
      return { ticker: name, symbolFull: row.s, description, close, change, changeAbs, volume, marketCap, sector, industry, valueTraded, avg10dVol, relVol10d, earningsTsA, earningsTsB };
    });
  }

  /* Dedupe helper: merge any number of scan results, keeping first occurrence
   * per ticker. Order of arguments matters — earlier wins on collision. */
  function merge(...lists) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
      for (const q of list) {
        if (seen.has(q.ticker)) continue;
        seen.add(q.ticker);
        out.push(q);
      }
    }
    return out;
  }

  const [upGen, upLarge, upMid, downGen, downLarge, downMid] = await Promise.all([
    doScan('up',   'general'),
    doScan('up',   'largeCap'),
    doScan('up',   'midCap'),
    doScan('down', 'general'),
    doScan('down', 'largeCap'),
    doScan('down', 'midCap')
  ]);
  const upRaw   = merge(upGen,   upLarge,   upMid);
  const downRaw = merge(downGen, downLarge, downMid);
  console.info(`[movers] up: ${upGen.length} general + ${upLarge.length} largeCap + ${upMid.length} midCap = ${upRaw.length} unique · down: ${downGen.length} + ${downLarge.length} + ${downMid.length} = ${downRaw.length} unique`);

  function buildRow(q, direction) {
    const move = Number(q.change) || 0;
    const marketCap = Number(q.marketCap) || 0;
    const volume = Number(q.volume) || 0;
    const avgVol = Number(q.avg10dVol) || volume;
    const volumeMultiple = avgVol ? Number((volume / avgVol).toFixed(2)) : 1;
    const tradedValue = Number(q.valueTraded) || (volume * (q.close || 0));
    const tt = tickerToTrend[q.ticker];

    let score = 0;
    const absMove = Math.abs(move);
    if (absMove >= 12) score += 25; else if (absMove >= 8) score += 18; else if (absMove >= 5) score += 10;
    if (volumeMultiple >= 5) score += 30; else if (volumeMultiple >= 3) score += 20; else if (volumeMultiple >= 2) score += 10;
    if (marketCap >= 300e6 && marketCap <= 2e9) score += 15;
    else if (marketCap > 2e9 && marketCap <= 20e9) score += 10;
    else if (marketCap > 20e9 && marketCap <= 200e9) score += 5;

    /* Did this ticker report earnings today (or after hours since yesterday)?
     * TradingView has two candidate columns (earnings_release_date and
     * earnings_release_next_date) — which one carries the "most recent
     * release" value varies. We take whichever yields a timestamp within
     * the last ~30 hours. Timestamps come in seconds or ms depending on
     * the column, so normalise both. */
    const toMs = (x) => {
      const n = Number(x);
      if (!isFinite(n) || n <= 0) return 0;
      return n > 1e12 ? n : n * 1000;
    };
    const cand = [toMs(q.earningsTsA), toMs(q.earningsTsB)].filter(Boolean);
    let earningsMs = 0;
    for (const c of cand) {
      const h = (Date.now() - c) / 3600e3;
      if (h >= -12 && h <= 30) { earningsMs = c; break; }
    }
    const earningsToday = earningsMs > 0;

    return {
      id: `${runDate}-${q.ticker}-${direction}`,
      run_date: runDate,
      ticker: q.ticker,
      symbol_full: q.symbolFull || `NASDAQ:${q.ticker}`,
      name: q.description || q.ticker,
      earnings_today: earningsToday,
      earnings_at: earningsMs ? new Date(earningsMs).toISOString() : null,
      direction,
      move_pct: Number(move.toFixed(2)),
      market_cap: marketCap,
      volume,
      avg_volume_10d: avgVol,
      volume_multiple: volumeMultiple,
      traded_value: tradedValue,
      sector: q.sector || q.industry || '—',
      industry: q.industry || null,
      catalyst: null,
      catalyst_source: null,
      catalyst_url: null,
      trend_id: tt ? tt.id : null,
      trend_name: tt ? tt.name : null,
      cluster_score: score,
      new_trend_flag: false,
      new_headwind_flag: false,
      created_at: nowISO()
    };
  }

  const gainers = upRaw.map((q) => buildRow(q, 'up'));
  const losers  = downRaw.map((q) => buildRow(q, 'down'));
  const all = gainers.concat(losers);

  /* Cluster flags: 3+ untracked companies same sector same direction */
  const bySectorUp = {}, bySectorDown = {};
  gainers.forEach((m) => { if (!m.trend_id) (bySectorUp[m.sector] = bySectorUp[m.sector] || []).push(m); });
  losers.forEach((m) => { if (!m.trend_id) (bySectorDown[m.sector] = bySectorDown[m.sector] || []).push(m); });
  Object.values(bySectorUp).forEach((arr) => { if (arr.length >= 3) arr.forEach((m) => { m.new_trend_flag = true; }); });
  Object.values(bySectorDown).forEach((arr) => { if (arr.length >= 3) arr.forEach((m) => { m.new_headwind_flag = true; }); });

  await enrichCatalysts(all, onProgress);
  /* Filter is applied at render time (see applyLoserFilter) so it runs on
   * cached data too, not only fresh scrapes. */
  return all;
}

/* Loser filter — applied every render. New rule: "kick out pure orphans."
 * Keep a loser if:
 *   (a) it has a real catalyst (news or synthetic earnings), OR
 *   (b) it's an orphan in a sector with exactly one anchor story — it will
 *       be swept into that story's cluster card ("attached to a story").
 * Drop all other orphans (pure orphans — no catalyst, no attachable story).
 *
 * Gainers are never touched. Uses clusterAnchorsBySimilarity to match
 * groupMoversIntoCards exactly, so the filter's definition of "one story"
 * is always consistent with what the grouper actually produces. */
function applyLoserFilter(rows) {
  const gainers = rows.filter((m) => m.direction === 'up');
  const losers  = rows.filter((m) => m.direction === 'down');

  /* Per sector: split into anchors + orphans, then count distinct anchor
   * stories via the same similarity logic the grouper uses. A sector with
   * exactly one anchor story is the one case the sweep will fire in. */
  const sectorHasSingleStory = {};
  const sectorAnchorCount = {};
  const bySector = {};
  for (const m of losers) {
    const s = m.sector || '—';
    (bySector[s] = bySector[s] || []).push(m);
  }
  for (const [s, rs] of Object.entries(bySector)) {
    const anchors = rs.filter(hasRealCatalyst);
    const clusters = clusterAnchorsBySimilarity(anchors);
    sectorHasSingleStory[s] = clusters.length === 1;
    sectorAnchorCount[s] = clusters.length;
  }

  const decisions = [];
  const keptLosers = losers.filter((m) => {
    const sector = m.sector || '—';
    const row = { ticker: m.ticker, sector, move: (m.move_pct || 0).toFixed(2) + '%' };
    if (hasRealCatalyst(m)) {
      decisions.push({ ...row, kept: true, reason: 'has catalyst' });
      return true;
    }
    if (sectorHasSingleStory[sector]) {
      decisions.push({ ...row, kept: true, reason: 'orphan attached to single-anchor sector story (will sweep)' });
      return true;
    }
    const n = sectorAnchorCount[sector] || 0;
    decisions.push({
      ...row,
      kept: false,
      reason: n === 0 ? 'pure orphan (no anchor in sector)' : `pure orphan (sector has ${n} stories, no sweep)`
    });
    return false;
  });

  const dropped = losers.length - keptLosers.length;
  if (decisions.length) {
    console.groupCollapsed(`[movers] loser filter: kept ${keptLosers.length} / ${losers.length} (dropped ${dropped})`);
    console.table(decisions);
    console.groupEnd();
  }
  return gainers.concat(keptLosers);
}

/* Catalyst waterfall: Finnhub → Benzinga → SEC EDGAR → Yahoo. First success wins.
 * If every source fails for a ticker, catalyst is literally "Catalyst: None."
 * — no fabrication. */
async function enrichCatalysts(rows, onProgress) {
  /* Concurrency bumped from 4 → 12 since each waterfall call now has a
   * 4-second hard cap (no more 30s hangs), and the proxies the slow
   * sources go through don't rate-limit at this scale. */
  const BATCH = 12;
  const sourceCounts = {};
  const perTickerErrors = [];
  let enriched = 0;
  let processed = 0;
  const total = rows.length;

  const tickSub = () => {
    const src = Object.entries(sourceCounts).map(([s, c]) => `${s}:${c}`).join(' · ');
    return src ? `${enriched} with catalyst · ${src}` : '';
  };

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await Promise.all(batch.map(async (m) => {
      const ticker = m.ticker;
      const base = `Moved ${fmtPct(m.move_pct)} on ${fmtNum(m.volume_multiple, 1)}x average volume.`;
      const { result, errors } = await catalystWaterfall(ticker, m.symbol_full);
      if (result && result.headline) {
        m.catalyst = `${base} ${result.headline}`;
        m.catalyst_source = result.source;
        m.catalyst_url = result.url || null;
        enriched++;
        sourceCounts[result.source] = (sourceCounts[result.source] || 0) + 1;
      } else if (m.earnings_today) {
        /* TradingView's calendar says earnings were released today but the
         * news waterfall found nothing — synthesize an honest earnings
         * catalyst so the ticker stands alone instead of being misclassified
         * as a passive sector rider. */
        m.catalyst = `${base} ${m.name} reported earnings today — details pending.`;
        m.catalyst_source = 'TradingView (calendar)';
        m.catalyst_url = null;
        m.synthetic_catalyst = true;
        enriched++;
        sourceCounts['TradingView (calendar)'] = (sourceCounts['TradingView (calendar)'] || 0) + 1;
      } else {
        m.catalyst = `${base} Catalyst: None.`;
        m.catalyst_source = null;
        perTickerErrors.push({ ticker, errors });
      }
      processed++;
      if (onProgress) onProgress(processed, total, tickSub());
    }));
    /* No inter-batch sleep anymore — the per-source timeout already paces
     * the work and the upstream APIs we use don't rate-limit at this scale. */
  }

  const sumLine = Object.entries(sourceCounts).map(([s, c]) => `${s}:${c}`).join(' · ') || 'none';
  console.info(`[catalysts] ${enriched}/${rows.length} enriched · ${sumLine}`);
  if (perTickerErrors.length) {
    console.warn(`[catalysts] ${perTickerErrors.length} tickers had no catalyst. First three:`, perTickerErrors.slice(0, 3));
  }
  if (enriched === 0 && rows.length) {
    showToast('No catalysts found for any ticker — click ⚙ Diagnose to see why', 'error');
  } else if (enriched < rows.length) {
    showToast(`${enriched}/${rows.length} tickers got a catalyst · ${sumLine}`, 'muted');
  }
}

/* Per-source timeout — caps how long any single adapter can take. Without
 * this, a hung CORS proxy could stall a whole ticker's lookup for 30+
 * seconds. 4s is generous for healthy sources, brutal for hung ones. */
const CATALYST_TIMEOUT_MS = 4000;

/* Normalise URLs returned by catalyst adapters. Yahoo / TradingView etc.
 * sometimes return relative paths like "/articles/..." that the browser
 * would otherwise resolve against the dashboard's own origin (localhost:3000),
 * yielding 404s. Each adapter passes its own domain as the default base so
 * relative paths resolve correctly. Returns '' for anything unrecoverable
 * — the link is then simply omitted on render. */
function absoluteCatalystUrl(href, defaultBase) {
  if (!href || typeof href !== 'string') return '';
  const h = href.trim();
  if (!h) return '';
  if (/^https?:\/\//i.test(h)) return h;
  if (/^\/\//.test(h)) return 'https:' + h;
  if (h.startsWith('/') && defaultBase) {
    return defaultBase.replace(/\/+$/, '') + h;
  }
  /* Bare domain (e.g. "reuters.com/foo") — assume https. */
  if (/^[\w-]+(\.[\w-]+)+([\/?#].*)?$/.test(h)) return 'https://' + h;
  return '';
}

function callSourceWithTimeout(name, ticker, symbolFull) {
  return Promise.race([
    Promise.resolve()
      .then(() => CATALYSTS[name](ticker, symbolFull))
      .then((r) => {
        if (!r || !r.headline) throw new Error('empty');
        return { name, result: r };
      }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout ${CATALYST_TIMEOUT_MS}ms`)), CATALYST_TIMEOUT_MS))
  ]);
}

/* Per-ticker catalyst waterfall, parallelised within tiers.
 *
 * Sources are grouped into 3 tiers by speed + quality. WITHIN a tier, every
 * source fires in parallel via Promise.any() — first one to return a fresh
 * headline wins. If the whole tier comes back empty, fall through to the
 * next tier. This replaces the old "9 sources serially, give up after each
 * one fails" loop, which could spend 30+ seconds on a single ticker.
 *
 * Trade-off: when an earlier-priority source would have won, we still hit
 * its tier-mates with one extra network call each. That's a small cost for
 * a 3-5× speedup on the common case (small-cap tickers where many sources
 * have to fail). */
async function catalystWaterfall(ticker, symbolFull) {
  const errors = [];

  /* Tier 1: fast, JSON-native, no CORS proxy. */
  const tier1 = [];
  if (FINNHUB_KEY()) tier1.push('finnhub');
  tier1.push('yahoo_search', 'tradingview_news');

  /* Tier 2: broad coverage but slower / proxy-routed. */
  const tier2 = ['reuters', 'google_news_proxy', 'nasdaq'];

  /* Tier 3: fallbacks that rarely hit but worth trying as a last resort. */
  const tier3 = ['motley_fool', 'yahoo_rss', 'sec_edgar'];

  for (const tier of [tier1, tier2, tier3]) {
    const tasks = tier.map((name) =>
      callSourceWithTimeout(name, ticker, symbolFull).catch((e) => {
        errors.push(`${name}: ${e.message || e}`);
        throw e;     // rethrow so Promise.any treats this as a failure
      })
    );
    try {
      const { result } = await Promise.any(tasks);
      return { result, errors };
    } catch (_) {
      /* All sources in this tier failed; continue to next tier. */
    }
  }
  return { result: null, errors };
}

/* Try a URL directly first; if that fails (CORS / network block), retry
 * through up to three public CORS proxies. Returns the Response. */
const PUBLIC_PROXIES = [
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`
];

async function fetchWithProxyFallback(targetUrl) {
  const errors = [];
  try {
    const r = await fetch(targetUrl);
    if (r.ok) return r;
    errors.push(`direct:HTTP${r.status}`);
  } catch (e) {
    errors.push(`direct:${e.message}`);
  }
  for (const mk of PUBLIC_PROXIES) {
    const p = mk(targetUrl);
    try {
      const r = await fetch(p);
      if (r.ok) return r;
      errors.push(`${p.split('?')[0]}:HTTP${r.status}`);
    } catch (e) {
      errors.push(`${p.split('?')[0]}:${e.message}`);
    }
  }
  throw new Error('direct + all proxies failed · ' + errors.join(' | '));
}

const CATALYSTS = {
  finnhub: async (ticker) => {
    const key = FINNHUB_KEY();
    if (!key) throw new Error('no key set');
    const today = new Date();
    const from = new Date(today.getTime() - 3 * 86400e3).toISOString().slice(0, 10);
    const to = today.toISOString().slice(0, 10);
    const r = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(ticker)}&from=${from}&to=${to}&token=${key}`);
    if (r.status === 429) throw new Error('rate-limited (60/min)');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const items = await r.json();
    if (!Array.isArray(items) || !items.length) throw new Error('empty');
    const top = items.sort((a, b) => (b.datetime || 0) - (a.datetime || 0))[0];
    return { headline: `Finnhub: "${top.headline}"`, source: 'Finnhub', url: top.url };
  },

  /* Yahoo's newer JSON search endpoint. Same origin we use for yields, so
   * CORS is reliably open. Returns a `news` array with `providerPublishTime`. */
  yahoo_search: async (ticker) => {
    const r = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=10&quotesCount=0`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const news = (d && d.news) || [];
    if (!news.length) throw new Error('no news in payload');
    const fresh = news.filter((n) => isFreshDate(n.providerPublishTime));
    if (!fresh.length) throw new Error(`no fresh news (last ${CATALYST_FRESHNESS_DAYS}d)`);
    const top = fresh[0];
    const url = absoluteCatalystUrl(top.link, 'https://finance.yahoo.com')
             || (top.uuid ? `https://finance.yahoo.com/news/${top.uuid}` : '');
    return { headline: `Yahoo: "${top.title}"`, source: 'Yahoo', url };
  },

  /* TradingView's own news endpoint. We already scrape their scanner, so
   * CORS tends to match. Requires the full symbol (EXCHANGE:TICKER). */
  tradingview_news: async (ticker, symbolFull) => {
    const sym = symbolFull || `NASDAQ:${ticker}`;    // best-effort fallback
    const r = await fetch(`https://news-headlines.tradingview.com/v2/list?category=symbol&symbol=${encodeURIComponent(sym)}&lang=en`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const items = (d && (d.items || d.news)) || [];
    if (!items.length) throw new Error('no news');
    const fresh = items.filter((it) => isFreshDate(it.published || it.publishedAt || it.date));
    if (!fresh.length) throw new Error(`no fresh news (last ${CATALYST_FRESHNESS_DAYS}d)`);
    const top = fresh[0];
    const headline = top.title || top.headline || '';
    if (!headline) throw new Error('first item has no title');
    return {
      headline: `TradingView: "${headline}"`,
      source: 'TradingView',
      url: absoluteCatalystUrl(top.link, 'https://www.tradingview.com')
        || absoluteCatalystUrl(top.url, 'https://www.tradingview.com')
        || absoluteCatalystUrl(top.storyPath, 'https://www.tradingview.com')
        || ''
    };
  },

  /* Reuters via Google News with a `site:reuters.com` filter. Reuters'
   * own site doesn't expose CORS-open per-ticker endpoints, so we route
   * through the same public CORS proxy chain as Motley Fool / general
   * Google News. `when:14d` restricts results to the last 14 days. */
  reuters: async (ticker) => {
    const target = `https://news.google.com/rss/search?q=site%3Areuters.com+%22${encodeURIComponent(ticker)}%22+when%3A${CATALYST_FRESHNESS_DAYS}d&hl=en-US&gl=US&ceid=US:en`;
    const proxies = [
      (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
      (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`
    ];
    const notes = [];
    for (const mk of proxies) {
      const p = mk(target);
      try {
        const r = await fetch(p);
        if (!r.ok) { notes.push(`${p.split('?')[0]}:HTTP${r.status}`); continue; }
        const txt = await r.text();
        const items = parseRSS(txt);
        const fresh = items.filter((it) => isFreshDate(it.pubDate));
        if (fresh.length) {
          return {
            headline: `Reuters: "${fresh[0].title}"`,
            source: 'Reuters',
            url: absoluteCatalystUrl(fresh[0].link, 'https://www.reuters.com')
          };
        }
        notes.push(`${p.split('?')[0]}:${items.length ? 'all stale' : 'empty'}`);
      } catch (e) { notes.push(`${p.split('?')[0]}:${e.message}`); }
    }
    throw new Error(`no fresh Reuters article in last ${CATALYST_FRESHNESS_DAYS}d · ` + notes.join(' | '));
  },

  /* Motley Fool has no public RSS-per-ticker feed, but they index on Google
   * News and frequently publish "why [ticker] moved today" analysis on big
   * move days. We query Google News with a `site:fool.com` filter through
   * the same public CORS proxies. The `when:14d` operator restricts results
   * to the last 14 days, and we double-check pubDate to reject anything
   * stale that slipped through. */
  motley_fool: async (ticker) => {
    const target = `https://news.google.com/rss/search?q=site%3Afool.com+%22${encodeURIComponent(ticker)}%22+when%3A${CATALYST_FRESHNESS_DAYS}d&hl=en-US&gl=US&ceid=US:en`;
    const proxies = [
      (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
      (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`
    ];
    const notes = [];
    for (const mk of proxies) {
      const p = mk(target);
      try {
        const r = await fetch(p);
        if (!r.ok) { notes.push(`${p.split('?')[0]}:HTTP${r.status}`); continue; }
        const txt = await r.text();
        const items = parseRSS(txt);
        const fresh = items.filter((it) => isFreshDate(it.pubDate));
        if (fresh.length) {
          return {
            headline: `Motley Fool: "${fresh[0].title}"`,
            source: 'Motley Fool',
            url: absoluteCatalystUrl(fresh[0].link, 'https://www.fool.com')
          };
        }
        notes.push(`${p.split('?')[0]}:${items.length ? 'all stale' : 'empty'}`);
      } catch (e) { notes.push(`${p.split('?')[0]}:${e.message}`); }
    }
    throw new Error(`no fresh Motley Fool article in last ${CATALYST_FRESHNESS_DAYS}d · ` + notes.join(' | '));
  },

  nasdaq: async (ticker) => {
    const target = `https://api.nasdaq.com/api/news/topic/articlebysymbol?q=${encodeURIComponent(ticker)}%7Cstocks&offset=0&limit=5&fallback=true`;
    const r = await fetchWithProxyFallback(target);
    const txt = await r.text();
    /* Nasdaq now returns HTML bot-challenge pages instead of JSON for many
     * requests. Detect that before calling .json() so the error message is
     * readable. */
    if (txt.trim().startsWith('<')) throw new Error('Nasdaq returned HTML (bot-check or endpoint moved)');
    let d;
    try { d = JSON.parse(txt); } catch (e) { throw new Error('invalid JSON: ' + e.message); }
    const rows = d?.data?.rows || [];
    if (!rows.length) throw new Error('no rows');
    const top = rows[0];
    return {
      headline: `Nasdaq: "${top.title}"`,
      source: 'Nasdaq',
      url: absoluteCatalystUrl(top.url, 'https://www.nasdaq.com')
        || (top.url_path ? `https://www.nasdaq.com${top.url_path.startsWith('/') ? '' : '/'}${top.url_path}` : '')
    };
  },

  yahoo_rss: async (ticker) => {
    const target = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`;
    const r = await fetchWithProxyFallback(target);
    const txt = await r.text();
    const items = parseRSS(txt);
    if (!items.length) throw new Error('empty RSS (endpoint deprecated for most tickers in 2026)');
    return {
      headline: `Yahoo (RSS): "${items[0].title}"`,
      source: 'Yahoo',
      url: absoluteCatalystUrl(items[0].link, 'https://finance.yahoo.com')
    };
  },

  /* Google News RSS isn't CORS-open; try three public proxies until one works.
   * `when:14d` restricts results server-side; we double-check pubDate too. */
  google_news_proxy: async (ticker) => {
    const target = `https://news.google.com/rss/search?q=%22${encodeURIComponent(ticker)}%22+stock+when%3A${CATALYST_FRESHNESS_DAYS}d&hl=en-US&gl=US&ceid=US:en`;
    const proxies = [
      `https://corsproxy.io/?url=${encodeURIComponent(target)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
      `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(target)}`
    ];
    const notes = [];
    for (const p of proxies) {
      try {
        const r = await fetch(p);
        if (!r.ok) { notes.push(`${p.split('?')[0]}:HTTP${r.status}`); continue; }
        const txt = await r.text();
        const items = parseRSS(txt);
        const fresh = items.filter((it) => isFreshDate(it.pubDate));
        if (fresh.length) return {
          headline: `Google News: "${fresh[0].title}"`,
          source: 'Google News',
          url: absoluteCatalystUrl(fresh[0].link, 'https://news.google.com')
        };
        notes.push(`${p.split('?')[0]}:${items.length ? 'all stale' : 'empty'}`);
      } catch (e) { notes.push(`${p.split('?')[0]}:${e.message}`); }
    }
    throw new Error(`no fresh Google News in last ${CATALYST_FRESHNESS_DAYS}d · ` + notes.join(' | '));
  },

  /* SEC EDGAR full-text search — the same dataset backing the public
   * sec.gov/search-filings portal. No form-type filter, so this now covers
   * 8-K (material events), SC 13D / 13G (activist / large-holder), S-1 /
   * S-3 / 424B5 (capital raises), DEFA14A (proxy supplemental), 6-K
   * (foreign material events), and anything else filed in the window —
   * mirroring what a user would see in the portal's default search. */
  sec_edgar: async (ticker) => {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - CATALYST_FRESHNESS_DAYS * 86400e3).toISOString().slice(0, 10);
    const apiUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(ticker)}%22&dateRange=custom&startdt=${start}&enddt=${end}`;
    const r = await fetch(apiUrl);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const hits = d?.hits?.hits || [];
    if (!hits.length) throw new Error(`no SEC filings in last ${CATALYST_FRESHNESS_DAYS}d`);
    /* Hits are already date-bounded by the request, but the SEC sometimes
     * returns older items with file_date inside the metadata — re-check. */
    const fresh = hits.filter((h) => isFreshDate(h._source && h._source.file_date));
    if (!fresh.length) throw new Error('returned hits all outside window');
    const top = fresh[0]._source;
    /* form is sometimes a string ("8-K"), sometimes an array (["8-K","8-K/A"]).
     * Take the first entry either way for the headline. */
    const formType = Array.isArray(top.form) ? (top.form[0] || 'filing')
                  : (top.form || top.forms?.[0] || 'filing');
    const url = top.adsh
      ? `https://www.sec.gov/Archives/edgar/data/${top.ciks?.[0] || top.cik}/${(top.adsh || '').replace(/-/g, '')}/${top.adsh}-index.htm`
      : `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(ticker)}%22`;
    return {
      headline: `SEC ${formType}: "${top.display_names?.[0] || ticker} filed ${top.file_date}"`,
      source: 'SEC EDGAR',
      url
    };
  }
};

/* Check one ticker against every movers filter threshold and report which
 * ones it passes/fails. Use this when a ticker you expected to see in the
 * grid isn't there (e.g. "why no TXN today?"). */
async function diagnoseTicker() {
  const input = prompt('Ticker to check against the movers filters (e.g. TXN, STM):');
  if (!input) return;
  const sym = input.trim().toUpperCase();
  if (!sym) return;

  showToast(`Checking ${sym} against scanner filters...`);
  try {
    const r = await fetch('https://scanner.tradingview.com/america/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        symbols: {
          tickers: [`NASDAQ:${sym}`, `NYSE:${sym}`, `AMEX:${sym}`],
          query: { types: [] }
        },
        columns: ['name', 'description', 'close', 'change', 'change_abs', 'volume',
                  'market_cap_basic', 'sector', 'industry', 'Value.Traded',
                  'average_volume_10d_calc', 'relative_volume_10d_calc', 'is_primary',
                  'type', 'earnings_release_date', 'earnings_release_next_date']
      })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (!d.data || !d.data.length) {
      alert(`${sym}: not found on NASDAQ / NYSE / AMEX.\nMight be on a non-US exchange or a different symbol.`);
      return;
    }

    /* Pick the primary listing if TradingView returned multiple. */
    /* Primary-listing preference removed from the filter; for diagnostics we
     * still show it so you can see TradingView's opinion. Pick whichever
     * match looks "best" for the user — prefer primary if present, else the
     * first row returned. */
    const row = d.data.find((x) => x.d[12] === true) || d.data[0];
    const [name, desc, close, change, , volume, marketCap, sector, industry, valueTraded, avg10d, relVol, isPrimary, type, earningsA, earningsB] = row.d;
    const exch = (row.s || '').split(':')[0];
    const absChange = Math.abs(change || 0);

    const fmtEarnings = (ts) => {
      if (!ts) return '—';
      const ms = Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000;
      const d = new Date(ms);
      if (!isFinite(d.getTime())) return String(ts);
      const hours = (Date.now() - ms) / 3600e3;
      const tag = hours >= -12 && hours <= 30 ? '  ← within 30h window' : '';
      return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC (${hours.toFixed(1)}h ago)${tag}`;
    };

    const checks = [
      { name: 'Exchange NASDAQ/NYSE/AMEX', actual: exch || '—', pass: ['NASDAQ', 'NYSE', 'AMEX'].includes(exch) },
      { name: 'Type (stock or dr)',        actual: type || '—',                    pass: type === 'stock' || type === 'dr' },
      { name: 'Primary listing (info)',    actual: String(isPrimary),              pass: true },   // no longer a filter — shown for info
      { name: 'Close > $1',                actual: `$${(close || 0).toFixed(2)}`,  pass: (close || 0) > 1 },
      { name: 'Move > ±5%',                actual: `${(change || 0).toFixed(2)}%`, pass: absChange > 5 },
      { name: 'Rel volume > 1.5x',         actual: `${(relVol || 0).toFixed(2)}x`, pass: (relVol || 0) > 1.5 },
      { name: 'Mkt cap $300M–$700B',       actual: fmtMoney(marketCap),            pass: (marketCap || 0) >= 300e6 && (marketCap || 0) <= 700e9 },
      { name: 'Dollar volume ≥ $10M',      actual: fmtMoney(valueTraded),          pass: (valueTraded || 0) >= 10e6 },
      { name: 'earnings_release_date',     actual: fmtEarnings(earningsA),         pass: true },   // info only
      { name: 'earnings_release_next_date',actual: fmtEarnings(earningsB),         pass: true }    // info only
    ];
    const lines = checks.map((c) => `${c.pass ? '✓' : '✗'} ${c.name}: ${c.actual}`);
    const fails = checks.filter((c) => !c.pass).map((c) => c.name);

    /* Even if all filters pass at scanner level, the ticker might still be
     * beyond the [0,30] rank cap per direction. Note that separately. */
    let rankNote = '';
    if (fails.length === 0) {
      rankNote = '\n\nNote: the scanner also caps each direction at the top 30 by move %. ' +
                 `This ticker passes the filter but might be ranked lower than the top 30 ${change > 0 ? 'gainers' : 'losers'} today.`;
    }
    const verdict = fails.length === 0
      ? '✅ Passes every filter.'
      : `❌ Fails ${fails.length}: ${fails.join(', ')}`;

    console.group(`[ticker check] ${sym} — ${desc || name} · ${sector || industry || '—'}`);
    console.table(checks);
    console.groupEnd();

    alert(
      `${sym} — ${desc || name}\n${sector || industry || '—'} · ${exch}\n\n` +
      lines.join('\n') +
      `\n\n${verdict}${rankNote}\n\n` +
      `(Full table in DevTools console.)`
    );
  } catch (e) {
    console.error('ticker check failed', e);
    showToast('Ticker check failed: ' + e.message, 'error');
  }
}

/* Diagnose every source against a known-good ticker (AAPL) and report. */
/* Probe TradingView's scanner to find the right exchange prefix for a
 * ticker (NYSE / NASDAQ / AMEX). Returns "EXCHANGE:TICKER" or null. */
async function resolveSymbolExchange(ticker) {
  try {
    const r = await fetch('https://scanner.tradingview.com/america/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        symbols: { tickers: [`NASDAQ:${ticker}`, `NYSE:${ticker}`, `AMEX:${ticker}`], query: { types: [] } },
        columns: ['name']
      })
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.data && d.data.length) return d.data[0].s;   // "EXCHANGE:TICKER"
  } catch (_) {}
  return null;
}

async function diagnoseCatalysts() {
  const input = prompt('Ticker to diagnose against catalyst sources (default: AAPL):', 'AAPL');
  if (input === null) return;     // user cancelled
  const ticker = (input || 'AAPL').trim().toUpperCase();
  if (!ticker) return;

  showToast(`Resolving ${ticker} on US exchanges...`);
  const symbolFull = await resolveSymbolExchange(ticker);
  if (!symbolFull) {
    showToast(`${ticker}: not found on NASDAQ/NYSE/AMEX — sources may still try`, 'error');
  }

  showToast(`Diagnosing catalyst sources with ${ticker}${symbolFull ? ` (${symbolFull})` : ''}... see console`);
  const lines = [`ticker: ${ticker}${symbolFull ? `   exchange: ${symbolFull.split(':')[0]}` : '   exchange: not resolved'}`];
  console.group(`%cCatalyst diagnostics — ${ticker}`, 'font-weight:bold;color:#1D9E75');
  for (const [name, fn] of Object.entries(CATALYSTS)) {
    const t0 = performance.now();
    try {
      const r = await fn(ticker, symbolFull);
      const ms = Math.round(performance.now() - t0);
      console.log(`✓ ${name} (${ms}ms) → ${r.headline}`, r.url || '');
      lines.push(`✓ ${name} (${ms}ms)\n   ${r.headline.slice(0, 100)}\n   ${r.url || ''}`);
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      console.warn(`✗ ${name} (${ms}ms) — ${e.message}`);
      lines.push(`✗ ${name} (${ms}ms) — ${e.message}`);
    }
  }
  console.groupEnd();
  alert(`Catalyst source diagnostics (${ticker})\n\n` + lines.join('\n\n') + '\n\nFull detail in DevTools console.');
}

/* Freshness gate: catalysts older than CATALYST_FRESHNESS_DAYS are rejected
 * by adapters that have date info. Stops the waterfall from latching onto
 * a stale article when the real news is somewhere else. Adapters without
 * reliable dates (Nasdaq) skip this check; missing dates default to fresh
 * rather than reject (don't punish a source for incomplete metadata). */
const CATALYST_FRESHNESS_DAYS = 14;

function isFreshDate(input) {
  if (input === null || input === undefined || input === '') return true;
  let ms;
  if (typeof input === 'number') {
    ms = input > 1e12 ? input : input * 1000;
  } else {
    ms = Date.parse(input);
  }
  if (!isFinite(ms)) return true;
  return (Date.now() - ms) <= CATALYST_FRESHNESS_DAYS * 86400e3;
}

function parseRSS(xmlText) {
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) return [];
    const items = [...doc.querySelectorAll('item, entry')];
    return items.map((it) => ({
      title: (it.querySelector('title')?.textContent || '').trim(),
      pubDate: (it.querySelector('pubDate, published, updated')?.textContent || '').trim(),
      link: (it.querySelector('link')?.textContent || it.querySelector('link')?.getAttribute('href') || '').trim()
    })).filter((x) => x.title);
  } catch (e) { return []; }
}

/* ── Clustering: lump peers that share a catalyst story ──
 *
 * Rules (per user spec):
 *   1. Same sector + same direction + similar catalyst text → one card.
 *   2. Same sector + one dominant story, peers with no catalyst → lumped in,
 *      each flagged as "⚠ rode sector".
 *   3. Multiple distinct stories in a sector → separate cards; catalyst-less
 *      tickers stay solo (we don't guess which story they belong to).
 *   4. Different reasons entirely → separate cards. (Default of the algorithm.)
 */

const CATALYST_SIM_THRESHOLD = 0.35;

const CATALYST_STOPWORDS = new Set([
  'the','and','for','with','that','this','from','into','over','under','been','have','has','had',
  'are','was','were','its','their','they','them','than','after','before','about','moved','volume',
  'average','catalyst','none','finnhub','yahoo','benzinga','nasdaq','reports','filed','said','says'
]);

function hasRealCatalyst(m) {
  const c = m.catalyst || '';
  return c && !c.endsWith('Catalyst: None.');
}

function catalystTokens(m) {
  const text = (m.catalyst || '').toLowerCase();
  return new Set(text.split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !CATALYST_STOPWORDS.has(w)));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach((x) => { if (b.has(x)) inter++; });
  return inter / (a.size + b.size - inter);
}

/* Cluster a list of anchor (catalyst-bearing) rows by catalyst-token
 * similarity. Synthetic earnings catalysts never cluster — each reporter's
 * event stands alone. Shared between the filter and the grouper so both
 * see the same "number of stories in this sector" count. */
function clusterAnchorsBySimilarity(anchors) {
  const clusters = [];
  const seen = new Set();
  for (const a of anchors) {
    if (seen.has(a.id)) continue;
    const cluster = [a];
    seen.add(a.id);
    if (a.synthetic_catalyst) { clusters.push(cluster); continue; }
    const aTok = catalystTokens(a);
    for (const b of anchors) {
      if (seen.has(b.id)) continue;
      if (b.synthetic_catalyst) continue;
      if (jaccard(aTok, catalystTokens(b)) >= CATALYST_SIM_THRESHOLD) {
        cluster.push(b);
        seen.add(b.id);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

function groupMoversIntoCards(rows) {
  const bySectorDir = {};
  for (const r of rows) {
    const k = `${r.sector || '—'}|${r.direction}`;
    (bySectorDir[k] = bySectorDir[k] || []).push(r);
  }

  const cards = [];
  for (const group of Object.values(bySectorDir)) {
    const anchors = group.filter(hasRealCatalyst);
    const orphans = group.filter((r) => !hasRealCatalyst(r));
    const anchorClusters = clusterAnchorsBySimilarity(anchors);

    /* If there's exactly one story in this (sector, direction) and at least
     * one orphan, sweep the orphans in with a "rode sector" flag. */
    if (anchorClusters.length === 1 && orphans.length) {
      const combined = anchorClusters[0].concat(orphans.map((o) => ({ ...o, _rode_sector: true })));
      cards.push(buildCardFromRows(combined));
    } else {
      for (const cluster of anchorClusters) cards.push(buildCardFromRows(cluster));
      for (const o of orphans) cards.push(buildCardFromRows([o]));
    }
  }

  /* Sort within each direction:
   *   1. catalyst-bearing cards FIRST (so they fill the 50-slot cap before
   *      no-catalyst cards do — user wants actionable cards prioritised
   *      for inclusion in the visible list, not just rank by magnitude)
   *   2. then by peakMove descending
   * Direction split (gainers before losers in the global list) stays first. */
  cards.sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === 'up' ? -1 : 1;
    const aHas = hasRealCatalyst(a.anchor) ? 1 : 0;
    const bHas = hasRealCatalyst(b.anchor) ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    return b.peakMove - a.peakMove;
  });
  return cards;
}

function buildCardFromRows(rows) {
  const sorted = rows.slice().sort((a, b) => Math.abs(b.move_pct || 0) - Math.abs(a.move_pct || 0));
  const anchor = sorted.find(hasRealCatalyst) || sorted[0];
  const peakMove = Math.max(...sorted.map((r) => Math.abs(r.move_pct || 0)));
  const avgMove = sorted.reduce((s, r) => s + (r.move_pct || 0), 0) / sorted.length;
  return {
    type: sorted.length > 1 ? 'cluster' : 'single',
    rows: sorted,
    anchor,
    direction: anchor.direction,
    sector: anchor.sector || '—',
    peakMove,
    avgMove
  };
}

async function renderMovers() {
  const grid = document.getElementById('movers-grid');
  const metrics = document.getElementById('movers-metrics');
  const rowsRaw = await db.select('movers', { run_date: todayISO() });
  /* Apply loser filter at render time so the rule works on cached rows too. */
  const rows = applyLoserFilter(rowsRaw);
  const cards = groupMoversIntoCards(rows);

  const up = rows.filter((r) => r.direction === 'up');
  const down = rows.filter((r) => r.direction === 'down');
  const gainerCards = cards.filter((c) => c.direction === 'up');
  const loserCards  = cards.filter((c) => c.direction === 'down');
  /* Cap at 50 cards per view, as requested. */
  const gainersShown = gainerCards.slice(0, 50);
  const losersShown  = loserCards.slice(0, 50);

  /* Tab counters. */
  const gCount = document.getElementById('view-count-gainers');
  const lCount = document.getElementById('view-count-losers');
  if (gCount) gCount.textContent = String(gainerCards.length);
  if (lCount) lCount.textContent = String(loserCards.length);

  const viewCards = moversView === 'losers' ? losersShown : gainersShown;
  const viewRowsFlat = viewCards.flatMap((c) => c.rows);
  const activeLabel = moversView === 'losers' ? 'Losers' : 'Gainers';
  const clusteredInView = viewCards.filter((c) => c.type === 'cluster').length;
  const avgMove = viewRowsFlat.length
    ? viewRowsFlat.reduce((s, r) => s + Math.abs(r.move_pct || 0), 0) / viewRowsFlat.length
    : 0;

  metrics.innerHTML = `
    <div class="metric"><div class="metric-label">All movers (today)</div><div class="metric-val">${rows.length}</div></div>
    <div class="metric"><div class="metric-label">${escapeHtml(activeLabel)} (shown)</div><div class="metric-val ${moversView === 'losers' ? 'delta-red' : 'delta-green'}">${viewCards.length}</div></div>
    <div class="metric"><div class="metric-label">${escapeHtml(activeLabel)} clusters</div><div class="metric-val">${clusteredInView}</div></div>
    <div class="metric"><div class="metric-label">Avg abs move</div><div class="metric-val">${fmtNum(avgMove, 1)}%</div></div>
  `;

  if (!rows.length) {
    grid.innerHTML = `<div class="empty-state">No movers for today yet. Click <strong>Run movers screener</strong> above.</div>`;
    return;
  }
  if (!viewCards.length) {
    grid.innerHTML = `<div class="empty-state">No ${escapeHtml(activeLabel.toLowerCase())} to show for today. Switch tabs, or run the screener.</div>`;
    return;
  }

  grid.innerHTML = viewCards.map((c) => c.type === 'cluster' ? renderClusterCard(c) : renderMoverCard(c.rows[0])).join('');
}

function renderMoverCard(m) {
  const dirClass = m.direction === 'up' ? 'up' : 'down';
  const flagClass = m.new_trend_flag ? 'flagged' : m.new_headwind_flag ? 'headwind' : '';
  const srcPill = m.catalyst_source ? `<span class="src-pill">${escapeHtml(m.catalyst_source)}</span>` : '';
  const catIsNone = (m.catalyst || '').endsWith('Catalyst: None.');
  const headline = extractHeadline(m.catalyst);
  const cls = catIsNone ? { label: null, kind: null } : classifyCatalyst(headline);
  /* When the catalyst came from the earnings-calendar synthesis (rather than
   * a news source), force the chip to say "Earnings today" regardless of the
   * keyword classifier's guess. */
  const effectiveCls = m.synthetic_catalyst ? { label: 'Earnings today', kind: 'earnings' } : cls;
  const chip = effectiveCls.label ? `<span class="cat-chip cat-${effectiveCls.kind}">${escapeHtml(effectiveCls.label)}</span>` : '';
  /* Defensive safety net: an older cached catalyst_url might be a relative
   * path like "/articles/...". Without an http(s) prefix the browser resolves
   * it against localhost:3000 — 404. Drop links that can't be made absolute. */
  const safeUrl = m.catalyst_url && /^https?:\/\//i.test(m.catalyst_url) ? m.catalyst_url : '';
  const catInner = catIsNone
    ? 'Catalyst: None.'
    : `${chip}<a class="cat-link" ${safeUrl ? `href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener"` : ''} title="${escapeHtml(headline)}">${escapeHtml(headline)}</a>`;
  const fallbacks = catIsNone ? `
    <div class="mover-fallbacks">
      <a href="https://seekingalpha.com/symbol/${encodeURIComponent(m.ticker)}" target="_blank" rel="noopener">Seeking Alpha</a>
      <a href="https://www.google.com/search?q=${encodeURIComponent(m.ticker + ' investor relations')}" target="_blank" rel="noopener">IR page</a>
      <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(m.ticker)}&type=&dateb=&owner=include&count=20" target="_blank" rel="noopener">SEC filings</a>
    </div>
  ` : '';
  const trendTag = m.trend_id ? `<div class="mover-trend-tag">${escapeHtml(m.trend_name || m.trend_id)}</div>` : '';
  return `
    <div class="mover-card ${flagClass}">
      <div class="mover-top">
        <div>
          <div class="mover-ticker">${escapeHtml(m.ticker)}</div>
          <div class="mover-name">${escapeHtml(m.name)}</div>
          <div class="mover-sector">${escapeHtml(m.sector || '—')}</div>
          ${trendTag}
        </div>
        <div class="mover-dir ${dirClass}">${fmtPct(m.move_pct)}</div>
      </div>
      <div class="mover-stats">
        <div class="mover-stat"><div class="mover-stat-val">${fmtMoney(m.market_cap)}</div><div class="mover-stat-lbl">mkt cap</div></div>
        <div class="mover-stat"><div class="mover-stat-val">${fmtNum(m.volume_multiple, 1)}x</div><div class="mover-stat-lbl">vol mult</div></div>
        <div class="mover-stat"><div class="mover-stat-val">${fmtMoney(m.traded_value)}</div><div class="mover-stat-lbl">traded $</div></div>
      </div>
      <div class="mover-catalyst one-line ${catIsNone ? 'none' : ''}">${catInner} ${srcPill}</div>
      ${fallbacks}
      <div class="mover-score">heuristic score ${fmtNum(m.cluster_score, 0)}${m.new_trend_flag ? ' · new-trend cluster' : ''}${m.new_headwind_flag ? ' · new-headwind cluster' : ''}</div>
    </div>
  `;
}

function renderClusterCard(card) {
  const { anchor, rows, sector, avgMove, direction } = card;
  const dirClass = direction === 'up' ? 'up' : 'down';
  const srcPill = anchor.catalyst_source ? `<span class="src-pill">${escapeHtml(anchor.catalyst_source)}</span>` : '';

  /* Inside a cluster we're narrating the shared story, not each ticker's
   * move, so strip prefix + pull the quoted headline. */
  const sharedCatalystIsNone = !anchor.catalyst || anchor.catalyst.endsWith('Catalyst: None.');
  const sharedHeadline = sharedCatalystIsNone ? 'Catalyst: None.' : extractHeadline(anchor.catalyst);
  const sharedCls = sharedCatalystIsNone ? { label: null, kind: null } : classifyCatalyst(sharedHeadline);
  const sharedChip = sharedCls.label ? `<span class="cat-chip cat-${sharedCls.kind}">${escapeHtml(sharedCls.label)}</span>` : '';
  const sharedInner = sharedCatalystIsNone
    ? 'Catalyst: None.'
    : `${sharedChip}<a class="cat-link" ${anchor.catalyst_url ? `href="${escapeHtml(anchor.catalyst_url)}" target="_blank" rel="noopener"` : ''} title="${escapeHtml(sharedHeadline)}">${escapeHtml(sharedHeadline)}</a>`;

  const rowsHtml = rows.map((r) => {
    const rode = r._rode_sector;
    const trendTag = r.trend_id ? `<span class="cluster-trend">${escapeHtml(r.trend_name || r.trend_id)}</span>` : '';
    const rodeTag = rode ? `<span class="rode-flag" title="No specific catalyst was found for this ticker; it's included because it moved alongside the sector.">⚠ no news found</span>` : '';
    const moveClass = r.direction === 'up' ? 'up' : 'down';
    return `
      <div class="cluster-row">
        <span class="cluster-ticker">${escapeHtml(r.ticker)}</span>
        <span class="cluster-move ${moveClass}">${fmtPct(r.move_pct)}</span>
        <span class="cluster-meta">${fmtMoney(r.market_cap)} · ${fmtNum(r.volume_multiple, 1)}x</span>
        ${trendTag}${rodeTag}
      </div>
    `;
  }).join('');

  return `
    <div class="mover-card cluster ${dirClass}">
      <div class="cluster-header">
        <div class="cluster-title">${escapeHtml(sector)}</div>
        <div class="cluster-sub">${rows.length} ${direction === 'up' ? 'up' : 'down'} · avg ${fmtPct(avgMove)} · shared catalyst</div>
      </div>
      <div class="cluster-rows">${rowsHtml}</div>
      <div class="mover-catalyst one-line ${sharedCatalystIsNone ? 'none' : ''}">${sharedInner} ${srcPill}</div>
    </div>
  `;
}

/* PDF export — redesigned cover + Gainers / Losers sections.
 *
 * Visual structure:
 *   1. Cover band      — large serif title, accent line, 4 stat tiles
 *   2. Gainers section — green band header + table with green-tinted Move cells
 *   3. Losers section  — red band header + table with red-tinted Move cells
 *   4. Footer          — page numbers + generated timestamp on every page
 *
 * Uses jspdf-autotable when available; falls back to plain typeset rows
 * otherwise (same data, no styling). */
async function exportMoversPDF() {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      showToast('jsPDF failed to load — check network', 'error');
      console.error('jsPDF not on window.jspdf', window.jspdf);
      return;
    }
    const { jsPDF } = window.jspdf;
    const rows = await db.select('movers', { run_date: todayISO() });
    if (!rows.length) { showToast('No movers to export'); return; }

    /* Same sort as the dashboard: gainers first (largest gain), then losers. */
    const sorted = rows.slice().sort((a, b) => {
      if (a.direction !== b.direction) return a.direction === 'up' ? -1 : 1;
      return Math.abs(b.move_pct || 0) - Math.abs(a.move_pct || 0);
    });
    const gainers = sorted.filter((m) => m.direction === 'up');
    const losers  = sorted.filter((m) => m.direction === 'down');
    const avgAbs  = sorted.length ? sorted.reduce((s, r) => s + Math.abs(r.move_pct || 0), 0) / sorted.length : 0;

    /* Dashboard palette (RGB triples for jsPDF's setters). */
    const COL = {
      textPrimary:   [26, 26, 24],
      textSecondary: [90, 90, 84],
      textMuted:     [154, 154, 146],
      bgSurface:     [240, 239, 233],
      bgCard:        [255, 255, 255],
      border:        [220, 220, 215],
      borderLight:   [240, 240, 235],
      accent:        [29, 158, 117],
      accentDark:    [15, 110, 86],
      accentLight:   [225, 245, 238],
      red:           [226, 75, 74],
      redDark:       [120, 30, 30],
      redLight:      [252, 235, 235]
    };

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const PAGE_W = 297, PAGE_H = 210;
    const MARGIN = 14;
    const CONTENT_W = PAGE_W - MARGIN * 2;

    /* jsPDF's built-in fonts only support WinAnsi/Latin-1. Headlines from
     * Yahoo/Reuters/etc. often contain typographic Unicode that renders as
     * garbage bytes (e.g. ▲ shows as "â—²"). Translate common Unicode
     * punctuation to ASCII and strip anything else above U+00FF. */
    const safePDF = (s) => {
      if (s === null || s === undefined) return '';
      return String(s)
        .replace(/[—–]/g, '-')      // em/en dash → hyphen
        .replace(/[“”]/g, '"')      // curly double quotes → straight
        .replace(/[‘’]/g, "'")      // curly single quotes → straight
        .replace(/…/g, '...')            // ellipsis → three dots
        .replace(/[▲△]/g, '^')      // triangle up → caret
        .replace(/[▼▽]/g, 'v')      // triangle down → letter v
        .replace(/[ ]/g, ' ')            // nbsp → space
        .replace(/[^\x00-\xFF]/g, '?');       // last-resort strip beyond Latin-1
    };

    /* ── 1. Cover band ─────────────────────────────────────────────── */
    doc.setFont('times', 'normal');
    doc.setFontSize(28);
    doc.setTextColor(...COL.textPrimary);
    doc.text('MegaTrend Movers', MARGIN, 22);

    doc.setFont('courier', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...COL.textSecondary);
    doc.text(todayISO(), PAGE_W - MARGIN, 22, { align: 'right' });

    doc.setDrawColor(...COL.accent);
    doc.setLineWidth(0.8);
    doc.line(MARGIN, 26, PAGE_W - MARGIN, 26);

    /* Four stat tiles below the title. */
    const tileY = 32;
    const tileH = 22;
    const tileGap = 4;
    const tileW = (CONTENT_W - tileGap * 3) / 4;
    const drawTile = (i, label, value, valueColor) => {
      const x = MARGIN + i * (tileW + tileGap);
      doc.setFillColor(...COL.bgSurface);
      doc.rect(x, tileY, tileW, tileH, 'F');
      doc.setFont('courier', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...COL.textMuted);
      doc.text(label.toUpperCase(), x + 4, tileY + 6);
      doc.setFont('times', 'normal');
      doc.setFontSize(20);
      doc.setTextColor(...(valueColor || COL.textPrimary));
      doc.text(value, x + 4, tileY + 17);
    };
    drawTile(0, 'Total movers', String(sorted.length));
    drawTile(1, 'Gainers',      String(gainers.length), COL.accent);
    drawTile(2, 'Losers',       String(losers.length),  COL.red);
    drawTile(3, 'Avg abs move', fmtNum(avgAbs, 1) + '%');

    let cursorY = tileY + tileH + 10;

    /* ── 2. Helpers for section header + table ─────────────────────── */
    const drawSectionHeader = (label, color, y) => {
      /* Coloured band with white serif title — gives each section a clear
       * anchor when scanning multi-page output. The band's colour already
       * conveys direction (green/red), so we no longer need triangle
       * characters in the label — those rendered as garbage in WinAnsi. */
      doc.setFillColor(...color);
      doc.rect(MARGIN, y, CONTENT_W, 8, 'F');
      doc.setFont('times', 'normal');
      doc.setFontSize(13);
      doc.setTextColor(255, 255, 255);
      doc.text(safePDF(label), MARGIN + 4, y + 6);
      return y + 11;
    };

    const formatCatalyst = (m) => {
      if (!m.catalyst || m.catalyst.endsWith('Catalyst: None.')) return '-';
      return safePDF(extractHeadline(m.catalyst));
    };

    const hasAutoTable = typeof doc.autoTable === 'function';
    if (!hasAutoTable) {
      console.warn('[exportMoversPDF] jspdf-autotable plugin not loaded — using plain-text fallback');
    }

    const renderTable = (set, direction) => {
      if (!set.length) return cursorY;
      const moveBg   = direction === 'up' ? COL.accentLight : COL.redLight;
      const moveText = direction === 'up' ? COL.accentDark  : COL.redDark;

      if (!hasAutoTable) {
        /* Plain fallback — typeset row by row. */
        let y = cursorY;
        doc.setFont('courier', 'normal');
        doc.setFontSize(8);
        for (const m of set) {
          if (y > PAGE_H - 18) { doc.addPage(); y = MARGIN; }
          doc.setTextColor(...COL.textPrimary);
          const line = safePDF(`${m.ticker.padEnd(8)} ${fmtPct(m.move_pct).padStart(8)}  ${fmtMoney(m.market_cap).padStart(8)}  ${(m.sector || '-').slice(0, 28)}`);
          doc.text(line, MARGIN, y); y += 5;
          const cat = formatCatalyst(m);
          if (cat && cat !== '—') {
            doc.setTextColor(...COL.textSecondary);
            const wrapped = doc.splitTextToSize(cat, CONTENT_W - 6);
            for (const ln of wrapped.slice(0, 2)) { doc.text(ln, MARGIN + 4, y); y += 4; }
          }
          if (m.catalyst_url) {
            doc.setTextColor(...COL.accentDark);
            doc.textWithLink(m.catalyst_source || 'Source', MARGIN + 4, y, { url: m.catalyst_url });
            y += 6;
          } else {
            y += 2;
          }
        }
        return y + 6;
      }

      const body = set.map((m) => [
        safePDF(m.ticker),
        fmtPct(m.move_pct),
        fmtMoney(m.market_cap),
        safePDF(m.sector || '-'),
        formatCatalyst(m),
        safePDF(m.catalyst_source || '-')
      ]);

      doc.autoTable({
        startY: cursorY,
        head: [['Ticker', 'Move', 'Mkt cap', 'Sector', 'Catalyst', 'Source']],
        body,
        margin: { left: MARGIN, right: MARGIN },
        theme: 'plain',
        styles: {
          font: 'helvetica',
          fontSize: 8,
          cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
          textColor: COL.textPrimary,
          lineColor: COL.borderLight,
          lineWidth: 0.1,
          overflow: 'linebreak'
        },
        headStyles: {
          fillColor: COL.textPrimary,
          textColor: 255,
          fontStyle: 'bold',
          fontSize: 8,
          cellPadding: { top: 3, right: 3, bottom: 3, left: 3 }
        },
        alternateRowStyles: { fillColor: [250, 249, 246] },
        columnStyles: {
          0: { cellWidth: 18, fontStyle: 'bold' },
          1: { cellWidth: 20, halign: 'right' },
          2: { cellWidth: 22, halign: 'right' },
          3: { cellWidth: 42 },
          4: { cellWidth: 'auto' },
          5: { cellWidth: 28, fontSize: 7, textColor: COL.textSecondary }
        },
        didDrawCell: (data) => {
          if (data.section !== 'body') return;
          /* Repaint the Move cell with a coloured tint + bold direction text. */
          if (data.column.index === 1) {
            doc.setFillColor(...moveBg);
            doc.rect(data.cell.x + 0.3, data.cell.y + 0.3, data.cell.width - 0.6, data.cell.height - 0.6, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(...moveText);
            doc.text(
              fmtPct(set[data.row.index].move_pct),
              data.cell.x + data.cell.width - 3,
              data.cell.y + data.cell.height / 2 + 1.3,
              { align: 'right' }
            );
          }
          /* Source cell: clickable, blue, dotted-underline-by-convention. */
          if (data.column.index === 5) {
            const m = set[data.row.index];
            if (m && m.catalyst_url) {
              doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: m.catalyst_url });
            }
          }
        }
      });
      return doc.lastAutoTable.finalY + 8;
    };

    /* ── 3. Gainers section ────────────────────────────────────────── */
    if (gainers.length) {
      cursorY = drawSectionHeader(`Gainers  ·  ${gainers.length}`, COL.accent, cursorY);
      cursorY = renderTable(gainers, 'up');
    }

    /* ── 4. Losers section ─────────────────────────────────────────── */
    if (losers.length) {
      /* Force a page break if we're too close to the bottom — section
       * header looks orphaned otherwise. */
      if (cursorY > PAGE_H - 50) { doc.addPage(); cursorY = MARGIN; }
      cursorY = drawSectionHeader(`Losers  ·  ${losers.length}`, COL.red, cursorY);
      cursorY = renderTable(losers, 'down');
    }

    /* ── 5. Footer on every page ───────────────────────────────────── */
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFont('courier', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...COL.textMuted);
      doc.setDrawColor(...COL.border);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, PAGE_H - 9, PAGE_W - MARGIN, PAGE_H - 9);
      doc.text(`Generated ${nowISO().slice(0, 16).replace('T', ' ')} UTC`, MARGIN, PAGE_H - 5);
      doc.text(`Page ${i} of ${totalPages}`, PAGE_W / 2, PAGE_H - 5, { align: 'center' });
      doc.text('MegaTrend Intelligence', PAGE_W - MARGIN, PAGE_H - 5, { align: 'right' });
    }

    doc.save(`megatrend-movers-${todayISO()}.pdf`);
    showToast('Movers PDF saved');
  } catch (e) {
    console.error('[exportMoversPDF] failed:', e);
    showToast('Export failed: ' + (e.message || e), 'error');
  }
}

/* ══════════ Macro tab ══════════ */

const FRED_SERIES = {
  fed_funds: { id: 'FEDFUNDS', label: 'Fed funds', units: '%' },
  cpi:       { id: 'CPIAUCSL', label: 'CPI (headline)', units: 'idx' },
  gdp:       { id: 'GDPC1',    label: 'Real GDP', units: 'B$' }
};
const YIELD_TICKERS = [
  { id: '^IRX', label: '3M', tenor: 0.25 },
  { id: '^FVX', label: '5Y',  tenor: 5 },
  { id: '^TNX', label: '10Y', tenor: 10 },
  { id: '^TYX', label: '30Y', tenor: 30 }
];

async function renderMacro() {
  const macro = await db.getMacro();
  const age = macro.updated_at ? (Date.now() - Date.parse(macro.updated_at)) : Infinity;
  const stale = age > 6 * 3600 * 1000;
  if (stale || !macro.fred?.fed_funds) {
    await fetchMacroLive().catch((e) => {
      console.error('macro fetch failed', e);
      showToast('Macro fetch failed: ' + e.message, 'error');
    });
  }
  await renderMacroCards();
}

async function fetchMacroLive() {
  const fred = {};
  for (const [k, s] of Object.entries(FRED_SERIES)) {
    try {
      const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${s.id}&file_type=json&sort_order=desc&limit=2`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const obs = (d.observations || []).filter((o) => o.value && o.value !== '.');
      fred[k] = {
        value: Number(obs[0].value),
        prior: obs[1] ? Number(obs[1].value) : null,
        as_of: obs[0].date,
        label: s.label,
        units: s.units
      };
    } catch (e) {
      console.warn(`FRED ${s.id} failed:`, e.message);
      fred[k] = { value: null, error: e.message, label: s.label, units: s.units };
    }
  }

  const yields = {};
  for (const t of YIELD_TICKERS) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t.id)}?interval=1d&range=5d`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const price = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
      yields[t.id] = { value: Number(price), tenor: t.tenor, label: t.label };
    } catch (e) {
      console.warn(`Yahoo ${t.id} failed:`, e.message);
      yields[t.id] = { value: null, error: e.message, tenor: t.tenor, label: t.label };
    }
  }
  await db.saveMacro({ fred, yields });
}

async function renderMacroCards() {
  const macro = await db.getMacro();
  const fred = macro.fred || {};
  const yields = macro.yields || {};

  const fredEl = document.getElementById('macro-fred');
  fredEl.innerHTML = Object.entries(FRED_SERIES).map(([k, s]) => {
    const f = fred[k] || {};
    const v = isFinite(f.value) ? fmtNum(f.value, k === 'cpi' ? 2 : k === 'gdp' ? 1 : 2) : '—';
    const prior = isFinite(f.prior) ? fmtNum(f.prior, 2) : '—';
    const err = f.error ? `<div class="macro-card-delta delta-red">error: ${escapeHtml(f.error)}</div>` : '';
    return `
      <div class="macro-card">
        <div class="macro-card-label">${escapeHtml(s.label)} (${s.units})</div>
        <div class="macro-card-val">${v}</div>
        <div class="macro-card-delta">prior ${prior} · as of ${escapeHtml(f.as_of || '—')}</div>
        ${err}
      </div>
    `;
  }).join('');

  const svg = document.getElementById('macro-yield-svg');
  const meta = document.getElementById('macro-yield-meta');
  const points = YIELD_TICKERS.map((t) => ({ ...t, value: yields[t.id]?.value })).filter((p) => isFinite(p.value));
  if (points.length < 2) {
    svg.innerHTML = `<text x="300" y="80" text-anchor="middle" fill="#9a9a92" font-family="DM Mono" font-size="11">yield data unavailable</text>`;
    meta.textContent = '';
  } else {
    const xs = points.map((p) => p.tenor);
    const ys = points.map((p) => p.value);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys) - 0.3, yMax = Math.max(...ys) + 0.3;
    const xOf = (x) => 30 + ((x - xMin) / (xMax - xMin || 1)) * 540;
    const yOf = (y) => 140 - ((y - yMin) / (yMax - yMin || 1)) * 120;
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.tenor)},${yOf(p.value)}`).join(' ');
    svg.innerHTML = `
      <path d="${path}" stroke="#1D9E75" stroke-width="2" fill="none" />
      ${points.map((p) => `
        <circle cx="${xOf(p.tenor)}" cy="${yOf(p.value)}" r="4" fill="#1D9E75" />
        <text x="${xOf(p.tenor)}" y="${yOf(p.value) - 10}" text-anchor="middle" fill="#5a5a54" font-family="DM Mono" font-size="10">${fmtNum(p.value, 2)}%</text>
        <text x="${xOf(p.tenor)}" y="155" text-anchor="middle" fill="#9a9a92" font-family="DM Mono" font-size="9">${p.label}</text>
      `).join('')}
    `;
    meta.textContent = `updated ${fmtRelTime(macro.updated_at)}`;
  }

  const fomcEl = document.getElementById('macro-fomc');
  if (!macro.fomc || !macro.fomc.length) {
    fomcEl.innerHTML = `<div class="empty-state">No FOMC data yet — paste a macro JSON above.</div>`;
  } else {
    fomcEl.innerHTML = macro.fomc.map((row) => {
      const cut = Math.round((row.cut || 0) * 100);
      const hold = Math.round((row.hold || 0) * 100);
      const hike = Math.round((row.hike || 0) * 100);
      return `
        <div class="fomc-row">
          <div class="fomc-date">${escapeHtml(row.meeting_date)}</div>
          <div class="fomc-bars">
            <div class="fomc-bar fomc-cut"  style="width:${cut}%">${cut ? `cut ${cut}%` : ''}</div>
            <div class="fomc-bar fomc-hold" style="width:${hold}%">${hold ? `hold ${hold}%` : ''}</div>
            <div class="fomc-bar fomc-hike" style="width:${hike}%">${hike ? `hike ${hike}%` : ''}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  const calEl = document.getElementById('macro-calendar');
  if (!macro.calendar || !macro.calendar.length) {
    calEl.innerHTML = `<div class="empty-state">No calendar items yet.</div>`;
  } else {
    const sorted = macro.calendar.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    calEl.innerHTML = sorted.map((c) => `
      <div class="cal-row">
        <div class="cal-date">${escapeHtml(c.date)}</div>
        <div class="cal-title">${escapeHtml(c.title)}${c.note ? ` <span style="color:var(--text-muted)">· ${escapeHtml(c.note)}</span>` : ''}</div>
        <div class="cal-impact ${c.impact}">${escapeHtml(c.impact)}</div>
      </div>
    `).join('');
  }
}

async function importMacroJSON() {
  const ta = document.getElementById('macro-import-area');
  const err = document.getElementById('macro-import-error');
  err.classList.remove('show');
  let parsed;
  try { parsed = JSON.parse(ta.value); }
  catch (e) { err.textContent = 'Invalid JSON: ' + e.message; err.classList.add('show'); return; }
  const result = await validateAgainst('./schemas/macro.schema.json', parsed);
  if (!result.ok) { err.textContent = 'Schema errors:\n' + result.errors.slice(0, 10).join('\n'); err.classList.add('show'); return; }
  await db.saveMacro({ fomc: parsed.fomc, calendar: parsed.calendar });
  ta.value = '';
  showToast(`Imported FOMC (${parsed.fomc.length}) + calendar (${parsed.calendar.length})`);
  renderMacroCards();
}

/* ══════════ Footer / boot ══════════ */

async function wireEvents() {
  /* Screener */
  document.getElementById('screener-add-btn').addEventListener('click', () => openCustomPanel(null));
  document.getElementById('screener-scan-btn').addEventListener('click', openCandidateScan);
  document.getElementById('screener-import-btn').addEventListener('click', importTrendsJSON);
  document.getElementById('screener-copy-registry-btn').addEventListener('click', copyRegistryToClipboard);
  document.getElementById('screener-export-btn').addEventListener('click', exportScreenerPDF);

  /* News */
  document.getElementById('news-import-btn').addEventListener('click', importNewsJSON);
  document.getElementById('news-export-btn').addEventListener('click', exportNewsPDF);
  document.getElementById('news-filters').addEventListener('click', (e) => {
    const f = e.target.closest('.filter');
    if (!f) return;
    newsFilter = f.dataset.type;
    document.querySelectorAll('#news-filters .filter').forEach((b) => b.classList.toggle('active', b === f));
    renderNews();
  });

  /* Movers */
  document.getElementById('movers-run-btn').addEventListener('click', () => runMovers(false));
  document.getElementById('movers-force-btn').addEventListener('click', () => {
    if (!confirm('Force refresh will re-scrape and overwrite today\'s cached movers. Continue?')) return;
    runMovers(true);
  });
  document.getElementById('movers-export-btn').addEventListener('click', exportMoversPDF);
  document.getElementById('movers-view-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.view-tab');
    if (!b) return;
    moversView = b.dataset.view === 'losers' ? 'losers' : 'gainers';
    document.querySelectorAll('#movers-view-tabs .view-tab').forEach((x) => x.classList.toggle('active', x === b));
    renderMovers();
  });
  document.getElementById('movers-check-btn').addEventListener('click', diagnoseTicker);
  document.getElementById('movers-diagnose-btn').addEventListener('click', diagnoseCatalysts);
  document.getElementById('movers-settings-btn').addEventListener('click', () => {
    const p = document.getElementById('movers-settings-panel');
    p.style.display = p.style.display === 'none' ? 'block' : 'none';
    document.getElementById('movers-finnhub-input').value = FINNHUB_KEY();
  });
  document.getElementById('movers-finnhub-save').addEventListener('click', () => {
    const v = document.getElementById('movers-finnhub-input').value.trim();
    if (v) localStorage.setItem('mt.finnhub_key', v);
    showToast(v ? 'Finnhub key saved' : 'Enter a key first');
  });
  document.getElementById('movers-finnhub-clear').addEventListener('click', () => {
    localStorage.removeItem('mt.finnhub_key');
    document.getElementById('movers-finnhub-input').value = '';
    showToast('Finnhub key cleared');
  });

  /* Macro */
  document.getElementById('macro-import-btn').addEventListener('click', importMacroJSON);
  document.getElementById('macro-refresh-btn').addEventListener('click', async () => {
    showToast('Refreshing FRED + yields...');
    try { await fetchMacroLive(); await renderMacroCards(); showToast('Macro refreshed'); }
    catch (e) { showToast('Macro refresh failed: ' + e.message, 'error'); }
  });

  /* Footer */
  document.getElementById('footer-prune').addEventListener('click', async () => {
    const r = await db.prune();
    showToast(`Pruned · movers: ${r.movers} · news: ${r.news_items}`, 'muted');
    renderNews();
    renderMovers();
  });
  document.getElementById('footer-counts').addEventListener('click', async () => {
    const c = await db.counts();
    alert('Storage counts:\n' + Object.entries(c).map(([k, v]) => `${k}: ${v}`).join('\n'));
  });
}

async function boot() {
  await wireEvents();
  await renderScreener();
  await renderNews();
  await renderMovers();
  await refreshMoversCacheLabel();
  console.info('MegaTrend dashboard ready · backend:', db._backend);
}

document.addEventListener('DOMContentLoaded', boot);

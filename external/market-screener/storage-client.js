/* storage-client.js
 *
 * The only file that talks to storage. During the build phase it wraps
 * localStorage in a Supabase-shaped API; when we flip to Supabase later,
 * only this file changes — every tab keeps calling db.*.
 *
 * Tables (keyed on table name, prefixed mt.*):
 *   trends, news_items, movers, movers_runs,
 *   macro_data, candidate_scans, dismissed_candidates
 *
 * Each table is an array of rows except `macro_data`, which is a single
 * object keyed under id = 'current'. Primary keys come from `id`.
 */

(function () {
  const BACKEND = 'local';       // flip to 'supabase' later; plumbing is in place.
  const PREFIX = 'mt.';
  const TABLES = [
    'trends', 'news_items', 'movers', 'movers_runs',
    'macro_data', 'candidate_scans', 'dismissed_candidates'
  ];

  const keyFor = (t) => PREFIX + t;

  function loadRaw(table) {
    try {
      const raw = localStorage.getItem(keyFor(table));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error(`storage-client: failed to load table "${table}"`, e);
      return [];
    }
  }

  function saveRaw(table, rows) {
    try {
      localStorage.setItem(keyFor(table), JSON.stringify(rows));
    } catch (e) {
      console.error(`storage-client: failed to save table "${table}"`, e);
      throw e;           // fail loud — the caller needs to know
    }
  }

  function matches(row, filter) {
    if (!filter) return true;
    return Object.keys(filter).every((k) => row[k] === filter[k]);
  }

  const db = {
    /* Read. Optional filter is a plain object; all keys must match. */
    async select(table, filter) {
      if (!TABLES.includes(table)) throw new Error(`unknown table: ${table}`);
      const rows = loadRaw(table);
      return filter ? rows.filter((r) => matches(r, filter)) : rows;
    },

    /* Insert (no dedupe; caller is responsible for not double-inserting). */
    async insert(table, rowOrRows) {
      if (!TABLES.includes(table)) throw new Error(`unknown table: ${table}`);
      const rows = loadRaw(table);
      const incoming = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
      saveRaw(table, rows.concat(incoming));
      return incoming;
    },

    /* Upsert by id. If a row already exists with the same id, merge and
     * replace; otherwise append. Replaces the whole row — this mirrors
     * Supabase's default upsert behaviour. */
    async upsert(table, rowOrRows) {
      if (!TABLES.includes(table)) throw new Error(`unknown table: ${table}`);
      const rows = loadRaw(table);
      const incoming = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const r of incoming) {
        if (!r || typeof r.id === 'undefined') {
          throw new Error(`upsert: row missing id for table ${table}`);
        }
        byId.set(r.id, { ...byId.get(r.id), ...r });
      }
      saveRaw(table, Array.from(byId.values()));
      return incoming;
    },

    /* Delete by id. Returns true iff a row was removed. */
    async delete(table, id) {
      if (!TABLES.includes(table)) throw new Error(`unknown table: ${table}`);
      const rows = loadRaw(table);
      const next = rows.filter((r) => r.id !== id);
      const removed = next.length !== rows.length;
      saveRaw(table, next);
      return removed;
    },

    /* Get the singleton macro_data row. */
    async getMacro() {
      const rows = loadRaw('macro_data');
      return rows.find((r) => r.id === 'current') || {
        id: 'current', fred: {}, yields: {}, fomc: [], calendar: [], updated_at: null
      };
    },

    async saveMacro(next) {
      const current = await db.getMacro();
      const merged = { ...current, ...next, id: 'current', updated_at: new Date().toISOString() };
      saveRaw('macro_data', [merged]);
      return merged;
    },

    /* Prune movers and news_items older than `days` (default 30).
     * Returns { movers: n, news_items: n } deletion counts. */
    async prune(days) {
      const cutoff = Date.now() - (days || 30) * 24 * 3600 * 1000;
      const out = { movers: 0, news_items: 0 };

      const movers = loadRaw('movers');
      const keptMovers = movers.filter((m) => {
        const t = m.run_date ? Date.parse(m.run_date + 'T00:00:00Z') : Date.parse(m.created_at || '');
        return isFinite(t) ? t >= cutoff : true;
      });
      out.movers = movers.length - keptMovers.length;
      if (out.movers) saveRaw('movers', keptMovers);

      const news = loadRaw('news_items');
      const keptNews = news.filter((n) => {
        const t = Date.parse(n.imported_at || n.published_at || '');
        return isFinite(t) ? t >= cutoff : true;
      });
      out.news_items = news.length - keptNews.length;
      if (out.news_items) saveRaw('news_items', keptNews);

      if (out.movers || out.news_items) {
        console.info(`storage-client: prune removed movers=${out.movers}, news=${out.news_items}`);
      }
      return out;
    },

    /* For debugging / diagnostic panels. */
    async counts() {
      const out = {};
      for (const t of TABLES) out[t] = loadRaw(t).length;
      return out;
    },

    _backend: BACKEND
  };

  /* Loud banner if running from file:// — external fetches will fail. */
  if (location.protocol === 'file:') {
    console.warn(
      'storage-client: serving from file:// — external fetches (TradingView, FRED, Yahoo) will be blocked by CORS. ' +
      'Run `npm start` and open http://localhost:3000 instead.'
    );
  }

  window.db = db;
})();

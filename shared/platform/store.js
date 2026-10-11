/* Store: module records on the server. CONTRACT sections 2 and 5.
     const schedules = Store.collection('scheduler', 'schedules');
     await schedules.save(id, { schemaVersion: 1, ... }, { projectId, baseRev });   // baseRev omitted when creating
   Saves are compare-and-set on rev: a stale save throws ConflictError with `.current`, and nothing is overwritten.
   `watch` polls every 20 seconds (15-30 s is acceptable, CONTRACT section 8) instead of using a live feed. */
import { request } from './http.js';

export { ApiError, ConflictError } from './http.js';

const seg = encodeURIComponent;
export const POLL_MS = 20000;

export const Store = {
  collection(module, collection) {
    const base = `/api/${seg(module)}/${seg(collection)}`;
    return {
      /* all live records you may see, or only those changed since a cursor (deletions then show up with deleted: true) */
      list({ projectId, since } = {}) {
        const q = [];
        if (projectId) q.push(`projectId=${seg(projectId)}`);
        if (since !== undefined && since !== null) q.push(`since=${seg(since)}`);
        return request('GET', base + (q.length ? '?' + q.join('&') : ''));
      },
      get(id) { return request('GET', `${base}/${seg(id)}`); },
      save(id, data, { projectId, baseRev } = {}) {
        return request('PUT', `${base}/${seg(id)}`, { body: { data, projectId }, ifMatch: baseRev });
      },
      remove(id, baseRev) { return request('DELETE', `${base}/${seg(id)}`, { ifMatch: baseRev }); },

      /* keeps `cb(records, changes)` up to date: `records` is every live record, `changes` only what just arrived.
         Returns a function that stops watching. Polls again at once when the tab becomes visible. */
      watch(cb, { projectId, intervalMs = POLL_MS, onError } = {}) {
        const known = new Map();
        let cursor = null, timer = null, stopped = false, busy = false;
        const tick = async () => {
          if (stopped || busy) return;
          busy = true;
          try {
            const res = await this.list({ projectId, since: cursor });
            const first = cursor === null;
            const changes = res.records;
            for (const r of res.records) { if (r.deleted) known.delete(r.id); else known.set(r.id, r); }
            cursor = res.serverTime;
            if (first || changes.length) cb([...known.values()], changes);
          } catch (e) { if (onError) onError(e); }
          busy = false;
          if (!stopped) timer = setTimeout(tick, intervalMs);
        };
        const onVisible = () => { if (typeof document !== 'undefined' && !document.hidden) { clearTimeout(timer); tick(); } };
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
        tick();
        return () => {
          stopped = true; clearTimeout(timer);
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
        };
      },
    };
  },
};

/* Backup (CONTRACT section 6): firm admins only. Import adds what is missing and reports what already existed. */
export const Backup = {
  export({ module } = {}) { return request('GET', '/api/backup' + (module ? `?module=${seg(module)}` : '')); },
  import(backup) { return request('POST', '/api/backup', { body: backup }); },
  /* Vantagepoint copy from CSV text. Order: employees, projects, then team. */
  importVp(kind, csvText) { return request('POST', `/api/admin/import-vp?kind=${seg(kind)}`, { body: csvText, raw: true }); },
};

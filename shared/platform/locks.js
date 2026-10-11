/* Locks: short-lived "who is editing" markers (the Scheduler's presence). Informational: the real protection is compare-and-set in Store.
   A lock lasts about 45 seconds and is refreshed while the editor is open. */
import { request, ApiError } from './http.js';

const seg = encodeURIComponent;
const path = (m, c, id) => `/api/locks/${seg(m)}/${seg(c)}` + (id ? `/${seg(id)}` : '');
export const REFRESH_MS = 15000;

export const Locks = {
  /* who is editing in this collection: [{ recordId, personId, name, expiresAt }] */
  list(module, collection) { return request('GET', path(module, collection)); },

  /* resolves { held: true }, or { held: false, heldBy: { id, name } } when someone else has it */
  async acquire(module, collection, id) {
    try { return await request('PUT', path(module, collection, id)); }
    catch (e) { if (e instanceof ApiError && e.status === 409 && e.body.heldBy) return { held: false, heldBy: e.body.heldBy }; throw e; }
  },
  release(module, collection, id) { return request('DELETE', path(module, collection, id)); },

  /* acquire and keep refreshing until release() is called on the returned handle */
  async hold(module, collection, id, { onLost } = {}) {
    const first = await Locks.acquire(module, collection, id);
    if (!first.held) return { held: false, heldBy: first.heldBy, release() {} };
    const timer = setInterval(async () => {
      try { const r = await Locks.acquire(module, collection, id); if (!r.held && onLost) onLost(r.heldBy); } catch (e) { /* the next refresh tries again */ }
    }, REFRESH_MS);
    return { held: true, release() { clearInterval(timer); return Locks.release(module, collection, id).catch(() => {}); } };
  },
};

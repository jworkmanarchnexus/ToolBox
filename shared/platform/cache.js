/* Cache: a local copy of a module's data on this device, so it works offline and opens instantly (Minutes uses it).
   It is a convenience, never the source of truth: the server holds the real data.
   IndexedDB first, then browser storage, then memory. Each person gets their own copy, so a shared computer never shows one
   person another person's data. Values are text; the caller turns objects into JSON. */
import { currentUserId, pref } from './http.js';

const TIMEOUT = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms))]);
const mem = new Map();

export const Cache = {
  /* const c = await Cache.open('minutes'); await c.set('state', text); const text = await c.get('state'); c.mode -> 'idb' | 'ls' | 'mem' */
  async open(name) {
    const who = currentUserId() || 'anonymous';
    const prefix = `${name}:${who}:`;
    const api = { mode: 'mem', async get() { return null; }, async set() {}, async remove() {} };
    let idb = null;
    try {
      if (typeof indexedDB === 'undefined') throw new Error('no idb');
      idb = await TIMEOUT(new Promise((res, rej) => {
        const r = indexedDB.open('toolbox-cache', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
      }), 3000);
      api.mode = 'idb';
    } catch (e) {
      // browser storage through the same per-device store the preferences use; if that is blocked too, keep it in memory
      try { pref('cache.test', '1'); api.mode = pref('cache.test') === '1' ? 'ls' : 'mem'; pref('cache.test', ''); } catch (e2) { api.mode = 'mem'; }
    }
    const idbReq = (mode, fn) => new Promise((res, rej) => {
      const tx = idb.transaction('kv', mode); const out = fn(tx.objectStore('kv'));
      tx.oncomplete = () => res(out && out.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
    api.get = async (key) => {
      try {
        if (api.mode === 'idb') { const v = await TIMEOUT(idbReq('readonly', (s) => s.get(prefix + key)), 4000); return v === undefined ? null : v; }
        if (api.mode === 'ls') { const v = pref('cache.' + prefix + key); return v ? v : null; }
      } catch (e) { /* fall through to memory */ }
      return mem.has(prefix + key) ? mem.get(prefix + key) : null;
    };
    api.set = async (key, text) => {
      mem.set(prefix + key, text);
      if (api.mode === 'idb') return TIMEOUT(idbReq('readwrite', (s) => s.put(text, prefix + key)), 6000);
      if (api.mode === 'ls') { pref('cache.' + prefix + key, text); if (pref('cache.' + prefix + key) !== text) throw new Error('storage is full or blocked'); }
    };
    api.remove = async (key) => {
      mem.delete(prefix + key);
      if (api.mode === 'idb') return TIMEOUT(idbReq('readwrite', (s) => s.delete(prefix + key)), 6000);
      if (api.mode === 'ls') pref('cache.' + prefix + key, '');
    };
    return api;
  },
};

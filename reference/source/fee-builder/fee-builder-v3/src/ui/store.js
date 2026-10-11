/*
 * Fee Builder UI store: in-memory state, undo/redo, persistence, draft recovery,
 * and conflict detection.
 *
 * Storage:
 *  - Inside Claude: proposals in the artifact's shared `db` collection "proposals";
 *    settings in the viewer's private subtree (data/users/<id>/settings).
 *  - Anywhere else (the standalone page): browser localStorage.
 * Every edit also writes a local draft so a crash or closed tab never loses work.
 * Concurrent edits are detected with a revision counter (not transactional; see docs).
 */
(function (root) {
  'use strict';
  const FB = root.FB || (root.FB = {});
  const { model } = FB;
  const LS = {
    proposals: 'fb3.proposals', settings: 'fb3.settings', draft: id => 'fb3.draft.' + id, ui: 'fb3.ui'
  };
  const MAX_DOC = 240 * 1024;

  function lsGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } }

  function createStore(hooks) {
    const S = {
      settings: model.normalizeSettings(lsGet(LS.settings)),
      proposals: new Map(),
      example: null,
      currentId: null,
      scIds: {},
      view: 'develop',
      analyzeTab: 'phases',
      pkgFilter: 'all',
      devPkg: null,
      mode: 'boot',          // 'db' | 'local' | 'boot'
      save: 'idle',          // idle | saving | saved | local | error | conflict | sandbox | readonly
      saveError: '',
      dirty: new Set(),
      rev: {},               // last revision we wrote or loaded, per proposal
      conflict: null,        // { id, remote }
      draftOffer: null,      // { id, draft }
      loadIssues: {},        // id -> [messages]
      undo: {}, redo: {},
      lastUndoKey: null, lastUndoAt: 0,
      readOnly: false,
      ui: Object.assign({ newFee: false, settingsOpen: false }, lsGet(LS.ui) || {})
    };
    let db = null, userId = null, saveTimer = null, saving = false, unsub = null;

    /* ---------- accessors ---------- */
    const current = () => (S.currentId === 'example' ? S.example : S.proposals.get(S.currentId)) || null;
    function scenario(p) {
      p = p || current();
      if (!p) return null;
      const id = S.scIds[p.id];
      return p.scenarios.find(s => s.id === id) || p.scenarios.find(s => s.id === p.preferredId) || p.scenarios[0];
    }
    function list() {
      return [...S.proposals.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }

    /* ---------- edits ---------- */
    /**
     * Run a mutation on the current proposal. `key` groups rapid edits to the same field
     * into one undo step. Returns whatever fn returns.
     */
    function mutate(fn, key) {
      const p = current();
      if (!p) return;
      if (S.readOnly && !p.example) { hooks.toast('This view is read-only.'); return; }
      const now = Date.now();
      if (!(key && key === S.lastUndoKey && now - S.lastUndoAt < 1200)) {
        const u = S.undo[p.id] || (S.undo[p.id] = []);
        u.push(JSON.stringify(p));
        if (u.length > 150) u.shift();
        S.redo[p.id] = [];
      }
      S.lastUndoKey = key || null;
      S.lastUndoAt = now;
      const out = fn(p);
      touch(p);
      return out;
    }
    function touch(p) {
      if (p.example) { S.save = 'sandbox'; return; }
      p.updatedAt = Date.now();
      S.dirty.add(p.id);
      lsSet(LS.draft(p.id), { at: p.updatedAt, baseRev: S.rev[p.id] || 0, proposal: p });
      S.save = 'saving';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 700);
    }
    function canUndo() { const p = current(); return !!(p && S.undo[p.id] && S.undo[p.id].length); }
    function canRedo() { const p = current(); return !!(p && S.redo[p.id] && S.redo[p.id].length); }
    function undo() { return swap(S.undo, S.redo); }
    function redo() { return swap(S.redo, S.undo); }
    function swap(from, to) {
      const p = current();
      if (!p || !from[p.id] || !from[p.id].length) return false;
      (to[p.id] || (to[p.id] = [])).push(JSON.stringify(p));
      const restored = JSON.parse(from[p.id].pop());
      replace(restored);
      S.lastUndoKey = null;
      touch(restored);
      return true;
    }
    function replace(p) {
      if (p.example || S.currentId === 'example' && p.id === S.example.id) S.example = p;
      else S.proposals.set(p.id, p);
    }

    /* ---------- proposals ---------- */
    function create(opts) {
      const p = model.newProposal(Object.assign({ settings: S.settings }, opts));
      S.proposals.set(p.id, p);
      S.currentId = p.id;
      S.scIds[p.id] = p.scenarios[0].id;
      touch(p);
      return p;
    }
    function openExample() {
      S.example = FB.sample.example(S.settings);
      S.example.id = 'example';
      S.currentId = 'example';
      S.scIds.example = S.example.preferredId;
      S.save = 'sandbox';
    }
    function saveExampleCopy() {
      if (!S.example) return null;
      const copy = model.clone(S.example);
      copy.id = model.uid('p');
      delete copy.example;
      copy.name = copy.name.replace(/^Example:\s*/, '') + ' (copy)';
      copy.createdAt = Date.now();
      S.proposals.set(copy.id, copy);
      S.currentId = copy.id;
      S.scIds[copy.id] = copy.preferredId;
      touch(copy);
      return copy;
    }
    function open(id) {
      if (id === 'example') { if (!S.example) openExample(); else S.currentId = 'example'; return; }
      if (!S.proposals.has(id)) return;
      S.currentId = id;
      checkDraft(id);
      S.save = S.mode === 'local' ? 'local' : (S.dirty.size ? 'saving' : 'saved');
      remember();
    }
    function remove(id) {
      S.proposals.delete(id);
      S.dirty.delete(id);
      lsDel(LS.draft(id));
      if (db) db.doc('proposals/' + id).delete().catch(() => { S.save = 'error'; S.saveError = 'Delete did not reach the server.'; hooks.render(); });
      else saveLocalAll();
      const next = list()[0];
      S.currentId = next ? next.id : null;
    }
    function importJson(obj) {
      const n = model.normalize(obj);
      const p = n.proposal;
      if (S.proposals.has(p.id)) { p.id = model.uid('p'); }
      delete p.example;
      p.rev = 0;
      S.proposals.set(p.id, p);
      S.currentId = p.id;
      S.loadIssues[p.id] = n.issues;
      touch(p);
      return n;
    }

    /* ---------- saving ---------- */
    async function flush() {
      if (saving) { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 400); return; }
      if (S.mode === 'boot') return;
      saving = true;
      try {
        if (S.mode === 'local') {
          saveLocalAll();
          S.dirty.forEach(id => lsDel(LS.draft(id)));
          S.dirty.clear();
          S.save = 'local';
        } else {
          for (const id of [...S.dirty]) {
            const p = S.proposals.get(id);
            if (!p) { S.dirty.delete(id); continue; }
            if (S.conflict && S.conflict.id === id) continue;
            const doc = JSON.parse(JSON.stringify(p));
            doc.rev = (S.rev[id] || 0) + 1;
            const size = JSON.stringify(doc).length;
            if (size > MAX_DOC) throw new Error('This proposal is too large to save (' + Math.round(size / 1024) + ' KB). Delete old snapshots or scenarios.');
            try { await db.doc('proposals/' + id).set(doc); }
            catch (e) {
              if (e && e.code === 'unavailable') { await new Promise(r => setTimeout(r, 500 + Math.random() * 700)); await db.doc('proposals/' + id).set(doc); }
              else throw e;
            }
            S.rev[id] = doc.rev;
            p.rev = doc.rev;
            S.dirty.delete(id);
            lsDel(LS.draft(id));
          }
          S.save = S.conflict ? 'conflict' : (S.dirty.size ? 'saving' : 'saved');
          S.saveError = '';
        }
      } catch (e) {
        S.save = 'error';
        S.saveError = (e && e.code === 'invalid_argument') ? 'Saving was refused. You may have view-only access.' : (e && e.message) || 'Save failed.';
        if (e && e.code === 'invalid_argument') S.readOnly = true;
      } finally {
        saving = false;
        hooks.paintSave();
      }
    }
    function saveLocalAll() {
      const all = {};
      S.proposals.forEach((p, id) => { all[id] = p; });
      if (!lsSet(LS.proposals, all)) { S.save = 'error'; S.saveError = 'Browser storage is unavailable or full. Export a JSON backup.'; }
    }
    function retry() {
      const p = current();
      if (p && !p.example) S.dirty.add(p.id);
      S.readOnly = false;
      flush();
    }

    /* ---------- conflicts & drafts ---------- */
    function resolveConflict(keepMine) {
      const c = S.conflict;
      if (!c) return;
      if (keepMine) {
        S.rev[c.id] = c.remote.rev || S.rev[c.id];
        S.conflict = null;
        S.dirty.add(c.id);
        flush();
      } else {
        const n = model.normalize(c.remote);
        S.proposals.set(c.id, n.proposal);
        S.rev[c.id] = c.remote.rev || 0;
        S.dirty.delete(c.id);
        lsDel(LS.draft(c.id));
        S.conflict = null;
        S.save = 'saved';
      }
    }
    function checkDraft(id) {
      const d = lsGet(LS.draft(id));
      const p = S.proposals.get(id);
      if (!d || !p || !d.proposal) return;
      if ((d.at || 0) > (p.updatedAt || 0) && JSON.stringify(d.proposal) !== JSON.stringify(p)) S.draftOffer = { id, draft: d };
      else lsDel(LS.draft(id));
    }
    function resolveDraft(restore) {
      const o = S.draftOffer;
      if (!o) return;
      if (restore) {
        try {
          const n = model.normalize(o.draft.proposal);
          S.proposals.set(o.id, n.proposal);
          touch(n.proposal);
        } catch (e) { hooks.toast('That draft could not be read.'); }
      } else lsDel(LS.draft(o.id));
      S.draftOffer = null;
    }

    /* ---------- settings ---------- */
    function saveSettings() {
      lsSet(LS.settings, S.settings);
      if (db && userId) db.doc('data/users/' + userId + '/settings').set(JSON.parse(JSON.stringify(S.settings))).catch(() => { /* keep local copy */ });
    }
    function remember() {
      lsSet(LS.ui, { lastId: S.currentId, view: S.view });
    }

    /* ---------- loading ---------- */
    function ingest(raw, source) {
      // Returns a normalized proposal, keeping a copy of any pre-v3 original for safety.
      const n = model.normalize(raw);
      const p = n.proposal;
      if (!raw.schema || raw.schema < 3) { p.legacyOriginal = raw; S.loadIssues[p.id] = n.issues; }
      else if (n.issues.length) S.loadIssues[p.id] = n.issues;
      p.rev = raw.rev || 0;
      return { p, migrated: !raw.schema || raw.schema < 3, source };
    }

    function onSnapshot(snap) {
      let changedCurrent = false;
      const seen = new Set();
      snap.docs.forEach(d => {
        const raw = d.data();
        if (!raw || typeof raw !== 'object') return;
        const id = raw.id || d.id;
        seen.add(id);
        const local = S.proposals.get(id);
        const rrev = raw.rev || 0;
        if (local && rrev <= (S.rev[id] || 0)) return; // our own write or older
        if (local && S.dirty.has(id)) {
          if (!S.conflict) { S.conflict = { id, remote: raw }; S.save = 'conflict'; if (id === S.currentId) changedCurrent = true; }
          return;
        }
        let ing;
        try { ing = ingest(raw, 'db'); } catch (e) { return; }
        ing.p.id = id;
        S.proposals.set(id, ing.p);
        S.rev[id] = rrev;
        if (ing.migrated && !S.readOnly) { S.dirty.add(id); }
        if (id === S.currentId) changedCurrent = true;
      });
      // Removed elsewhere.
      [...S.proposals.keys()].forEach(id => { if (!seen.has(id) && !S.dirty.has(id) && S.rev[id]) { S.proposals.delete(id); if (id === S.currentId) { S.currentId = null; changedCurrent = true; } } });
      if (S.dirty.size && !saving) { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300); }
      if (S.mode === 'boot' || !S.currentId) pickInitial();
      if (S.save !== 'conflict' && !S.dirty.size) S.save = 'saved';
      hooks.dataChanged(changedCurrent);
    }

    function pickInitial() {
      const ui = lsGet(LS.ui) || {};
      if (ui.lastId && S.proposals.has(ui.lastId)) S.currentId = ui.lastId;
      else if (S.proposals.size) S.currentId = list()[0].id;
      if (S.currentId && S.currentId !== 'example') checkDraft(S.currentId);
      if (ui.view && S.proposals.size) S.view = ui.view;
    }

    async function init() {
      let claude = null;
      try { claude = root.claude && typeof root.claude.use === 'function' ? root.claude : null; } catch (e) { claude = null; }
      if (claude) {
        try { db = await claude.use('db'); } catch (e) { db = null; }
        try {
          const user = await claude.use('user');
          if (user) {
            userId = await user.id();
            const canWrite = await user.can('data.write');
            if (canWrite === false) S.readOnly = true;
          }
        } catch (e) { userId = null; }
      }
      if (db) {
        S.mode = 'db';
        if (userId) {
          try {
            const sd = await db.doc('data/users/' + userId + '/settings').get();
            if (sd.exists) { S.settings = model.normalizeSettings(sd.data()); lsSet(LS.settings, S.settings); }
          } catch (e) { /* use local copy */ }
        }
        try {
          unsub = db.collection('proposals').onSnapshot(onSnapshot, err => {
            S.save = 'error'; S.saveError = 'Lost the connection to saved proposals (' + (err && err.code) + '). Reload to reconnect.'; hooks.render();
          });
        } catch (e) { db = null; }
      }
      if (!db) {
        S.mode = 'local';
        const all = lsGet(LS.proposals) || {};
        Object.keys(all).forEach(id => {
          try { const ing = ingest(all[id], 'local'); ing.p.id = id; S.proposals.set(id, ing.p); if (ing.migrated) S.dirty.add(id); } catch (e) { /* skip unreadable */ }
        });
        pickInitial();
        S.save = 'local';
        if (S.dirty.size) flush();
        hooks.dataChanged(true);
      }
      return S.mode;
    }

    return {
      S, current, scenario, list, mutate, touch, undo, redo, canUndo, canRedo, create, openExample, saveExampleCopy, open, remove,
      importJson, flush, retry, resolveConflict, resolveDraft, saveSettings, remember, init, replace,
      _debug: { onSnapshot, ingest, get db() { return db; }, set db(v) { db = v; }, LS }
    };
  }

  FB.ui = FB.ui || {};
  FB.ui.createStore = createStore;
})(typeof globalThis !== 'undefined' ? globalThis : this);

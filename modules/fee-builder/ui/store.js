/*
 * Fee Builder UI store: in-memory state, undo/redo, persistence, draft recovery, and conflict detection.
 *
 * Storage (the only Fee Builder file that talks to the Toolbox platform, CLAUDE.md rule 1; `P` is handed over by mount()):
 *  - Proposals: records in the Fee Builder collection "owned-proposals". Linked to a Vantagepoint project, a proposal follows
 *    that project's access rules; not linked yet (a pursuit), only its creator, firm admins and firm viewers can see it.
 *  - Personal settings: one private record per person, "personal-settings/settings-<person id>".
 *  - Every edit also writes a local draft (this device only, via pref()) so a crash or closed tab never loses work.
 *  - Saves are compare-and-set on the server's revision. If someone else saved first, the person chooses which version to keep.
 *  - Other people's changes arrive by polling (about every 20 seconds).
 */
(function (root) {
  'use strict';
  const FB = root.FB || (root.FB = {});
  const { model } = FB;
  const MODULE = 'fee-builder', COLL = 'owned-proposals', SETTINGS = 'personal-settings';

  function createStore(hooks, P) {
    const pref = (k, v) => P.pref(k, v);
    const jget = (k) => { try { const v = pref(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
    const jset = (k, v) => { try { pref(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
    const jdel = (k) => pref(k, '');
    const KEY = { draft: id => 'fb.draft.' + id, ui: 'fb.ui' };
    const proposals = () => P.Store.collection(MODULE, COLL);

    const S = {
      settings: model.normalizeSettings(null),
      proposals: new Map(),
      example: null,
      currentId: null,
      scIds: {},
      view: 'develop',
      analyzeTab: 'phases',
      pkgFilter: 'all',
      devPkg: null,
      mode: 'boot',          // 'db' | 'boot'
      save: 'idle',          // idle | saving | saved | error | conflict | sandbox | readonly
      saveError: '',
      dirty: new Set(),
      rev: {},               // the server's revision we last wrote or loaded, per proposal
      conflict: null,        // { id, remote }
      draftOffer: null,      // { id, draft }
      loadIssues: {},        // id -> [messages]
      undo: {}, redo: {},
      lastUndoKey: null, lastUndoAt: 0,
      projectOf: {},         // proposal id -> Toolbox project id it is linked to (or absent)
      projects: new Map(),   // Toolbox project id -> { id, number, name, client, status, access, vp }
      denied: {},            // proposal id -> true when the server refused a save (no edit access)
      readOnly: false,
      ui: Object.assign({ newFee: false, settingsOpen: false }, jget(KEY.ui) || {})
    };
    let userId = null, saveTimer = null, saving = false, stopWatch = null, settingsRev, projTimer = null;

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
    /* may this person edit? Linked: the project's access level. Not linked: whoever made it (the server decides for real). */
    function readOnlyFor(p) {
      if (!p || p.example) return false;
      if (S.denied[p.id]) return true;
      const pid = S.projectOf[p.id];
      if (!pid) return false;
      const proj = S.projects.get(pid);
      return !proj || proj.status !== 'active' || !(proj.access === 'write' || proj.access === 'admin');
    }
    const writableProjects = () => [...S.projects.values()].filter(q => q.status === 'active' && (q.access === 'write' || q.access === 'admin'))
      .sort((a, b) => (a.number || a.name).localeCompare(b.number || b.name));

    /* ---------- edits ---------- */
    /**
     * Run a mutation on the current proposal. `key` groups rapid edits to the same field
     * into one undo step. Returns whatever fn returns.
     */
    function mutate(fn, key) {
      const p = current();
      if (!p) return;
      if (readOnlyFor(p)) { hooks.toast('You can view this proposal but not change it.'); return; }
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
      jset(KEY.draft(p.id), { at: p.updatedAt, baseRev: S.rev[p.id] || 0, proposal: p });
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

    /* ---------- linking a proposal to a project ---------- */
    /* `projectId` is the Toolbox project id (from Directory), or null for a pursuit with no project yet. The link is the record's
       project (the server uses it for access); a copy of the Vantagepoint number is kept in extRefs.vp, as the contract asks. */
    function link(projectId) {
      const p = current();
      if (!p || p.example) return;
      const proj = projectId ? S.projects.get(projectId) : null;
      mutate(q => {
        q.extRefs = q.extRefs || {};
        if (proj) {
          q.extRefs.vp = { projectId: proj.vp ? proj.vp.projectId : null, number: proj.number };
          if (!q.number) q.number = proj.number;
          if (!q.client && proj.client) q.client = proj.client;
          if (!q.name) q.name = proj.name;
        } else delete q.extRefs.vp;
        if (proj) S.projectOf[q.id] = proj.id; else delete S.projectOf[q.id];
      }, 'link');
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
      S.save = S.dirty.size ? 'saving' : 'saved';
      remember();
    }
    function remove(id) {
      const rev = S.rev[id];
      S.proposals.delete(id);
      S.dirty.delete(id);
      jdel(KEY.draft(id));
      if (rev) proposals().remove(id, rev).catch(() => { S.save = 'error'; S.saveError = 'Delete did not reach the server.'; hooks.render(); });
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
        for (const id of [...S.dirty]) {
          const p = S.proposals.get(id);
          if (!p) { S.dirty.delete(id); continue; }
          if (S.conflict && S.conflict.id === id) continue;
          if (S.denied[id]) continue;
          const doc = JSON.parse(JSON.stringify(p));
          delete doc.rev; // the server owns the revision
          doc.schemaVersion = doc.schema || 3; // CONTRACT section 2: every record says which schema it follows
          try {
            const rec = await proposals().save(id, doc, { projectId: S.projectOf[id] || null, baseRev: S.rev[id] || undefined });
            S.rev[id] = rec.rev;
            p.rev = rec.rev;
            S.dirty.delete(id);
            jdel(KEY.draft(id));
          } catch (e) {
            if (e instanceof P.ConflictError) { S.conflict = { id, remote: remoteDoc(e.current) }; S.save = 'conflict'; continue; }
            if (e && e.status === 403) { S.denied[id] = true; S.save = 'readonly'; S.saveError = 'Saving was refused. You do not have edit access to this proposal.'; continue; }
            if (e && e.status === 413) throw new Error('This proposal is too large to save. Delete old snapshots or scenarios.');
            throw e;
          }
        }
        if (!Object.keys(S.denied).some(id => S.dirty.has(id))) S.save = S.conflict ? 'conflict' : (S.dirty.size ? 'saving' : 'saved');
        else S.save = 'error';
        if (S.save !== 'error') S.saveError = '';
      } catch (e) {
        S.save = 'error';
        S.saveError = (e && e.message) || 'Save failed.';
      } finally {
        saving = false;
        hooks.paintSave();
      }
    }
    function retry() {
      const p = current();
      if (p && !p.example) { S.dirty.add(p.id); delete S.denied[p.id]; }
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
        jdel(KEY.draft(c.id));
        S.conflict = null;
        S.save = 'saved';
      }
    }
    function checkDraft(id) {
      const d = jget(KEY.draft(id));
      const p = S.proposals.get(id);
      if (!d || !p || !d.proposal) return;
      if ((d.at || 0) > (p.updatedAt || 0) && JSON.stringify(d.proposal) !== JSON.stringify(p)) S.draftOffer = { id, draft: d };
      else jdel(KEY.draft(id));
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
      } else jdel(KEY.draft(o.id));
      S.draftOffer = null;
    }

    /* ---------- settings (personal, private to this person) ---------- */
    function saveSettings() {
      if (!userId) return;
      const id = 'settings-' + userId;
      const store = P.Store.collection(MODULE, SETTINGS);
      store.save(id, { schemaVersion: 1, settings: JSON.parse(JSON.stringify(S.settings)) }, { baseRev: settingsRev })
        .then(rec => { settingsRev = rec.rev; })
        .catch(async e => {
          // creating when it already exists, or another window saved first: take its revision and write once more
          try {
            const cur = await store.get(id);
            const rec = await store.save(id, { schemaVersion: 1, settings: JSON.parse(JSON.stringify(S.settings)) }, { baseRev: cur.rev });
            settingsRev = rec.rev;
          } catch (e2) { hooks.toast('Settings could not be saved. They are kept on this screen for now.'); }
        });
    }
    function remember() {
      jset(KEY.ui, { lastId: S.currentId, view: S.view });
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
    /* a stored record -> the plain proposal document, carrying the server's revision */
    const remoteDoc = (r) => Object.assign({}, r.data, { id: r.id, rev: r.rev });

    /* everything the server says is there right now; replaces the old live snapshot */
    function onRecords(all) {
      let changedCurrent = false;
      const seen = new Set();
      all.forEach(r => {
        const raw = remoteDoc(r);
        const id = r.id;
        seen.add(id);
        // a link chosen here but not saved yet must survive a poll that still shows the old record
        if (!S.dirty.has(id) && (r.rev || 0) >= (S.rev[id] || 0)) { if (r.projectId) S.projectOf[id] = r.projectId; else delete S.projectOf[id]; }
        const local = S.proposals.get(id);
        const rrev = r.rev || 0;
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
        if (ing.migrated && !readOnlyFor(ing.p)) { S.dirty.add(id); }
        if (id === S.currentId) changedCurrent = true;
      });
      // Removed elsewhere.
      [...S.proposals.keys()].forEach(id => { if (!seen.has(id) && !S.dirty.has(id) && S.rev[id]) { S.proposals.delete(id); if (id === S.currentId) { S.currentId = null; changedCurrent = true; } } });
      if (S.dirty.size && !saving) { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300); }
      if (S.mode === 'boot' || !S.currentId) pickInitial();
      S.mode = 'db';
      if (S.save !== 'conflict' && !S.dirty.size) S.save = 'saved';
      hooks.dataChanged(changedCurrent);
    }

    function pickInitial() {
      const ui = jget(KEY.ui) || {};
      if (ui.lastId && S.proposals.has(ui.lastId)) S.currentId = ui.lastId;
      else if (S.proposals.size) S.currentId = list()[0].id;
      if (S.currentId && S.currentId !== 'example') checkDraft(S.currentId);
      if (ui.view && S.proposals.size) S.view = ui.view;
    }

    /* projects come from the Vantagepoint copy (read-only); there is no change feed, so look again every minute */
    async function refreshProjects() {
      try {
        const [act, arch] = await Promise.all([P.Directory.projects(), P.Directory.projects({ scope: 'archived' })]);
        const m = new Map();
        act.concat(arch).forEach(q => m.set(q.id, q));
        const sig = JSON.stringify([...m.values()]);
        const changed = sig !== JSON.stringify([...S.projects.values()]);
        S.projects = m;
        if (changed) hooks.dataChanged(false);
      } catch (e) { /* the picker just stays as it was */ }
    }

    async function init() {
      const me = P.Session.me();
      userId = me ? me.id : null;
      S.readOnly = false;
      if (userId) {
        try {
          const rec = await P.Store.collection(MODULE, SETTINGS).get('settings-' + userId);
          settingsRev = rec.rev;
          if (rec.data && rec.data.settings) S.settings = model.normalizeSettings(rec.data.settings);
        } catch (e) { /* no saved settings yet: defaults */ }
      }
      await refreshProjects();
      projTimer = setInterval(refreshProjects, 60000);
      S.mode = 'boot';
      stopWatch = proposals().watch(onRecords, {
        onError: () => { S.save = 'error'; S.saveError = 'Lost the connection to saved proposals. Reload to reconnect.'; hooks.render(); }
      });
      return S.mode;
    }
    function stop() {
      if (stopWatch) stopWatch();
      stopWatch = null;
      clearInterval(projTimer);
      clearTimeout(saveTimer);
    }

    return {
      S, current, scenario, list, mutate, touch, undo, redo, canUndo, canRedo, create, openExample, saveExampleCopy, open, remove,
      importJson, flush, retry, resolveConflict, resolveDraft, saveSettings, remember, init, stop, replace, link, readOnlyFor, writableProjects,
      _debug: { onRecords, ingest, KEY }
    };
  }

  FB.ui = FB.ui || {};
  FB.ui.createStore = createStore;
})(typeof globalThis !== 'undefined' ? globalThis : this);

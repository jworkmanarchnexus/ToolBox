/* Nexus Minutes: screens, storage and sync. Rules live in logic.js (NM). */
/* start(root, P): root is the element to draw into (inside the Toolbox shell's main area); P is the platform adapters. */
function startMinutes(root, P) {
  const e = NM.esc;
  let mounted = true; // document and window listeners only act while Minutes is on screen
  const onWin = (target, type, fn, opts) => target.addEventListener(type, (ev) => { if (mounted) fn(ev); }, opts);

  /* ---------- icons ---------- */
  const ICON = {
    chev: '<path d="M9 6l6 6-6 6"/>',
    gantt: '<path d="M10 6h8"/><path d="M12 16h6"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 11h7"/>',
    calc: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M8 6h8"/><path d="M16 14v4"/><path d="M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01"/>',
    minutes: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>',
    building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>',
    menu: '<path d="M4 5h16M4 12h16M4 19h16"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>', auto: '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="12" r="10"/>',
    pclose: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>', popen: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>',
    ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15V6a1 1 0 011-1h9"/>',
    save: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 010 12"/>',
    clip: '<path d="M20 11.5l-7.8 7.8a5 5 0 01-7-7l8-8a3.3 3.3 0 014.7 4.7l-8 8a1.7 1.7 0 01-2.4-2.4l7.4-7.4"/>',
  };
  const ic = (n) => '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICON[n] + '</svg>';
  const BRAND = '';

  /* ---------- app state ---------- */
  let state = NM.emptyState();
  let booted = false;
  const env = { db: null, projects: new Map(), denied: new Set(), downloads: null, pdfBusy: false, canWrite: true, admin: true, storage: 'mem', pushing: false, pushError: false, online: navigator.onLine !== false, stale: false, lastPull: 0 };
  let ui = { view: 'home', projectId: '', seriesId: '', meetingId: '', tab: 'meetings', ptab: 'series', panel: '', rev: -1, attOpen: true, details: !(window.matchMedia && window.matchMedia('(max-width: 1000px)').matches), collapsed: {}, reg: { series: '', status: 'active', who: '', overdue: false }, confirm: '', copyText: '', quick: '', extend: '', showDone: false, legacy: false };
  /* what the person may do comes from the project (Directory): leads edit, the team reads. The server enforces it. */
  const canWriteProject = (d) => !!d && d.status === 'active' && (d.access === 'write' || d.access === 'admin');
  const roFor = (pid) => {
    if (!pid) return false;
    const p = state.projects[pid];
    if (p && p.example) return false; // the example is a private sandbox on this device
    if (!env.projects.size) return false; // the project list has not arrived (offline): edits queue and the server decides later
    return !canWriteProject(env.projects.get(pid));
  };
  const RO = () => roFor(ui.projectId);
  const isAdmin = () => env.admin === true;
  const firm = () => NM.getFirm(state);
  const R = (x) => NM.fmtRef(x, firm().refStyle);
  const T = (x) => NM.fmtTime(x, firm().timeFormat);
  const dis = () => (RO() ? ' disabled' : '');
  const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms))]);

  function saveUi() { try { P.pref('nm.ui', JSON.stringify({ view: ui.view, projectId: ui.projectId, seriesId: ui.seriesId, meetingId: ui.meetingId, tab: ui.tab, ptab: ui.ptab })); } catch (_) {} }
  const alive = (r) => !!r && !r.deleted;
  function loadUi() {
    try {
      const j = JSON.parse(P.pref('nm.ui') || 'null');
      if (!j) return;
      const p = state.projects[j.projectId], s = state.series[j.seriesId], m = state.meetings[j.meetingId];
      const ptab = ['series', 'directory', 'actions', 'details'].includes(j.ptab) ? j.ptab : 'series';
      if (j.view === 'firm') Object.assign(ui, { view: 'firm' });
      else if (j.view === 'project' && alive(p)) Object.assign(ui, { view: 'project', projectId: p.id, ptab });
      else if (j.view === 'series' && alive(s) && alive(state.projects[s.projectId])) Object.assign(ui, { view: 'series', projectId: s.projectId, seriesId: s.id, tab: ['meetings', 'actions', 'setup'].includes(j.tab) ? j.tab : 'meetings' });
      else if ((j.view === 'meeting' || j.view === 'sheet') && alive(m) && alive(state.series[m.seriesId]) && alive(state.projects[state.series[m.seriesId].projectId])) {
        Object.assign(ui, { view: m.status === 'published' && !m.revising ? 'sheet' : 'meeting', projectId: state.series[m.seriesId].projectId, seriesId: m.seriesId, meetingId: m.id });
      }
    } catch (_) {}
  }

  /* ---------- local copy on this device (the platform cache: IndexedDB, then browser storage, then memory; one per person) ---------- */
  const Local = {
    mode: 'mem', cache: null,
    async open() { this.cache = await P.Cache.open('minutes'); this.mode = this.cache.mode; env.storage = this.mode; },
    async get(key) { try { return this.cache ? await this.cache.get(key || 'state') : null; } catch (_) { return null; } },
    async set(text, key) { if (this.cache) return this.cache.set(key || 'state', text); },
  };
  let saveT = 0, pushT = 0;
  function persistSoon() { clearTimeout(saveT); saveT = setTimeout(persistNow, 250); schedulePush(900); refreshSync(); }
  async function persistNow() { try { await Local.set(JSON.stringify(state)); } catch (_) { env.storage = 'mem'; refreshSync(); } }

  /* ---------- the Toolbox server ---------- */
  /* Records keep the shape and the updatedAt-based merge they always had (logic.js decides what is newer and what conflicts).
     The server adds one thing: each write names the revision it started from, so two devices can never overwrite each other
     in the same instant. */
  const MOD = 'minutes';
  const serverColl = (c) => (c === 'firm' ? 'firm-settings' : c);
  const collOf = (c) => P.Store.collection(MOD, serverColl(c));
  const REVS = new Map(); // 'coll/id' -> the revision the server last showed us
  /* Minutes projects are keyed by the Toolbox project id; every other record reaches its project through its series */
  function projectIdOf(c, rec) {
    if (c === 'firm') return null;
    if (c === 'projects') return rec.id;
    if (c === 'series') return rec.projectId || null;
    const s = state.series[rec.seriesId];
    return s ? s.projectId : null;
  }
  const isLocalOnly = (c, rec) => { const pid = projectIdOf(c, rec); const p = pid && state.projects[pid]; return !!(p && p.example); };
  const asData = (rec) => Object.assign(JSON.parse(JSON.stringify(rec)), { schemaVersion: rec.v || NM.SCHEMA });
  const DL = { save({ filename, data }) { P.Files.save({ filename, data }); return Promise.resolve({ status: 'saved' }); } };

  async function refreshProjects() {
    try {
      const [act, arch] = await Promise.all([P.Directory.projects(), P.Directory.projects({ scope: 'archived' })]);
      const m = new Map();
      act.concat(arch).forEach((d) => m.set(d.id, d));
      env.projects = m;
      // the project's number and name come from Vantagepoint: keep Minutes' copy the same
      let changed = false;
      for (const [id, d] of m) {
        const r = state.projects[id];
        if (r && !r.deleted && !r.example && (r.name !== d.name || r.number !== d.number)) {
          r.name = d.name; r.number = d.number; changed = true;
          if (canWriteProject(d)) NM.touch(state, 'projects', r);
        }
      }
      if (changed) persistSoon();
      return true;
    } catch (_) { return false; }
  }
  async function initRemote() {
    env.db = true; env.downloads = DL; env.admin = P.Session.isAdmin();
    await refreshProjects();
  }
  async function pullAll(colls) {
    const out = {}; let ok = 0;
    for (const c of colls) {
      try {
        const res = await timeout(collOf(c).list(), 20000);
        const m = {};
        for (const r of res.records) { REVS.set(c + '/' + r.id, r.rev); m[r.id] = r.data; }
        out[c] = m; ok++;
      } catch (_) { /* leave this collection out of the merge */ }
    }
    if (!ok) throw new Error('pull failed');
    return out;
  }
  /* Image records are large, so they are fetched on start and Sync now, or when a pulled meeting points at one we lack. */
  function missingImages() {
    const need = new Set();
    for (const m of Object.values(state.meetings)) if (!m.deleted) NM.listAtts(m).forEach((x) => need.add(x.att.imageId));
    for (const sn of Object.values(state.snapshots)) if (!sn.deleted) ((sn.data && sn.data.attachments) || []).forEach((a) => need.add(a.imageId));
    return [...need].filter((id) => !(state.images[id] && state.images[id].data));
  }
  async function pullMerge(withImages) {
    if (!env.db) return null;
    try {
      const remote = await pullAll(NM.COLLS.filter((c) => c !== 'images'));
      env.lastPull = Date.now();
      const r = NM.mergeRemote(state, remote, true);
      if (withImages || missingImages().length) {
        try { const ri = await pullAll(['images']); const r2 = NM.mergeRemote(state, ri, true); r.pulled += r2.pulled; r.queued += r2.queued; } catch (_) { /* placeholders show until the next sync */ }
      }
      if (r.pulled || r.queued || r.conflicts) persistSoon();
      if (r.pulled || r.conflicts) { if (isEditing()) env.stale = true; else render(); }
      env.pushError = false;
      return r;
    } catch (_) { env.pushError = true; refreshSync(); return null; }
  }
  function schedulePush(ms) { if (!env.db) return; clearTimeout(pushT); pushT = setTimeout(pushDirty, ms); }
  /* write one record. 'ok', 'conflict' (held for a decision) or 'denied' (no edit access to its project) */
  async function putRecord(c, id, rec) {
    const key = c + '/' + id;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const saved = await timeout(collOf(c).save(id, asData(rec), { projectId: projectIdOf(c, rec), baseRev: REVS.get(key) }), 20000);
        REVS.set(key, saved.rev);
        return 'ok';
      } catch (err) {
        if (err instanceof P.ConflictError || (err && err.status === 428)) {
          // someone else wrote since we last looked (or we never looked): compare with their copy exactly as a pull would
          let cur = err.current;
          if (!cur) { try { cur = await collOf(c).get(id); } catch (_) { cur = null; } }
          if (cur) {
            REVS.set(key, cur.rev);
            if (NM.checkPush(state, c, id, cur.data) === 'conflict') return 'conflict';
          }
          continue;
        }
        if (err && err.status === 403) return 'denied';
        throw err;
      }
    }
    throw new Error('Could not save ' + key);
  }
  async function pushDirty() {
    if (!env.db || env.pushing || !env.online || !NM.dirtyCount(state)) { refreshSync(); return; }
    env.pushing = true; refreshSync();
    let failed = false, held = 0;
    try {
      for (const c of NM.COLLS) {
        for (const id of Object.keys(state.dirty[c])) {
          const rec = state[c][id];
          if (!rec) { delete state.dirty[c][id]; continue; }
          // the example project is a sandbox on this device only; records the server refused before are not retried
          if (isLocalOnly(c, rec) || env.denied.has(c + '/' + id)) { delete state.dirty[c][id]; continue; }
          if (state.conflicts[c + '/' + id]) { held++; continue; }
          const sent = rec.updatedAt;
          const verdict = await putRecord(c, id, rec);
          if (verdict === 'conflict') { held++; continue; }
          if (verdict === 'denied') { env.denied.add(c + '/' + id); delete state.dirty[c][id]; continue; }
          NM.markPushed(state, c, id, sent);
        }
      }
      env.pushError = false;
    } catch (err) {
      failed = true; env.pushError = true;
    }
    env.pushing = false;
    persistSoon();
    if (held) render();
    if (failed) schedulePush(30000);
    else if (NM.dirtyCount(state) - Object.keys(state.conflicts).length > 0) schedulePush(400);
    refreshSync();
  }
  onWin(window, 'online', () => { env.online = true; schedulePush(300); refreshSync(); });
  onWin(window, 'offline', () => { env.online = false; refreshSync(); });
  onWin(window, 'focus', () => { if (booted && env.db && !env.pushing && !NM.dirtyCount(state) && Date.now() - env.lastPull > 30000) pullMerge(); });
  // other people's changes arrive by polling (15 to 30 seconds is acceptable; CONTRACT section 8)
  const pullTimer = setInterval(() => { if (mounted && booted && env.db && env.online && !env.pushing && !NM.dirtyCount(state) && Date.now() - env.lastPull > 25000) pullMerge(); }, 30000);
  const projTimer = setInterval(() => { if (mounted && booted && env.db) refreshProjects().then(() => { if (!isEditing()) render(); }); }, 60000);

  function syncInfo() {
    const n = NM.dirtyCount(state);
    if (!booted) return { cls: '', text: 'Loading' };
    if (RO()) return { cls: '', text: 'View only' };
    if (!env.db) return { cls: 's-bad', text: 'Not connected' };
    if (!env.online) return { cls: 's-wait', text: n ? 'Offline · ' + n + ' waiting' : 'Offline' };
    if (env.pushing) return { cls: 's-busy', text: 'Saving…' };
    const nc = Object.keys(state.conflicts).length;
    if (nc) return { cls: 's-bad', text: nc + ' conflict' + (nc === 1 ? '' : 's') + ' to resolve' };
    if (env.pushError) return { cls: 's-bad', text: 'Sync failed' + (n ? ' · ' + n + ' waiting' : '') };
    if (n) return { cls: 's-wait', text: n + ' waiting to sync' };
    return { cls: 's-ok', text: 'Saved' };
  }
  function refreshSync() {
    const el = document.getElementById('sync-chip');
    if (!el) return;
    const i = syncInfo();
    el.className = 'sync ' + i.cls; el.querySelector('span').textContent = i.text;
  }

  /* ---------- small helpers ---------- */
  function toast(msg, isErr) { window.Toolbox.toast(msg); void isErr; }
  const pageEl = () => root.querySelector('.page');
  function scrollTop(y) { const pg = pageEl(); if (pg) pg.scrollTop = y; }
  function isEditing() { const a = document.activeElement; return !!a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); }
  function go(patch) {
    Object.assign(ui, { panel: '', confirm: '', copyText: '', quick: '', extend: '' }, patch);
    saveUi(); render(); scrollTop(0);
  }
  function run(fn, o) {
    o = o || {};
    if (RO()) { toast('This view is read-only.', true); return { ok: false }; }
    try {
      const v = fn(); persistSoon();
      if (o.msg) toast(o.msg);
      if (o.render !== false) render(o.focus);
      return { ok: true, v };
    } catch (err) { toast(err.message || 'Something went wrong.', true); render(); return { ok: false }; }
  }
  function silent(fn) {
    if (RO()) return;
    try { fn(); persistSoon(); railSoon(); } catch (err) { toast(err.message || 'Something went wrong.', true); }
  }
  /* [8:00 – 8:30 AM]: the shared AM/PM is written once. */
  const rng = (a, b) => { let x = T(a), y = T(b); const mx = / (AM|PM)$/.exec(x), my = / (AM|PM)$/.exec(y); if (mx && my && mx[1] === my[1]) x = x.slice(0, -3); return '[' + x + ' – ' + y + ']'; };
  const hm = (n) => { const h = Math.floor(n / 60), m = n % 60; return h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + ' min'; };
  function schedSummary(m, sc) {
    const sr = state.series[m.seriesId];
    if (!m.timed || !sc.any) return '<span id="sched-sum" class="sched"></span>';
    const over = sr && sr.durationMin > 0 && sc.total > sr.durationMin ? ' <span class="bad">· ' + (sc.total - sr.durationMin) + ' min over the usual ' + sr.durationMin + '</span>' : '';
    return '<span id="sched-sum" class="sched">Planned <b>' + hm(sc.total) + '</b>' + (sc.startOk ? ' · ends <b>' + e(T(sc.end)) + '</b>' : ' · set a start time to see clock times') + over + '</span>';
  }
  /* Typing a duration or a start time updates every clock time in place, without redrawing (which would drop focus). */
  function timesRefresh() {
    const m = state.meetings[ui.meetingId]; if (!m || ui.view !== 'meeting') return;
    const sc = NM.schedule(state, m);
    sc.rows.forEach((r) => {
      const a = root.querySelector('[data-sched="' + r.id + '"]'); if (a) a.textContent = r.start ? rng(r.start, r.end) : '';
      const b = root.querySelector('[data-brktime="' + r.id + '"]'); if (b) b.textContent = r.brkStart ? rng(r.brkStart, r.brkEnd) : '';
    });
    const sm = document.getElementById('sched-sum'); if (sm) sm.outerHTML = schedSummary(m, sc);
  }
  const chip = (t, cls) => '<span class="chip ' + (cls || '') + '">' + e(t) + '</span>';
  const selected = (a, b) => (a === b ? ' selected' : '');
  const fmtD = NM.fmtDate;
  const proj = () => state.projects[ui.projectId];
  const who = (p, ids) => ids.map((i) => NM.partyLabel(p, i)).join(', ');
  const tabsHTML = (list, cur, act) => '<div class="tabs" role="tablist">' + list.map((t) => '<button role="tab" aria-selected="' + (cur === t[0]) + '" data-act="' + act + '" data-id="' + t[0] + '">' + t[1] + (t[2] !== '' && t[2] != null ? '<span class="n">' + t[2] + '</span>' : '') + '</button>').join('') + '</div>';

  /* ---------- chrome ---------- */
  function shell(inner) {
    const i = syncInfo();
    const p = alive(state.projects[ui.projectId]) ? state.projects[ui.projectId] : null;
    const s = alive(state.series[ui.seriesId]) ? state.series[ui.seriesId] : null;
    const m = alive(state.meetings[ui.meetingId]) ? state.meetings[ui.meetingId] : null;
    const sep = ic('chev');
    const cbtn = (act, id, t) => '<button data-act="' + act + '"' + (id ? ' data-id="' + id + '"' : '') + '>' + e(t) + '</button>';
    let crumbs = '';
    if (ui.view === 'home') crumbs = '<span>Toolbox</span>' + sep + '<span class="here">Minutes</span>';
    else if (ui.view === 'firm') crumbs = cbtn('go-home', '', 'Minutes') + sep + '<span class="here">Firm settings</span>';
    else if (p) {
      crumbs = cbtn('go-home', '', 'Minutes') + sep;
      if (ui.view === 'project') crumbs += '<span class="here">' + e(p.name) + '</span>';
      else {
        crumbs += cbtn('open-project', p.id, p.name) + sep;
        if (ui.view === 'series' && s) crumbs += '<span class="here">' + e(s.name) + '</span>';
        else if (s) crumbs += cbtn('open-series', s.id, s.name) + sep + '<span class="here">Meeting ' + (m ? m.number : '') + '</span>';
      }
    }
    const legacy = ui.legacy ? '<div class="banner info"><span>The first version of this tool stored meetings differently, so the test data from it was set aside in this browser instead of being converted. This version starts clean.</span><div class="actions"><button class="btn sm" data-act="dismiss-legacy">Got it</button></div></div>' : '';
    const mcrumb = ui.view === 'home' ? 'Minutes' : m ? 'Meeting ' + m.number : s ? s.name : p ? p.name : ui.view === 'firm' ? 'Firm settings' : 'Minutes';
    const mc = document.getElementById('mCrumb'); if (mc) mc.textContent = mcrumb;
    const crumbBar = '<div class="mn-bar">' + (crumbs ? '<nav class="crumbs" aria-label="Where you are">' + crumbs + '</nav>' : '<span></span>') +
      '<button id="sync-chip" class="sync ' + i.cls + '" data-act="toggle-data" aria-expanded="' + (ui.panel === 'data') + '" title="Where this tool keeps its data"><i></i><span>' + e(i.text) + '</span></button></div>';
    return '<main class="page"><div class="pbody">' + crumbBar + legacy + conflictBanner() + (env.stale ? '<div class="banner info"><span>Newer changes from another device were loaded.</span><div class="actions"><button class="btn sm" data-act="refresh">Show them</button></div></div>' : '') +
      (ui.panel === 'data' ? dataPanel() : '') + inner + '</div></main>';
  }
  function recLabel(c, r) {
    if (c === 'projects') return 'Project “' + r.name + '”';
    if (c === 'series') return 'Series “' + r.name + '”';
    if (c === 'meetings') { const s = state.series[r.seriesId]; return 'Meeting ' + r.number + (s ? ' of ' + s.name : ''); }
    if (c === 'actions') return 'Action “' + (r.text || '').slice(0, 50) + '”';
    if (c === 'firm') return 'Firm settings';
    return c;
  }
  /* A record that was changed here and by someone else since the last sync is never overwritten silently. */
  function conflictBanner() {
    const list = NM.conflictList(state);
    if (!list.length) return '';
    return '<section class="banner conflict" role="alert"><b>' + list.length + ' record' + (list.length === 1 ? ' was' : 's were') + ' changed here and somewhere else</b>' +
      '<p class="hint" style="color:inherit">Nothing was overwritten. Choose which copy to keep for each one. Keeping yours replaces the other copy; using theirs discards your unsent edits to it.</p>' +
      list.map((x) => '<div class="cf-row"><div><b>' + e(recLabel(x.coll, x.mine)) + '</b><span class="muted"> · yours saved ' + e(NM.fmtStamp(x.mine.updatedAt)) + ' · other copy saved ' + e(NM.fmtStamp(x.theirs.updatedAt)) + (x.theirs.deleted ? ' (deleted there)' : '') + '</span></div>' +
        '<div class="actions"><button class="btn sm" data-act="resolve" data-key="' + e(x.key) + '" data-choice="mine"' + dis() + '>Keep mine</button><button class="btn sm" data-act="resolve" data-key="' + e(x.key) + '" data-choice="theirs"' + dis() + '>Use theirs</button></div></div>').join('') + '</section>';
  }
  function dataPanel() {
    const n = NM.dirtyCount(state);
    const where = RO() ? 'You can read this but not change it.' : env.db ? 'Everything is saved on this computer first, then copied to the Toolbox. ' + (n ? n + ' change' + (n === 1 ? '' : 's') + ' still waiting to upload.' : 'Everything is uploaded.') :
      env.storage === 'mem' ? 'This browser is blocking storage, so a copy cannot be kept on this computer. Changes still go to the Toolbox when it is reachable.' : 'Saved on this computer only. The Toolbox is not reachable right now.';
    const hasEx = NM.listProjects(state).some((x) => x.example);
    return '<section class="panel" aria-label="Data and backup"><h2>Data and backup</h2><p class="hint">' + e(where) + '</p><div class="actions">' +
      (env.db ? '<button class="btn" data-act="sync-now"' + (env.online ? '' : ' disabled') + '>Sync now</button>' : '') +
      (env.downloads ? '<button class="btn" data-act="save-backup">' + ic('save') + 'Download backup</button>' : '') +
      '<label class="btn" for="import-file">Import backup</label><input id="import-file" type="file" accept=".json,application/json" data-bind="import" hidden' + dis() + '>' +
      (hasEx ? '<button class="btn danger" data-act="remove-examples"' + dis() + '>Remove example project</button>' : '') +
      '<button class="btn ghost" data-act="toggle-data">Close</button></div></section>';
  }

  /* ---------- home: projects ---------- */
  /* Vantagepoint projects the person can edit that have no minutes set up yet */
  function startable() { return [...env.projects.values()].filter((d) => d.status === 'active' && canWriteProject(d) && !alive(state.projects[d.id])).sort((a, b) => (a.number || a.name).localeCompare(b.number || b.name)); }
  function startList() {
    const list = startable();
    if (!list.length) return '';
    return '<section class="proj"><div class="proj-h"><span class="pn">Start minutes for a project</span><span class="hint">Projects come from Vantagepoint. Pick one to set up its contacts and meeting series.</span></div>' +
      list.map((d) => '<div class="srow"><div><b>' + e(d.name) + '</b><div class="lr-sub">' + e([d.number, d.client].filter(Boolean).join(' · ')) + '</div></div><div class="st"></div><div class="go"><button class="btn sm" data-act="start-project" data-id="' + e(d.id) + '"' + dis() + '>' + ic('plus') + 'Start minutes</button></div></div>').join('') + '</section>';
  }
  function viewHome() {
    const list = NM.listProjects(state);
    const form = '';
    const firmBtn = isAdmin() ? '<button class="btn" data-act="open-firm">Firm settings</button>' : '';
    if (!list.length) {
      return (form || '<section class="empty"><div class="eyebrow">Nexus Toolbox</div><h1>Meeting minutes that carry over</h1>' +
        '<p>Set up a project and the companies on it. Build each agenda as a list of discussion items under categories like Site, Schedule and Mechanical. In the meeting, record outcomes as decisions or assignments. Assignments become action items that stay on every agenda until someone closes them.</p>' +
        '<div class="flow"><span>Agenda</span><span>Minutes</span><span>Published</span><span>Next agenda</span></div>' +
        (startable().length ? '' : '<p class="hint">You are not set up on a Vantagepoint project that can take minutes yet. Ask a project lead (PIC, PM or PA) to start one, or try the example.</p>') +
        '<div class="actions"><button class="btn" data-act="load-example"' + dis() + '>Load an example project</button>' + firmBtn + '</div>' + startList() +
        '<p class="hint">The example is a made-up medical office project with two published meetings and an agenda ready to run. Remove it any time.</p></section>');
    }
    const groups = list.map((p) => {
      const sum = NM.projectSummary(state, p.id);
      const sl = NM.seriesOf(state, p.id);
      const rows = sl.map((sr) => seriesRow(sr)).join('') || '<p class="hint" style="padding:8px 4px">No meeting series yet. <button class="link" data-act="open-project" data-id="' + p.id + '">Set one up</button></p>';
      return '<section class="proj"><div class="proj-h"><button class="pn" data-act="open-project" data-id="' + p.id + '">' + e(p.name) + '</button><span class="hint">' + e([p.number, (p.address || '').split('\n')[0]].filter(Boolean).join(' · ')) +
        (sum.open ? ' · <b>' + sum.open + '</b> open action' + (sum.open === 1 ? '' : 's') : '') + (sum.overdue ? ' · <b class="bad">' + sum.overdue + ' overdue</b>' : '') + '</span></div>' + rows + '</section>';
    }).join('');
    return '<div class="ptitle"><h1 class="h-page">Minutes</h1><span class="eyebrow">Agendas and minutes that carry open items forward.</span><span class="grow"></span><div class="actions"></div></div>' + form + '<div class="sec-head"><h2 class="h-sec">Projects<span class="n">' + list.length + '</span></h2></div>' + groups + startList();
  }
  /* One line per series. The button goes straight to the meeting that needs attention, so getting to work is one click from the home screen. */
  function seriesRow(sr) {
    const sum = NM.seriesSummary(state, sr.id);
    const ms = NM.meetingsOf(state, sr.id), latest = ms[0], draft = NM.draftOf(state, sr.id);
    const blocked = latest && latest.revising;
    let stat = '';
    if (draft) stat = 'Meeting ' + draft.number + ' ' + (draft.status === 'agenda' ? 'agenda in progress' : 'minutes in progress');
    else if (latest) stat = 'Meeting ' + latest.number + (blocked ? ' being revised' : ' published ' + NM.fmtShort(latest.date));
    else stat = 'No meetings yet';
    let go;
    if (draft) go = '<button class="btn primary sm" data-act="open-meeting" data-id="' + draft.id + '">Continue Meeting ' + draft.number + '</button>';
    else if (blocked) go = '<button class="btn primary sm" data-act="open-meeting-edit" data-id="' + latest.id + '">Continue revision</button>';
    else go = '<button class="btn primary sm" data-act="new-meeting-in" data-id="' + sr.id + '"' + (roFor(sr.projectId) ? ' disabled' : '') + '>' + ic('plus') + 'New meeting ' + (latest ? latest.number + 1 : sr.startNumber || 1) + '</button>';
    const last = !draft && latest && !blocked ? '<button class="btn sm" data-act="open-meeting" data-id="' + latest.id + '">View Meeting ' + latest.number + '</button>' : '';
    return '<div class="srow"><div><button class="sn-btn" data-act="open-series" data-id="' + sr.id + '">' + e(sr.name) + '</button><div class="lr-sub">' + e([sr.meetingType, sr.location].filter(Boolean).join(' · ')) + '</div></div>' +
      '<div class="st"><span>' + e(stat) + '</span><span><b>' + sum.open + '</b> open action' + (sum.open === 1 ? '' : 's') + '</span>' + (sum.overdue ? '<span class="bad"><b>' + sum.overdue + '</b> overdue</span>' : '') + '</div><div class="go">' + last + go + '</div></div>';
  }
  /* ---------- firm settings (administrators only) ---------- */
  function viewFirm() {
    const f = firm();
    if (!isAdmin()) return '<section class="panel"><h2>Firm settings</h2><p>Firm-wide settings are managed by an administrator. They fill in the header, footer and notices on every set of minutes.</p><div class="actions"><button class="btn" data-act="go-home">Back to projects</button></div></section>';
    const d = RO() ? ' disabled' : '';
    const fld = (key, label, type) => '<div class="field"><label for="f-' + key + '">' + label + '</label><input id="f-' + key + '" type="text" value="' + e(f[key]) + '" data-bind="firmf" data-field="' + key + '"' + d + '></div>';
    const offs = f.offices.map((o) => '<div class="office"><div class="row"><div class="field"><label for="o-n-' + o.id + '">Office</label><input id="o-n-' + o.id + '" type="text" value="' + e(o.name) + '" data-bind="ofield" data-field="name" data-id="' + o.id + '"' + d + '></div>' +
      '<div class="field"><label for="o-a1-' + o.id + '">Street</label><input id="o-a1-' + o.id + '" type="text" value="' + e(o.address1) + '" data-bind="ofield" data-field="address1" data-id="' + o.id + '"' + d + '></div>' +
      '<div class="field"><label for="o-a2-' + o.id + '">City, state, ZIP</label><input id="o-a2-' + o.id + '" type="text" value="' + e(o.address2) + '" data-bind="ofield" data-field="address2" data-id="' + o.id + '"' + d + '></div>' +
      '<div class="field"><label for="o-p-' + o.id + '">Telephone</label><input id="o-p-' + o.id + '" type="text" value="' + e(o.phone) + '" data-bind="ofield" data-field="phone" data-id="' + o.id + '"' + d + '></div>' +
      '<button class="btn sm" data-act="remove-office" data-id="' + o.id + '"' + d + '>Remove</button></div></div>').join('');
    return '<div class="ptitle"><h1 class="h-page">Firm settings</h1><span class="eyebrow">Administrators</span></div>' +
      '<p class="hint">Entered once, used by every project. These fill in the corporate header, footer and notices on agendas and minutes. Minutes already published keep the values they were issued with.</p>' +
      '<section class="panel"><h2>Organization</h2><div class="row">' + fld('name', 'Firm name') + fld('short', 'Abbreviation (AKA)') + fld('web', 'Web address') + '</div><div class="row">' + fld('contactPhone', 'Default telephone') + fld('contactEmail', 'Default e-mail') + '</div></section>' +
      '<section class="panel"><h2>Offices</h2>' + offs + '<form class="dir-add" data-form="addOffice" style="grid-template-columns:minmax(0,1fr) auto"><div class="field"><label for="of-new">New office</label><input id="of-new" name="name" type="text" placeholder="Office name" autocomplete="off"' + d + '></div><button class="btn sm" type="submit"' + d + '>' + ic('plus') + 'Add office</button></form></section>' +
      '<section class="panel"><h2>Document</h2><div class="row">' + fld('docType', 'Document type (footer)') + fld('docIdPrefix', 'Document ID prefix') + fld('formVersion', 'Form version') + '</div><div class="row">' + fld('copyrightHolder', 'Copyright holder') +
      '<div class="field"><label for="f-copyrightYear">Copyright year</label><input id="f-copyrightYear" type="text" value="' + e(f.copyrightYear) + '" placeholder="Year of issue" data-bind="firmf" data-field="copyrightYear"' + d + '></div>' +
      '<div class="field"><label for="f-timeFormat">Time format</label><select id="f-timeFormat" data-bind="firmf" data-field="timeFormat"' + d + '><option value="12h"' + selected(f.timeFormat, '12h') + '>12-hour (1:00 PM)</option><option value="24h"' + selected(f.timeFormat, '24h') + '>24-hour (13:00)</option></select></div>' +
      '<div class="field"><label for="f-refStyle">Issue numbers</label><select id="f-refStyle" data-bind="firmf" data-field="refStyle"' + d + '><option value="legacy"' + selected(f.refStyle, 'legacy') + '>001.02 and 001.02.B (form style)</option><option value="plain"' + selected(f.refStyle, 'plain') + '>1.2 and 1.2.B</option></select></div></div>' +
      '<p class="hint">The document ID prints as the prefix, the meeting number and the revision, for example MIN 003.01.</p></section>' +
      '<section class="panel"><h2>Notice printed above the minutes</h2><div class="field"><label for="f-notice">Correction notice</label><textarea id="f-notice" rows="3" data-bind="firmf" data-field="correctionNotice"' + d + '>' + e(f.correctionNotice) + '</textarea></div>' +
      '<p class="hint">The sentences explaining bold (new from this meeting) and underline (requires action) are added automatically.</p></section>' +
      '<section class="panel"><h2>Meeting types</h2><div class="field"><label for="f-types">One per line. Offered when setting up a series.</label><textarea id="f-types" rows="5" data-bind="firmtypes"' + d + '>' + e(f.meetingTypes.join('\n')) + '</textarea></div></section>';
  }

  /* ---------- project: series, contacts, action register, settings ---------- */
  function viewProject() {
    const p = proj();
    const sl = NM.seriesOf(state, p.id);
    const nAct = NM.projectActions(state, p.id, { status: 'active' }).length;
    const tabs = [['series', 'Meeting series', sl.length], ['directory', 'Contacts', p.parties.length], ['actions', 'Action register', nAct], ['details', 'Project settings', '']];
    const addr1 = (p.address || '').split('\n')[0];
    return '<div class="ptitle"><h1 class="h-page">' + e(p.name) + '</h1><span class="eyebrow">' + e([p.number, addr1].filter(Boolean).join(' · ') || 'Project') + '</span></div>' + tabsHTML(tabs, ui.ptab, 'ptab') +
      (ui.ptab === 'series' ? projectSeries(p, sl) : ui.ptab === 'directory' ? projectDirectory(p) : ui.ptab === 'actions' ? projectRegister(p) : projectDetails(p));
  }
  function projectSeries(p, sl) {
    const types = firm().meetingTypes;
    const form = ui.panel === 'newSeries' ? '<form class="panel" data-form="newSeries"><h2>New meeting series</h2><div class="row"><div class="field"><label for="ns-name">Name</label><input id="ns-name" name="name" type="text" required placeholder="Weekly OAC Meeting" autocomplete="off"></div>' +
      '<div class="field"><label for="ns-type">Meeting type</label><input id="ns-type" name="meetingType" type="text" list="mtypes" placeholder="Owner-Architect-Contractor" autocomplete="off"></div>' +
      '<div class="field"><label for="ns-loc">Usual location</label><input id="ns-loc" name="location" type="text" placeholder="Zoom, Conference Room B" autocomplete="off"></div>' +
      '<div class="field"><label for="ns-cad">Repeats</label><select id="ns-cad" name="cadence"><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="monthly">Monthly</option><option value="none">No set schedule</option></select></div></div>' +
      '<datalist id="mtypes">' + types.map((t) => '<option value="' + e(t) + '">').join('') + '</datalist>' +
      '<p class="hint">It starts with the standard categories (General, Schedule, Site, Architecture, Structural, Mechanical, Electrical, Plumbing). Time, duration, roster and numbering are set under Setup.</p>' +
      '<div class="actions"><button class="btn primary" type="submit">Create series</button><button class="btn ghost" type="button" data-act="close-panel">Cancel</button></div></form>' : '';
    const rows = sl.map((s) => {
      const sum = NM.seriesSummary(state, s.id);
      let stat;
      if (sum.draft) stat = 'Meeting ' + sum.draft.number + ' · ' + (sum.draft.status === 'agenda' ? 'agenda' : 'minutes in progress');
      else if (sum.latest) stat = 'Meeting ' + sum.latest.number + ' published ' + NM.fmtShort(sum.latest.date);
      else stat = 'No meetings yet';
      return '<button class="list-row" data-act="open-series" data-id="' + s.id + '"><span><span class="lr-name">' + e(s.name) + '</span><span class="lr-sub">' + e([s.meetingType, s.location].filter(Boolean).join(' · ') || 'No usual location') + '</span></span>' +
        '<span class="lr-stat">' + e(stat) + '<br><b>' + sum.open + '</b> open action' + (sum.open === 1 ? '' : 's') + (sum.overdue ? ' · <b class="bad">' + sum.overdue + ' overdue</b>' : '') + '</span>' + ic('chev') + '</button>';
    }).join('');
    const people = p.parties.filter((x) => !x.isFirm).length;
    const anyMeet = NM.seriesOf(state, p.id).some((s) => NM.meetingsOf(state, s.id).length);
    return '<div class="actions"><button class="btn primary" data-act="new-series"' + dis() + '>' + ic('plus') + 'New series</button>' + (anyMeet ? '<button class="btn sm" style="margin-left:auto" data-act="export-project" title="One Markdown file with every series\u2019 minutes (and agendas that never became minutes), for searching or asking an AI">' + ic('save') + 'Export all</button>' : '') + '</div>' + form +
      (rows ? '<div class="list">' + rows + '</div>' : '<p class="hint">No meeting series yet. A series is a recurring meeting, such as the weekly owner-architect-contractor meeting.</p>') +
      (!people ? '<div class="banner info"><span>Add the companies and people on this project under <b>Contacts</b> so they can be picked as attendees and responsible parties. Contacts are entered once and reused by every series.</span><div class="actions"><button class="btn sm" data-act="ptab" data-id="directory">Open contacts</button></div></div>' : '');
  }
  function pfld(x, key, label, type) {
    return '<div class="field"><label for="pf-' + key + '-' + x.id + '">' + label + '</label><input id="pf-' + key + '-' + x.id + '" type="' + (type || 'text') + '" value="' + e(x[key]) + '" data-bind="pfield" data-field="' + key + '" data-id="' + x.id + '"' + dis() + '></div>';
  }
  function partyRow(p, x) {
    if (x.isFirm) return '<div class="dir-row firm"><div><b>' + e(x.name) + '</b> <span class="chip">' + e(x.abbr || 'Firm') + '</span><div class="muted">' + e([x.phone, x.email].filter(Boolean).join(' · ')) + '</div></div><span class="hint">Managed in firm settings</span></div>';
    if (x.kind === 'company') return '<div class="dir-row company"><div class="row">' + pfld(x, 'name', 'Company') + pfld(x, 'abbr', 'AKA (abbreviation)') + pfld(x, 'phone', 'Telephone') + '</div><button class="btn sm" data-act="remove-party" data-id="' + x.id + '"' + dis() + '>Remove</button></div>';
    return '<div class="dir-row person"><div class="row">' + pfld(x, 'name', 'Name') + pfld(x, 'title', 'Title') +
      '<div class="field"><label for="pf-co-' + x.id + '">Company</label><select id="pf-co-' + x.id + '" data-bind="pfield" data-field="companyId" data-id="' + x.id + '"' + dis() + '><option value="">No company</option>' + NM.companiesOf(p).map((c) => '<option value="' + c.id + '"' + selected(x.companyId, c.id) + '>' + e(c.name) + '</option>').join('') + '</select></div>' +
      pfld(x, 'phone', 'Telephone', 'tel') + pfld(x, 'email', 'E-mail', 'email') + '</div><button class="btn sm" data-act="remove-party" data-id="' + x.id + '"' + dis() + '>Remove</button></div>';
  }
  function projectDirectory(p) {
    const cos = NM.companiesOf(p), loose = NM.peopleOf(p, '');
    const list = cos.map((c) => '<div class="dir-co">' + partyRow(p, c) + NM.peopleOf(p, c.id).map((x) => partyRow(p, x)).join('') + '</div>').join('') +
      (loose.length ? '<div class="dir-co"><div class="lbl">People without a company</div>' + loose.map((x) => partyRow(p, x)).join('') + '</div>' : '');
    return '<section class="panel"><h2>Contacts</h2><p class="hint">Companies and people on this project. Enter each once; every series picks its roster and responsible parties from this list. The abbreviation (AKA) is what prints in the Action By column.</p>' +
      (list || '<p class="hint">Nobody yet. Add the companies first, then the people at each one.</p>') +
      '<form class="dir-add" data-form="addParty"><div class="field"><label for="dp-name">Name</label><input id="dp-name" name="name" type="text" required placeholder="Company or person" autocomplete="off"' + dis() + '></div>' +
      '<div class="field"><label for="dp-kind">Type</label><select id="dp-kind" name="kind"' + dis() + '><option value="company">Company</option><option value="person">Person</option></select></div>' +
      '<div class="field"><label for="dp-co">Company (for a person)</label><select id="dp-co" name="companyId"' + dis() + '><option value="">No company</option>' + cos.map((c) => '<option value="' + c.id + '">' + e(c.name) + '</option>').join('') + '</select></div>' +
      '<button class="btn primary" type="submit"' + dis() + '>' + ic('plus') + 'Add</button></form></section>';
  }
  function projectRegister(p) {
    const f = ui.reg, sl = NM.seriesOf(state, p.id);
    const rows = NM.projectActions(state, p.id, { status: f.status || 'active', seriesId: f.series || undefined, assigneeId: f.who || undefined, overdue: f.overdue || undefined });
    const stOpts = [['active', 'Open and in progress'], ['all', 'Everything'], ['open', 'Open'], ['progress', 'In progress'], ['done', 'Completed'], ['canceled', 'Canceled']];
    const filters = '<div class="filters"><div class="field"><label for="rg-st">Show</label><select id="rg-st" data-bind="regf" data-field="status">' + stOpts.map((o) => '<option value="' + o[0] + '"' + selected(f.status || 'active', o[0]) + '>' + o[1] + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="rg-se">Series</label><select id="rg-se" data-bind="regf" data-field="series"><option value="">All series</option>' + sl.map((s) => '<option value="' + s.id + '"' + selected(f.series, s.id) + '>' + e(s.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="rg-who">Responsible</label><select id="rg-who" data-bind="regf" data-field="who"><option value="">Anyone</option>' + p.parties.map((x) => '<option value="' + x.id + '"' + selected(f.who, x.id) + '>' + e(NM.partyLabel(p, x.id)) + '</option>').join('') + '</select></div>' +
      '<label class="chk" for="rg-od"><input id="rg-od" type="checkbox" data-bind="regf" data-field="overdue"' + (f.overdue ? ' checked' : '') + '> Overdue only</label></div>';
    const head = '<div class="ahead tbl" style="padding-inline:0"><span>#</span><span>Action</span><span>Responsible</span><span>Due</span><span>Status</span></div>';
    return '<section class="panel"><h2>Action register</h2><p class="hint">Every action in this project across all series. Numbers stay with an action for its whole life.</p>' + filters + '</section>' +
      (rows.length ? '<div class="acttable">' + head + rows.map((r) => actionTableRow(r.a, p, !isOpenA(r.a), r.seriesName)).join('') + '</div>' : '<p class="hint">Nothing matches. Actions appear here when minutes with assignments are published.</p>');
  }
  const isOpenA = (a) => NM.isActive(a);
  function fnExample(p) {
    const s0 = Object.values(state.series).find((x) => x.projectId === p.id && !x.deleted);
    const snap = { rev: 0, kind: 'minutes', data: { doc: { kind: 'minutes' }, header: { project: p.name, series: s0 ? s0.name : 'Weekly OAC Meeting', number: 12, date: NM.todayStr() } } };
    return 'Tokens: {date} {project} {series} {number} {doc} {rev}. Leave empty for the default. Example: <b>' + e(NM.fileName(p.fileName, snap, 'pdf')) + '</b>';
  }
  function projectDetails(p) {
    const d = ui.confirm === 'delete-project';
    const f = firm();
    const fldNum = '<div class="field"><label for="pj-number">Architect’s project #</label><input id="pj-number" type="text" value="' + e(p.number) + '" data-bind="pjfield" data-field="number"' + (p.example ? dis() : ' disabled') + '></div>';
    const fld = (key, label, ph) => '<div class="field"><label for="pj-' + key + '">' + label + '</label><input id="pj-' + key + '" type="text" value="' + e(p[key]) + '"' + (ph ? ' placeholder="' + ph + '"' : '') + ' data-bind="pjfield" data-field="' + key + '"' + dis() + '></div>';
    return '<section class="panel"><h2>Project</h2><div class="field"><label for="pj-name">Project name</label><input id="pj-name" type="text" value="' + e(p.name) + '" data-bind="pjfield" data-field="name"' + (p.example ? dis() : ' disabled') + '>' + (p.example ? '' : '<span class="hint">The name and number come from Vantagepoint and cannot be changed here.</span>') + '</div>' +
      '<div class="field"><label for="pj-address">Project address</label><textarea id="pj-address" rows="2" data-bind="pjfield" data-field="address"' + dis() + '>' + e(p.address) + '</textarea></div>' +
      '<div class="row">' + fldNum + fld('ownerNumber', 'Owner’s project #') + '</div>' +
      '<div class="row"><div class="field"><label for="pj-owner">Owner / client organization</label><select id="pj-owner" data-bind="pjfield" data-field="ownerOrgId"' + dis() + '><option value="">Not set</option>' + NM.companiesOf(p).filter((c) => !c.isFirm).map((c) => '<option value="' + c.id + '"' + selected(p.ownerOrgId, c.id) + '>' + e(c.name) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="pj-office">Primary office</label><select id="pj-office" data-bind="pjfield" data-field="officeId"' + dis() + '>' + f.offices.map((o) => '<option value="' + o.id + '"' + selected(p.officeId, o.id) + '>' + e(o.name) + '</option>').join('') + '</select></div></div>' +
      '<div class="field"><label for="pj-fileName">File name for PDFs and saved files</label><input id="pj-fileName" type="text" value="' + e(p.fileName) + '" placeholder="' + e(NM.FILE_DEFAULT) + '" data-bind="pjfield" data-field="fileName"' + dis() + '><p class="hint" id="pj-fn-ex">' + fnExample(p) + '</p></div>' +
      '<p class="hint">These print at the top of every agenda and set of minutes. Published minutes keep the values they were issued with. The owner is picked from Contacts.</p></section>' +
      '<section class="panel"><h2>Delete project</h2>' + (d ? '<p>This removes ' + e(p.name) + ' with its contacts, every series, all meetings, action items and published minutes. A backup downloaded earlier can restore it.</p><div class="actions"><button class="btn danger" data-act="delete-project"' + dis() + '>Delete permanently</button><button class="btn ghost" data-act="close-panel">Keep it</button></div>' :
        '<div class="actions"><button class="btn danger" data-act="ask-delete-project"' + dis() + '>Delete this project</button></div>') + '</section>';
  }

  /* ---------- series ---------- */
  function viewSeries() {
    const s = state.series[ui.seriesId], p = proj();
    const open = NM.actionsOf(state, s.id).filter(NM.isActive);
    const tab = ui.tab === 'setup' ? 'setup' : 'meetings';
    const tabs = [['meetings', 'Meetings and actions', ''], ['setup', 'Setup', '']];
    return '<div class="ptitle"><h1 class="h-page">' + e(s.name) + '</h1><span class="eyebrow">' + e(p.name) + (s.meetingType ? ' · ' + e(s.meetingType) : '') + '</span></div>' + tabsHTML(tabs, tab, 'tab') +
      (tab === 'meetings' ? seriesMeetings(s) + '<div class="sec-head"><h2 class="h-sec">Open action items<span class="n">' + open.length + '</span></h2></div>' + seriesActions(s, p) : seriesSetup(s, p));
  }
  function seriesMeetings(s) {
    const ms = NM.meetingsOf(state, s.id), draft = NM.draftOf(state, s.id), latest = ms[0];
    const blocked = latest && latest.revising;
    const open = NM.actionsOf(state, s.id).filter(NM.isActive).length;
    const nextNo = latest ? latest.number + 1 : s.startNumber || 1;
    const primary = draft ? '<button class="btn primary sm" data-act="open-meeting" data-id="' + draft.id + '">Continue Meeting ' + draft.number + '</button>' :
      '<button class="btn primary sm" data-act="new-meeting"' + (blocked || RO() ? ' disabled' : '') + '>' + ic('plus') + 'New meeting ' + nextNo + '</button>';
    const hint = blocked ? '<p class="hint">Finish the revision to Meeting ' + latest.number + ' before starting the next one.</p>' : !ms.length ? '<p class="hint">The first agenda starts from this series’ categories, roster and defaults. Add discussion items under each category.</p>' :
      draft ? '' : '<p class="hint">The new agenda starts with the series defaults' + (s.carryOpen ? ' and ' + open + ' open action item' + (open === 1 ? '' : 's') : '') + '.</p>';
    const rows = ms.map((m) => {
      let chips, sub = '';
      const snaps = NM.snapshotsOf(state, m.id);
      if (m.revising) chips = chip('Revising', 'old') + chip('Rev ' + snaps.length, 'solid');
      else if (m.status === 'published' && snaps.length) {
        chips = chip('Published', 'ok') + chip('Rev ' + (snaps.length - 1));
        const c = snaps[snaps.length - 1].data.counts;
        sub = '<span>' + c.topics + ' topic' + (c.topics === 1 ? '' : 's') + '</span><span>' + c.decisions + ' decision' + (c.decisions === 1 ? '' : 's') + '</span><span>' + c.assignments + ' new action' + (c.assignments === 1 ? '' : 's') + '</span>' + (c.overdue ? '<span class="bad">' + c.overdue + ' overdue</span>' : '');
      } else {
        chips = chip(m.status === 'agenda' ? 'Agenda' : 'Minutes', 'new');
        const n = m.sections.reduce((k, x) => k + x.topics.length, 0);
        sub = '<span>' + n + ' topic' + (n === 1 ? '' : 's') + '</span><span>' + m.carried.length + ' carried action' + (m.carried.length === 1 ? '' : 's') + '</span>';
      }
      const tm = NM.effective(state, m, 'time').value;
      return '<button class="mrow" data-act="open-meeting" data-id="' + m.id + '"><span><span class="mn">Meeting ' + m.number + '</span><span class="md"><span>' + e(fmtD(m.date)) + (tm ? ' · ' + e(T(tm)) : '') + '</span>' + sub + '</span></span><span class="chips">' + chips + '</span>' + ic('chev') + '</button>';
    }).join('');
    return '<div class="sec-head"><h2 class="h-sec">Meetings<span class="n">' + ms.length + '</span></h2><div class="actions">' + primary + (ms.length ? '<button class="btn sm" data-act="export-series" title="One Markdown file with every meeting\u2019s minutes (and agendas that never became minutes), for searching or asking an AI">' + ic('save') + 'Export all</button>' : '') + '</div></div>' + hint + (rows ? '<div class="list">' + rows + '</div>' : '');
  }
  function actionTableRow(a, p, done, seriesName) {
    const today = NM.todayStr();
    const act = NM.isActive(a);
    const od = act && a.due && a.due < today;
    const pushes = a.pushes.length;
    const from = a.refMeeting ? 'M' + a.refMeeting + ' · ' + R(a.ref) : R(a.ref);
    return '<div class="arow tbl' + (done ? ' a-done' : '') + '"><div class="a-ref">#' + (a.seq || '–') + '<small>' + e(from) + '</small></div><div class="a-main"><div class="a-text">' + e(a.text) + '</div>' +
      (seriesName ? '<div class="a-note muted">' + e(seriesName) + '</div>' : '') +
      (pushes ? '<div class="pushlog">' + a.pushes.map((x) => '<span><b>M' + x.number + '</b> moved ' + e(NM.fmtShort(x.from)) + ' → ' + e(NM.fmtShort(x.to)) + (x.note ? ': ' + e(x.note) : '') + '</span>').join('') + '</div>' : '') +
      (done && a.doneNote ? '<div class="a-note"><b>' + NM.ACTION_LABEL[a.status] + '</b> ' + e(a.doneNote) + '</div>' : '') + '</div>' +
      '<div class="a-meta"><div class="a-who">' + e(who(p, a.assigneeIds) || '—') + '</div><div class="a-due' + (od ? ' od' : '') + '">' + e(NM.fmtShort(a.due)) + (pushes ? '<small>was ' + e(NM.fmtShort(a.origDue)) + '</small>' : '') + (od ? '<small>overdue</small>' : '') + (done && a.doneOn ? '<small>' + (a.status === 'done' ? 'completed ' : 'closed ') + e(NM.fmtShort(a.doneOn)) + '</small>' : '') + '</div>' +
      '<div class="a-st">' + (done ? e(NM.ACTION_LABEL[a.status]) + ' <button class="link" data-act="reopen-action" data-id="' + a.id + '"' + dis() + '>Reopen</button>' : e(NM.ACTION_LABEL[a.status]) + (pushes ? '<small>moved ' + pushes + '×</small>' : '')) + '</div></div></div>';
  }
  function seriesActions(s, p) {
    const all = NM.actionsOf(state, s.id);
    const open = all.filter(NM.isActive), done = all.filter((a) => !NM.isActive(a));
    const head = '<div class="ahead tbl" style="padding-inline:0"><span>#</span><span>Action</span><span>Responsible</span><span>Due</span><span>Status</span></div>';
    return (open.length ? '<div class="acttable">' + head + open.map((a) => actionTableRow(a, p, false)).join('') + '</div>' : '<p class="hint">No open action items. They are created when you publish minutes that contain assignments.</p>') +
      (done.length ? '<div><button class="link" data-act="show-done" aria-expanded="' + ui.showDone + '">' + (ui.showDone ? 'Hide' : 'Show') + ' ' + done.length + ' completed or canceled</button>' + (ui.showDone ? '<div class="acttable">' + done.map((a) => actionTableRow(a, p, true)).join('') + '</div>' : '') + '</div>' : '');
  }
  function peopleOptions(p, cur, blank) {
    return '<option value="">' + e(blank) + '</option>' + p.parties.filter((x) => x.kind === 'person').sort((a, b) => a.name.localeCompare(b.name)).map((x) => '<option value="' + x.id + '"' + selected(cur, x.id) + '>' + e(NM.partyLabel(p, x.id)) + '</option>').join('');
  }
  function seriesSetup(s, p) {
    const d = ui.confirm === 'delete-series';
    const cos = NM.companiesOf(p);
    const hasMeetings = NM.meetingsOf(state, s.id).length > 0;
    const pickRow = (x) => '<label for="sa-' + x.id + '"><input id="sa-' + x.id + '" type="checkbox" data-bind="sat" data-id="' + x.id + '"' + (s.attendeeIds.includes(x.id) ? ' checked' : '') + dis() + '><span>' + e(NM.partyLabel(p, x.id)) + '</span></label>';
    const tpl = s.template.map((t, i) => '<div class="tpl"><div class="tpl-head"><div class="field"><label for="tn-' + t.id + '">Category ' + (i + 1) + '</label><input id="tn-' + t.id + '" type="text" value="' + e(t.name) + '" data-bind="tname" data-id="' + t.id + '"' + dis() + '></div>' +
      '<div class="btns"><button class="btn sm" data-act="tpl-up" data-id="' + t.id + '" aria-label="Move ' + e(t.name) + ' up"' + (i === 0 || RO() ? ' disabled' : '') + '>↑</button><button class="btn sm" data-act="tpl-down" data-id="' + t.id + '" aria-label="Move ' + e(t.name) + ' down"' + (i === s.template.length - 1 || RO() ? ' disabled' : '') + '>↓</button>' +
      '<button class="btn sm" data-act="tpl-remove" data-id="' + t.id + '"' + dis() + '>Remove</button></div></div>' +
      '<div class="row"><div class="field"><label for="td-' + t.id + '">Planned minutes (optional)</label><input id="td-' + t.id + '" type="number" min="0" max="720" step="5" inputmode="numeric" value="' + (t.dur || '') + '" data-bind="tdur" data-id="' + t.id + '"' + dis() + '></div><div class="field"><label for="tb-' + t.id + '">Break after, minutes (optional)</label><input id="tb-' + t.id + '" type="number" min="0" max="720" step="5" inputmode="numeric" value="' + (t.brk || '') + '" data-bind="tbrk" data-id="' + t.id + '"' + dis() + '></div></div>' +
      '<div class="field"><label for="tt-' + t.id + '">Standing topics (optional, one per line)</label><textarea id="tt-' + t.id + '" rows="2" placeholder="Discussed every meeting under this category" data-bind="ttopics" data-id="' + t.id + '"' + dis() + '>' + e(t.topics.join('\n')) + '</textarea></div></div>').join('');
    const sf = (key, label, type, val, extra) => '<div class="field"><label for="s-' + key + '">' + label + '</label><input id="s-' + key + '" type="' + type + '" value="' + e(val) + '" data-bind="sfield" data-field="' + key + '"' + (extra || '') + dis() + '></div>';
    return '<section class="panel"><h2>Series</h2><p class="hint">Defaults that every meeting in this series starts from. A single meeting can override any of them, and shows when it has.</p>' +
      '<div class="row">' + sf('name', 'Name', 'text', s.name) + sf('meetingType', 'Meeting type', 'text', s.meetingType, ' list="mtypes" placeholder="Owner-Architect-Contractor"') + sf('location', 'Usual location', 'text', s.location) + '</div>' +
      '<datalist id="mtypes">' + firm().meetingTypes.map((t) => '<option value="' + e(t) + '">').join('') + '</datalist>' +
      '<div class="row">' + sf('defaultTime', 'Usual start time', 'time', s.defaultTime) + sf('durationMin', 'Duration (minutes)', 'number', s.durationMin || '', ' min="0" step="5" inputmode="numeric"') +
      '<div class="field"><label for="s-cadence">Repeats</label><select id="s-cadence" data-bind="sfield" data-field="cadence"' + dis() + '>' + [['weekly', 'Weekly'], ['biweekly', 'Every two weeks'], ['monthly', 'Monthly'], ['none', 'No set schedule']].map((o) => '<option value="' + o[0] + '"' + selected(s.cadence, o[0]) + '>' + o[1] + '</option>').join('') + '</select></div></div>' +
      '<div class="row"><div class="field"><label for="s-preparedById">Prepared by (default)</label><select id="s-preparedById" data-bind="sfield" data-field="preparedById"' + dis() + '>' + peopleOptions(p, s.preparedById, 'Firm contact') + '</select></div>' +
      sf('startNumber', 'First meeting number', 'number', s.startNumber, ' min="1" step="1"' + (hasMeetings ? ' disabled' : '')) +
      '<label class="chk" for="s-carryOpen"><input id="s-carryOpen" type="checkbox" data-bind="sfield" data-field="carryOpen"' + (s.carryOpen ? ' checked' : '') + dis() + '> Carry open actions onto each new agenda</label></div></section>' +
      '<section class="panel"><h2>Standard sections</h2><p class="hint">Every new agenda starts with these categories in this order. Categories with no discussion items are left off the published minutes. Changing them does not change meetings that already exist.</p>' +
      tpl + '<form class="roster-row" data-form="addTplSection" style="grid-template-columns:minmax(0,1fr) auto"><input id="at-name" name="name" type="text" placeholder="New category, e.g. Fire protection" aria-label="New category name" autocomplete="off"' + dis() + '><button class="btn sm" type="submit"' + dis() + '>' + ic('plus') + 'Add category</button></form></section>' +
      '<section class="panel"><h2>Default roster</h2><p class="hint">New meetings start with this list, all marked “not yet recorded”. Record attendance during the meeting. ' + (p.parties.length ? '' : 'Add people under Contacts first.') + '</p>' +
      (p.parties.length ? '<div class="pick-list">' + (cos.length ? '<div class="grp">Companies</div>' + cos.map(pickRow).join('') : '') + '<div class="grp">People</div>' + p.parties.filter((x) => x.kind === 'person').sort((a, b) => a.name.localeCompare(b.name)).map(pickRow).join('') + '</div>' : '') + '</section>' +
      '<section class="panel"><h2>Delete series</h2>' + (d ? '<p>This removes ' + e(s.name) + ' with all of its meetings, action items and published minutes. A backup downloaded earlier can restore it.</p><div class="actions"><button class="btn danger" data-act="delete-series"' + dis() + '>Delete permanently</button><button class="btn ghost" data-act="close-panel">Keep it</button></div>' :
        '<div class="actions"><button class="btn danger" data-act="ask-delete-series"' + dis() + '>Delete this series</button></div>') + '</section>';
  }

  /* ---------- meeting (agenda and minutes) ---------- */
  function stage(m) {
    const idx = m.status === 'agenda' ? 0 : m.status === 'minutes' ? 1 : 2;
    const names = ['Agenda', m.revising ? 'Revising' : 'Minutes', 'Published'];
    return '<div class="stage" aria-label="Meeting stage">' + names.map((n, i) => '<span class="' + (i < idx ? 'done' : i === idx ? 'on' : '') + '"' + (i === idx ? ' aria-current="step"' : '') + '>' + n + '</span>').join('<i>\u203a</i>') + '</div>';
  }
  function partyOptions(p, exclude, blank) {
    const ex = new Set(exclude);
    let o = '<option value="">' + e(blank) + '</option>';
    const grp = (label, items) => (items.length ? '<optgroup label="' + e(label) + '">' + items.map((x) => '<option value="' + x.id + '">' + e(x.kind === 'company' ? x.name + ' (whole company)' : x.name) + '</option>').join('') + '</optgroup>' : '');
    for (const c of NM.companiesOf(p)) o += grp(c.name, [c].concat(NM.peopleOf(p, c.id)).filter((x) => !ex.has(x.id)));
    o += grp('People without a company', NM.peopleOf(p, '').filter((x) => !ex.has(x.id)));
    return o;
  }
  function quickForm(target, p) {
    return '<form class="quick" data-form="quickAdd" data-target="' + target + '"><div class="lbl">Add to the project directory</div><div class="row"><div class="field"><label for="qa-name">Name</label><input id="qa-name" name="name" type="text" required autocomplete="off" placeholder="Person or company"></div>' +
      '<div class="field"><label for="qa-kind">Type</label><select id="qa-kind" name="kind"><option value="company">Company</option><option value="person">Person</option></select></div>' +
      '<div class="field"><label for="qa-co">Company (for a person)</label><select id="qa-co" name="companyId"><option value="">No company</option>' + NM.companiesOf(p).map((c) => '<option value="' + c.id + '">' + e(c.name) + '</option>').join('') + '</select></div></div>' +
      '<div class="actions"><button class="btn primary sm" type="submit">Add and ' + (target === 'att' ? 'invite' : 'assign') + '</button><button class="btn ghost sm" type="button" data-act="quick-close">Cancel</button></div></form>';
  }
  function ovInner(m, key) {
    const from = key === 'next' ? NM.nextMeeting(state, m).from : key === 'roster' ? (NM.ovOf(state, m).roster ? 'meeting' : 'series') : NM.effective(state, m, key).from;
    if (from === 'meeting') return '<span class="ov">Changed for this meeting</span>' + (NM.canEditContent(m) && !RO() ? ' <button class="link" data-act="reset-ov" data-key="' + key + '">Use series default</button>' : '');
    return '<span class="inh">From series</span>';
  }
  const ovBadge = (m, key) => '<span class="badges" data-ovbadge="' + key + '">' + ovInner(m, key) + '</span>';
  const ATT_SHORT = { present: 'In', remote: 'Tele', absent: 'Out', unset: '–' };
  function attLegend() {
    return '<ul class="legend" aria-label="Attendance legend">' + NM.ATT_STATES.slice(1).concat(['unset']).map((k) => '<li><b class="sym s-' + k + '">' + ATT_SHORT[k] + '</b> ' + NM.ATT_LABEL[k] + (k === 'unset' ? ' (prints as an empty mark, not as absent)' : '') + '</li>').join('') + '</ul>';
  }
  function attendeeRow(m, x, p, canText) {
    const pt = NM.party(p, x.partyId);
    const nm = NM.partyName(p, x.partyId);
    const co = pt && pt.kind === 'person' && pt.companyId ? NM.partyName(p, pt.companyId) : '';
    const seg = NM.ATT_STATES.slice(1).concat(['unset']).map((k) => '<button type="button" class="s-' + k + '" data-act="att" data-id="' + x.partyId + '" data-state="' + k + '" aria-pressed="' + (x.state === k) + '" aria-label="' + e(nm) + ': ' + NM.ATT_LABEL[k] + '" title="' + NM.ATT_LABEL[k] + '"' + (canText ? '' : ' disabled') + '>' + ATT_SHORT[k] + '</button>').join('');
    return '<div class="att"><div class="who"><span>' + e(nm) + '</span>' + (co ? '<span>' + e(co) + '</span>' : '') + '</div><div class="seg" role="group" aria-label="Attendance for ' + e(nm) + '">' + seg + '</div>' +
      (canText ? '<button class="t-x rm" data-act="remove-attendee" data-id="' + x.partyId + '" aria-label="Remove ' + e(nm) + '" title="Remove from this meeting">×</button>' : '') + '</div>';
  }
  function attCounts(m) {
    const n = { present: 0, remote: 0, absent: 0, unset: 0 };
    m.attendees.forEach((a) => { n[a.state] = (n[a.state] || 0) + 1; });
    return n;
  }
  function railDetails(m, s, p, canText) {
    const f = firm(), d = canText ? '' : ' disabled';
    const tm = NM.effective(state, m, 'time').value, loc = NM.effective(state, m, 'location').value, ty = NM.effective(state, m, 'meetingType').value, pb = NM.effective(state, m, 'preparedBy').value;
    const nx = NM.nextMeeting(state, m);
    return '<div class="grp">' +
      '<div class="field"><label for="m-loc">Location ' + ovBadge(m, 'location') + '</label><input id="m-loc" type="text" value="' + e(loc) + '" placeholder="Zoom" data-bind="mf" data-field="location"' + d + '></div>' +
      '<div class="field"><label for="m-type">Meeting type ' + ovBadge(m, 'meetingType') + '</label><input id="m-type" type="text" list="mtypes" value="' + e(ty) + '" data-bind="mf" data-field="meetingType"' + d + '><datalist id="mtypes">' + f.meetingTypes.map((t) => '<option value="' + e(t) + '">').join('') + '</datalist></div>' +
      '<div class="field"><label for="m-prep">Prepared by ' + ovBadge(m, 'preparedBy') + '</label><select id="m-prep" data-bind="mf" data-field="preparedById"' + d + '>' + peopleOptions(p, pb, 'Firm contact') + '</select></div>' +
      '<div class="lbl" style="margin-top:4px">Next meeting ' + ovBadge(m, 'next') + '</div>' +
      '<div class="g2"><div class="field"><label for="n-date">Date</label><input id="n-date" type="date" value="' + e(nx.date) + '" data-bind="mnext" data-field="date"' + d + '></div>' +
      '<div class="field"><label for="n-time">Time</label><input id="n-time" type="time" value="' + e(nx.time) + '" data-bind="mnext" data-field="time"' + d + '></div></div>' +
      '<div class="field"><label for="n-loc">Location</label><input id="n-loc" type="text" value="' + e(nx.location) + '" data-bind="mnext" data-field="location"' + d + '></div>' +
      '<p class="hint">“From series” follows the series setup. Changing a value here affects only this meeting.</p></div>';
  }
  /* The rail stays beside the work: stage, the one primary action, what publishing will do, and the meeting details. No extra clicks to reach any of it. */
  function railHTML(m, s, p, c, rows, iss, nextRev, snaps) {
    const busy = env.pdfBusy ? ' disabled' : '';
    const minutes = c.minutes;
    let primary = '', facts = '', issues = '', second = [];
    if (m.status === 'agenda') {
      primary = '<button class="btn primary block" data-act="start-minutes"' + dis() + '>Start meeting</button><p class="hint">Starting keeps these same items and lets you record outcomes under each one.</p>';
      const n = m.sections.reduce((k, x) => k + x.topics.length, 0);
      facts = '<dl class="kv"><dt>Discussion items</dt><dd>' + n + '</dd><dt>Carried actions</dt><dd>' + m.carried.length + '</dd></dl>';
      second.push('<button class="btn sm" data-act="open-preview">Preview</button>', '<button class="btn sm" data-act="pdf-agenda"' + busy + '>' + ic('save') + 'Agenda PDF</button>', '<button class="btn sm" data-act="copy-agenda">' + ic('copy') + 'Copy</button>');
    } else if (minutes) {
      const bl = iss.items.filter((x) => x.level === 'blocker'), wr = iss.items.filter((x) => x.level === 'warning');
      const label = (m.revising ? 'Publish Rev ' + nextRev : 'Publish Rev 0');
      primary = '<button class="btn primary block" data-act="publish-quick"' + dis() + '>' + (bl.length ? 'Fix ' + bl.length + ' before publishing' : wr.length ? 'Review ' + wr.length + ' warning' + (wr.length === 1 ? '' : 's') + ' and publish' : label) + '</button>';
      const done = rows.carried.filter((r) => r.state === 'done').length, ext = rows.carried.filter((r) => r.state === 'extended').length, can = rows.carried.filter((r) => r.state === 'canceled').length;
      facts = '<dl class="kv"><dt>New action items</dt><dd>' + rows.created.length + '</dd>' + (rows.carried.length ? '<dt>Carried open</dt><dd>' + (rows.carried.length - done - can) + '</dd>' : '') + (done ? '<dt>Completed</dt><dd>' + done + '</dd>' : '') + (can ? '<dt>Canceled</dt><dd>' + can + '</dd>' : '') + (ext ? '<dt>Deadline extended</dt><dd>' + ext + '</dd>' : '') + '</dl>';
      const li = (x, cls) => '<div class="issue ' + cls + '"><span>' + e(x.msg) + (x.target ? ' <button class="link" data-act="goto" data-kind="' + x.target.kind + '" data-id="' + e(x.target.id || '') + '">Go to</button>' : '') + '</span></div>';
      issues = bl.slice(0, 4).map((x) => li(x, 'bad')).join('') + wr.slice(0, 3).map((x) => li(x, '')).join('') + (bl.length + wr.length > 7 ? '<div class="hint">and more in the review.</div>' : '');
      second.push('<button class="btn sm" data-act="open-preview">Preview</button>', '<button class="btn sm" data-act="pdf-draft"' + busy + '>' + ic('save') + 'PDF</button>');
      if (!m.revising) second.push('<button class="btn sm" data-act="back-agenda"' + dis() + '>Back to agenda</button>');
    }
    if (m.revising) second.push('<button class="btn sm" data-act="cancel-revision"' + dis() + '>' + ic('undo') + 'Cancel revision</button>');
    if (!m.revising && !snaps.length) second.push('<button class="btn ghost sm" data-act="ask-delete-meeting"' + dis() + '>Delete</button>');
    const keys = c.canText ? '<details class="keys"><summary>Keyboard shortcuts</summary><ul><li><kbd>Enter</kbd> finishes editing an item</li><li><kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> moves an item</li>' + (minutes ? '<li><kbd>Alt</kbd>+<kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> adds a decision, assignment or information</li>' : '') + '<li><kbd>Ctrl</kbd>+<kbd>Enter</kbd> jumps to “add a discussion item”</li><li><kbd>Esc</kbd> closes a panel</li></ul></details>' : '';
    return '<aside class="rail" aria-label="Meeting summary and actions">' + stage(m) + primary + facts + (issues ? '<div class="stack">' + issues + '</div>' : '') + '<div class="btnrow">' + second.join('') + '</div><div class="sep"></div>' +
      '<div><button class="att-toggle" style="display:flex;width:100%;justify-content:space-between;align-items:center;font:700 11px/1.2 var(--f-cond);letter-spacing:.14em;text-transform:uppercase" data-act="toggle-details" aria-expanded="' + ui.details + '"><span>Meeting details</span>' + ic('chev') + '</button>' + (ui.details ? railDetails(m, s, p, c.canText) : '') + '</div>' + (keys ? '<div class="sep"></div>' + keys : '') + '</aside>';
  }
  function viewMeeting() {
    const m = state.meetings[ui.meetingId], s = state.series[m.seriesId], p = proj();
    const snaps = NM.snapshotsOf(state, m.id);
    const canText = NM.canEditContent(m) && !RO();
    const minutes = m.status === 'minutes';
    const latest = NM.isLatest(state, m);
    const ol = NM.outline(m);
    const rows = NM.actionRows(state, m);
    const nextRev = snaps.length;
    const attNo = {}; NM.listAtts(m).forEach((x) => { attNo[x.att.id] = x.no; });
    const rowBy = {}; rows.carried.forEach((r) => { rowBy[r.a.id] = r; });
    const ctx = { m, s, p, canText, minutes, latest, attNo, rowBy, sched: NM.schedule(state, m) };
    const busy = env.pdfBusy ? ' disabled' : '';
    const iss = minutes ? NM.publishIssues(state, m) : null;
    const sched = NM.schedule(state, m);
    const dd = canText ? '' : ' disabled';
    const when = '<div class="when"><label class="chk"><input type="checkbox" data-bind="timed"' + (m.timed ? ' checked' : '') + dd + '> Include durations</label><input id="m-date" type="date" aria-label="Meeting date" value="' + e(m.date) + '" data-bind="mf" data-field="date"' + dd + '><input id="m-time" type="time" aria-label="Meeting start time" value="' + e(NM.effective(state, m, 'time').value) + '" data-bind="mf" data-field="time"' + dd + '>' + ovBadge(m, 'time') + schedSummary(m, sched) + '</div>';
    const top = '<div class="ptitle"><h1 class="h-page">Meeting ' + m.number + '</h1><span class="eyebrow">' + e(p.name) + ' · ' + e(s.name) + '</span>' + when +
      (m.revising ? '<div class="revbox"><span class="lbl">Revising to</span><span class="num">Rev ' + nextRev + '</span></div>' : '') + '</div>';

    let banners = '';
    if (m.revising) banners += '<div class="banner"><span><b>Revising Meeting ' + m.number + '.</b> ' + e(m.revNote) + ' Rev ' + (nextRev - 1) + ' stays available until you publish.</span>' + (!latest ? '<span>' + ic('lock') + ' Later meetings exist, so assignments and action updates are locked. Decisions, information, topics and attendance can change.</span>' : '') + '</div>';
    if (ui.confirm === 'delete-meeting') banners += '<div class="banner"><span><b>Delete Meeting ' + m.number + '?</b> Its agenda and anything typed into it are removed.</span><div class="actions"><button class="btn danger sm" data-act="delete-meeting">Delete meeting</button><button class="btn sm" data-act="close-panel">Keep it</button></div></div>';
    if (ui.panel === 'copy') banners += '<div class="panel"><h2>Copy the text</h2><p class="hint">Your browser would not copy automatically. Select all and copy.</p><textarea id="copybox" class="copybox" readonly>' + e(ui.copyText) + '</textarea><div class="actions"><button class="btn ghost" data-act="close-panel">Done</button></div></div>';
    if (ui.panel === 'preview') banners += '<section class="panel preview"><div class="sec-head"><h2 class="h-sec">Preview</h2><div class="actions"><button class="btn sm" data-act="refresh-preview">Refresh</button><button class="btn sm" data-act="' + (m.status === 'agenda' ? 'pdf-agenda' : 'pdf-draft') + '"' + busy + '>' + ic('save') + 'PDF</button><button class="btn ghost sm" data-act="close-panel">Close preview</button></div></div><p class="hint" id="pv-note">Drawn by the same layout code as the PDF, so line and page breaks match. A PDF viewer smooths letters slightly differently. Nothing is published or locked.</p><div id="pv-pages" class="pv-pages" aria-live="polite"><p class="hint">Building preview…</p></div></section>';
    const publish = ui.panel === 'publish' ? publishPanel(m, rows, nextRev) : '';

    const n = attCounts(m);
    const attAvail = partyOptions(p, m.attendees.map((x) => x.partyId), '+ Add someone from the project…');
    const summ = m.attendees.length ? [n.present + ' in', n.remote ? n.remote + ' tele' : '', n.absent ? n.absent + ' out' : '', n.unset ? n.unset + ' not yet recorded' : ''].filter(Boolean).join(' · ') : 'No one invited';
    const att = '<section class="att-box" id="att-sec"><div class="att-top"><button class="att-toggle" data-act="toggle-att" aria-expanded="' + ui.attOpen + '" aria-label="Show or hide attendance">' + ic('chev') + '</button><h2>Attendance</h2><span class="att-sum">' + e(summ) + '</span><span class="spacer"></span>' +
      (ui.attOpen && canText && m.attendees.length ? '<button class="btn sm" data-act="all-present-unset">Remaining in attendance</button><button class="btn sm" data-act="all-present">Everyone in attendance</button>' : '') + '</div>' +
      (ui.attOpen ? attLegend() + '<div class="att-list">' + (m.attendees.length ? m.attendees.map((x) => attendeeRow(m, x, p, canText)).join('') : '<p class="hint" style="padding:6px 0">No attendees yet. Add people below, or set the default roster under the series setup.</p>') + '</div>' +
        (canText ? '<div class="addbar"><select id="att-add" data-bind="attadd" aria-label="Add an attendee">' + attAvail + '</select><button class="btn ghost sm" data-act="quick-open" data-id="att">+ New person or company</button>' +
          '<label class="chk" for="att-toseries"><input id="att-toseries" type="checkbox"> Also add to default roster</label></div>' + (ui.quick === 'att' ? quickForm('att', p) : '') : '') : '') + '</section>';

    const noTopics = !m.sections.some((x) => x.topics.length);
    const body = ol.map((x) => sectionHTML(x, ctx)).join('');
    const addSec = canText ? '<form class="roster-row" data-form="addSection"><input id="as-name" name="name" type="text" placeholder="Add a category to this meeting only" aria-label="New category" autocomplete="off"><button class="btn sm" type="submit">' + ic('plus') + 'Add category</button></form>' : '';
    const work = '<div class="work">' + top + banners + publish + att + (noTopics && m.status !== 'agenda' ? '<p class="hint">No discussion items yet. Add them under a category below.</p>' : '') + body + addSec + actionsSection(m, rows, ctx) + '</div>';
    return '<div class="mlayout">' + work + railHTML(m, s, p, ctx, rows, iss, nextRev, snaps) + '</div>';
  }
  /* Typing does not re-render the page (that would drop focus), so the rail is refreshed on its own: publish readiness stays current. */
  let railT = 0;
  function railSoon() {
    clearTimeout(railT);
    railT = setTimeout(() => {
      const el = root.querySelector('aside.rail'); const m = state.meetings[ui.meetingId];
      if (!el || ui.view !== 'meeting' || !m || el.contains(document.activeElement)) return;
      const s = state.series[m.seriesId], p = proj();
      const snaps = NM.snapshotsOf(state, m.id);
      const c = { canText: NM.canEditContent(m) && !RO(), minutes: m.status === 'minutes' };
      el.outerHTML = railHTML(m, s, p, c, NM.actionRows(state, m), c.minutes ? NM.publishIssues(state, m) : null, snaps.length, snaps);
    }, 350);
  }
  function sectionHTML(x, c) {
    const sec = x.sec, col = !!ui.collapsed[sec.id];
    const rm = c.canText && !sec.topics.length ? '<button class="link rm" data-act="remove-section" data-id="' + sec.id + '">Remove category</button>' : '';
    const topics = col ? '' : x.topics.map((t) => topicHTML(t, c)).join('');
    const add = c.canText && !col ? '<form class="addtopic" data-form="addTopic" data-id="' + sec.id + '"><input id="nt-' + sec.id + '" name="text" type="text" placeholder="Add a discussion item, then press Enter" aria-label="Add a discussion item to ' + e(sec.name) + '" autocomplete="off"><button class="btn sm" type="submit">' + ic('plus') + 'Add</button></form>' : '';
    const mv = c.canText ? '<span class="sec-mv"><button class="t-mv" data-act="sec-up" data-id="' + sec.id + '" aria-label="Move ' + e(sec.name) + ' up">↑</button><button class="t-mv" data-act="sec-down" data-id="' + sec.id + '" aria-label="Move ' + e(sec.name) + ' down">↓</button></span>' : '';
    const sr = (c.sched.rows.find((r) => r.id === sec.id)) || { dur: 0, brk: 0 };
    const T_ON = !!c.m.timed;
    const stime = !T_ON ? '' : '<span class="stime" data-sched="' + sec.id + '">' + (sr.start ? e(rng(sr.start, sr.end)) : '') + '</span>';
    const dur = !T_ON ? '' : c.canText ? '<label class="dur"><input id="sd-' + sec.id + '" type="number" min="0" max="720" step="5" inputmode="numeric" placeholder="–" value="' + (sec.dur || '') + '" data-bind="sdur" data-id="' + sec.id + '" aria-label="Minutes planned for ' + e(sec.name) + '"> min</label>' : (sec.dur ? '<span class="dur">' + sec.dur + ' min</span>' : '');
    const last = c.m.sections[c.m.sections.length - 1] === sec;
    const brk = last || !T_ON ? '' : sec.brk ? '<div class="brk"><span class="brk-l">Break</span>' + (c.canText ? '<input id="sb-' + sec.id + '" type="number" min="0" max="720" step="5" inputmode="numeric" value="' + sec.brk + '" data-bind="sbrk" data-id="' + sec.id + '" aria-label="Break length after ' + e(sec.name) + '"> min' : sec.brk + ' min') + '<span class="stime" data-brktime="' + sec.id + '">' + (sr.brkStart ? e(rng(sr.brkStart, sr.brkEnd)) : '') + '</span>' + (c.canText ? '<button class="t-x" data-act="del-break" data-id="' + sec.id + '" aria-label="Remove the break after ' + e(sec.name) + '">×</button>' : '') + '</div>' :
      (c.canText ? '<div class="brk add"><button class="link" data-act="add-break" data-id="' + sec.id + '">+ Break after ' + e(sec.name) + '</button></div>' : '');
    return '<section class="sec" id="sec-' + sec.id + '"><h3><button class="col" data-act="toggle-sec" data-id="' + sec.id + '" aria-expanded="' + !col + '" aria-label="' + (col ? 'Expand ' : 'Collapse ') + e(sec.name) + '">' + ic('chev') + '</button><span class="sn' + (x.no ? '' : ' none') + '">' + (x.no || '–') + '</span><span class="sname">' + e(sec.name) + '</span>' + stime + (col ? '<span class="muted">' + sec.topics.length + ' item' + (sec.topics.length === 1 ? '' : 's') + '</span>' : '') + mv + dur + rm + '</h3>' + topics + add + '</section>' + brk;
  }
  const imgSrc = (id) => { const r = state.images[id]; return r && !r.deleted ? r.data : ''; };
  const LAYOUT_LABEL = { half: 'Half width', full: 'Full width', page: 'Own page at the end' };
  const imgBtn = (kind, id, label) => '<label class="t-img" for="af-' + id + '" title="Add an image (or paste or drop one here)" aria-label="Add an image to ' + e(label) + '">' + ic('clip') + '</label><input id="af-' + id + '" type="file" accept="image/*" multiple hidden data-bind="afile" data-kind="' + kind + '" data-id="' + id + '">';
  function attsHTML(kind, id, list, c) {
    const rows = list.map((a) => {
      const no = c.attNo[a.id], src = imgSrc(a.imageId);
      return '<div class="attrow"><div class="thumb">' + (src ? '<img src="' + e(src) + '" alt="Attachment ' + no + ' preview">' : '<span class="fig-miss">Image still syncing</span>') + '</div>' +
        '<div class="ar-body"><div class="ar-top"><b>Att. ' + no + '</b>' +
        '<select aria-label="Layout for Att. ' + no + '" data-bind="alay" data-id="' + a.id + '"' + (c.canText ? '' : ' disabled') + '>' + NM.LAYOUTS.map((l) => '<option value="' + l + '"' + selected(a.layout, l) + '>' + LAYOUT_LABEL[l] + '</option>').join('') + '</select>' +
        (c.canText ? '<button class="btn ghost sm" data-act="del-att" data-id="' + a.id + '" aria-label="Remove Att. ' + no + '">Remove</button>' : '') + '</div>' +
        '<input id="ac-' + a.id + '" type="text" value="' + e(a.caption) + '" placeholder="Caption (shown under the image)" aria-label="Caption for Att. ' + no + '" data-bind="acap" data-id="' + a.id + '"' + (c.canText ? '' : ' disabled') + '></div></div>';
    }).join('');
    return rows ? '<div class="atts">' + rows + '</div>' : '';
  }
  function topicHTML(t, c) {
    const tp = t.t;
    const confirming = ui.confirm === 'topic:' + tp.id;
    let outs = '';
    if (c.minutes) {
      const list = t.outcomes.map((y) => outcomeHTML(y, c)).join('');
      const add = c.canText ? '<div class="addout" role="group" aria-label="Add an outcome to ' + e(tp.text) + '"><button class="btn sm" data-act="add-outcome" data-id="' + tp.id + '" data-type="decision" title="Alt+1">' + ic('plus') + 'Decision</button><button class="btn sm" data-act="add-outcome" data-id="' + tp.id + '" data-type="assignment" title="Alt+2"' + (c.latest ? '' : ' disabled title="Locked: later meetings exist"') + '>' + ic('plus') + 'Assignment</button><button class="btn sm" data-act="add-outcome" data-id="' + tp.id + '" data-type="info" title="Alt+3">' + ic('plus') + 'Information</button></div>' : '';
      outs = '<div class="outs">' + list + add + '</div>';
    }
    const carriedBlock = t.carried.length ? '<div class="outs carried-outs">' + t.carried.map((x) => (c.rowBy[x.id] ? carriedHTML(c.rowBy[x.id], c) : '')).join('') + '</div>' : '';
    const conf = confirming ? '<div class="outs"><div class="banner"><span><b>Remove this topic?</b> Its ' + tp.outcomes.length + ' outcome' + (tp.outcomes.length === 1 ? '' : 's') + ' will be removed too.</span><div class="actions"><button class="btn danger sm" data-act="confirm-del-topic" data-id="' + tp.id + '">Remove</button><button class="btn sm" data-act="close-panel">Keep it</button></div></div></div>' : '';
    const ctl = c.canText ? '<span class="t-btns">' + imgBtn('topic', tp.id, 'item ' + R(t.no)) + '<button class="t-mv" data-act="topic-up" data-id="' + tp.id + '" aria-label="Move item ' + e(R(t.no)) + ' up" title="Alt+↑">↑</button><button class="t-mv" data-act="topic-down" data-id="' + tp.id + '" aria-label="Move item ' + e(R(t.no)) + ' down" title="Alt+↓">↓</button>' +
      (!(tp.carry || []).length ? '<button class="t-x" data-act="del-topic" data-id="' + tp.id + '" aria-label="Remove discussion item ' + e(R(t.no)) + '">×</button>' : '') + '</span>' : '<span></span>';
    return '<div class="topic" id="topic-' + tp.id + '" data-attach="topic:' + tp.id + '"><div class="t-no">' + e(R(t.no)) + '</div><textarea id="tt-' + tp.id + '" class="t-input" rows="1" aria-label="Discussion item ' + e(R(t.no)) + '" data-bind="topic" data-id="' + tp.id + '"' + (c.canText ? '' : ' disabled') + '>' + e(tp.text) + '</textarea>' +
      ctl + conf + '<div class="t-atts">' + attsHTML('topic', tp.id, tp.atts || [], c) + '</div>' + carriedBlock + outs + '</div>';
  }
  function outcomeHTML(y, c) {
    const o = y.o, isA = o.type === 'assignment';
    const can = c.canText && c.minutes && (!isA || c.latest);
    const d = can ? '' : ' disabled';
    const ph = { decision: 'What was decided', assignment: 'What needs to be done', info: 'What was said or learned' }[o.type];
    let assign = '';
    if (isA) {
      const need = [];
      if (!o.assigneeIds.length) need.push('a responsible party');
      if (!o.due) need.push('a due date');
      assign = '<div class="assign"><span class="lbl">Responsible</span><div class="pchips">' + o.assigneeIds.map((id) => '<span class="pchip">' + e(NM.partyLabel(c.p, id)) + (can ? '<button data-act="unassign" data-id="' + o.id + '" data-pid="' + id + '" aria-label="Remove ' + e(NM.partyName(c.p, id)) + '">×</button>' : '') + '</span>').join('') + '</div>' +
        (can ? '<div class="pickrow"><select id="pk-' + o.id + '" aria-label="Add responsible party" data-bind="assign" data-id="' + o.id + '">' + partyOptions(c.p, o.assigneeIds, o.assigneeIds.length ? '+ Add another…' : 'Choose from the project…') + '</select><button class="btn ghost sm" data-act="quick-open" data-id="' + o.id + '">+ New</button></div>' : '') +
        '<div class="field due"><label for="od-' + o.id + '">Due</label><input id="od-' + o.id + '" type="date" value="' + e(o.due) + '" data-bind="odue" data-id="' + o.id + '"' + d + '></div>' +
        (need.length && can ? '<span class="need">Needs ' + need.join(' and ') + ' before you can publish.</span>' : '') +
        (ui.quick === o.id ? quickForm(o.id, c.p) : '') + '</div>';
    }
    return '<div class="out o-' + o.type + '" id="out-' + o.id + '" data-attach="outcome:' + o.id + '"><div class="out-top"><span class="ol">' + e(R(y.ref)) + '</span><select aria-label="Outcome type" data-bind="otype" data-id="' + o.id + '"' + (c.canText && c.minutes ? '' : ' disabled') + '>' +
      NM.OUTCOME_TYPES.map((t) => '<option value="' + t + '"' + selected(o.type, t) + (t === 'assignment' && !c.latest && !isA ? ' disabled' : '') + '>' + NM.TYPE_LABEL[t] + '</option>').join('') + '</select>' +
      '<textarea id="ot-' + o.id + '" rows="1" placeholder="' + ph + '" aria-label="' + NM.TYPE_LABEL[o.type] + ' ' + e(R(y.ref)) + '" data-bind="otext" data-id="' + o.id + '"' + d + '>' + e(o.text) + '</textarea>' +
      '<span class="out-tools">' + (can ? imgBtn('outcome', o.id, NM.TYPE_LABEL[o.type] + ' ' + R(y.ref)) + '<button class="t-x" data-act="del-outcome" data-id="' + o.id + '" aria-label="Remove ' + NM.TYPE_LABEL[o.type] + ' ' + e(R(y.ref)) + '">×</button>' : '') + '</span></div>' + assign + attsHTML('outcome', o.id, o.atts || [], c) + '</div>';
  }
  const STATUS_SEG = [['open', 'Open'], ['progress', 'Doing'], ['done', 'Done'], ['canceled', 'Cancel']];
  function carriedHTML(r, c) {
    const a = r.a, u = r.u, minutes = c.minutes && c.canText;
    const chips = ['<span class="chip">#' + (a.seq || '–') + '</span>'];
    if (r.state === 'done') chips.push('<span class="chip ok">' + ic('check') + 'Completed</span>');
    else if (r.state === 'canceled') chips.push(chip('Canceled', 'old'));
    else if (r.state === 'progress') chips.push(chip('In progress', 'new'));
    else if (r.state === 'extended') chips.push(chip('Extended', 'old'));
    else if (r.overdue) chips.push(chip('Overdue', 'bad'));
    if (r.pushes && r.state !== 'extended') chips.push(chip('Moved ' + r.pushes + '×', 'old'));
    if (r.state === 'extended' && r.pushes > 1) chips.push(chip('Moved ' + r.pushes + '×', 'old'));
    const prior = a.pushes.filter((x) => x.number < c.m.number);
    const last = NM.lastUpdate(state, a, c.m);
    const dueTxt = r.state === 'extended' ? 'Due ' + NM.fmtShort(r.due) + ' (was ' + NM.fmtShort(r.before) + ')' : 'Due ' + NM.fmtShort(r.due);
    let ctl = '';
    if (minutes) {
      const lock = c.latest ? '' : ' disabled';
      const showEx = r.state === 'extended' || ui.extend === a.id || u.extendNote;
      // One click sets the status (it used to take two: open the list, pick an option).
      const seg = '<div class="seg" role="group" aria-label="Status of ' + e(R(r.ref)) + '">' + STATUS_SEG.map((o) => '<button type="button" id="us-' + a.id + '-' + o[0] + '" class="k-' + o[0] + '" data-act="ustat" data-id="' + a.id + '" data-v="' + o[0] + '" aria-pressed="' + (r.state === o[0]) + '"' + lock + '>' + o[1] + '</button>').join('') + '</div>';
      ctl = '<div class="act-ctl">' + seg + '<textarea id="un-' + a.id + '" rows="1" aria-label="Update on ' + e(R(r.ref)) + '" placeholder="Update since the last meeting" data-bind="unote" data-id="' + a.id + '">' + e(u.note) + '</textarea>' +
        (r.state === 'done' ? '<div class="field on"><label for="ud-' + a.id + '">Completed</label><input id="ud-' + a.id + '" type="date" value="' + e(u.doneOn || c.m.date) + '" data-bind="udoneon" data-id="' + a.id + '"' + lock + '></div>' : '') +
        (r.state === 'open' || r.state === 'progress' ? '<button class="link" data-act="open-extend" data-id="' + a.id + '"' + lock + '>Extend deadline…</button>' : '') + '</div>' +
        (r.state === 'canceled' && !u.note.trim() ? '<div class="need">Add an update saying why it was canceled before you publish.</div>' : '') +
        (showEx && r.state !== 'done' && r.state !== 'canceled' ? '<div class="extend"><div class="field"><label for="ex-d-' + a.id + '">New due date</label><input id="ex-d-' + a.id + '" type="date" value="' + e(u.extendTo) + '" data-bind="uextend" data-id="' + a.id + '"' + lock + '></div>' +
          '<div class="field"><label for="ex-n-' + a.id + '">Why is it moving? (required)</label><textarea id="ex-n-' + a.id + '" rows="1" data-bind="uextnote" data-id="' + a.id + '"' + lock + '>' + e(u.extendNote) + '</textarea></div>' +
          '<div><button class="link" data-act="cancel-extend" data-id="' + a.id + '"' + lock + '>Cancel extension</button></div></div>' : '');
    } else if (c.m.status !== 'agenda' || u.note) {
      ctl = (u.note ? '<p class="it-prev"><b>Update this meeting</b>' + e(u.note) + '</p>' : '') + (r.state === 'extended' && u.extendNote ? '<p class="it-prev"><b>Why it moved</b>' + e(u.extendNote) + '</p>' : '');
    }
    return '<div class="act' + (r.state === 'done' || r.state === 'canceled' ? ' is-done' : '') + '" id="act-' + a.id + '"><div class="act-ref">' + e(R(r.ref)) + (r.refMeeting ? '<small>from M' + r.refMeeting + ' · ' + e(R(r.origRef)) + '</small>' : '') + '</div><div class="act-body"><div class="act-title">' + e(r.text) + '</div>' +
      '<div class="act-meta"><span>' + e(who(c.p, r.assigneeIds) || 'No one assigned') + '</span><span' + (r.overdue ? ' class="bad"' : '') + '>' + e(dueTxt) + '</span>' + chips.join('') + '</div>' +
      (prior.length ? '<div class="pushlog">' + prior.map((x) => '<span><b>M' + x.number + '</b> moved ' + e(NM.fmtShort(x.from)) + ' → ' + e(NM.fmtShort(x.to)) + (x.note ? ': ' + e(x.note) : '') + '</span>').join('') + '</div>' : '') +
      (last ? '<p class="it-prev"><b>Meeting ' + last.number + ' · ' + e(NM.fmtShort(last.date)) + '</b>' + e(last.note) + '</p>' : '') + ctl + '</div></div>';
  }
  function actionsSection(m, rows, c) {
    const stateChip = { new: chip('New', 'new'), open: chip('Open', ''), progress: chip('In progress', 'new'), done: '<span class="chip ok">' + ic('check') + 'Completed</span>', canceled: chip('Canceled', 'old'), extended: chip('Extended', 'old') };
    const list = rows.all.map((r) => {
      const miss = [];
      if (r.kind === 'new') { if (!r.assigneeIds.length) miss.push('responsible party'); if (!r.due) miss.push('due date'); }
      return '<div class="act sum' + (r.state === 'done' || r.state === 'canceled' ? ' is-done' : '') + '"><div class="act-ref">' + e(R(r.ref)) + (r.kind === 'carried' && r.refMeeting ? '<small>from M' + r.refMeeting + ' · ' + e(R(r.origRef)) + '</small>' : '') + '</div><div class="act-body"><div class="act-title">' + (r.text.trim() ? e(r.text) : '<span class="muted">No description yet</span>') + '</div>' +
        '<div class="act-meta"><span>' + e(who(c.p, r.assigneeIds) || 'No one assigned') + '</span><span' + (r.overdue ? ' class="bad"' : '') + '>' + (r.due ? 'Due ' + e(NM.fmtShort(r.due)) : 'No due date') + '</span>' + stateChip[r.state] + (r.overdue ? chip('Overdue', 'bad') : '') + (miss.length ? chip('Needs ' + miss.join(' + '), 'bad') : '') + '</div></div></div>';
    }).join('');
    return '<div class="sec-head"><h2 class="h-sec">Action items<span class="n">' + rows.all.length + ' in this meeting, numbered as above</span></h2></div>' + (list || '<p class="hint">No open action items.</p>');
  }
  function publishPanel(m, rows, rev) {
    const iss = NM.publishIssues(state, m);
    const bl = iss.items.filter((x) => x.level === 'blocker'), wr = iss.items.filter((x) => x.level === 'warning');
    const done = rows.carried.filter((r) => r.state === 'done').length, ext = rows.carried.filter((r) => r.state === 'extended').length, can = rows.carried.filter((r) => r.state === 'canceled').length;
    const li = (x) => '<li>' + e(x.msg) + (x.target ? ' <button class="link" data-act="goto" data-kind="' + x.target.kind + '" data-id="' + e(x.target.id || '') + '">Go to</button>' : '') + '</li>';
    return '<section class="panel" id="publish-panel"><h2>' + (m.revising ? 'Publish Rev ' + rev : 'Publish minutes') + '</h2><p>' + (m.revising ? 'This adds Rev ' + rev + ' to the revision table. Earlier revisions are kept as issued.' : 'This locks Meeting ' + m.number + ' as Rev 0. The firm, project and contact details are frozen into the issued copy.') +
      ' <b>' + rows.created.length + '</b> new action item' + (rows.created.length === 1 ? '' : 's') + ' will be created' + (done ? ', <b>' + done + '</b> completed' : '') + (can ? ', <b>' + can + '</b> canceled' : '') + (ext ? ', <b>' + ext + '</b> deadline' + (ext === 1 ? '' : 's') + ' extended' : '') + '. Everything else stays open for the next agenda.</p>' +
      (bl.length ? '<div class="banner"><b>Must be fixed before publishing</b><ul class="issues bad">' + bl.map(li).join('') + '</ul></div>' : '') +
      (wr.length ? '<div class="banner info"><b>Worth a look (does not stop publishing)</b><ul class="issues">' + wr.map(li).join('') + '</ul></div>' : '') +
      (!bl.length && !wr.length ? '<p class="hint">No problems found.</p>' : '') +
      '<div class="actions"><button class="btn primary" data-act="confirm-publish"' + (bl.length ? ' disabled' : '') + '>' + (m.revising ? 'Publish Rev ' + rev : 'Publish Rev 0') + (wr.length && !bl.length ? ' with ' + wr.length + ' warning' + (wr.length === 1 ? '' : 's') : '') + '</button><button class="btn" data-act="open-preview">Preview</button><button class="btn ghost" data-act="close-panel">Keep editing</button></div></section>';
  }
  /* ---------- published sheet ---------- */
  function viewSheet() {
    const m = state.meetings[ui.meetingId], s = state.series[m.seriesId];
    const snaps = NM.snapshotsOf(state, m.id);
    if (!snaps.length) { ui.view = 'meeting'; return viewMeeting(); }
    const lastRev = snaps[snaps.length - 1].rev;
    const rev = snaps.some((x) => x.rev === ui.rev) ? ui.rev : lastRev;
    const snap = snaps.find((x) => x.rev === rev);
    const other = NM.revisingOf(state, s.id);
    const canRevise = m.status === 'published' && rev === lastRev && !RO() && !other;
    let o = '<div class="sheet-wrap"><div class="ptitle"><h1 class="h-page">Meeting ' + m.number + ' minutes</h1><span class="eyebrow">' + e(s.name) + '</span></div>';
    if (m.revising) o += '<div class="banner"><span><b>Revision in progress.</b> This is Rev ' + lastRev + ', the last published version. Changes appear here when you publish Rev ' + (lastRev + 1) + '.</span><div class="actions"><button class="btn sm" data-act="open-meeting-edit" data-id="' + m.id + '">Continue revision</button></div></div>';
    if (rev !== lastRev) o += '<div class="banner info"><span>You are looking at Rev ' + rev + '. Rev ' + lastRev + ' is the current issue.</span></div>';
    if (snaps.length > 1) o += '<div class="revpick" role="group" aria-label="Revision">' + snaps.map((x) => '<button data-act="sheet-rev" data-id="' + x.rev + '" aria-pressed="' + (x.rev === rev) + '">Rev ' + x.rev + ' · ' + e(new Date(x.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) + '</button>').join('') + '</div>';
    o += '<div class="actions"><button class="btn" data-act="copy-text">' + ic('copy') + 'Copy as text</button>' +
      (env.downloads ? '<button class="btn" data-act="save-pdf"' + (env.pdfBusy ? ' disabled' : '') + '>' + ic('save') + (env.pdfBusy ? 'Building PDF…' : 'Save as PDF') + '</button><button class="btn" data-act="save-html">' + ic('save') + 'Save as web page</button><button class="btn" data-act="save-text">' + ic('save') + 'Save as text</button>' : '') +
      (canRevise ? '<button class="btn" data-act="ask-revise">Revise</button>' : '') + '</div>';
    if (other && other.id !== m.id && m.status === 'published') o += '<p class="hint">Meeting ' + other.number + ' is being revised. Finish that before revising this one.</p>';
    if (ui.panel === 'revise') o += '<form class="panel" data-form="revise"><h2>Revise Meeting ' + m.number + '</h2><p>This reopens the minutes for edits. Rev ' + lastRev + ' stays as issued, and your changes become Rev ' + (lastRev + 1) + ' when you publish.</p><div class="field"><label for="rv-reason">What is being corrected?</label><textarea id="rv-reason" name="reason" rows="3" required placeholder="Corrected the due date on 3.1.B"></textarea></div><div class="actions"><button class="btn primary" type="submit">Start revision</button><button class="btn ghost" type="button" data-act="close-panel">Cancel</button></div></form>';
    if (ui.panel === 'copy') o += '<div class="panel"><h2>Copy the text</h2><p class="hint">Your browser would not copy automatically. Select all and copy.</p><textarea id="copybox" class="copybox" readonly>' + e(ui.copyText) + '</textarea><div class="actions"><button class="btn ghost" data-act="close-panel">Done</button></div></div>';
    o += NM.snapshotToHtml(snap, snaps, imgSrc) + '</div>';
    return o;
  }

  /* ---------- render ---------- */
  function render(focusId) {
    const a = document.activeElement;
    const keep = a && a.id && root.contains(a) ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
    const pg0 = pageEl();
    const y = pg0 ? pg0.scrollTop : 0;
    let inner = '';
    if (!booted) inner = '<p class="hint">Loading your minutes…</p>';
    else {
      const p = state.projects[ui.projectId], s = state.series[ui.seriesId], m = state.meetings[ui.meetingId];
      if (ui.view !== 'home' && ui.view !== 'firm' && !alive(p)) ui.view = 'home';
      if ((ui.view === 'series' || ui.view === 'meeting' || ui.view === 'sheet') && !alive(s)) ui.view = alive(p) ? 'project' : 'home';
      if ((ui.view === 'meeting' || ui.view === 'sheet') && !alive(m)) ui.view = alive(s) ? 'series' : ui.view;
      if (ui.view === 'meeting' && m && m.status === 'published' && !m.revising && NM.snapshotsOf(state, m.id).length) ui.view = 'sheet';
      inner = ui.view === 'home' ? viewHome() : ui.view === 'firm' ? viewFirm() : ui.view === 'project' ? viewProject() : ui.view === 'series' ? viewSeries() : ui.view === 'meeting' ? viewMeeting() : viewSheet();
    }
    root.innerHTML = shell(inner);
    if (ui.panel === 'preview' && pvNodes) { const h = document.getElementById('pv-pages'); if (h) { h.textContent = ''; pvNodes.forEach((n) => h.appendChild(n)); } }
    scrollTop(y);
    const target = focusId || (keep && keep.id);
    if (target) {
      const el = document.getElementById(target);
      if (el) { try { el.focus({ preventScroll: true }); if (!focusId && keep && keep.s != null && el.setSelectionRange) el.setSelectionRange(keep.s, keep.e); } catch (_) {} }
    }
  }

  /* ---------- events ---------- */
  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-act]');
    if (!t || !root.contains(t)) return;
    const id = t.dataset.id, mid = ui.meetingId, sid = ui.seriesId, pid = ui.projectId;
    switch (t.dataset.act) {
      case 'open-firm': if (isAdmin()) go({ view: 'firm' }); break;
      case 'remove-office': run(() => NM.removeOffice(state, id)); break;
      case 'resolve': { const [cc, ii] = String(t.dataset.key).split('/'); run(() => NM.resolveConflict(state, cc, ii, t.dataset.choice), { msg: t.dataset.choice === 'mine' ? 'Kept your copy. It will upload.' : 'Used the other copy.' }); break; }
      case 'toggle-details': ui.details = !ui.details; render(); break;
      case 'reset-ov': run(() => NM.resetOverride(state, mid, t.dataset.key)); break;
      case 'ustat': {
        const v = t.dataset.v, base = { extendTo: '', extendNote: '' };
        const patch = v === 'done' ? { done: true } : v === 'canceled' ? { cancel: true } : Object.assign(base, { done: false, cancel: false, setStatus: v });
        ui.extend = '';
        run(() => NM.setUpdate(state, mid, id, patch), { focus: t.id }); break;
      }
      case 'publish-quick': {
        const iss = NM.publishIssues(state, state.meetings[mid]);
        const bl = iss.items.filter((x) => x.level === 'blocker'), wr = iss.items.filter((x) => x.level === 'warning');
        if (bl.length) { const tg = bl[0].target; if (tg) gotoIssue(tg.kind, tg.id || ''); toast(bl.length + ' thing' + (bl.length === 1 ? '' : 's') + ' to fix first: ' + bl[0].msg, true); }
        else if (wr.length) { ui.panel = 'publish'; render(); const pp = document.getElementById('publish-panel'); if (pp && pp.scrollIntoView) pp.scrollIntoView({ block: 'center' }); }
        else { const r = run(() => NM.publish(state, mid), { render: false }); if (r.ok) { toast('Published Rev ' + r.v.rev + '.'); go({ view: 'sheet', rev: -1 }); } }
        break;
      }
      case 'add-break': run(() => NM.setSectionTiming(state, mid, id, { brk: 10 }), { focus: 'sb-' + id }); break;
      case 'del-break': run(() => NM.setSectionTiming(state, mid, id, { brk: 0 })); timesRefresh(); break;
      case 'att': run(() => NM.setAttendance(state, mid, id, t.dataset.state), { focus: null }); break;
      case 'all-present-unset': run(() => NM.setAllAttendance(state, mid, 'present', true)); break;
      case 'toggle-sec': ui.collapsed[id] = !ui.collapsed[id]; render(); break;
      case 'sec-up': run(() => NM.moveSection(state, mid, id, -1)); break;
      case 'sec-down': run(() => NM.moveSection(state, mid, id, 1)); break;
      case 'topic-up': run(() => NM.moveTopic(state, mid, id, -1), { focus: 'tt-' + id }); break;
      case 'topic-down': run(() => NM.moveTopic(state, mid, id, 1), { focus: 'tt-' + id }); break;
      case 'open-preview': ui.panel = 'preview'; pvNodes = null; render(); { const pv = document.querySelector('.panel.preview'); if (pv) pv.scrollIntoView({ block: 'start' }); } drawPreview(); break;
      case 'refresh-preview': pvNodes = null; drawPreview(); break;
      case 'pdf-agenda': makePdf('agenda'); break;
      case 'pdf-draft': makePdf('draft'); break;
      case 'goto': gotoIssue(t.dataset.kind, id); break;
      case 'go-home': go({ view: 'home', projectId: '', seriesId: '', meetingId: '' }); break;
      case 'open-project': go({ view: 'project', projectId: id, seriesId: '', meetingId: '', ptab: 'series' }); break;
      case 'ptab': go({ ptab: id }); break;
      case 'open-series': { const s = state.series[id]; go({ view: 'series', projectId: s.projectId, seriesId: id, meetingId: '', tab: 'meetings' }); break; }
      case 'tab': go({ tab: id }); break;
      case 'open-meeting': { const m = state.meetings[id]; go({ view: m.status === 'published' && !m.revising ? 'sheet' : 'meeting', projectId: state.series[m.seriesId].projectId, seriesId: m.seriesId, meetingId: id, rev: -1 }); break; }
      case 'open-meeting-edit': go({ view: 'meeting', meetingId: id }); break;
      case 'start-project': {
        const d = env.projects.get(id); if (!d) break;
        ui.projectId = id; // permissions are per project
        const r = run(() => NM.createProject(state, { id: d.id, name: d.name, number: d.number }), { render: false });
        if (r.ok) go({ view: 'project', projectId: d.id, ptab: 'series' });
        break;
      }
      case 'new-series': ui.panel = ui.panel === 'newSeries' ? '' : 'newSeries'; render('ns-name'); break;
      case 'close-panel': ui.panel = ''; ui.confirm = ''; render(); break;
      case 'toggle-data': ui.panel = ui.panel === 'data' ? '' : 'data'; render(); break;
      case 'refresh': env.stale = false; render(); break;
      case 'dismiss-legacy': ui.legacy = false; render(); break;
      case 'sync-now': (async () => { toast('Syncing…'); await pullMerge(true); await pushDirty(); toast(env.pushError ? 'Sync did not finish. It will retry.' : 'Up to date.', env.pushError); })(); break;
      case 'load-example': run(() => { NM.buildExample(state); ui.view = 'home'; ui.projectId = ''; saveUi(); }, { msg: 'Example loaded. Press Continue on Meeting 3, then Start meeting.' }); break;
      case 'remove-examples': run(() => { NM.listProjects(state).filter((x) => x.example).forEach((x) => NM.deleteProject(state, x.id)); ui.view = 'home'; ui.panel = ''; saveUi(); }, { msg: 'Example removed.' }); break;
      case 'new-meeting-in': { const sr = state.series[id]; ui.projectId = sr.projectId; const r = run(() => NM.createMeeting(state, id), { render: false }); if (r.ok) go({ view: 'meeting', projectId: sr.projectId, seriesId: id, meetingId: r.v.id }); break; }
      case 'new-meeting': { const r = run(() => NM.createMeeting(state, sid), { render: false }); if (r.ok) go({ view: 'meeting', meetingId: r.v.id }); break; }
      case 'start-minutes': run(() => NM.startMinutes(state, mid), { msg: 'Meeting started. Add outcomes under each item.' }); break;
      case 'back-agenda': run(() => NM.backToAgenda(state, mid)); break;
      case 'ask-delete-meeting': ui.confirm = 'delete-meeting'; render(); break;
      case 'delete-meeting': { const r = run(() => NM.deleteDraftMeeting(state, mid), { render: false, msg: 'Meeting deleted.' }); if (r.ok) go({ view: 'series', meetingId: '' }); break; }
      case 'open-publish': ui.panel = 'publish'; render(); break;
      case 'confirm-publish': { const r = run(() => NM.publish(state, mid), { render: false }); if (r.ok) { toast('Published Rev ' + r.v.rev + '.'); go({ view: 'sheet', rev: -1 }); } break; }
      case 'cancel-revision': { const r = run(() => NM.cancelRevision(state, mid), { render: false, msg: 'Revision cancelled. The last issue is unchanged.' }); if (r.ok) go({ view: 'sheet', rev: -1 }); break; }
      case 'ask-revise': ui.panel = 'revise'; render('rv-reason'); break;
      case 'sheet-rev': ui.rev = Number(id); render(); break;
      case 'toggle-att': ui.attOpen = !ui.attOpen; render(); break;
      case 'all-present': run(() => NM.setAllAttendance(state, mid, 'present', false)); break;
      case 'remove-attendee': run(() => NM.removeAttendee(state, mid, id)); break;
      case 'quick-open': ui.quick = id; render('qa-name'); break;
      case 'quick-close': ui.quick = ''; render(); break;
      case 'del-topic': {
        const f = NM.findTopic(state.meetings[mid], id);
        if (f && f.topic.outcomes.some((o) => o.text.trim() || o.assigneeIds.length)) { ui.confirm = 'topic:' + id; render(); } else run(() => NM.removeTopic(state, mid, id));
        break;
      }
      case 'confirm-del-topic': ui.confirm = ''; run(() => NM.removeTopic(state, mid, id)); break;
      case 'remove-section': run(() => NM.removeSection(state, mid, id)); break;
      case 'add-outcome': { const r = run(() => NM.addOutcome(state, mid, id, t.dataset.type), { render: false }); if (r.ok) render('ot-' + r.v.id); break; }
      case 'del-att': run(() => NM.removeAttachment(state, mid, id)); break;
      case 'del-outcome': run(() => NM.removeOutcome(state, mid, id)); break;
      case 'unassign': run(() => NM.toggleAssignee(state, mid, id, t.dataset.pid, false)); break;
      case 'open-extend': ui.extend = id; render('ex-d-' + id); break;
      case 'cancel-extend': ui.extend = ''; run(() => NM.setUpdate(state, mid, id, { extendTo: '', extendNote: '' })); break;
      case 'reopen-action': run(() => NM.reopenAction(state, id), { msg: 'Action reopened. It will appear on the next agenda.' }); break;
      case 'show-done': ui.showDone = !ui.showDone; render(); break;
      case 'tpl-up': run(() => NM.moveTemplateSection(state, sid, id, -1)); break;
      case 'tpl-down': run(() => NM.moveTemplateSection(state, sid, id, 1)); break;
      case 'tpl-remove': run(() => NM.removeTemplateSection(state, sid, id)); break;
      case 'remove-party': run(() => NM.removeParty(state, pid, id)); break;
      case 'ask-delete-series': ui.confirm = 'delete-series'; render(); break;
      case 'delete-series': { const r = run(() => NM.deleteSeries(state, sid), { render: false, msg: 'Series deleted.' }); if (r.ok) go({ view: 'project', seriesId: '', meetingId: '', ptab: 'series' }); break; }
      case 'ask-delete-project': ui.confirm = 'delete-project'; render(); break;
      case 'delete-project': { const r = run(() => NM.deleteProject(state, pid), { render: false, msg: 'Project deleted.' }); if (r.ok) go({ view: 'home', projectId: '', seriesId: '', meetingId: '' }); break; }
      case 'copy-text': copyText('snap'); break;
      case 'copy-agenda': copyText('agenda'); break;
      case 'save-pdf': makePdf('snap'); break;
      case 'export-series': exportSeries(); break;
      case 'export-project': exportSeries(true); break;
      case 'save-html': saveFile('html'); break;
      case 'save-text': saveFile('txt'); break;
      case 'save-backup': saveBackup(); break;
    }
  });
  root.addEventListener('submit', (ev) => {
    const f = ev.target.closest('form[data-form]');
    if (!f) return;
    ev.preventDefault();
    const fd = new FormData(f), v = (k) => String(fd.get(k) || '');
    const mid = ui.meetingId, sid = ui.seriesId, pid = ui.projectId;
    switch (f.dataset.form) {
      case 'newSeries': { const r = run(() => NM.createSeries(state, pid, { name: v('name'), meetingType: v('meetingType'), location: v('location'), cadence: v('cadence') }), { render: false }); if (r.ok) { go({ view: 'series', seriesId: r.v.id, tab: 'setup' }); toast('Series created. Pick the usual attendees and adjust the categories.'); } break; }
      case 'addOffice': if (isAdmin()) run(() => NM.addOffice(state, { name: v('name') }), { focus: 'of-new' }); break;
      case 'addParty': run(() => NM.addParty(state, pid, { name: v('name'), kind: v('kind'), companyId: v('companyId') }), { focus: 'dp-name' }); break;
      case 'addTplSection': run(() => NM.addTemplateSection(state, sid, v('name')), { focus: 'at-name' }); break;
      case 'addSection': run(() => NM.addSection(state, mid, v('name')), { focus: 'as-name' }); break;
      case 'addTopic': { const secId = f.dataset.id; if (v('text').trim()) run(() => NM.addTopic(state, mid, secId, v('text')), { focus: 'nt-' + secId }); break; }
      case 'quickAdd': {
        const target = f.dataset.target;
        run(() => {
          const x = NM.addParty(state, pid, { name: v('name'), kind: v('kind'), companyId: v('companyId') });
          if (target === 'att') NM.addAttendee(state, mid, x.id, false); else NM.toggleAssignee(state, mid, target, x.id, true);
          ui.quick = '';
        }, { msg: 'Added to the project directory.' });
        break;
      }
      case 'revise': { const r = run(() => NM.reviseMeeting(state, mid, v('reason')), { render: false }); if (r.ok) go({ view: 'meeting' }); break; }
    }
  });
  root.addEventListener('input', (ev) => {
    const t = ev.target, b = t.dataset && t.dataset.bind;
    if (!b) return;
    const id = t.dataset.id, mid = ui.meetingId, sid = ui.seriesId, pid = ui.projectId;
    switch (b) {
      case 'topic': if (t.value.trim()) silent(() => NM.setTopicText(state, mid, id, t.value)); break;
      case 'otext': silent(() => NM.setOutcome(state, mid, id, { text: t.value })); break;
      case 'unote': silent(() => NM.setUpdate(state, mid, id, { note: t.value })); break;
      case 'uextnote': silent(() => NM.setUpdate(state, mid, id, { extendNote: t.value })); break;
      case 'mf': if (['location', 'meetingType'].includes(t.dataset.field)) { silent(() => NM.setMeetingFields(state, mid, { [t.dataset.field]: t.value })); ovRefresh(t.dataset.field); } break;
      case 'sfield': if (['name', 'location', 'meetingType'].includes(t.dataset.field)) { if (t.dataset.field !== 'name' || t.value.trim()) silent(() => NM.updateSeries(state, sid, { [t.dataset.field]: t.value })); } break;
      case 'firmf': if (isAdmin()) silent(() => NM.updateFirm(state, { [t.dataset.field]: t.value })); break;
      case 'firmtypes': if (isAdmin()) silent(() => NM.updateFirm(state, { meetingTypes: t.value.split('\n') })); break;
      case 'ofield': if (isAdmin() && (t.dataset.field !== 'name' || t.value.trim())) silent(() => NM.updateOffice(state, id, { [t.dataset.field]: t.value })); break;
      case 'pfield': if (t.tagName !== 'SELECT' && (t.dataset.field !== 'name' || t.value.trim())) silent(() => NM.updateParty(state, pid, id, { [t.dataset.field]: t.value })); break;
      case 'pjfield': if (t.tagName !== 'SELECT' && (t.dataset.field !== 'name' || t.value.trim())) { silent(() => NM.updateProject(state, pid, { [t.dataset.field]: t.value })); const ex = document.getElementById('pj-fn-ex'); if (ex && state.projects[pid]) ex.innerHTML = fnExample(state.projects[pid]); } break;
      case 'tname': if (t.value.trim()) silent(() => NM.renameTemplateSection(state, sid, id, t.value)); break;
      case 'sdur': silent(() => NM.setSectionTiming(state, mid, id, { dur: t.value })); timesRefresh(); break;
      case 'sbrk': silent(() => NM.setSectionTiming(state, mid, id, { brk: t.value })); timesRefresh(); break;
      case 'tdur': silent(() => NM.setTemplateTiming(state, sid, id, { dur: t.value })); break;
      case 'tbrk': silent(() => NM.setTemplateTiming(state, sid, id, { brk: t.value })); break;
      case 'acap': silent(() => NM.setAttachment(state, mid, id, { caption: t.value })); break;
      case 'ttopics': silent(() => NM.setTemplateTopics(state, sid, id, t.value)); break;
    }
  });
  root.addEventListener('change', (ev) => {
    const t = ev.target, b = t.dataset && t.dataset.bind;
    if (!b) return;
    const id = t.dataset.id, mid = ui.meetingId, sid = ui.seriesId, pid = ui.projectId;
    switch (b) {
      case 'mf': { const fld = t.dataset.field; if (fld === 'location' || fld === 'meetingType') { ovRefresh(fld); break; } run(() => NM.setMeetingFields(state, mid, { [fld]: t.value }), { render: false }); if (fld === 'date') render(t.id); else { ovRefresh(fld === 'preparedById' ? 'preparedBy' : fld); if (fld === 'time') timesRefresh(); } break; }
      case 'mnext': { const m = state.meetings[mid]; const cur = NM.nextMeeting(state, m); const nx = { date: cur.date, time: cur.time, location: cur.location }; nx[t.dataset.field] = t.value; run(() => NM.setMeetingFields(state, mid, { next: nx }), { render: false }); ovRefresh('next'); break; }
      case 'sfield': { const f = t.dataset.field; if (['name', 'location', 'meetingType'].includes(f)) break; const val = f === 'carryOpen' ? t.checked : f === 'durationMin' || f === 'startNumber' ? Number(t.value) : t.value; run(() => NM.updateSeries(state, sid, { [f]: val }), { render: false }); if (f === 'startNumber') render(); break; }
      case 'pfield': if (t.tagName === 'SELECT') run(() => NM.updateParty(state, pid, id, { [t.dataset.field]: t.value })); break;
      case 'pjfield': if (t.tagName === 'SELECT') run(() => NM.updateProject(state, pid, { [t.dataset.field]: t.value }), { render: false }); break;
      case 'regf': ui.reg[t.dataset.field] = t.type === 'checkbox' ? t.checked : t.value; render(t.id); break;
      case 'ustatus': {
        const v = t.value;
        if (v === 'extended') break;
        const base = { extendTo: '', extendNote: '' };
        const patch = v === 'done' ? { done: true } : v === 'canceled' ? { cancel: true } : Object.assign(base, { done: false, cancel: false, setStatus: v });
        ui.extend = '';
        run(() => NM.setUpdate(state, mid, id, patch), { focus: t.id }); break;
      }
      case 'udoneon': run(() => NM.setUpdate(state, mid, id, { doneOn: t.value }), { render: false }); break;
      case 'attadd': if (t.value) run(() => NM.addAttendee(state, mid, t.value, !!(document.getElementById('att-toseries') || {}).checked)); break;
      case 'timed': run(() => NM.setTimed(state, mid, t.checked), { focus: t.id }); break;
      case 'mdate': run(() => NM.setMeetingFields(state, mid, { date: t.value }), { render: false }); break;
      case 'otype': run(() => NM.setOutcome(state, mid, id, { type: t.value }), { focus: 'ot-' + id }); break;
      case 'odue': run(() => NM.setOutcome(state, mid, id, { due: t.value }), { focus: t.id }); break;
      case 'assign': if (t.value) run(() => NM.toggleAssignee(state, mid, id, t.value, true), { focus: 'pk-' + id }); break;
      case 'uextend': run(() => NM.setUpdate(state, mid, id, { extendTo: t.value }), { focus: t.id }); break;
      case 'sat': run(() => { const s = state.series[sid]; NM.updateSeries(state, sid, { attendeeIds: t.checked ? s.attendeeIds.concat([id]) : s.attendeeIds.filter((x) => x !== id) }); }, { render: false }); break;
      case 'alay': run(() => NM.setAttachment(state, mid, id, { layout: t.value }), { render: false }); break;
      case 'afile': { const files = [...(t.files || [])]; t.value = ''; attachFiles(t.dataset.kind, id, files); break; }
      case 'firmf': if (isAdmin() && t.tagName === 'SELECT') silent(() => NM.updateFirm(state, { [t.dataset.field]: t.value })); break;
      case 'import': importFile(t); break;
    }
  });
  root.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (!t.matches) return;
    const topicEl = t.closest && t.closest('.topic');
    if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && t.matches('textarea.t-input')) {
      ev.preventDefault(); const tid = t.dataset.id; run(() => NM.moveTopic(state, ui.meetingId, tid, ev.key === 'ArrowUp' ? -1 : 1), { focus: 'tt-' + tid }); return;
    }
    if (ev.altKey && ['1', '2', '3'].includes(ev.key) && topicEl && state.meetings[ui.meetingId] && state.meetings[ui.meetingId].status === 'minutes') {
      ev.preventDefault(); const type = { 1: 'decision', 2: 'assignment', 3: 'info' }[ev.key]; const tid = topicEl.id.replace('topic-', '');
      const r = run(() => NM.addOutcome(state, ui.meetingId, tid, type), { render: false }); if (r.ok) render('ot-' + r.v.id); return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter' && t.closest && t.closest('.sec')) {
      const inp = t.closest('.sec').querySelector('.addtopic input'); if (inp) { ev.preventDefault(); inp.focus(); } return;
    }
    if (ev.key === 'Enter' && !ev.shiftKey && t.matches('textarea.t-input')) { ev.preventDefault(); t.blur(); }
  });
  function ovRefresh(key) {
    const m = state.meetings[ui.meetingId]; if (!m) return;
    const k = key === 'preparedById' ? 'preparedBy' : key;
    const el = root.querySelector('[data-ovbadge="' + k + '"]'); if (el) el.innerHTML = ovInner(m, k);
  }
  /* The publication review links straight to the thing that needs attention. */
  function gotoIssue(kind, id) {
    const m = state.meetings[ui.meetingId];
    const focusEl = (dom, f) => { const el = document.getElementById(dom); if (el) { if (el.scrollIntoView) el.scrollIntoView({ block: 'center' }); const t = f && document.getElementById(f); if (t) { try { t.focus({ preventScroll: true }); } catch (_) {} } } };
    if (kind === 'attendance') { ui.attOpen = true; render(); focusEl('att-sec'); return; }
    if (kind === 'details') { ui.details = true; render(); focusEl('m-date', 'm-date'); return; }
    if (kind === 'project') { go({ view: 'project', ptab: 'details', meetingId: '' }); return; }
    if (kind === 'outcome') { render(); focusEl('out-' + id, 'ot-' + id); return; }
    if (kind === 'topic') { const f = m && NM.findTopic(m, id); if (f && ui.collapsed[f.sec.id]) ui.collapsed[f.sec.id] = false; render(); focusEl('topic-' + id, 'tt-' + id); return; }
    if (kind === 'action') { render(); focusEl('act-' + id, 'un-' + id); return; }
  }
  onWin(document, 'keydown', (ev) => { if (ev.key === 'Escape' && (ui.panel || ui.quick || ui.confirm)) { ui.panel = ''; ui.confirm = ''; ui.quick = ''; render(); } });

  /* ---------- output ---------- */
  function currentSnap() {
    const m = state.meetings[ui.meetingId]; if (!m) return null;
    const snaps = NM.snapshotsOf(state, m.id); if (!snaps.length) return null;
    const rev = snaps.some((x) => x.rev === ui.rev) ? ui.rev : snaps[snaps.length - 1].rev;
    return { snap: snaps.find((x) => x.rev === rev), snaps };
  }
  function copyText(kind) {
    let text;
    if (kind === 'agenda') { const m = state.meetings[ui.meetingId]; if (!m) return; text = NM.agendaToText(state, m); }
    else { const c = currentSnap(); if (!c) return; text = NM.snapshotToText(c.snap, c.snaps); }
    const fallback = () => { ui.panel = 'copy'; ui.copyText = text; render('copybox'); const b = document.getElementById('copybox'); if (b) b.select(); };
    try { navigator.clipboard.writeText(text).then(() => toast(kind === 'agenda' ? 'Agenda copied. Paste it into an email or invite.' : 'Copied. Paste it into an email or message.'), fallback); } catch (_) { fallback(); }
  }
  function curPattern() { const m = state.meetings[ui.meetingId], s = m && state.series[m.seriesId], p = s && state.projects[s.projectId]; return (p && p.fileName) || ''; }
  async function saveFile(kind) {
    const c = currentSnap(); if (!c || !env.downloads) return;
    const slug = NM.fileName(curPattern(), c.snap);
    const data = kind === 'html' ? NM.exportDocument(c.snap, c.snaps, window.__SHEET_CSS || '', imgSrc) : NM.snapshotToText(c.snap, c.snaps);
    try { await env.downloads.save({ filename: slug + '.' + kind, data }); toast('Saved.'); } catch (err) { if (!err || err.code !== 'declined') toast('Could not save the file here.', true); }
  }
  async function exportSeries(whole) {
    if (!env.downloads) { toast('Saving files is not available here.', true); return; }
    try {
      const r = whole ? NM.projectExport(state, ui.projectId) : NM.seriesExport(state, ui.seriesId);
      if (!r.count) { toast('No meetings to export yet.', true); return; }
      const nm = (r.project + ' ' + r.name + ' All Meetings ' + NM.todayStr()).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
      await env.downloads.save({ filename: nm + '.md', data: r.text });
      toast('Exported ' + r.count + ' meeting' + (r.count === 1 ? '' : 's') + (whole ? ' from ' + r.series + ' series' : '') + '.');
    } catch (err) { if (!err || err.code !== 'declined') toast('Could not export. ' + ((err && err.message) || ''), true); }
  }
  async function saveBackup() {
    if (!env.downloads) return;
    try { await env.downloads.save({ filename: 'nexus-minutes-backup-' + NM.todayStr() + '.json', data: backupFile() }); toast('Backup saved.'); } catch (err) { if (!err || err.code !== 'declined') toast('Could not save the backup here.', true); }
  }
  function importFile(input) {
    const f = input.files && input.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const parsed = readBackup(String(rd.result));
        const r = NM.mergeRemote(state, parsed, false);
        persistSoon(); render(); toast(r.pulled ? 'Imported ' + r.pulled + ' records.' : 'Nothing new in that file.');
      } catch (err) { toast(err.message, true); }
    };
    rd.onerror = () => toast('Could not read that file.', true);
    rd.readAsText(f);
    input.value = '';
  }

  /* ---------- images: shrink in the browser until the record fits the database limit ---------- */
  const Img = {
    load(file) {
      return new Promise((res, rej) => {
        const url = URL.createObjectURL(file), im = new Image();
        im.onload = () => { URL.revokeObjectURL(url); res(im); };
        im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That file is not an image this browser can open.')); };
        im.src = url;
      });
    },
    async encode(file) {
      const im = await Img.load(file);
      const sw = im.naturalWidth || im.width, sh = im.naturalHeight || im.height;
      if (!sw || !sh) throw new Error('That image is empty.');
      let long = Math.min(2000, Math.max(sw, sh)), q = 0.82;
      for (let i = 0; i < 12; i++) {
        const k = long / Math.max(sw, sh), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(im, 0, 0, w, h);
        const data = cv.toDataURL('image/jpeg', q);
        if (data.length <= 200000) return { data, w, h };
        if (q > 0.55) q -= 0.1; else { long = Math.round(long * 0.8); q = 0.7; }
      }
      throw new Error('Could not shrink that image enough to store it.');
    },
  };
  window.__nmImg = Img;
  async function attachFiles(kind, id, files) {
    files = files.filter((f) => f && /^image\//.test(f.type || ''));
    if (!files.length) return;
    if (RO()) { toast('This view is read-only.', true); return; }
    const mid = ui.meetingId, m = state.meetings[mid];
    if (!m || !NM.canEditContent(m)) { toast('These minutes are locked. Start a revision to add images.', true); return; }
    toast(files.length > 1 ? 'Adding ' + files.length + ' images…' : 'Adding image…');
    let last = null;
    for (const f of files) {
      try {
        const img = await window.__nmImg.encode(f);
        if (ui.meetingId !== mid) return;
        last = NM.addAttachment(state, mid, kind, id, img);
        persistSoon();
      } catch (err) { toast(err.message || 'Could not add that image.', true); }
    }
    if (last) { toast(files.length > 1 ? 'Images added. Set each one’s size below.' : 'Image added. Set its size below.'); render('ac-' + last.id); }
  }
  const imgFiles = (dt) => {
    if (!dt) return [];
    const out = [];
    for (const f of [...(dt.files || [])]) if (/^image\//.test(f.type || '')) out.push(f);
    if (!out.length) for (const it of [...(dt.items || [])]) { if (it.kind === 'file' && /^image\//.test(it.type || '')) { const f = it.getAsFile && it.getAsFile(); if (f) out.push(f); } }
    return out;
  };
  const hasImage = (dt) => !!dt && ([...(dt.types || [])].includes('Files') || [...(dt.items || [])].some((it) => it.kind === 'file' && /^image\//.test(it.type || '')) || imgFiles(dt).length > 0);
  function attachTarget(el) { const h = el && el.closest && el.closest('[data-attach]'); if (!h || !root.contains(h)) return null; const [kind, id] = h.dataset.attach.split(':'); return { kind, id }; }
  // Remember the last topic or outcome the cursor was in, so a paste still lands when focus has drifted to the page body.
  let lastAttach = null;
  root.addEventListener('focusin', (ev) => { const t = attachTarget(ev.target); if (t) lastAttach = Object.assign({ meeting: ui.meetingId }, t); });
  onWin(document, 'paste', (ev) => {
    if (ui.view !== 'meeting') return;
    const files = imgFiles(ev.clipboardData); if (!files.length) return;
    let t = attachTarget(ev.target);
    if (!t && lastAttach && lastAttach.meeting === ui.meetingId && document.getElementById((lastAttach.kind === 'outcome' ? 'out' : 'topic') + '-' + lastAttach.id)) t = lastAttach;
    ev.preventDefault();
    if (!t) { toast('Click into a topic or outcome first, then paste the image.', true); return; }
    attachFiles(t.kind, t.id, files);
  });
  root.addEventListener('dragover', (ev) => { if (attachTarget(ev.target) && hasImage(ev.dataTransfer)) ev.preventDefault(); });
  root.addEventListener('drop', (ev) => {
    const files = imgFiles(ev.dataTransfer); const t = attachTarget(ev.target);
    if (!files.length || !t) return;
    ev.preventDefault(); attachFiles(t.kind, t.id, files);
  });

  /* backups use the Toolbox's common file format (CONTRACT section 6); files from the earlier version still import */
  function backupFile() {
    const inner = JSON.parse(NM.exportBackup(state));
    const me = P.Session.me();
    const collections = {};
    for (const c of NM.COLLS) collections[c] = inner[c];
    return JSON.stringify({ format: 'toolbox-backup', formatVersion: 1, app: 'minutes', appSchemaVersion: NM.SCHEMA, exportedAt: inner.exportedAt, exportedBy: me ? me.id : null, people: me ? { [me.id]: me.name } : {}, collections }, null, 1);
  }
  function readBackup(text) {
    try {
      const j = JSON.parse(text);
      if (j && j.format === 'toolbox-backup' && j.app === 'minutes') text = JSON.stringify(Object.assign({ app: 'nexus-minutes', v: j.appSchemaVersion }, j.collections));
    } catch (_) { /* parseBackup reports it */ }
    return NM.parseBackup(text);
  }

  /* ---------- PDF (jsPDF is the shared copy in /shared/vendor, loaded when first needed; the fonts are embedded) ---------- */
  let pvSeq = 0, pvNodes = null, pdfLoading = null;
  function loadPdfLib() {
    if (window.jspdf) return Promise.resolve(window.jspdf);
    if (!pdfLoading) {
      pdfLoading = new Promise((res, rej) => {
        const sc = document.createElement('script');
        sc.src = '/shared/vendor/jspdf.umd.min.js';
        sc.onload = () => (window.jspdf ? res(window.jspdf) : rej(new Error('missing')));
        sc.onerror = () => { pdfLoading = null; rej(new Error('blocked')); };
        document.head.append(sc);
      });
    }
    return pdfLoading;
  }
  async function drawPreview() {
    const host = document.getElementById('pv-pages'), m = state.meetings[ui.meetingId]; if (!host || !m) return;
    const mine = ++pvSeq;
    try { await loadPdfLib(); } catch (_) { /* the text version shows below */ }
    const JsPDF = window.jspdf && window.jspdf.jsPDF;
    const snap = m.status === 'agenda' ? NM.buildAgendaDoc(state, m) : NM.buildDraft(state, m);
    try {
      if (!JsPDF) throw new Error('no pdf lib');
      host.innerHTML = '<p class="hint">Building preview…</p>';
      const scratch = document.createElement('div');
      await NMPdf.renderPreview(JsPDF, snap, [], imgSrc, window.NMAssets, scratch, Math.min(2, Math.max(1.2, (window.devicePixelRatio || 1) * 1.1)));
      if (mine !== pvSeq || !document.getElementById('pv-pages')) return;
      host.textContent = ''; pvNodes = [...scratch.childNodes]; pvNodes.forEach((n) => host.appendChild(n));
    } catch (err) {
      if (mine !== pvSeq) return;
      const h2 = document.getElementById('pv-pages'); if (h2) h2.innerHTML = '<p class="hint">Could not draw the page preview, so this is the text version.</p>' + NM.snapshotToHtml(snap, [], imgSrc);
    }
  }
  async function makePdf(kind) {
    if (!env.downloads || env.pdfBusy) return;
    const m = state.meetings[ui.meetingId]; if (!m) return;
    let snap, revs = [], suffix = '';
    if (kind === 'snap') { const c = currentSnap(); if (!c) return; snap = c.snap; revs = c.snaps; }
    else if (kind === 'agenda') { snap = NM.buildAgendaDoc(state, m); suffix = '-agenda'; }
    else { snap = NM.buildDraft(state, m); suffix = '-draft'; }
    env.pdfBusy = true; render();
    try {
      await loadPdfLib();
      const JsPDF = window.jspdf && window.jspdf.jsPDF;
      if (!JsPDF) throw new Error('The PDF library did not load.');
      const doc = NMPdf.build(JsPDF, snap, revs, imgSrc, window.NMAssets);
      await env.downloads.save({ filename: NM.fileName(curPattern(), snap, 'pdf'), data: doc.output('arraybuffer') });
      toast('Saved.');
    } catch (err) { if (!err || err.code !== 'declined') toast('Could not make the PDF. ' + ((err && err.message) || ''), true); }
    finally { env.pdfBusy = false; render(); }
  }

  /* ---------- boot ---------- */
  async function boot() {
    render();
    await Local.open();
    const saved = await Local.get();
    if (saved) {
      try {
        const j = JSON.parse(saved);
        if (NM.isLegacy(j)) {
          // First-version data has a different shape. Keep a copy under another key and start clean.
          try { await Local.set(saved, 'state-v1'); await Local.set(JSON.stringify(state)); ui.legacy = true; } catch (_) {}
        } else state = NM.normalizeState(j);
      } catch (_) {}
    }
    loadUi();
    booted = true; render();
    await initRemote();
    render();
    refreshSync();
    if (env.db) { await pullMerge(true); schedulePush(300); }
    refreshSync();
    window.__nmReady = true;
  }
  boot();
  return {
    stop() { mounted = false; clearTimeout(pushT); clearTimeout(saveT); clearInterval(pullTimer); clearInterval(projTimer); },
    show() { mounted = true; refreshProjects().then(() => render()); },
    hide() { mounted = false; },
    isDirty: () => NM.dirtyCount(state) > 0,
  };
}


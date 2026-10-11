/* ===== App state, persistence, editing ===== */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const k in props || {}) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v; // internal icon strings only
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function todayDay() { const t = new Date(); return dayNum(t.getFullYear(), t.getMonth(), t.getDate()); }
function whenText(ms) {
  if (!ms) return '';
  try { return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
}

const S = {
  db: null, room: null, user: null, dl: null,
  meId: null, readonly: false, noStore: false,
  schedules: new Map(), schedLoaded: false, holLoaded: false,
  holidays: [], cal: makeCalendar([]),
  cur: null, work: null, base: { sid: null, by: null, at: 0 }, baseWork: null,
  dirty: false, saving: false, remote: null, undo: [], res: new Map(),
  view: 'table', sel: null, focusId: null, meta: { projectId: null }, route: null, impact: null, zoomF: 1,
  issuesOpen: null, onlyIssues: false, // issuesOpen null: open by itself when there is a conflict
  peers: [], names: {}, err: null, lastPresence: '',
};

/* ----- toast ----- */
let toastTimer = null;
function toast(msg, action) {
  const t = $('#toast');
  t.textContent = '';
  t.append(h('span', { text: msg }));
  if (action) t.append(h('button', { class: 'toast-act', text: action.label, onclick: () => { t.classList.remove('on'); action.run(); } }));
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), action ? 7000 : 3600);
}
function fail(msg, e) {
  S.err = msg + (e && e.code ? ' (' + e.code + ')' : '');
  renderBanners();
}

/* ----- people ----- */
function nameOf(id) {
  if (!id) return 'Someone';
  if (id === S.meId) return 'you';
  return S.names[id] || 'Someone';
}
async function refreshNames(ids) {
  if (!S.user) return;
  ids = [...new Set((ids || []).filter(Boolean))];
  if (!ids.length) return;
  try {
    const ps = await S.user.profiles(ids);
    let changed = false;
    for (const id of ids) {
      const n = (ps[id] && ps[id].name) || '';
      if (S.names[id] !== n) { S.names[id] = n; changed = true; }
    }
    if (changed) { renderSheet(); renderBanners(); }
  } catch (e) { /* names are optional */ }
}

/* ----- presence ----- */
function updatePresence() {
  if (!S.room) return;
  const key = (S.cur || '') + '|' + (S.dirty ? 1 : 0);
  if (key === S.lastPresence) return;
  S.lastPresence = key;
  S.room.presence({ sid: S.cur || null, dirty: !!S.dirty }).catch(() => {});
}
function onPeers(ch) {
  S.peers = ch.peers.filter((p) => p.kind === 'viewer' && !p.isMe);
  refreshNames(S.peers.map((p) => p.by));
  renderSheet();
  renderBanners();
}
function peersHere() {
  const seen = new Map();
  for (const p of S.peers) {
    if (!S.cur || (p.presence && p.presence.sid) !== S.cur) continue;
    const k = p.by || p.peer;
    const prev = seen.get(k);
    const editing = !!(p.presence && p.presence.dirty);
    if (!prev) seen.set(k, { by: p.by, editing });
    else prev.editing = prev.editing || editing;
  }
  return [...seen.values()];
}
function peersElsewhere() {
  const seen = new Map();
  for (const p of S.peers) {
    if ((p.presence && p.presence.sid) === S.cur) continue;
    const k = p.by || p.peer;
    if (!seen.has(k)) seen.set(k, { by: p.by });
  }
  return [...seen.values()];
}

/* ----- tasks ----- */
function cloneTasks(ts) { return JSON.parse(JSON.stringify(ts)); }
function normalizeTasks(ts) {
  const t0 = fmtISO(S.cal.next(todayDay()));
  return (ts || []).map((t) => ({
    id: String(t.id || newId()),
    name: String(t.name || ''),
    kind: t.kind === 'milestone' ? 'milestone' : 'task',
    duration: t.kind === 'milestone' ? 0 : Math.max(1, Math.round(+t.duration || 1)),
    start: isNaN(parseDate(t.start)) ? t0 : t.start,
    locked: !!t.locked,
    notBefore: t.notBefore && !isNaN(parseDate(t.notBefore)) ? t.notBefore : null,
    deps: (t.deps || []).map((d) => ({ id: String(d.id), type: d.type === 'SS' ? 'SS' : 'FS', lag: Math.round(+d.lag || 0) })),
    ignore: Array.isArray(t.ignore) ? t.ignore.slice() : [],
    lvl: LEVELS.includes(t.lvl) ? t.lvl : 'client',
    exec: !!t.exec,
    exColor: normColor(t.exColor),
    commit: normCommit(t.commit),
  }));
}
const taskById = (id) => (S.work ? S.work.tasks.find((t) => t.id === id) : null);

function recalc() {
  if (!S.work) { S.res = new Map(); return; }
  S.cal = makeCalendar(S.work.holidays || [], S.work.offDays);
  const tasks = S.work.tasks;
  S.res = schedule(tasks, S.cal);
  for (const t of tasks) {
    const x = S.res.get(t.id);
    if (x && !t.locked && !x.cycle) t.start = fmtISO(x.start);
    if (!(t.deps || []).length) t.notBefore = null;
  }
}
function setDirty(v) { if (v && (!S.dirty || !S.dirtySince)) S.dirtySince = Date.now(); S.dirty = v; if (!v) { S.dirtySince = 0; S.nagUntil = 0; } updatePresence(); }
/* nudge to save after a long stretch of unsaved edits (only edits count; viewing never does) */
const NAG_AFTER = 30 * 60 * 1000, NAG_AGAIN = 15 * 60 * 1000;
const nagDue = () => !!(S.work && S.dirty && !S.readonly && S.dirtySince && Date.now() - S.dirtySince >= NAG_AFTER && Date.now() >= (S.nagUntil || 0));
function nagTick() {
  if (!S.dirty) { S.dirtySince = 0; S.nagUntil = 0; } else if (!S.dirtySince) S.dirtySince = Date.now();
  const due = nagDue();
  if (due !== !!S.nagShown) { S.nagShown = due; renderBanners(); }
}
function pushUndo() {
  S.undo.push(JSON.stringify(S.work));
  if (S.undo.length > 60) S.undo.shift();
}
/* every change goes through here: undoable, recalculated, and explained (impact.js) */
function edit(fn, opts) {
  if (S.readonly || !S.work) return;
  const warn = S.work.commitWarn;
  const before = impactSnap(S.work.tasks, S.res, warn);
  // what a person changed: computed starts of linked activities are not inputs
  const inSig = (t) => JSON.stringify((t.deps || []).length && !t.locked ? Object.assign({}, t, { start: null }) : t);
  const sig = new Map(S.work.tasks.map((t) => [t.id, inSig(t)]));
  pushUndo();
  fn();
  recalc();
  setDirty(true);
  const edited = S.work.tasks.filter((t) => sig.get(t.id) !== inSig(t)).map((t) => t.id);
  const imp = computeImpact(before, impactSnap(S.work.tasks, S.res, S.work.commitWarn), edited);
  S.impact = imp.quiet && !(opts && opts.explain) ? null : Object.assign(imp, { at: Date.now(), undoDepth: S.undo.length });
  renderAll();
  showImpact();
}
function undo() {
  if (!S.undo.length || S.readonly) return;
  const w = JSON.parse(S.undo.pop());
  if (w.__rev) { S.base = w.__rev.base; S.baseWork = w.__rev.baseWork; delete w.__rev; } // undoing a merge also goes back to the version it started from
  S.work = w;
  recalc();
  setDirty(true);
  S.impact = null;
  renderAll();
  showImpact();
}

/* ----- loading a schedule into the working copy ----- */
const validHol = (a) => (Array.isArray(a) ? a : []).filter((x) => x && !isNaN(parseDate(x.date))).map((x) => ({ date: x.date, name: x.name || '' }));
function docToWork(d) {
  // holidays belong to the project; older schedules fall back to the shared list until they are saved
  const own = Array.isArray(d.holidays);
  const hol = own ? validHol(d.holidays) : validHol(S.holidays);
  const offDays = normOffDays(d.offDays);
  S.cal = makeCalendar(hol, offDays);
  return { offDays, info: normInfo(d.info), exportDefaults: normExportDefaults(d.exportDefaults), name: d.name || 'Untitled schedule', tasks: normalizeTasks(d.tasks), scale: ['days', 'weeks', 'months', 'quarters'].includes(d.scale) ? d.scale : 'weeks', colors: normColors(d.colors), execOn: d.execOn === true, execColor: normColor(d.execColor) || 'blue', commitWarn: normCommitWarn(d.commitWarn), customColors: validCustom(d.customColors), baselineOn: d.baselineOn === true, baseline: normBaseline(d.baseline), holidays: hol, hset: own ? d.hset === true : hol.length > 0, holShared: !own };
}
function loadDoc(d) {
  S.tpl = null;
  S.cur = d.id;
  S.work = docToWork(d);
  S.base = { sid: d.sid || null, by: d.updatedBy || null, at: d.updatedAt || 0 };
  S.dirty = false; S.remote = null; S.undo = []; S.sel = null; S.multi = new Set(); S.impact = null; S.zoomF = 1;
  S.meta = { projectId: d.projectId || null };
  const proj = S.projects.get(S.meta.projectId);
  S.readonly = !!S.platformRO || !!(proj && proj.status === 'archived');
  recalc();
  S.baseWork = JSON.parse(JSON.stringify(S.work)); // what the server had when I loaded it: the starting point for merging
  try { localStorage.setItem('schedsheet:last', d.id); } catch (e) { /* optional */ }
  refreshNames([d.updatedBy]);
  updatePresence();
}
function onSchedSnap(snap) {
  S.schedLoaded = true;
  const m = new Map();
  for (const d of snap.docs) if (d.exists) m.set(d.id, Object.assign({ id: d.id }, d.data()));
  S.schedules = m;
  if (S.cur && !S.tpl && !m.has(S.cur) && !S.creating) {
    toast('This schedule was deleted.');
    const pid = S.meta.projectId;
    S.cur = null; S.work = null; S.dirty = false; S.res = new Map(); updatePresence();
    if (S.route && S.route.page === 'editor') { go(pid ? '#/scheduler/p/' + pid : DEFAULT_ROUTE, { replace: true }); return; }
  } else if (S.cur && !S.tpl && m.has(S.cur)) {
    handleRemote(m.get(S.cur));
  }
  routeRender();
}
function handleRemote(d) {
  if (!S.work) { loadDoc(d); return; }
  S.meta.projectId = d.projectId || null; // the project link is not part of the merge: the latest one wins
  if ((d.sid || null) === (S.base.sid || null)) return;
  if (!S.dirty) {
    loadDoc(d);
    refreshNames([d.updatedBy]).then(() => toast(nameOf(d.updatedBy) + ' saved changes. You are looking at the latest version.'));
  } else {
    S.remote = { sid: d.sid || null, by: d.updatedBy || null, at: d.updatedAt || 0 };
    refreshNames([d.updatedBy]);
  }
}
function loadTheirs() {
  const d = S.schedules.get(S.cur);
  if (d) { loadDoc(d); renderAll(); toast('Loaded the latest saved version.'); }
}
function onHolSnap(snap) {
  S.holLoaded = true;
  const d = snap.exists ? snap.data() : null;
  S.holidays = d && Array.isArray(d.items) ? d.items.filter((x) => x && !isNaN(parseDate(x.date))) : [];
  if (S.work && S.work.holShared && !S.dirty) { S.work.holidays = validHol(S.holidays); S.work.hset = S.work.holidays.length > 0; }
  else if (!S.work) S.cal = makeCalendar(S.holidays);
  recalc();
  renderAll();
}

/* ----- save ----- */
async function save() {
  if (S.tpl) return saveTemplateEdit();
  if (!S.dirty || S.saving || !S.cur || S.readonly || !S.db) return;
  S.saving = true;
  renderSheet(); renderToolbar();
  const id = S.cur;
  // has someone saved since I loaded? Then merge their changes into mine first, and let me review, instead of overwriting them.
  try {
    const live = await S.db.doc('schedules/' + id).get();
    if (live && live.exists) {
      const d = Object.assign({ id }, live.data());
      if ((d.sid || null) !== (S.base.sid || null)) { S.saving = false; renderAll(); reconcile(d); return; }
    }
  } catch (e) { /* if the check itself fails, save as before */ }
  const prev = S.base;
  const savedWork = JSON.parse(JSON.stringify(S.work));
  const existing = S.schedules.get(S.cur) || {};
  const sid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const at = Date.now();
  const data = {
    name: S.work.name, scale: S.work.scale || 'weeks', colors: normColors(S.work.colors), holidays: validHol(S.work.holidays), hset: !!S.work.hset, execOn: !!S.work.execOn, execColor: normColor(S.work.execColor) || 'blue', customColors: validCustom(S.work.customColors), baselineOn: !!S.work.baselineOn, baseline: normBaseline(S.work.baseline), offDays: normOffDays(S.work.offDays), info: normInfo(S.work.info), exportDefaults: normExportDefaults(S.work.exportDefaults), commitWarn: normCommitWarn(S.work.commitWarn), tasks: cloneTasks(S.work.tasks), sid, updatedBy: S.meId || null, updatedAt: at,
    projectId: S.meta.projectId !== undefined ? S.meta.projectId : (existing.projectId || null),
    createdBy: existing.createdBy || S.meId || null, createdAt: existing.createdAt || at,
  };
  S.base = { sid, by: S.meId, at };
  try {
    await S.db.doc('schedules/' + S.cur).set(data);
    S.dirty = false; S.remote = null; S.err = null; S.work.holShared = false;
    S.baseWork = savedWork;
    toast('Saved.');
    recordHistory(id, data);
  } catch (e) {
    S.base = prev;
    const quota = e && e.code === 'quota_exceeded';
    toast(quota ? 'Could not save: storage is full.' : 'Could not save. Check your connection and try again.');
  }
  S.saving = false;
  updatePresence();
  renderAll();
}

/* ----- merging someone else's saved changes into mine ----- */
async function reconcile(d) {
  if (!S.work || S.readonly || !d) return;
  await refreshNames([d.updatedBy]);
  const who = nameOf(d.updatedBy);
  const keepCal = S.cal;
  const theirs = docToWork(d);
  S.cal = keepCal;
  const base = S.baseWork || theirs;
  const r = merge3(base, S.work, theirs);
  if (r.conflicts.length) openMergeDialog(who, r.conflicts, (choices) => applyMerge(d, theirs, merge3(base, S.work, theirs, choices), who));
  else applyMerge(d, theirs, r, who);
}
function applyMerge(d, theirs, res, who) {
  const snap = JSON.parse(JSON.stringify(S.work));
  snap.__rev = { base: S.base, baseWork: S.baseWork };
  S.undo.push(JSON.stringify(snap));
  if (S.undo.length > 60) S.undo.shift();
  S.work = res.merged;
  S.base = { sid: d.sid || null, by: d.updatedBy || null, at: d.updatedAt || 0 };
  S.baseWork = JSON.parse(JSON.stringify(theirs));
  S.remote = null;
  recalc();
  setDirty(true);
  renderAll();
  const loops = [...S.res.values()].filter((x) => x.cycle).length;
  toast(mergeSummary(res.stats, who) + ' Review it, then Save.' + (loops ? ' Some links now form a loop. See Issues.' : ''), { label: 'Undo', run: undo });
}

/* ----- version history: every save is kept (saves by one person within 10 minutes share one entry), newest 40 ----- */
const HIST_KEEP = 40, HIST_MERGE_MS = 10 * 60 * 1000;
const histPath = (id) => 'schedules/' + id + '/history';
async function recordHistory(id, data) {
  try {
    const col = S.db.collection(histPath(id));
    const L = S.lastSnap;
    const merge = !!L && L.cur === id && L.by === (S.meId || null) && data.updatedAt - L.start < HIST_MERGE_MS;
    const ref = merge ? col.doc(L.hid) : col.doc();
    await ref.set(Object.assign({}, data, { at: data.updatedAt, by: S.meId || null }));
    S.lastSnap = { cur: id, hid: ref.id, by: S.meId || null, start: merge ? L.start : data.updatedAt };
    const snap = await col.orderBy('at', 'desc').limit(HIST_KEEP + 20).get();
    const extra = snap.docs.slice(HIST_KEEP);
    for (const d of extra) await col.doc(d.id).delete();
  } catch (e) { /* history is best effort: a failure here never blocks saving */ }
}
async function loadHistory() {
  const snap = await S.db.collection(histPath(S.cur)).orderBy('at', 'desc').limit(HIST_KEEP).get();
  return snap.docs.map((d) => Object.assign({ hid: d.id }, d.data()));
}
async function clearHistory(id) {
  try {
    const col = S.db.collection(histPath(id));
    const snap = await col.get();
    for (const d of snap.docs) await col.doc(d.id).delete();
  } catch (e) { /* best effort */ }
}
/* what restoring a version would change, compared with what is on screen now */
function historyDiff(snapTasks, curTasks) {
  const cur = new Map(curTasks.map((t) => [t.id, t]));
  const old = new Map((snapTasks || []).map((t) => [String(t.id), t]));
  let add = 0, gone = 0, moved = 0, renamed = 0;
  for (const [id, t] of old) {
    const c = cur.get(id);
    if (!c) { add++; continue; }
    if (c.start !== t.start || (+c.duration || 0) !== (+t.duration || 0)) moved++;
    if ((c.name || '') !== (t.name || '')) renamed++;
  }
  for (const id of cur.keys()) if (!old.has(id)) gone++;
  return { add, gone, moved, renamed, same: !add && !gone && !moved && !renamed };
}
function restoreVersion(v) {
  if (S.readonly || !S.work) return;
  edit(() => { const w = docToWork(v); w.name = S.work.name; S.work = w; S.sel = null; S.multi = new Set(); });
  S.lastSnap = null; // the next save is a new history entry, so the version you restored over stays available
  toast('Restored the version from ' + whenText(v.at) + '. It is not saved yet. Review it, then Save, or Undo to go back.');
}
/* opts: { example, projectId, tasks, execOn, scale, info, quiet } */
async function createSchedule(name, opts) {
  if (opts === true || opts === false) opts = { example: opts };
  opts = opts || {};
  const ref = S.db.collection('schedules').doc();
  const at = Date.now();
  const tasks = opts.tasks || (opts.example ? exampleTasks(todayDay(), S.cal) : []);
  const proj = opts.projectId ? S.projects.get(opts.projectId) : null;
  const info = normInfo(Object.assign({ number: proj ? proj.number : '', client: proj ? proj.client : '' }, opts.info || {}));
  const raw = opts.raw || {};
  const data = { name, scale: opts.scale || 'weeks', colors: normColors(null), execOn: !!opts.execOn, execColor: 'nexus', commitWarn: 0, customColors: [], baselineOn: false, baseline: null, offDays: [0, 6], info, exportDefaults: {}, holidays: validHol(S.holidays), hset: S.holidays.length > 0, tasks, sid: Math.random().toString(36).slice(2, 10) + at.toString(36), updatedBy: S.meId || null, updatedAt: at, createdBy: S.meId || null, createdAt: at, projectId: opts.projectId || null };
  for (const k of ['colors', 'execColor', 'commitWarn', 'customColors', 'baselineOn', 'offDays', 'exportDefaults', 'holidays', 'hset']) if (raw[k] !== undefined) data[k] = JSON.parse(JSON.stringify(raw[k]));
  S.creating = true;
  try {
    await ref.set(data);
    S.schedules.set(ref.id, Object.assign({ id: ref.id }, data));
    loadDoc(Object.assign({ id: ref.id }, data));
    if (opts.projectId && proj && !schedulesOf(opts.projectId).some((d) => d.id !== ref.id)) setPrimary(opts.projectId, ref.id);
    go('#/scheduler/s/' + ref.id);
    if (!opts.quiet) toast('Created \u201c' + name + '\u201d.');
  } catch (e) {
    toast('Could not create the schedule.');
  }
  S.creating = false;
  return ref.id;
}
async function deleteSchedule() {
  if (!S.cur) return;
  const id = S.cur, pid = S.meta.projectId;
  try {
    await S.db.doc('schedules/' + id).delete();
    clearHistory(id);
    S.cur = null; S.work = null; S.dirty = false; S.res = new Map(); S.schedules.delete(id);
    updatePresence();
    go(pid ? '#/scheduler/p/' + pid : DEFAULT_ROUTE);
    toast('Schedule deleted.');
  } catch (e) { toast('Could not delete the schedule.'); }
}
function switchTo(id) {
  if (id === S.cur) return;
  const open = () => { const d = S.schedules.get(id); if (d) { loadDoc(d); go('#/scheduler/s/' + id); } else renderSheet(); };
  if (S.dirty) {
    renderSheet();
    openDialog({
      title: 'Discard unsaved changes?',
      body: h('p', { text: 'You have unsaved changes to “' + S.work.name + '”. Switching schedules will discard them.' }),
      actions: [
        { label: 'Stay here' },
        { label: 'Discard and switch', danger: true, run: open },
      ],
    });
  } else open();
}

/* ----- task operations ----- */
function newTaskAfter(index, kind) {
  const tasks = S.work.tasks;
  const ref = index >= 0 ? S.res.get(tasks[index].id) : (tasks.length ? S.res.get(tasks[tasks.length - 1].id) : null);
  const startDay = ref ? S.cal.next(ref.kind === 'milestone' ? ref.start : ref.end) : S.cal.next(todayDay());
  const ms = kind === 'milestone';
  return { id: newId(), name: ms ? 'New milestone' : 'New activity', kind: ms ? 'milestone' : 'task', duration: ms ? 0 : 7, start: fmtISO(startDay), locked: false, notBefore: null, deps: [], ignore: [], lvl: 'client', exec: false, exColor: null, commit: null };
}
function addTask(afterIndex, kind) {
  const t = newTaskAfter(afterIndex, kind);
  edit(() => {
    const tasks = S.work.tasks;
    const at = afterIndex >= 0 ? afterIndex + 1 : tasks.length;
    tasks.splice(at, 0, t);
  });
  S.sel = t.id; S.focusId = t.id;
  renderAll();
}
function spliceTask(afterIndex) {
  const a = S.work.tasks[afterIndex];
  if (!a) return;
  const t = newTaskAfter(afterIndex);
  t.deps = [{ id: a.id, type: 'FS', lag: 0 }];
  let moved = 0;
  edit(() => {
    S.work.tasks.splice(afterIndex + 1, 0, t);
    for (const x of S.work.tasks) {
      if (x.id === t.id) continue;
      for (const d of x.deps || []) {
        if (d.id === a.id && d.type === 'FS') { d.id = t.id; moved++; }
      }
    }
  });
  S.sel = t.id; S.focusId = t.id;
  renderAll();
  toast(moved
    ? 'Inserted and linked after row ' + (afterIndex + 1) + '. ' + moved + ' task' + (moved === 1 ? '' : 's') + ' now follow' + (moved === 1 ? 's' : '') + ' the new one.'
    : 'Inserted and linked after row ' + (afterIndex + 1) + '. Nothing followed it, so no other links changed.',
  { label: 'Undo', run: undo });
}
function setExColor(id, key) {
  const t = taskById(id);
  if (!t || S.readonly) return;
  edit(() => { t.exColor = normColor(key); });
}
/* ----- project details and shared export settings ----- */
const INFO_MAX = { number: 40, client: 80, issue: 160 };
function normInfo(o) {
  const out = {};
  for (const k of Object.keys(INFO_MAX)) out[k] = String((o && o[k]) || '').replace(/\s+/g, ' ').trim().slice(0, INFO_MAX[k]);
  return out;
}
const projText = () => { const i = S.work && S.work.info; return i ? [i.number && 'Project ' + i.number, i.client && 'Client: ' + i.client].filter(Boolean).join(' \u00b7 ') : ''; };
/* ----- baseline and slip: a snapshot of every task's dates, kept in the schedule ----- */
function normBaseline(b) {
  if (!b || typeof b !== 'object' || !b.tasks || typeof b.tasks !== 'object') return null;
  const tasks = {};
  let n = 0;
  for (const [id, v] of Object.entries(b.tasks)) {
    if (v && !isNaN(parseDate(v.s)) && Number.isFinite(+v.d) && +v.d >= 0) { tasks[id] = { s: v.s, d: Math.round(+v.d) }; n++; }
  }
  return n ? { at: +b.at || 0, by: b.by || null, tasks } : null;
}
const baseActive = () => !!(S.work && S.work.baselineOn && S.work.baseline);
const endOf = (r) => (r.kind === 'milestone' ? r.start : r.start + r.dur);
/* the baseline position of a task as a row-like object, or null when it was added after the baseline */
function baseRow(id) {
  const b = S.work && S.work.baseline && S.work.baseline.tasks[id];
  const r = S.res.get(id);
  if (!b || !r) return null;
  const start = parseDate(b.s);
  return { kind: r.kind, start, dur: b.d, end: start + b.d, finish: start + Math.max(0, b.d - 1) };
}
/* days the finish has moved against the baseline: positive is later, null when there is no baseline for the task */
function slipOf(id) {
  const b = baseRow(id), r = S.res.get(id);
  return b && r ? endOf(r) - b.end : null;
}
const slipText = (n) => (n > 0 ? '+' + n + 'd' : n < 0 ? '\u2212' + (-n) + 'd' : '0');
function setBaseline() {
  if (S.readonly || !S.work) return;
  edit(() => {
    const tasks = {};
    for (const t of S.work.tasks) { const r = S.res.get(t.id); if (r) tasks[t.id] = { s: fmtISO(r.start), d: r.kind === 'milestone' ? 0 : r.dur }; }
    S.work.baseline = { at: Date.now(), by: S.meId || null, tasks };
  });
}
function clearBaseline() {
  if (S.readonly || !S.work) return;
  edit(() => { S.work.baseline = null; });
}
const MAX_CUSTOM = 16;
function validCustom(a) {
  const out = [];
  for (const v of Array.isArray(a) ? a : []) { const c = HEX_RE.test(v) ? v.toLowerCase() : null; if (c && !out.includes(c) && out.length < MAX_CUSTOM) out.push(c); }
  return out;
}
/* saved project colors; adding or removing is undoable like any other edit */
function addCustomColor(hex) {
  const c = HEX_RE.test(hex) ? hex.toLowerCase() : null;
  if (!c || S.readonly) return null;
  const cur = validCustom(S.work.customColors);
  if (cur.includes(c)) return c;
  if (cur.length >= MAX_CUSTOM) { toast('A project can save up to ' + MAX_CUSTOM + ' custom colors. Remove one first.'); return null; }
  edit(() => { S.work.customColors = cur.concat(c); });
  return c;
}
function removeCustomColor(hex) {
  if (S.readonly) return;
  edit(() => { S.work.customColors = validCustom(S.work.customColors).filter((x) => x !== hex); });
}
function setExDefault(key, all) {
  key = normColor(key);
  if (S.readonly || !key) return;
  edit(() => { S.work.execColor = key; if (all) for (const t of S.work.tasks) t.exColor = null; });
}
function deleteTask(id) {
  const t = taskById(id);
  if (!t) return;
  edit(() => {
    S.work.tasks = S.work.tasks.filter((x) => x.id !== id);
    for (const x of S.work.tasks) x.deps = (x.deps || []).filter((d) => d.id !== id);
  });
  if (S.sel === id) S.sel = null;
  renderAll();
  toast('Deleted \u201c' + (t.name || 'activity') + '\u201d.', { label: 'Undo', run: undo });
}
function moveTask(id, dir) {
  const i = S.work.tasks.findIndex((t) => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= S.work.tasks.length) return;
  edit(() => { const a = S.work.tasks; [a[i], a[j]] = [a[j], a[i]]; });
}
function toggleLock(id) {
  const r = S.res.get(id);
  edit(() => {
    const t = taskById(id);
    if (!t.locked) { t.start = fmtISO(r.start); t.locked = true; t.notBefore = null; }
    else t.locked = false;
  });
}
function applyFix(id, fix) {
  const t0 = taskById(id);
  if (t0 && t0.locked) {
    // a locked date was pinned on purpose: changing it takes a deliberate yes
    const r0 = S.res.get(id);
    openDialog({
      title: 'Change a locked date?',
      body: h('div', null, h('p', { text: '\u201c' + (t0.name || 'This task') + '\u201d is locked' + (r0 ? ' at ' + fmtShort(r0.start) : '') + '. \u201c' + fix.label + '\u201d changes that date.' }),
        h('p', { class: 'muted', text: 'It stays locked at the new date. Undo puts it back.' })),
      actions: [{ label: 'Cancel' }, { label: fix.label + ' and keep it locked', primary: true, run: () => { doFix(id, fix); } }],
    });
    return;
  }
  doFix(id, fix);
}
function doFix(id, fix) {
  const r = S.res.get(id);
  edit(() => {
    const t = taskById(id);
    if (fix.type === 'setStart') {
      if (t.locked || r.anchored) t.start = fix.date;
      else t.notBefore = fix.date;
    } else if (fix.type === 'setDuration') {
      t.duration = fix.dur;
    }
  });
}
function ignoreFlag(id, code) {
  edit(() => { const t = taskById(id); t.ignore = (t.ignore || []).concat(code); });
}
const BAD_DATE = 'Couldn\u2019t read that date. Try 10/15, 10/15/26 or Oct 15.';
const readDate = (txt, ref) => parseTyped(txt, ref, todayDay());
function onField(id, f, el) {
  const t = taskById(id), r = S.res.get(id);
  if (!t || !r || S.readonly) return;
  if (f === 'name') { edit(() => { t.name = el.value.trim(); }); return; }
  if (f === 'exec') { edit(() => { t.exec = !!el.checked; }); return; }
  if (f === 'lvl') { if (LEVELS.includes(el.value)) edit(() => { t.lvl = el.value; }); return; }
  if (f === 'kind') {
    edit(() => {
      if (el.value === 'milestone') { t.kind = 'milestone'; t.duration = 0; }
      else { t.kind = 'task'; t.duration = Math.max(1, t.duration || 1); }
    });
    return;
  }
  if (t.locked && (f === 'start' || f === 'finish' || f === 'dur')) {
    toast('This date is locked. Unlock it (padlock) before changing it.');
    renderAll(); return;
  }
  if (f === 'start') {
    const n = readDate(el.value, r.start);
    if (isNaN(n)) { toast(BAD_DATE); renderAll(); return; }
    if (r.anchored) { edit(() => { t.start = fmtISO(n); }, true); return; }
    if (n < r.driven) {
      toast('Its predecessors don\u2019t allow a start before ' + fmtShort(r.driven) + '. Change a link or lag to move it earlier.');
      renderAll(); return;
    }
    edit(() => { t.notBefore = n === r.driven ? null : fmtISO(n); }, true);
    return;
  }
  if (f === 'dur') {
    const v = parseInt(el.value, 10);
    if (!(v >= 1)) { renderAll(); return; }
    edit(() => { t.duration = v; }, true);
    return;
  }
  if (f === 'finish') {
    const n = readDate(el.value, r.finish);
    if (isNaN(n)) { toast(BAD_DATE); renderAll(); return; }
    if (n < r.start) { toast('A task can\u2019t finish before it starts.'); renderAll(); return; }
    edit(() => { t.duration = n - r.start + 1; }, true);
    return;
  }
  if (f === 'preds') {
    const p = parsePreds(el.value, S.work.tasks, id);
    if (p.error) { toast(p.error); renderAll(); return; }
    if (wouldCycle(S.work.tasks, id, p.deps.map((d) => d.id))) {
      toast('That link would make a loop: one of those tasks already depends on this one.');
      renderAll(); return;
    }
    edit(() => { t.deps = p.deps; });
  }
}

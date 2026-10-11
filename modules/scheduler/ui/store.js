/* ===== The Scheduler's data layer =====
   The ONLY Scheduler file that talks to the Toolbox platform (CLAUDE.md rule 1). `P` is the platform object the shell
   hands to mount(): { Session, Directory, Store, Locks, Files, pref, ConflictError, ApiError }.
   It replaces what used to be spread across the app: the live snapshots (now polling), the sid check (now compare-and-set
   on rev), presence (now Locks), the hand-entered project list (now Directory), and personal templates (now owned records).

   Where things live (collections of the "scheduler" module):
     schedules           one per schedule, linked to its project           rev = the version
     h-<scheduleId>      that schedule's saved versions (history)           linked to the project
     project-settings    { primaryId } per project, id ps-<projectId>       linked to the project
     firm-holidays       the firm holiday list, id firm-holidays            firm admins write
     firm-templates      company templates and starter overrides            firm admins and template managers write
     firm-writers        { ids } the template managers, id firm-templates   firm admins write
     personal-templates  my own templates                                   only their owner */
let P = null;
const SCH = 'scheduler';
const COL = { schedules: 'schedules', settings: 'project-settings', holidays: 'firm-holidays', templates: 'firm-templates', writers: 'firm-writers', mine: 'personal-templates' };
const histCol = (id) => 'h-' + id;
const store = (c) => P.Store.collection(SCH, c);

/* ids the server accepts: 6 to 64 letters, digits, - or _. Lower-case hex also keeps "h-<id>" a legal collection name. */
function recId() {
  const a = new Uint8Array(16);
  (window.crypto || window.msCrypto).getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/* starter templates have short ids ("fed"); the server needs at least 6 characters */
const STARTER_PREFIX = 'starter_';
const toRecTplId = (id) => (id.length >= 6 ? id : STARTER_PREFIX + id);
const fromRecTplId = (id) => (id.startsWith(STARTER_PREFIX) ? id.slice(STARTER_PREFIX.length) : id);

/* the revision the server last told us about, per record: lets a plain "save" send the right If-Match */
const REVS = new Map();
const revKey = (c, id) => c + '/' + id;
const noteRevs = (all) => { for (const r of all) REVS.set(revKey(r.collection, r.id), r.rev); };

/* a stored record -> the flat document the editor works with (the server's stamps replace any in the data) */
const STAMPS = ['id', 'projectId', 'rev', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'sid'];
const toDoc = (r) => Object.assign({}, r.data, { id: r.id, projectId: r.projectId, rev: r.rev, createdAt: r.createdAt, createdBy: r.createdBy, updatedAt: r.updatedAt, updatedBy: r.updatedBy });
function plainData(doc) {
  const d = Object.assign({}, doc);
  for (const k of STAMPS) delete d[k];
  d.schemaVersion = 1;
  return d;
}

/* create-or-update one record. `baseRev` given: strict compare-and-set (a conflict throws). Otherwise use the last known rev,
   and for shared settings (`force`) retry once on top of whatever is stored. */
async function putRec(collection, id, data, opts) {
  opts = opts || {};
  const key = revKey(collection, id);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const baseRev = opts.baseRev !== undefined ? opts.baseRev : REVS.get(key);
      const r = await store(collection).save(id, data, { projectId: opts.projectId, baseRev });
      REVS.set(key, r.rev);
      return r;
    } catch (e) {
      if (attempt === 0 && e.status === 428) { // it exists and we did not know its rev (it may be a deleted record we are bringing back)
        let cur = null;
        try { cur = await store(collection).get(id); } catch (e2) { cur = ((await store(collection).list({ since: 0 })).records || []).find((x) => x.id === id) || null; }
        if (cur) { REVS.set(key, cur.rev); opts = Object.assign({}, opts, { baseRev: undefined }); continue; }
      }
      if (attempt === 0 && opts.force && e instanceof P.ConflictError) { REVS.set(key, e.current.rev); opts = Object.assign({}, opts, { baseRev: undefined }); continue; }
      throw e;
    }
  }
}
async function removeRec(collection, id, baseRev) {
  const key = revKey(collection, id);
  try { const r = await store(collection).remove(id, baseRev !== undefined ? baseRev : REVS.get(key)); REVS.set(key, r.rev); return r; }
  catch (e) {
    if (e instanceof P.ConflictError) { const r = await store(collection).remove(id, e.current.rev); REVS.set(key, r.rev); return r; }
    throw e;
  }
}

/* ----- schedules ----- */
/* strict save: throws ConflictError when someone else saved first (the caller merges) */
async function saveScheduleRec(id, data, projectId, baseRev) {
  return putRec(COL.schedules, id, plainData(data), { projectId, baseRev });
}
async function deleteScheduleRec(id) {
  const d = S.schedules.get(id);
  return removeRec(COL.schedules, id, d ? d.rev : undefined);
}
async function moveScheduleRec(id, projectId) {
  const d = S.schedules.get(id);
  if (!d) throw new Error('missing schedule');
  return putRec(COL.schedules, id, plainData(d), { projectId: projectId || null, baseRev: d.rev });
}
async function fetchScheduleDoc(id) { return toDoc(await store(COL.schedules).get(id)); }

/* ----- history ----- */
async function writeHistoryRec(scheduleId, hid, entry, projectId) {
  return putRec(histCol(scheduleId), hid, plainData(entry), { projectId });
}
async function listHistoryRecs(scheduleId) {
  const res = await store(histCol(scheduleId)).list();
  noteRevs(res.records);
  return res.records.map((r) => Object.assign({}, r.data, { hid: r.id, rev: r.rev }));
}
async function dropHistoryRec(scheduleId, hid) { return removeRec(histCol(scheduleId), hid); }

/* ----- a project's primary schedule ----- */
async function setPrimaryRec(projectId, scheduleId) {
  return putRec(COL.settings, 'ps-' + projectId, { schemaVersion: 1, primaryId: scheduleId }, { projectId, force: true });
}

/* ----- templates ----- */
const companyTplStore = () => store(COL.templates);
const mineTplStore = () => store(COL.mine);
async function writeCompanyTplRec(id, data) { return putRec(COL.templates, toRecTplId(id), plainData(data), { force: true }); }
async function deleteCompanyTplRec(id) { return removeRec(COL.templates, toRecTplId(id)); }
async function writeMineTplRec(id, data) { return putRec(COL.mine, id, plainData(data), { force: true }); }
async function deleteMineTplRec(id) { return removeRec(COL.mine, id); }
async function writeTplManagersRec(ids) { return putRec(COL.writers, COL.templates, { schemaVersion: 1, ids }, { force: true }); }

/* ----- downloads: a normal browser download ----- */
const DL = {
  save({ filename, data }) {
    P.Files.save({ filename, data });
    return Promise.resolve({ status: 'saved' });
  },
};

/* ===== what arrives from the server =====
   Each watcher polls (about every 20 seconds, shared/platform/store.js) and hands over the whole current list. */
let stops = [], timers = [], visHandler = null, mountedFlag = false;
const stopData = () => { stops.forEach((f) => f()); stops = []; timers.forEach(clearInterval); timers = []; if (visHandler) { document.removeEventListener('visibilitychange', visHandler); visHandler = null; } };

function onSchedRecords(all) {
  S.schedLoaded = true;
  noteRevs(all);
  const m = new Map(all.map((r) => [r.id, toDoc(r)]));
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
function onSettingsRecords(all) {
  noteRevs(all);
  S.projSettings = new Map(all.filter((r) => r.data && r.projectId).map((r) => [r.projectId, { primaryId: r.data.primaryId || null }]));
  if (S.route && (S.route.page === 'home' || S.route.page === 'project')) routeRender();
}
function onHolRecords(all) {
  noteRevs(all);
  S.holLoaded = true;
  const rec = all.find((r) => r.id === 'firm-holidays');
  const d = rec ? rec.data : null;
  S.holidays = d && Array.isArray(d.items) ? d.items.filter((x) => x && !isNaN(parseDate(x.date))) : [];
  if (S.work && S.work.holShared && !S.dirty) { S.work.holidays = validHol(S.holidays); S.work.hset = S.work.holidays.length > 0; }
  else if (!S.work) S.cal = makeCalendar(S.holidays);
  recalc();
  renderAll();
}
function onTplCompanyRecords(all) {
  noteRevs(all);
  const m = new Map();
  for (const r of all) { const id = fromRecTplId(r.id); m.set(id, normTemplate(Object.assign(toDoc(r), { id }), 'company')); }
  S.tplCompany = m; S.tplLoaded = true;
  tplChanged();
}
function onTplMineRecords(all) {
  noteRevs(all);
  const m = new Map();
  for (const r of all) if (r.data && r.data.kind === 'template') m.set(r.id, normTemplate(toDoc(r), 'mine'));
  S.tplMine = m; S.tplMineLoaded = true;
  tplChanged();
}
function onTplManagersRecords(all) {
  noteRevs(all);
  const rec = all.find((r) => r.id === COL.templates);
  const d = rec ? rec.data : null;
  S.tplManagers = d && Array.isArray(d.ids) ? d.ids.filter((x) => typeof x === 'string').slice(0, 50) : [];
  tplChanged();
}

/* projects: from the Vantagepoint copy, read-only. There is no change feed, so look again every minute and when the tab returns. */
let projSig = '';
async function refreshProjects() {
  try {
    const [act, arch, mine] = await Promise.all([P.Directory.projects(), P.Directory.projects({ scope: 'archived' }), P.Directory.projects({ scope: 'mine' })]);
    const mineIds = new Set(mine.map((p) => p.id));
    const m = new Map();
    for (const p of act.concat(arch)) m.set(p.id, normProject(Object.assign({}, p, { mine: mineIds.has(p.id) })));
    const sig = JSON.stringify([...m.values()]);
    S.projLoaded = true;
    if (sig === projSig) return;
    projSig = sig;
    S.projects = m;
    if (S.work && !S.tpl) S.readonly = readonlyFor(S.meta.projectId);
    routeRender();
  } catch (e) { fail('Could not load projects', e); }
}

/* who is editing: locks are shown as presence. A lock lasts about 45 seconds and the editor refreshes its own. */
let lockSig = '';
async function refreshLocks() {
  try {
    const list = await P.Locks.list(SCH, COL.schedules);
    const sig = JSON.stringify(list.map((l) => [l.recordId, l.personId]));
    if (sig === lockSig) return;
    lockSig = sig;
    S.peers = list.filter((l) => l.personId !== S.meId).map((l) => ({ by: l.personId, kind: 'viewer', isMe: false, presence: { sid: l.recordId, dirty: true } }));
    renderSheet(); renderBanners();
  } catch (e) { /* presence is optional */ }
}
let lockHandle = null, lockFor = null, lockSeq = 0;
function releaseLock() {
  const h = lockHandle;
  lockHandle = null; lockFor = null; lockSeq++;
  if (h && h.release) h.release();
}
/* hold a lock on the open schedule while it has unsaved changes; let it go otherwise */
async function syncLock() {
  const want = S.cur && S.dirty && !S.readonly && !S.tpl ? S.cur : null;
  if (want === lockFor) return;
  releaseLock();
  if (!want) return;
  lockFor = want;
  const seq = ++lockSeq;
  try {
    const handle = await P.Locks.hold(SCH, COL.schedules, want, { onLost: () => refreshLocks() });
    if (seq !== lockSeq) { handle.release(); return; }
    lockHandle = handle;
    if (!handle.held) { lockSig = ''; refreshLocks(); }
  } catch (e) { /* presence is optional */ }
}

/* people: names are looked up from the directory, never stored in records */
async function loadNames() {
  try { for (const p of await P.Session.directory()) S.names[p.id] = p.name; } catch (e) { /* names are optional */ }
}

/* start everything once the module is first shown */
async function startData() {
  stopData();
  const me = P.Session.me();
  S.meId = me ? me.id : null;
  S.isOwner = P.Session.isAdmin();
  S.db = true; S.room = true; S.dl = DL;
  await loadNames();
  const onErr = (what) => (e) => fail('Could not load ' + what, e);
  stops.push(store(COL.schedules).watch(onSchedRecords, { onError: onErr('schedules') }));
  stops.push(store(COL.settings).watch(onSettingsRecords, { onError: onErr('project settings') }));
  stops.push(store(COL.holidays).watch(onHolRecords, { onError: onErr('holidays') }));
  stops.push(store(COL.templates).watch(onTplCompanyRecords, { onError: onErr('templates') }));
  stops.push(store(COL.writers).watch(onTplManagersRecords, {}));
  stops.push(store(COL.mine).watch(onTplMineRecords, {}));
  refreshProjects(); refreshLocks();
  timers.push(setInterval(refreshProjects, 60000), setInterval(refreshLocks, 15000));
  visHandler = () => { if (!document.hidden) { refreshProjects(); refreshLocks(); } };
  document.addEventListener('visibilitychange', visHandler);
}

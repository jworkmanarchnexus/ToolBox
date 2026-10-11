/* ===== Template library: where templates live and who may change them =====
   Three sources, one shape (see templates.js):
   - Starter templates ship with the app (TEMPLATES). A template manager can edit one, which
     saves a company copy under the same id, or remove it, which saves a hidden marker.
   - Company templates: `templates/<id>`, read by everyone, changed by template managers.
   - My templates: `data/users/<my id>/<id>` with kind "template", private to each person.
   Template managers: `config/templateManagers` { ids: [user ids] }. The page owner is always a
   manager and is the only one who changes the list (a db rule enforces that part). In production
   both become a firm-wide role checked on the server (SPEC 4.2, 16.5); here the company list is
   only gated in the interface, because database rules cannot follow a list of people. */
S.tplCompany = new Map(); // id -> stored company doc (overrides, hidden markers, new templates)
S.tplMine = new Map();
S.tplManagers = [];
S.tplLoaded = false;
S.isOwner = false;

const TPL_NAME_MAX = 80, TPL_DESC_MAX = 240, TPL_CAT_MAX = 40;
const TPL_SCALES = ['days', 'weeks', 'months', 'quarters'];
const tplClean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
function normTplTasks(ts) {
  const out = [], seen = new Set();
  for (const t of Array.isArray(ts) ? ts : []) {
    if (!t || typeof t !== 'object') continue;
    const k = tplClean(t.k, 40);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const o = { k, name: tplClean(t.name, 200) };
    if (t.ms) o.ms = true; else o.d = Math.max(1, Math.min(3650, Math.round(+t.d || 1)));
    const after = (Array.isArray(t.after) ? t.after : []).map((a) => {
      if (Array.isArray(a)) return [tplClean(a[0], 40), a[1] === 'SS' ? 'SS' : 'FS', Math.round(+a[2] || 0)];
      return tplClean(a, 40);
    }).filter((a) => (Array.isArray(a) ? a[0] : a));
    if (after.length) o.after = after;
    if (['design', 'internal'].includes(t.lvl)) o.lvl = t.lvl;
    if (t.exec) { o.exec = true; if (t.exColor !== undefined) o.exColor = normColor(t.exColor) || null; }
    if (t.phase && !o.ms) o.phase = true;
    if (!o.after && Number.isFinite(+t.off) && Math.round(+t.off)) o.off = Math.round(+t.off);
    out.push(o);
  }
  // links to keys that are not in the template are dropped
  for (const o of out) if (o.after) { o.after = o.after.filter((a) => seen.has(Array.isArray(a) ? a[0] : a) && (Array.isArray(a) ? a[0] : a) !== o.k); if (!o.after.length) delete o.after; }
  return out;
}
function normTemplate(d, scope) {
  return {
    id: d.id, scope,
    name: tplClean(d.name, TPL_NAME_MAX) || 'Untitled template',
    category: tplClean(d.category, TPL_CAT_MAX),
    description: tplClean(d.description, TPL_DESC_MAX),
    scale: TPL_SCALES.includes(d.scale) ? d.scale : 'weeks',
    execOn: d.execOn === true,
    tasks: normTplTasks(d.tasks),
    basedOn: d.basedOn ? tplClean(d.basedOn, 120) : null,
    hidden: d.hidden === true,
    createdBy: d.createdBy || null, createdAt: +d.createdAt || 0,
    updatedBy: d.updatedBy || null, updatedAt: +d.updatedAt || 0,
  };
}
/* the stored form: what goes to the database */
function tplData(t) {
  return { kind: 'template', name: t.name, category: t.category || '', description: t.description || '', scale: t.scale || 'weeks', execOn: !!t.execOn, tasks: normTplTasks(t.tasks), basedOn: t.basedOn || null, hidden: false, createdBy: t.createdBy || S.meId || null, createdAt: t.createdAt || Date.now(), updatedBy: S.meId || null, updatedAt: Date.now() };
}

/* ----- lists ----- */
const STARTER_IDS = new Set(TEMPLATES.map((t) => t.id));
function companyTemplates() {
  const out = [];
  for (const t of TEMPLATES) {
    if (t.id === 'blank') continue;
    const o = S.tplCompany.get(t.id);
    if (o && o.hidden) continue;
    out.push(o ? Object.assign({}, o, { starterId: t.id }) : Object.assign({}, t, { scope: 'company', starter: true, starterId: t.id, updatedAt: 0 }));
  }
  for (const o of S.tplCompany.values()) if (!STARTER_IDS.has(o.id) && !o.hidden) out.push(o);
  return out.sort((a, b) => (a.category || '~').localeCompare(b.category || '~') || a.name.localeCompare(b.name));
}
const hiddenStarters = () => TEMPLATES.filter((t) => t.id !== 'blank' && S.tplCompany.get(t.id) && S.tplCompany.get(t.id).hidden);
const myTemplates = () => [...S.tplMine.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
const tplKey = (t) => (t.scope === 'mine' ? 'mine:' : 'company:') + t.id;
function tplByKey(key) {
  if (!key) return null;
  if (key === 'blank' || key === 'company:blank') return tplById('blank');
  const [scope, id] = key.split(':');
  if (scope === 'mine') return S.tplMine.get(id) || null;
  return companyTemplates().find((t) => t.id === id) || null;
}

/* ----- who may do what (interface gate; the server enforces in production) ----- */
const isTplManager = () => !!(S.db && (S.isOwner || (S.meId && S.tplManagers.includes(S.meId))));
const canEditTpl = (t) => !!(t && S.db && !S.platformRO && (t.scope === 'mine' ? !!S.meId : isTplManager()));
const canMine = () => !!(S.db && S.meId && !S.platformRO);

/* ----- live data ----- */
function onTplCompanySnap(snap) {
  const m = new Map();
  for (const d of snap.docs) if (d.exists) m.set(d.id, normTemplate(Object.assign({ id: d.id }, d.data()), 'company'));
  S.tplCompany = m; S.tplLoaded = true;
  tplChanged();
}
function onTplMineSnap(snap) {
  const m = new Map();
  for (const d of snap.docs) { if (!d.exists) continue; const x = d.data(); if (x && x.kind === 'template') m.set(d.id, normTemplate(Object.assign({ id: d.id }, x), 'mine')); }
  S.tplMine = m;
  tplChanged();
}
function onTplManagersSnap(snap) {
  const d = snap.exists ? snap.data() : null;
  S.tplManagers = d && Array.isArray(d.ids) ? d.ids.filter((x) => typeof x === 'string').slice(0, 50) : [];
  refreshNames(S.tplManagers);
  tplChanged();
}
function tplChanged() {
  if (S.route && S.route.page === 'editor' && S.route.tpl && !S.tpl) { routeRender(); return; } // a template link opened before the library arrived
  if (S.route && S.route.page === 'templates') renderTemplates();
  if (S.route && S.route.page === 'editor' && S.tpl) { renderSheet(); renderToolbar(); }
}
const myTplCol = () => S.db.collection('data/users/' + S.meId);

/* ----- writes ----- */
const tplNewId = () => 'tpl' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
async function createMyTemplate(t) {
  if (!canMine()) { toast('Sign in to keep your own templates.'); return null; }
  const id = tplNewId();
  const data = tplData(Object.assign({}, t, { createdBy: S.meId, createdAt: Date.now() }));
  try { await myTplCol().doc(id).set(data); S.tplMine.set(id, normTemplate(Object.assign({ id }, data), 'mine')); return id; } catch (e) { toast('Could not save the template.'); return null; }
}
async function writeTemplate(t) {
  if (!canEditTpl(t)) { toast('Only template managers can change company templates.'); return false; }
  const data = tplData(t);
  try {
    if (t.scope === 'mine') { await myTplCol().doc(t.id).set(data); S.tplMine.set(t.id, normTemplate(Object.assign({ id: t.id }, data), 'mine')); }
    else { await S.db.doc('templates/' + t.id).set(data); S.tplCompany.set(t.id, normTemplate(Object.assign({ id: t.id }, data), 'company')); }
    return true;
  } catch (e) { toast('Could not save the template.'); return false; }
}
async function deleteTemplate(t) {
  if (!canEditTpl(t)) return false;
  try {
    if (t.scope === 'mine') { await myTplCol().doc(t.id).delete(); S.tplMine.delete(t.id); }
    else if (STARTER_IDS.has(t.id)) { const data = { kind: 'template', hidden: true, name: t.name, updatedBy: S.meId || null, updatedAt: Date.now() }; await S.db.doc('templates/' + t.id).set(data); S.tplCompany.set(t.id, normTemplate(Object.assign({ id: t.id }, data), 'company')); }
    else { await S.db.doc('templates/' + t.id).delete(); S.tplCompany.delete(t.id); }
    return true;
  } catch (e) { toast('Could not delete the template.'); return false; }
}
/* starter templates removed by a manager can be brought back */
async function restoreStarter(id) {
  if (!isTplManager()) return;
  try { await S.db.doc('templates/' + id).delete(); S.tplCompany.delete(id); toast('Restored “' + tplById(id).name + '”.'); } catch (e) { toast('Could not restore the template.'); }
}
async function moveToCompany(t) {
  if (t.scope !== 'mine' || !isTplManager()) return null;
  const data = tplData(t);
  try {
    await S.db.doc('templates/' + t.id).set(data);
    await myTplCol().doc(t.id).delete();
    S.tplMine.delete(t.id);
    S.tplCompany.set(t.id, normTemplate(Object.assign({ id: t.id }, data), 'company'));
    return t.id;
  } catch (e) { toast('Could not move the template.'); return null; }
}
async function setTplManagers(ids) {
  if (!S.isOwner) return false;
  try { await S.db.doc('config/templateManagers').set({ ids: [...new Set(ids)].slice(0, 50), updatedBy: S.meId || null, updatedAt: Date.now() }); return true; } catch (e) { toast('Could not update the template managers.'); return false; }
}

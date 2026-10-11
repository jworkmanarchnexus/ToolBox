/* ===== Projects: the data boundary for project information =====
   In production, projects (number, name, client, status, team) come from Vantagepoint and
   are read-only here. Vantagepoint is NOT connected in this preview, so projects are a local
   list kept with the schedules and labeled as such everywhere they appear. Everything that
   reads or writes a project goes through this file, so swapping in the real source touches
   one place (see docs/PLATFORM-SEAM.md, "Projects").
   Schedules point at their project with `projectId` (a column in production). A schedule
   with no projectId is "unassigned": older schedules made before projects existed. */
const PROJECT_SOURCE = { kind: 'local', label: 'Local project list', note: 'Vantagepoint is not connected yet, so projects are entered here by hand. When it is, this list is replaced by Vantagepoint projects and these fields become read-only.' };
S.projects = new Map();
S.projLoaded = false;

const normProject = (d) => ({
  id: d.id,
  number: String(d.number || '').trim().slice(0, 24),
  name: String(d.name || 'Untitled project').trim().slice(0, 120),
  client: String(d.client || '').trim().slice(0, 80),
  status: d.status === 'archived' ? 'archived' : 'active',
  primaryId: d.primaryId || null,
  createdBy: d.createdBy || null, createdAt: +d.createdAt || 0, updatedAt: +d.updatedAt || 0,
  source: 'local',
});
function onProjSnap(snap) {
  const m = new Map();
  for (const d of snap.docs) if (d.exists) m.set(d.id, normProject(Object.assign({ id: d.id }, d.data())));
  S.projects = m;
  S.projLoaded = true;
  routeRender();
}
const projectOf = (sched) => (sched && sched.projectId ? S.projects.get(sched.projectId) || null : null);
const schedulesOf = (projectId) => [...S.schedules.values()].filter((d) => (d.projectId || null) === (projectId || null));
const projLabel = (p) => (p ? [p.number, p.name].filter(Boolean).join(' · ') : 'Unassigned schedules');

async function createProject(fields) {
  if (!S.db || S.readonly) return null;
  const ref = S.db.collection('projects').doc();
  const at = Date.now();
  const p = normProject(Object.assign({ id: ref.id }, fields, { createdBy: S.meId || null, createdAt: at, updatedAt: at }));
  const data = Object.assign({}, p); delete data.id;
  try { await ref.set(data); S.projects.set(ref.id, p); return p; } catch (e) { toast('Could not add the project.'); return null; }
}
async function updateProject(id, fields) {
  const p = S.projects.get(id);
  if (!p || !S.db || S.readonly) return false;
  const next = normProject(Object.assign({}, p, fields, { updatedAt: Date.now() }));
  const data = Object.assign({}, next); delete data.id;
  try { await S.db.doc('projects/' + id).set(data); S.projects.set(id, next); return true; } catch (e) { toast('Could not update the project.'); return false; }
}
/* exactly one primary schedule per project; the first schedule made is primary until changed */
const primaryOf = (projectId) => {
  const p = S.projects.get(projectId);
  const list = schedulesOf(projectId);
  if (p && p.primaryId && list.some((d) => d.id === p.primaryId)) return p.primaryId;
  const first = list.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
  return first ? first.id : null;
};
async function setPrimary(projectId, scheduleId) { return updateProject(projectId, { primaryId: scheduleId }); }
/* move a schedule into a project (or out to unassigned). Only the link changes. */
async function assignSchedule(scheduleId, projectId) {
  const d = S.schedules.get(scheduleId);
  if (!d || !S.db || S.readonly) return false;
  try {
    await S.db.doc('schedules/' + scheduleId).update({ projectId: projectId || null });
    d.projectId = projectId || null;
    if (S.cur === scheduleId) S.meta.projectId = projectId || null;
    return true;
  } catch (e) { toast('Could not move the schedule.'); return false; }
}

/* recent projects: a personal convenience, kept on this device */
function noteRecent(projectId) {
  if (!projectId) return;
  try {
    const list = JSON.parse(localStorage.getItem('toolbox:recent') || '[]').filter((x) => x !== projectId);
    list.unshift(projectId);
    localStorage.setItem('toolbox:recent', JSON.stringify(list.slice(0, 8)));
  } catch (e) { /* optional */ }
}
function recentProjects() {
  try { return JSON.parse(localStorage.getItem('toolbox:recent') || '[]').map((id) => S.projects.get(id)).filter(Boolean); } catch (e) { return []; }
}
/* "My projects" without Vantagepoint: projects you added, saved a schedule in, or opened */
function isMine(p) {
  if (!p) return false;
  if (p.createdBy && p.createdBy === S.meId) return true;
  if (schedulesOf(p.id).some((d) => d.createdBy === S.meId || d.updatedBy === S.meId)) return true;
  return recentProjects().some((x) => x.id === p.id);
}

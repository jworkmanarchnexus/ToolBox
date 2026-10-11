/* ===== Projects: what the Scheduler knows about a project =====
   Projects come from the Toolbox directory (the nightly Vantagepoint copy) and are read-only here: number, name, client,
   status, and what the signed-in person may do on the project. The Scheduler stores only its own extras (a project's
   primary schedule), in its own records. Everything that reads a project goes through this file (store.js loads them).
   Schedules point at their project with `projectId`. A schedule with no projectId is "unassigned": it can only
   exist from before projects were required, and only its creator or a firm admin can change it. */
const PROJECT_SOURCE = { kind: 'vantagepoint', label: 'From Vantagepoint', note: 'Projects come from the nightly Vantagepoint copy, so their details can’t be changed here.' };
S.projects = new Map();
S.projLoaded = false;

const normProject = (d) => ({
  id: d.id,
  number: String(d.number || '').trim().slice(0, 24),
  name: String(d.name || 'Untitled project').trim().slice(0, 120),
  client: String(d.client || '').trim().slice(0, 80),
  status: d.status === 'archived' ? 'archived' : 'active',
  access: ['read', 'write', 'admin'].includes(d.access) ? d.access : 'read',
  mine: !!d.mine,
  updatedAt: +d.updatedAt || 0,
});
const projectOf = (sched) => (sched && sched.projectId ? S.projects.get(sched.projectId) || null : null);
const schedulesOf = (projectId) => [...S.schedules.values()].filter((d) => (d.projectId || null) === (projectId || null));
const projLabel = (p) => (p ? [p.number, p.name].filter(Boolean).join(' · ') : 'Unassigned schedules');

/* may this person change schedules in the project? The server decides for real; this only hides controls. */
const canWriteProject = (p) => !!p && p.status === 'active' && (p.access === 'write' || p.access === 'admin');
function readonlyFor(projectId) {
  if (!projectId) return false; // unassigned: the server allows only the creator and firm admins
  const p = S.projects.get(projectId);
  return !p || !canWriteProject(p);
}
/* projects that can take a new schedule */
const writableProjects = () => [...S.projects.values()].filter(canWriteProject).sort((a, b) => (a.number || a.name).localeCompare(b.number || b.name));
const canCreateAnywhere = () => !!S.db && writableProjects().length > 0;

/* exactly one primary schedule per project; the first schedule made is primary until changed */
const primaryOf = (projectId) => {
  const set = S.projSettings.get(projectId);
  const list = schedulesOf(projectId);
  if (set && set.primaryId && list.some((d) => d.id === set.primaryId)) return set.primaryId;
  const first = list.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
  return first ? first.id : null;
};
async function setPrimary(projectId, scheduleId) {
  try { await setPrimaryRec(projectId, scheduleId); S.projSettings.set(projectId, { primaryId: scheduleId }); return true; }
  catch (e) { toast('Could not change the primary schedule.'); return false; }
}
/* move a schedule into a project. Only the link changes. */
async function assignSchedule(scheduleId, projectId) {
  const d = S.schedules.get(scheduleId);
  if (!d || !S.db || !projectId) return false;
  try {
    const rec = await moveScheduleRec(scheduleId, projectId);
    S.schedules.set(scheduleId, toDoc(rec));
    if (S.cur === scheduleId) { S.meta.projectId = projectId; S.base.rev = rec.rev; S.readonly = readonlyFor(projectId); }
    return true;
  } catch (e) { toast(e && e.status === 403 ? 'You can’t move this schedule: you need edit access in both projects.' : 'Could not move the schedule.'); return false; }
}

/* recent projects: a personal convenience, kept on this device */
function recentIds() { try { return JSON.parse(pref('sched.recent') || '[]'); } catch (e) { return []; } }
function noteRecent(projectId) {
  if (!projectId) return;
  pref('sched.recent', JSON.stringify([projectId].concat(recentIds().filter((x) => x !== projectId)).slice(0, 8)));
}
function recentProjects() { return recentIds().map((id) => S.projects.get(id)).filter(Boolean); }
/* "My projects": the ones you are on the team of in Vantagepoint */
const isMine = (p) => !!p && !!p.mine;

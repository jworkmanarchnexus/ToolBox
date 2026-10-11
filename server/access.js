'use strict';
/* Builds the input for the shared permission rules (shared/rules/permissions.js) from the database.
   The server runs these rules on every call; the browser only uses them to hide controls. */
const P = require('../shared/rules/permissions');

function projectRow(db, id) { return db.get('SELECT * FROM projects WHERE id = ?', id); }

function firmRoleOf(db, personId) {
  const r = db.get('SELECT firm_role FROM people WHERE id = ?', personId);
  return r && r.firm_role ? [r.firm_role] : [];
}

/* people: every person whose firm role matters for this decision (the user, and a target for canDeny) */
function accessInput(db, userId, project, people) {
  const firmRoles = {};
  for (const p of new Set([userId].concat(people || []))) firmRoles[p] = firmRoleOf(db, p);
  return {
    user: userId,
    firmRoles,
    vpTeam: db.all('SELECT person_id, role FROM project_team WHERE project_id = ?', project.id).map(r => ({ user: r.person_id, role: r.role })),
    overrides: db.all('SELECT person_id, kind FROM access_overrides WHERE project_id = ?', project.id).map(r => ({ user: r.person_id, kind: r.kind })),
    archived: project.status === 'archived',
  };
}

function levelFor(db, userId, project) {
  return P.effectiveAccess(accessInput(db, userId, project));
}

function isFirmAdmin(db, userId) { return firmRoleOf(db, userId).includes('admin'); }

/* may this user perform `action` (view, edit, create, delete, manageAccess ...) on this project? */
function can(db, userId, project, action) {
  return P.canDo(levelFor(db, userId, project), action, { archived: project.status === 'archived', firmAdmin: isFirmAdmin(db, userId) });
}

module.exports = { projectRow, firmRoleOf, accessInput, levelFor, isFirmAdmin, can, ACCESS_NAME: P.ACCESS_NAME, P };

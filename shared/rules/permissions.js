/* ===== Effective access to a project (SPEC 4.3) =====
   Pure function: give it what Vantagepoint says, the manual overrides and the firm roles,
   and it returns NONE, READ, WRITE or ADMIN. It is written to run on the SERVER, where
   production must enforce it on every call; the browser only uses it to hide controls.
   In this preview Vantagepoint is not connected, so the app does not call it for real
   decisions (the host platform decides who can edit). Tested in tests/test-units.js.

   input = {
     user: 'u1',
     firmRoles: { u1: ['admin'] | ['viewer'] },
     vpTeam: [{ user: 'u2', role: 'pic' | 'pm' | 'pa' | 'team' }],
     overrides: [{ user: 'u3', kind: 'deny' | 'grant_viewer' | 'grant_editor' }],
     archived: false,
   } */
const ACCESS = { NONE: 0, READ: 1, WRITE: 2, ADMIN: 3 };
const ACCESS_NAME = ['none', 'read', 'write', 'admin'];
function effectiveAccess(input) {
  const u = input.user;
  const roles = (input.firmRoles && input.firmRoles[u]) || [];
  if (roles.includes('admin')) return ACCESS.ADMIN;
  const ov = (input.overrides || []).find((o) => o.user === u);
  if (ov && ov.kind === 'deny') return ACCESS.NONE;
  let lvl = ACCESS.NONE;
  for (const m of input.vpTeam || []) {
    if (m.user !== u) continue;
    lvl = Math.max(lvl, m.role === 'pic' || m.role === 'pm' || m.role === 'pa' ? ACCESS.ADMIN : ACCESS.READ);
  }
  if (ov && ov.kind === 'grant_editor') lvl = Math.max(lvl, ACCESS.WRITE);
  if (ov && ov.kind === 'grant_viewer') lvl = Math.max(lvl, ACCESS.READ);
  if (roles.includes('viewer')) lvl = Math.max(lvl, ACCESS.READ);
  return lvl;
}
/* what a level may do; archived projects are read-only for everyone (firm admins may delete) */
function canDo(level, action, opts) {
  const archived = !!(opts && opts.archived), firmAdmin = !!(opts && opts.firmAdmin);
  switch (action) {
    case 'view': case 'export': case 'duplicateFrom': return level >= ACCESS.READ;
    case 'edit': case 'create': case 'restore': case 'duplicateInto': return !archived && level >= ACCESS.WRITE;
    case 'delete': return archived ? firmAdmin : level >= ACCESS.WRITE;
    case 'manageAccess': return level >= ACCESS.ADMIN;
    default: return false;
  }
}
/* may `actor` deny `target` on this project? (no lockouts, no fights between PIC/PM/PA) */
function canDeny(input, actor, target) {
  const firm = (input.firmRoles && input.firmRoles[actor]) || [];
  if (firm.includes('admin')) return actor !== target;
  if (actor === target) return false;
  const lead = (u) => (input.vpTeam || []).some((m) => m.user === u && (m.role === 'pic' || m.role === 'pm' || m.role === 'pa'));
  if (!lead(actor)) return false;
  return !lead(target);
}
/* the duplicate rule: read or better on the source, write on the destination */
function canDuplicate(srcLevel, destLevel, destArchived) { return srcLevel >= ACCESS.READ && destLevel >= ACCESS.WRITE && !destArchived; }

if (typeof module !== 'undefined' && module.exports) module.exports = { ACCESS, ACCESS_NAME, effectiveAccess, canDo, canDeny, canDuplicate };

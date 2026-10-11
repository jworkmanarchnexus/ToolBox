'use strict';
/* Vantagepoint copy. In production a nightly job fills these tables; locally the same code loads CSV files.
   The Toolbox never calls Vantagepoint during the day (CONTRACT section 8, decision 5). */
const { parseCsv } = require('./csv');
const { newId } = require('./ids');

const need = (rows, cols, kind) => {
  if (rows.length) for (const c of cols) if (!(c in rows[0])) throw Object.assign(new Error(`${kind} CSV is missing the column "${c}"`), { status: 400 });
};
const teamRole = r => ({ pic: 'pic', pm: 'pm', pa: 'pa' }[String(r).toLowerCase()] || 'team');

function importEmployees(db, csv) {
  const rows = parseCsv(csv);
  need(rows, ['EmployeeID', 'Username', 'FirstName', 'LastName'], 'employees');
  let added = 0, updated = 0;
  db.tx(() => {
    for (const r of rows) {
      const name = `${r.FirstName} ${r.LastName}`.trim();
      const active = /^active$/i.test(r.Status || 'Active') ? 1 : 0;
      const ex = db.get('SELECT id FROM people WHERE vp_employee_id = ? OR username = ?', r.EmployeeID, r.Username);
      if (ex) {
        db.run('UPDATE people SET username=?, display_name=?, email=?, title=?, vp_employee_id=?, active=? WHERE id=?', r.Username, name, r.Email || null, r.Title || null, r.EmployeeID, active, ex.id);
        updated++;
      } else {
        db.run('INSERT INTO people (id, username, display_name, email, title, vp_employee_id, active) VALUES (?,?,?,?,?,?,?)', newId(), r.Username, name, r.Email || null, r.Title || null, r.EmployeeID, active);
        added++;
      }
    }
  });
  return { rows: rows.length, added, updated };
}

function importProjects(db, csv) {
  const rows = parseCsv(csv);
  need(rows, ['ProjectID', 'ProjectNumber', 'ProjectName'], 'projects');
  let added = 0, updated = 0;
  db.tx(() => {
    for (const r of rows) {
      const status = /^active$/i.test(r.Status || 'Active') ? 'active' : 'archived';
      const ex = db.get('SELECT * FROM projects WHERE vp_project_id = ?', r.ProjectID);
      const now = db.now();
      if (ex) {
        const same = ex.number === r.ProjectNumber && ex.name === r.ProjectName && (ex.client || '') === (r.Client || '') && ex.status === status;
        if (!same) db.run('UPDATE projects SET number=?, name=?, client=?, status=?, vp_number=?, rev=rev+1, updated_at=?, updated_by=NULL WHERE id=?', r.ProjectNumber, r.ProjectName, r.Client || null, status, r.ProjectNumber, now, ex.id);
        updated++;
      } else {
        db.run('INSERT INTO projects (id, number, name, client, status, vp_project_id, vp_number, source, schema_version, rev, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          newId(), r.ProjectNumber, r.ProjectName, r.Client || null, status, r.ProjectID, r.ProjectNumber, 'vantagepoint', 1, 1, now, now);
        added++;
      }
    }
  });
  return { rows: rows.length, added, updated };
}

/* replaces the team of every project that appears in the file, as a nightly copy would */
function importTeam(db, csv) {
  const rows = parseCsv(csv);
  need(rows, ['ProjectID', 'EmployeeID', 'Role'], 'team');
  const skipped = [];
  let written = 0;
  db.tx(() => {
    const projects = new Map();
    for (const r of rows) {
      const p = db.get('SELECT id FROM projects WHERE vp_project_id = ?', r.ProjectID);
      if (!p) { skipped.push(`unknown project ${r.ProjectID}`); continue; }
      projects.set(r.ProjectID, p.id);
    }
    for (const id of projects.values()) db.run('DELETE FROM project_team WHERE project_id = ?', id);
    for (const r of rows) {
      const pid = projects.get(r.ProjectID);
      const e = db.get('SELECT id FROM people WHERE vp_employee_id = ?', r.EmployeeID);
      if (!pid) continue;
      if (!e) { skipped.push(`unknown employee ${r.EmployeeID} on ${r.ProjectID}`); continue; }
      const dup = db.get('SELECT 1 AS x FROM project_team WHERE project_id=? AND person_id=?', pid, e.id);
      if (dup) { skipped.push(`duplicate ${r.EmployeeID} on ${r.ProjectID}`); continue; }
      db.run('INSERT INTO project_team (project_id, person_id, role) VALUES (?,?,?)', pid, e.id, teamRole(r.Role));
      written++;
    }
  });
  return { rows: rows.length, written, skipped };
}

/* local only: Toolbox firm roles are not in Vantagepoint, so they come from their own small file */
function importFirmRoles(db, csv) {
  const rows = parseCsv(csv);
  need(rows, ['Username', 'Role'], 'firm roles');
  db.tx(() => {
    db.run('UPDATE people SET firm_role = NULL');
    for (const r of rows) {
      if (!['admin', 'viewer'].includes(r.Role)) throw Object.assign(new Error(`unknown firm role "${r.Role}"`), { status: 400 });
      db.run('UPDATE people SET firm_role = ? WHERE username = ?', r.Role, r.Username);
    }
  });
  return { rows: rows.length };
}

module.exports = { importEmployees, importProjects, importTeam, importFirmRoles };

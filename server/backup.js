'use strict';
/* Backup export and import (CONTRACT section 6). Import is additive: anything that already exists is reported, never overwritten.
   Full backup  (app "toolbox"): core tables plus every module's records, keyed "module/collection".
   Module backup (app = module name): that module's records, keyed by collection. */
const { HttpError } = require('./errors');
const records = require('./records');

const FORMAT = 'toolbox-backup';

function exportBackup(db, userId, moduleName) {
  const people = Object.fromEntries(db.all('SELECT id, display_name FROM people ORDER BY id').map(p => [p.id, p.display_name]));
  const out = {
    format: FORMAT, formatVersion: 1, app: moduleName || 'toolbox', appSchemaVersion: db.get('SELECT version FROM schema_info').version,
    exportedAt: new Date().toISOString(), exportedBy: userId, people, collections: {},
  };
  const rows = moduleName
    ? db.all('SELECT * FROM records WHERE module = ? ORDER BY collection, id', moduleName)
    : db.all('SELECT * FROM records ORDER BY module, collection, id');
  for (const r of rows) {
    const key = moduleName ? r.collection : `${r.module}/${r.collection}`;
    (out.collections[key] = out.collections[key] || {})[r.id] = records.toRecord(r);
  }
  if (!moduleName) {
    out.core = {
      people: db.all('SELECT * FROM people ORDER BY id'),
      projects: db.all('SELECT * FROM projects ORDER BY id'),
      projectTeam: db.all('SELECT * FROM project_team ORDER BY project_id, person_id'),
      accessOverrides: db.all('SELECT * FROM access_overrides ORDER BY id'),
      firmSettings: db.all('SELECT * FROM firm_settings ORDER BY key'),
    };
  }
  return out;
}

function insert(db, table, row) {
  const cols = Object.keys(row);
  db.run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map(c => row[c]));
}

function importBackup(db, backup) {
  if (!backup || backup.format !== FORMAT || backup.formatVersion !== 1) throw new HttpError(400, 'This is not a Toolbox backup file (format "toolbox-backup", version 1).');
  const result = { added: 0, skipped: 0, conflicts: [] };
  const skip = what => { result.skipped++; result.conflicts.push(what); };
  const full = backup.app === 'toolbox';

  db.tx(() => {
    if (full && backup.core) {
      const c = backup.core;
      for (const r of c.people || []) {
        if (db.get('SELECT 1 AS x FROM people WHERE id = ? OR username = ?', r.id, r.username)) skip(`person ${r.username}`); else { insert(db, 'people', r); result.added++; }
      }
      for (const r of c.projects || []) {
        if (db.get('SELECT 1 AS x FROM projects WHERE id = ? OR (vp_project_id IS NOT NULL AND vp_project_id = ?)', r.id, r.vp_project_id)) skip(`project ${r.number}`); else { insert(db, 'projects', r); result.added++; }
      }
      for (const r of c.projectTeam || []) {
        if (db.get('SELECT 1 AS x FROM project_team WHERE project_id = ? AND person_id = ?', r.project_id, r.person_id)) result.skipped++; else { insert(db, 'project_team', r); result.added++; }
      }
      for (const r of c.accessOverrides || []) {
        if (db.get('SELECT 1 AS x FROM access_overrides WHERE id = ? OR (project_id = ? AND person_id = ?)', r.id, r.project_id, r.person_id)) result.skipped++; else { insert(db, 'access_overrides', r); result.added++; }
      }
      for (const r of c.firmSettings || []) {
        if (db.get('SELECT 1 AS x FROM firm_settings WHERE key = ?', r.key)) skip(`setting ${r.key}`); else { insert(db, 'firm_settings', r); result.added++; }
      }
    }
    for (const [key, byId] of Object.entries(backup.collections || {})) {
      const [mod, coll] = full ? key.split('/') : [backup.app, key];
      records.checkNames(mod, coll);
      for (const rec of Object.values(byId)) {
        if (db.get('SELECT 1 AS x FROM records WHERE module=? AND collection=? AND id=?', mod, coll, rec.id)) { skip(`${mod}/${coll}/${rec.id}`); continue; }
        db.run('INSERT INTO records (module, collection, id, project_id, rev, schema_version, data, created_at, created_by, updated_at, updated_by, deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          mod, coll, rec.id, rec.projectId || null, rec.rev, rec.schemaVersion, JSON.stringify(rec.data), rec.createdAt, rec.createdBy, rec.updatedAt, rec.updatedBy, rec.deleted ? 1 : 0);
        result.added++;
      }
    }
  });
  return result;
}

module.exports = { exportBackup, importBackup };

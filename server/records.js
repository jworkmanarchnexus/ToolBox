'use strict';
/* Module records: one generic table for every module (CLAUDE.md, Architecture).
   Every read and write goes through authorize(), which runs the shared permission rules. */
const { HttpError } = require('./errors');
const { ID_RE } = require('./ids');
const access = require('./access');

const NAME_RE = /^[a-z][a-z0-9-]{1,40}$/;
const MAX_JSON = 5 * 1024 * 1024;
const RESERVED = ['projects', 'people', 'me', 'locks', 'backup', 'admin', 'dev', 'health']; // these are core API paths, not modules

/* Collection naming convention (see docs/DECISIONS.md):
   - linked to a project -> that project's access level decides
   - "owned-*": with a project, that project's access level decides; without one (a pursuit that has no Vantagepoint project
     yet), only its creator and firm admins can change it, and firm viewers can read it. Nobody else can see it.
   - "personal-*" (no project) -> only the person who created the record
   - "firm-*" (no project) -> everyone reads; firm admins write, and so does anyone listed as a writer for that
     collection in the record `firm-writers/<collection>` ({ ids: [person ids] }, itself writable only by admins)
   - anything else without a project -> everyone reads, the creator or a firm admin writes */
function isWriter(db, userId, ctx) {
  if (!ctx.module || ctx.collection === 'firm-writers') return false;
  const row = db.get('SELECT data FROM records WHERE module = ? AND collection = ? AND id = ? AND deleted = 0', ctx.module, 'firm-writers', ctx.collection);
  if (!row) return false;
  const ids = JSON.parse(row.data).ids;
  return Array.isArray(ids) && ids.includes(userId);
}

function authorize(db, userId, action, ctx) {
  // action: read | create | update | delete
  const verb = { read: 'view', create: 'create', update: 'edit', delete: 'delete' }[action];
  if (ctx.projectId) {
    const project = access.projectRow(db, ctx.projectId);
    if (!project) return false;
    return access.can(db, userId, project, verb);
  }
  const admin = access.isFirmAdmin(db, userId);
  if (ctx.collection.startsWith('owned-')) {
    if (action === 'create') return true;
    const mine = !ctx.createdBy || ctx.createdBy === userId;
    if (action === 'read') return mine || admin || access.firmRoleOf(db, userId).includes('viewer');
    return mine || admin;
  }
  if (ctx.collection.startsWith('personal-')) return ctx.createdBy ? ctx.createdBy === userId : true;
  if (ctx.collection.startsWith('firm-')) return action === 'read' || admin || isWriter(db, userId, ctx);
  if (action === 'read') return true;
  if (action === 'create') return true;
  return admin || ctx.createdBy === userId;
}

function toRecord(row) {
  return {
    module: row.module, collection: row.collection, id: row.id, projectId: row.project_id,
    rev: row.rev, schemaVersion: row.schema_version,
    createdAt: row.created_at, createdBy: row.created_by, updatedAt: row.updated_at, updatedBy: row.updated_by,
    deleted: !!row.deleted, data: JSON.parse(row.data),
  };
}

function checkNames(module, collection) {
  if (!NAME_RE.test(module) || !NAME_RE.test(collection) || RESERVED.includes(module)) throw new HttpError(400, 'Module and collection names are lowercase letters, digits and hyphens.');
}
function checkId(id) {
  if (!ID_RE.test(id)) throw new HttpError(400, 'Record ids are 6 to 64 letters, digits, underscores or hyphens.');
}

function getRow(db, module, collection, id) {
  return db.get('SELECT * FROM records WHERE module = ? AND collection = ? AND id = ?', module, collection, id);
}
const ctxOf = (row, collection, module) => ({ projectId: row.project_id, createdBy: row.created_by, collection, module: module || row.module });

function list(db, userId, module, collection, query) {
  checkNames(module, collection);
  const since = query.since ? Number(query.since) : null;
  if (query.since && !Number.isFinite(since)) throw new HttpError(400, '"since" must be a number of milliseconds.');
  const params = [module, collection];
  let sql = 'SELECT * FROM records WHERE module = ? AND collection = ?';
  if (since !== null) { sql += ' AND updated_at > ?'; params.push(since); } else sql += ' AND deleted = 0';
  if (query.projectId) { sql += ' AND project_id = ?'; params.push(query.projectId); }
  sql += ' ORDER BY updated_at, id';
  const serverTime = db.now();
  const records = db.all(sql, ...params)
    .filter(r => authorize(db, userId, 'read', ctxOf(r, collection, module)))
    .map(toRecord);
  return { serverTime, records };
}

function get(db, userId, module, collection, id) {
  checkNames(module, collection); checkId(id);
  const row = getRow(db, module, collection, id);
  if (!row || row.deleted || !authorize(db, userId, 'read', ctxOf(row, collection))) throw new HttpError(404, 'Not found.');
  return toRecord(row);
}

/* create or update, compare-and-set on rev (CONTRACT section 2, rule 6) */
function put(db, userId, module, collection, id, body, ifMatch) {
  checkNames(module, collection); checkId(id);
  if (!body || typeof body !== 'object' || typeof body.data !== 'object' || body.data === null || Array.isArray(body.data)) {
    throw new HttpError(400, 'Send {"data": {...}, "projectId": "..."}.');
  }
  const schemaVersion = body.data.schemaVersion;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw new HttpError(400, 'data.schemaVersion must be a whole number, 1 or more.');
  const json = JSON.stringify(body.data);
  if (json.length > MAX_JSON) throw new HttpError(413, 'Record is too large.');
  const projectId = body.projectId || null;
  if (projectId && !access.projectRow(db, projectId)) throw new HttpError(400, 'That project does not exist.');

  return db.tx(() => {
    const row = getRow(db, module, collection, id);
    const now = db.now();
    if (!row) {
      if (!authorize(db, userId, 'create', { projectId, collection, module, createdBy: userId })) throw new HttpError(403, 'You do not have permission to create this here.');
      db.run('INSERT INTO records (module, collection, id, project_id, rev, schema_version, data, created_at, created_by, updated_at, updated_by, deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)',
        module, collection, id, projectId, 1, schemaVersion, json, now, userId, now, userId);
      return { status: 201, record: toRecord(getRow(db, module, collection, id)) };
    }
    if (ifMatch === undefined || ifMatch === null || ifMatch === '') throw new HttpError(428, 'This record already exists. Send its current revision in If-Match.');
    const want = Number(String(ifMatch).replace(/"/g, ''));
    if (!authorize(db, userId, 'update', ctxOf(row, collection))) throw new HttpError(403, 'You do not have permission to change this.');
    if (want !== row.rev) throw new HttpError(409, 'Someone else saved a newer version.', { current: toRecord(row) });
    const newProject = body.projectId === undefined ? row.project_id : projectId;
    if (newProject !== row.project_id && !authorize(db, userId, 'create', { projectId: newProject, collection, module, createdBy: row.created_by })) {
      throw new HttpError(403, 'You do not have permission to move this into that project.');
    }
    db.run('UPDATE records SET project_id=?, rev=rev+1, schema_version=?, data=?, updated_at=?, updated_by=?, deleted=0 WHERE module=? AND collection=? AND id=?',
      newProject, schemaVersion, json, now, userId, module, collection, id);
    return { status: 200, record: toRecord(getRow(db, module, collection, id)) };
  });
}

/* soft delete: the row stays so other people's polls see that it is gone */
function remove(db, userId, module, collection, id, ifMatch) {
  checkNames(module, collection); checkId(id);
  return db.tx(() => {
    const row = getRow(db, module, collection, id);
    if (!row || row.deleted) throw new HttpError(404, 'Not found.');
    if (ifMatch === undefined || ifMatch === '') throw new HttpError(428, 'Send the record\'s current revision in If-Match.');
    if (!authorize(db, userId, 'delete', ctxOf(row, collection))) throw new HttpError(403, 'You do not have permission to delete this.');
    if (Number(String(ifMatch).replace(/"/g, '')) !== row.rev) throw new HttpError(409, 'Someone else saved a newer version.', { current: toRecord(row) });
    db.run('UPDATE records SET deleted=1, rev=rev+1, updated_at=?, updated_by=? WHERE module=? AND collection=? AND id=?', db.now(), userId, module, collection, id);
    return toRecord(getRow(db, module, collection, id));
  });
}

module.exports = { list, get, put, remove, authorize, toRecord, checkNames };

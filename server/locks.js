'use strict';
/* "Who is editing" markers. A lock lasts LOCK_MS and is refreshed by the holder's poll. Informational, not a hard lock:
   the real protection against overwriting is the compare-and-set on rev. */
const { HttpError } = require('./errors');
const records = require('./records');

const LOCK_MS = 45 * 1000;

const nameOf = (db, id) => (db.get('SELECT display_name FROM people WHERE id = ?', id) || {}).display_name || id;

function purge(db, now) { db.run('DELETE FROM locks WHERE expires_at <= ?', now); }

function acquire(db, userId, module, collection, id) {
  records.checkNames(module, collection);
  const row = db.get('SELECT * FROM records WHERE module=? AND collection=? AND id=?', module, collection, id);
  if (row && !records.authorize(db, userId, 'update', { projectId: row.project_id, createdBy: row.created_by, collection })) {
    throw new HttpError(403, 'You do not have permission to edit this.');
  }
  const now = db.now();
  return db.tx(() => {
    purge(db, now);
    const cur = db.get('SELECT * FROM locks WHERE module=? AND collection=? AND record_id=?', module, collection, id);
    if (cur && cur.person_id !== userId) {
      throw new HttpError(409, `${nameOf(db, cur.person_id)} is editing this.`, { heldBy: { id: cur.person_id, name: nameOf(db, cur.person_id) }, expiresAt: cur.expires_at });
    }
    if (cur) db.run('UPDATE locks SET expires_at=? WHERE module=? AND collection=? AND record_id=?', now + LOCK_MS, module, collection, id);
    else db.run('INSERT INTO locks (module, collection, record_id, person_id, expires_at) VALUES (?,?,?,?,?)', module, collection, id, userId, now + LOCK_MS);
    return { held: true, expiresAt: now + LOCK_MS };
  });
}

function release(db, userId, module, collection, id) {
  db.run('DELETE FROM locks WHERE module=? AND collection=? AND record_id=? AND person_id=?', module, collection, id, userId);
  return { released: true };
}

function list(db, module, collection) {
  records.checkNames(module, collection);
  purge(db, db.now());
  return db.all('SELECT * FROM locks WHERE module=? AND collection=?', module, collection)
    .map(l => ({ recordId: l.record_id, personId: l.person_id, name: nameOf(db, l.person_id), expiresAt: l.expires_at }));
}

module.exports = { acquire, release, list, LOCK_MS };

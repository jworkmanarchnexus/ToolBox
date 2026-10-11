'use strict';
const test = require('node:test');
const assert = require('node:assert');
const dbmod = require('../db/db');
const backup = require('../backup');
const { start } = require('./helpers');

const doc = (extra, data) => Object.assign({ data: Object.assign({ schemaVersion: 1 }, data) }, extra);
const strip = b => { const c = JSON.parse(JSON.stringify(b)); delete c.exportedAt; return c; };

async function populate(t) {
  const pm = t.api('s.patel'), admin = t.api('a.rivera'), team = t.api('c.nguyen');
  const p = t.project('26-101');
  await pm.put('/api/scheduler/schedules/sched-9001', doc({ projectId: p.id }, { title: 'Design milestones', tasks: [{ id: 't1', name: 'Kickoff' }] }));
  await pm.put('/api/scheduler/schedules/sched-9001', doc({ projectId: p.id }, { title: 'Design milestones v2' }), { ifMatch: 1 });
  await pm.put('/api/scheduler/schedules/sched-9002', doc({ projectId: p.id }, { title: 'Deleted one' }));
  await pm.del('/api/scheduler/schedules/sched-9002', { ifMatch: 1 });
  await team.put('/api/scheduler/personal-templates/tpl-9001', doc({}, { name: 'My template' }));
  await admin.put('/api/scheduler/firm-holidays/hol-9001', doc({}, { days: ['2026-12-25'] }));
  await admin.put('/api/fee-builder/proposals/prop-9001', doc({}, { name: 'Pursuit, no project yet' }));
  await pm.put(`/api/projects/${p.id}/access/${t.person('r.ortiz').id}`, { kind: 'grant_viewer', reason: 'consultant' });
  t.db.run("INSERT INTO firm_settings (key, value, rev, updated_at, updated_by) VALUES ('office', '{\"name\":\"Main\"}', 1, 1, NULL)");
}

test('only firm admins can export or import a backup', async () => {
  const t = await start();
  assert.strictEqual((await t.api('s.patel').get('/api/backup')).status, 403);
  assert.strictEqual((await t.api('d.hollis').get('/api/backup')).status, 403);
  assert.strictEqual((await t.api('s.patel').post('/api/backup', {})).status, 403);
  assert.strictEqual((await t.api('a.rivera').get('/api/backup')).status, 200);
  await t.close();
});

test('backup then import into an empty database loses nothing', async () => {
  const t = await start();
  await populate(t);
  const adminId = t.person('a.rivera').id;
  const first = (await t.api('a.rivera').get('/api/backup')).body;

  assert.strictEqual(first.format, 'toolbox-backup');
  assert.strictEqual(first.formatVersion, 1);
  assert.strictEqual(first.people[adminId], 'Alex Rivera');
  assert.ok(first.collections['scheduler/schedules']['sched-9001']);
  assert.strictEqual(first.collections['scheduler/schedules']['sched-9002'].deleted, true, 'deleted records travel too');
  assert.strictEqual(first.core.projects.length, 12);

  const fresh = dbmod.open(':memory:');
  const result = backup.importBackup(fresh, JSON.parse(JSON.stringify(first)));
  assert.strictEqual(result.skipped, 0);
  assert.deepStrictEqual(strip(backup.exportBackup(fresh, adminId)), strip(first), 'exporting again gives the same backup');

  // and the restored data still obeys the permission rules
  const row = fresh.get("SELECT rev, created_by FROM records WHERE id = 'sched-9001'");
  assert.strictEqual(row.rev, 2);
  assert.strictEqual(row.created_by, t.person('s.patel').id);
  fresh.close();
  await t.close();
});

test('import is additive: existing data is reported, never overwritten', async () => {
  const t = await start();
  await populate(t);
  const admin = t.api('a.rivera');
  const snapshot = (await admin.get('/api/backup')).body;

  // change a record, then import the older snapshot over the top
  await t.api('s.patel').put('/api/scheduler/schedules/sched-9001', doc({ projectId: t.project('26-101').id }, { title: 'newer' }), { ifMatch: 2 });
  const res = await admin.post('/api/backup', snapshot);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.added, 0);
  assert.ok(res.body.skipped > 0);
  assert.ok(res.body.conflicts.includes('scheduler/schedules/sched-9001'));
  assert.strictEqual((await admin.get('/api/scheduler/schedules/sched-9001')).body.data.title, 'newer', 'the newer data survived');
  await t.close();
});

test('a module backup contains only that module', async () => {
  const t = await start();
  await populate(t);
  const b = (await t.api('a.rivera').get('/api/backup?module=fee-builder')).body;
  assert.strictEqual(b.app, 'fee-builder');
  assert.deepStrictEqual(Object.keys(b.collections), ['proposals']);
  assert.strictEqual(b.core, undefined);
  await t.close();
});

test('files that are not Toolbox backups are rejected', async () => {
  const t = await start();
  assert.strictEqual((await t.api('a.rivera').post('/api/backup', { format: 'something-else' })).status, 400);
  await t.close();
});

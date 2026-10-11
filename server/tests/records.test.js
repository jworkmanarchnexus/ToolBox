'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

const doc = (extra, data) => Object.assign({ data: Object.assign({ schemaVersion: 1 }, data) }, extra);

test('compare-and-set: a save must carry the revision it started from', async () => {
  const t = await start();
  const pm = t.api('s.patel'), pic = t.api('m.lee');
  const p = t.project('26-101');
  const url = '/api/scheduler/schedules/sched-1001';

  const created = await pm.put(url, doc({ projectId: p.id }, { title: 'v1' }));
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.rev, 1);
  assert.strictEqual(created.body.createdBy, pm.id);
  assert.strictEqual(created.body.schemaVersion, 1);

  assert.strictEqual((await pm.put(url, doc({ projectId: p.id }, { title: 'x' }))).status, 428, 'existing record, no If-Match');

  const second = await pm.put(url, doc({ projectId: p.id }, { title: 'v2' }), { ifMatch: 1 });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.rev, 2);
  assert.strictEqual(second.body.updatedBy, pm.id);

  // the PIC still holds revision 1: refused, and told what is stored now
  const stale = await pic.put(url, doc({ projectId: p.id }, { title: 'from the PIC' }), { ifMatch: 1 });
  assert.strictEqual(stale.status, 409);
  assert.strictEqual(stale.body.current.rev, 2);
  assert.strictEqual(stale.body.current.data.title, 'v2');
  assert.strictEqual((await pic.get(url)).body.data.title, 'v2', 'nothing was overwritten');

  const retry = await pic.put(url, doc({ projectId: p.id }, { title: 'merged' }), { ifMatch: stale.body.current.rev });
  assert.strictEqual(retry.status, 200);
  assert.strictEqual(retry.body.createdBy, pm.id, 'createdBy never changes');
  assert.strictEqual(retry.body.updatedBy, pic.id);
  await t.close();
});

test('delete is a soft delete that polling can see', async () => {
  const t = await start();
  const pm = t.api('s.patel');
  const p = t.project('26-101');
  const url = '/api/scheduler/schedules/sched-1002';
  await pm.put(url, doc({ projectId: p.id }, { title: 'gone soon' }));
  const before = (await pm.get('/api/scheduler/schedules')).body;
  assert.strictEqual(before.records.length, 1);
  assert.strictEqual((await pm.del(url)).status, 428, 'delete needs If-Match too');
  assert.strictEqual((await pm.del(url, { ifMatch: 99 })).status, 409);
  assert.strictEqual((await pm.del(url, { ifMatch: 1 })).status, 200);
  assert.strictEqual((await pm.get(url)).status, 404);
  assert.strictEqual((await pm.get('/api/scheduler/schedules')).body.records.length, 0, 'not in a full listing');
  const changes = (await pm.get(`/api/scheduler/schedules?since=${before.serverTime}`)).body;
  assert.strictEqual(changes.records.length, 1, 'but a poll sees the tombstone');
  assert.strictEqual(changes.records[0].deleted, true);
  await t.close();
});

test('polling with ?since= returns only what changed, and respects permissions', async () => {
  const t = await start();
  const pm = t.api('s.patel'), stranger = t.api('r.ortiz');
  const p = t.project('26-101');
  await pm.put('/api/scheduler/schedules/sched-2001', doc({ projectId: p.id }, { n: 1 }));
  const first = (await pm.get('/api/scheduler/schedules')).body;
  assert.strictEqual(first.records.length, 1);
  assert.strictEqual((await pm.get(`/api/scheduler/schedules?since=${first.serverTime}`)).body.records.length, 0, 'nothing new yet');

  await pm.put('/api/scheduler/schedules/sched-2002', doc({ projectId: p.id }, { n: 2 }));
  await pm.put('/api/scheduler/schedules/sched-2001', doc({ projectId: p.id }, { n: 3 }), { ifMatch: 1 });
  const next = (await pm.get(`/api/scheduler/schedules?since=${first.serverTime}`)).body;
  assert.deepStrictEqual(next.records.map(r => r.id).sort(), ['sched-2001', 'sched-2002']);
  assert.ok(next.serverTime > first.serverTime);

  assert.strictEqual((await stranger.get('/api/scheduler/schedules')).body.records.length, 0, 'a stranger sees none of it');
  await t.close();
});

test('the poll never misses two writes in the same millisecond', async () => {
  const t = await start();
  const pm = t.api('s.patel');
  const p = t.project('26-101');
  const cursor = (await pm.get('/api/scheduler/schedules')).body.serverTime;
  await Promise.all([1, 2, 3, 4, 5].map(n => pm.put(`/api/scheduler/schedules/burst-0${n}`, doc({ projectId: p.id }, { n }))));
  assert.strictEqual((await pm.get(`/api/scheduler/schedules?since=${cursor}`)).body.records.length, 5);
  await t.close();
});

test('input is validated', async () => {
  const t = await start();
  const a = t.api('a.rivera');
  assert.strictEqual((await a.put('/api/scheduler/firm-x/short', doc())).status, 400, 'id too short');
  assert.strictEqual((await a.put('/api/scheduler/firm-x/bad id!', doc())).status, 400, 'id with a space');
  assert.strictEqual((await a.put('/api/scheduler/firm-x/rec-0001', { data: { title: 'no version' } })).status, 400, 'schemaVersion required');
  assert.strictEqual((await a.put('/api/scheduler/firm-x/rec-0001', { data: [] })).status, 400, 'data must be an object');
  assert.strictEqual((await a.put('/api/scheduler/firm-x/rec-0001', doc({ projectId: 'no-such-project' }))).status, 400, 'unknown project');
  assert.strictEqual((await a.put('/api/Bad_Module/firm-x/rec-0001', doc())).status, 400, 'module name');
  assert.strictEqual((await a.get('/api/scheduler/schedules?since=abc')).status, 400);
  await t.close();
});

test('locks show who is editing and expire', async () => {
  const t = await start();
  const pm = t.api('s.patel'), pic = t.api('m.lee'), team = t.api('c.nguyen');
  const p = t.project('26-101');
  const url = '/api/scheduler/schedules/sched-3001';
  await pm.put(url, doc({ projectId: p.id }, {}));
  const lock = '/api/locks/scheduler/schedules/sched-3001';

  assert.strictEqual((await pm.put(lock)).status, 200);
  assert.strictEqual((await pm.put(lock)).status, 200, 'holder can refresh');
  const blocked = await pic.put(lock);
  assert.strictEqual(blocked.status, 409);
  assert.strictEqual(blocked.body.heldBy.name, 'Sam Patel');
  assert.strictEqual((await team.put(lock)).status, 403, 'read-only people cannot lock');
  const list = (await pic.get('/api/locks/scheduler/schedules')).body;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, 'Sam Patel');

  await pic.del(lock);
  assert.strictEqual((await pic.get('/api/locks/scheduler/schedules')).body.length, 1, 'someone else cannot release it');
  await pm.del(lock);
  assert.strictEqual((await pic.put(lock)).status, 200, 'free again after release');
  t.db.run('UPDATE locks SET expires_at = 1');
  assert.strictEqual((await pm.put(lock)).status, 200, 'an expired lock is free');
  await t.close();
});

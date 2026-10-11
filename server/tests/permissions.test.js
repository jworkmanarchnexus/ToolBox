'use strict';
/* The server must apply the shared permission rule on every call. Seed facts (server/db/seed):
   26-101: PIC m.lee, PM s.patel, PA t.brooks, team c.nguyen.  r.ortiz is not on 26-101.
   d.hollis is a firm viewer, a.rivera a firm admin.  24-201 is archived. */
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

const rec = (extra) => Object.assign({ data: { schemaVersion: 1, title: 'x' } }, extra);

test('every API call needs a signed-in user', async () => {
  const t = await start();
  assert.strictEqual((await t.api().get('/api/projects')).status, 401);
  assert.strictEqual((await t.api().get('/api/scheduler/schedules')).status, 401);
  const bad = await fetch(t.base + '/api/me', { headers: { 'x-toolbox-user': 'not-a-person' } });
  assert.strictEqual(bad.status, 401);
  await t.close();
});

test('people see only the projects the rule gives them', async () => {
  const t = await start();
  const nums = async u => (await t.api(u).get('/api/projects')).body.map(p => p.number);
  const stranger = await nums('r.ortiz');
  assert.ok(!stranger.includes('26-101'), 'not on 26-101');
  assert.ok(stranger.includes('26-102'));
  assert.ok((await nums('c.nguyen')).includes('26-101'));
  assert.strictEqual((await nums('d.hollis')).length, 9, 'firm viewer sees every active project');
  assert.strictEqual((await nums('a.rivera')).length, 9);
  const archived = (await t.api('a.rivera').get('/api/projects?scope=archived')).body;
  assert.strictEqual(archived.length, 3);
  const mine = (await t.api('s.patel').get('/api/projects?scope=mine')).body;
  assert.ok(mine.length > 0 && mine.length < 9);
  await t.close();
});

test('access level is reported per project', async () => {
  const t = await start();
  const level = async (u, n) => (await t.api(u).get('/api/projects')).body.find(p => p.number === n).access;
  assert.strictEqual(await level('s.patel', '26-101'), 'admin');
  assert.strictEqual(await level('c.nguyen', '26-101'), 'read');
  assert.strictEqual(await level('d.hollis', '26-101'), 'read');
  assert.strictEqual(await level('a.rivera', '26-101'), 'admin');
  await t.close();
});

test('a project you cannot see answers 404, as if it does not exist', async () => {
  const t = await start();
  const p = t.project('26-101');
  assert.strictEqual((await t.api('r.ortiz').get(`/api/projects/${p.id}`)).status, 404);
  assert.strictEqual((await t.api('r.ortiz').get(`/api/projects/${p.id}/team`)).status, 404);
  assert.strictEqual((await t.api('c.nguyen').get(`/api/projects/${p.id}/team`)).status, 200);
  await t.close();
});

test('a write without permission is refused by the server', async () => {
  const t = await start();
  const p = t.project('26-101');
  const url = '/api/scheduler/schedules/sched-0001';
  assert.strictEqual((await t.api('c.nguyen').put(url, rec({ projectId: p.id }))).status, 403, 'read-only team member');
  assert.strictEqual((await t.api('r.ortiz').put(url, rec({ projectId: p.id }))).status, 403, 'not on the project');
  assert.strictEqual((await t.api('d.hollis').put(url, rec({ projectId: p.id }))).status, 403, 'firm viewer cannot edit');
  assert.strictEqual((await t.api('s.patel').put(url, rec({ projectId: p.id }))).status, 201, 'PM can');
  await t.close();
});

test('edits and deletes are refused for people who can only read', async () => {
  const t = await start();
  const p = t.project('26-101');
  const url = '/api/scheduler/schedules/sched-0002';
  const made = await t.api('s.patel').put(url, rec({ projectId: p.id }));
  assert.strictEqual(made.status, 201);
  assert.strictEqual((await t.api('c.nguyen').put(url, rec({ projectId: p.id }), { ifMatch: 1 })).status, 403);
  assert.strictEqual((await t.api('c.nguyen').del(url, { ifMatch: 1 })).status, 403);
  assert.strictEqual((await t.api('c.nguyen').get(url)).status, 200, 'but they can read it');
  assert.strictEqual((await t.api('r.ortiz').get(url)).status, 404, 'a stranger cannot even see it');
  await t.close();
});

test('archived projects are read-only for everyone; only firm admins can delete', async () => {
  const t = await start();
  const active = t.project('26-101'), arch = t.project('24-201');
  const url = '/api/scheduler/schedules/sched-0003';
  const made = await t.api('s.patel').put(url, rec({ projectId: active.id }));
  // archive the project the record lives in, as would happen on a later Vantagepoint sync
  t.db.run('UPDATE records SET project_id = ? WHERE id = ?', arch.id, 'sched-0003');
  const rev = made.body.rev;
  assert.strictEqual((await t.api('m.lee').put(url, rec({ projectId: arch.id }), { ifMatch: rev })).status, 403, 'PIC cannot edit archived');
  assert.strictEqual((await t.api('a.rivera').put(url, rec({ projectId: arch.id }), { ifMatch: rev })).status, 403, 'not even a firm admin');
  assert.strictEqual((await t.api('m.lee').get(url)).status, 200, 'but they can read it');
  assert.strictEqual((await t.api('m.lee').del(url, { ifMatch: rev })).status, 403, 'PIC cannot delete');
  assert.strictEqual((await t.api('a.rivera').del(url, { ifMatch: rev })).status, 200, 'firm admin can');
  await t.close();
});

test('moving a record needs permission in the destination project too', async () => {
  const t = await start();
  const a = t.project('26-101'), b = t.project('26-102');
  const url = '/api/scheduler/schedules/sched-0004';
  const made = await t.api('s.patel').put(url, rec({ projectId: a.id }));
  // s.patel is not on 26-102
  assert.strictEqual((await t.api('s.patel').put(url, rec({ projectId: b.id }), { ifMatch: made.body.rev })).status, 403);
  await t.close();
});

test('project leads manage access, with the protections from the rule', async () => {
  const t = await start();
  const p = t.project('26-101');
  const pm = t.api('s.patel');
  const acc = u => `/api/projects/${p.id}/access/${t.person(u).id}`;
  assert.strictEqual((await t.api('c.nguyen').get(`/api/projects/${p.id}/access`)).status, 403, 'team members cannot see access settings');
  assert.strictEqual((await pm.put(acc('m.lee'), { kind: 'deny' })).status, 403, 'a PM cannot remove the PIC');
  assert.strictEqual((await pm.put(acc('s.patel'), { kind: 'deny' })).status, 403, 'nor themselves');
  assert.strictEqual((await pm.put(acc('c.nguyen'), { kind: 'deny', reason: 'moved off' })).status, 200);
  assert.strictEqual((await t.api('c.nguyen').get(`/api/projects/${p.id}`)).status, 404, 'a removed person loses the project');
  assert.strictEqual((await pm.put(acc('r.ortiz'), { kind: 'grant_editor' })).status, 200);
  assert.strictEqual((await t.api('r.ortiz').put('/api/scheduler/schedules/sched-0005', rec({ projectId: p.id }))).status, 201, 'a granted editor can write');
  assert.strictEqual((await pm.del(acc('c.nguyen'))).status, 200);
  assert.strictEqual((await t.api('c.nguyen').get(`/api/projects/${p.id}`)).status, 200, 'removing the override restores access');
  assert.strictEqual((await t.api('a.rivera').put(acc('s.patel'), { kind: 'deny' })).status, 200, 'a firm admin can remove a PM');
  await t.close();
});

test('personal and firm-level collections follow their naming rule', async () => {
  const t = await start();
  const mine = '/api/scheduler/personal-templates/tpl-0001';
  assert.strictEqual((await t.api('c.nguyen').put(mine, rec())).status, 201);
  assert.strictEqual((await t.api('c.nguyen').get(mine)).status, 200);
  assert.strictEqual((await t.api('s.patel').get(mine)).status, 404, 'personal records are private');
  const firm = '/api/scheduler/firm-holidays/hol-0001';
  assert.strictEqual((await t.api('c.nguyen').put(firm, rec())).status, 403, 'only firm admins write firm-* collections');
  assert.strictEqual((await t.api('a.rivera').put(firm, rec())).status, 201);
  assert.strictEqual((await t.api('c.nguyen').get(firm)).status, 200, 'everyone reads them');
  await t.close();
});

test('a firm-* collection can name extra writers (template managers), set only by admins', async () => {
  const t = await start();
  const tpl = '/api/scheduler/firm-templates/tpl-0001';
  assert.strictEqual((await t.api('c.nguyen').put(tpl, rec())).status, 403);
  const writers = '/api/scheduler/firm-writers/firm-templates';
  assert.strictEqual((await t.api('c.nguyen').put(writers, { data: { schemaVersion: 1, ids: [t.person('c.nguyen').id] } })).status, 403, 'only admins name writers');
  assert.strictEqual((await t.api('a.rivera').put(writers, { data: { schemaVersion: 1, ids: [t.person('c.nguyen').id] } })).status, 201);
  assert.strictEqual((await t.api('c.nguyen').put(tpl, rec())).status, 201, 'a listed writer can now write');
  assert.strictEqual((await t.api('r.ortiz').put(tpl + '9', rec())).status, 403, 'others still cannot');
  const writersRec = (await t.api('a.rivera').get(writers)).body;
  assert.strictEqual((await t.api('c.nguyen').put(writers, { data: { schemaVersion: 1, ids: [] } }, { ifMatch: writersRec.rev })).status, 403, 'a writer cannot change the writer list');
  await t.close();
});

test('owned-* collections: project access when linked, creator-only (plus firm admins and viewers) when not', async () => {
  const t = await start();
  const url = '/api/fee-builder/owned-proposals/prop-0001';
  const made = await t.api('c.nguyen').put(url, rec());
  assert.strictEqual(made.status, 201, 'anyone can start a pursuit');
  assert.strictEqual((await t.api('c.nguyen').get(url)).status, 200);
  assert.strictEqual((await t.api('s.patel').get(url)).status, 404, 'another PM cannot see a pursuit');
  assert.strictEqual((await t.api('d.hollis').get(url)).status, 200, 'a firm viewer (leadership) can read it');
  assert.strictEqual((await t.api('a.rivera').get(url)).status, 200, 'and a firm admin');
  assert.strictEqual((await t.api('d.hollis').put(url, rec(), { ifMatch: 1 })).status, 403, 'but a viewer cannot change it');
  assert.strictEqual((await t.api('a.rivera').put(url, rec(), { ifMatch: 1 })).status, 200, 'a firm admin can');
  assert.strictEqual((await t.api('s.patel').put(url, rec(), { ifMatch: 3 })).status, 403, 'and he cannot change it either');
  assert.strictEqual((await t.api('s.patel').get('/api/fee-builder/owned-proposals')).body.records.length, 0, 'not in his list either');

  // link it to a project: now that project's rule applies (the creator must be able to edit there)
  const p101 = t.project('26-101');
  assert.strictEqual((await t.api('c.nguyen').put(url, rec({ projectId: p101.id }), { ifMatch: 2 })).status, 403, 'c.nguyen is only a team member of 26-101: cannot move it in');
  const mine = await t.api('s.patel').put('/api/fee-builder/owned-proposals/prop-0002', rec());
  assert.strictEqual(mine.status, 201);
  assert.strictEqual((await t.api('s.patel').put('/api/fee-builder/owned-proposals/prop-0002', rec({ projectId: p101.id }), { ifMatch: 1 })).status, 200, 'the PM can link it to his project');
  assert.strictEqual((await t.api('c.nguyen').get('/api/fee-builder/owned-proposals/prop-0002')).status, 200, 'now the project team can read it');
  assert.strictEqual((await t.api('r.ortiz').get('/api/fee-builder/owned-proposals/prop-0002')).status, 404, 'but not outsiders');
  assert.strictEqual((await t.api('c.nguyen').put('/api/fee-builder/owned-proposals/prop-0002', rec(), { ifMatch: 2 })).status, 403, 'team members can read but not edit');
  await t.close();
});

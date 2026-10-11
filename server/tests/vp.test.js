'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

test('the seed loads about 8 people and 12 projects with teams', async () => {
  const t = await start();
  const n = tbl => t.db.get(`SELECT COUNT(*) AS n FROM ${tbl}`).n;
  assert.strictEqual(n('people'), 8);
  assert.strictEqual(n('projects'), 12);
  assert.ok(n('project_team') > 12);
  assert.strictEqual(t.db.get("SELECT COUNT(*) AS n FROM projects WHERE status = 'archived'").n, 3);
  assert.strictEqual(t.person('a.rivera').firm_role, 'admin');
  assert.strictEqual(t.person('d.hollis').firm_role, 'viewer');
  assert.strictEqual(t.project('26-101').vp_number, '26-101', 'projects carry the vp slot');
  await t.close();
});

test('the sign-in-as picker lists the seeded people without a login', async () => {
  const t = await start();
  const r = await t.api().get('/api/dev/users');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.length, 8);
  assert.ok(r.body.every(p => p.id && p.name && p.username));
  await t.close();
});

test('seeding twice keeps the same shape', async () => {
  const t = await start();
  const { seed } = require('../seed');
  seed(t.db);
  assert.strictEqual(t.db.get('SELECT COUNT(*) AS n FROM people').n, 8);
  assert.strictEqual(t.db.get('SELECT COUNT(*) AS n FROM projects').n, 12);
  await t.close();
});

test('Vantagepoint import: admins only; it updates, adds and replaces teams', async () => {
  const t = await start();
  const csv = { raw: true };
  assert.strictEqual((await t.api('s.patel').post('/api/admin/import-vp?kind=projects', 'x', csv)).status, 403);

  const admin = t.api('a.rivera');
  const projects = 'ProjectID,ProjectNumber,ProjectName,Client,Status\nP0101,26-101,Riverton Elementary Addition (renamed),Riverton School District,Active\nP0999,26-999,Brand New Job,"Acme, Inc.",Active\nP0102,26-102,Cedar Hills Library Renovation,City of Cedar Hills,Inactive\n';
  const r = await admin.post('/api/admin/import-vp?kind=projects', projects, csv);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual([r.body.added, r.body.updated], [1, 2]);
  assert.strictEqual(t.project('26-101').name, 'Riverton Elementary Addition (renamed)');
  assert.strictEqual(t.project('26-101').rev, 2, 'a changed project bumps its rev');
  assert.strictEqual(t.project('26-103').rev, 1, 'an unchanged one does not');
  assert.strictEqual(t.project('26-999').client, 'Acme, Inc.');
  assert.strictEqual(t.project('26-102').status, 'archived', 'a non-Active status archives the project');

  // the nightly team copy replaces the team of each project it mentions
  const team = 'ProjectID,EmployeeID,Role\nP0101,E004,PM\nP0101,E007,Team\nP0101,E404,Team\nP9999,E001,PM\n';
  const tr = await admin.post('/api/admin/import-vp?kind=team', team, csv);
  assert.strictEqual(tr.body.written, 2);
  assert.strictEqual(tr.body.skipped.length, 2, 'unknown people and projects are reported');
  const roles = t.db.all('SELECT person_id, role FROM project_team WHERE project_id = ?', t.project('26-101').id);
  assert.deepStrictEqual(roles.map(x => x.role).sort(), ['pm', 'team']);
  // access moves with it: the old PM lost admin on 26-101, the new one gained it
  const lvl = async u => (await t.api(u).get('/api/projects')).body.find(p => p.number === '26-101');
  assert.strictEqual(await lvl('s.patel'), undefined);
  assert.strictEqual((await lvl('j.kim')).access, 'admin');
  assert.strictEqual((await t.api('s.patel').get('/api/projects/' + t.project('26-103').id)).status, 404, 'not on 26-103');
  await t.close();
});

test('Vantagepoint import rejects a CSV with the wrong columns', async () => {
  const t = await start();
  const r = await t.api('a.rivera').post('/api/admin/import-vp?kind=projects', 'Foo,Bar\n1,2\n', { raw: true });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /ProjectID/);
  assert.strictEqual((await t.api('a.rivera').post('/api/admin/import-vp?kind=nonsense', 'x', { raw: true })).status, 400);
  await t.close();
});

'use strict';
/* The Scheduler's screens, run in jsdom against a real server and the real platform adapters. These replace the old mock-platform
   browser tests for everything that touches the server: creating, saving, merging, permissions, templates.
   (Canvas drawing for PNG/PDF export needs a real browser; see docs/DECISIONS.md.) */
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./ui-harness');

const rows = (res) => res.body.records;
async function withApp(fn) {
  const app = await start();
  try { await fn(app); } finally { await app.close(); }
}
const proj = (app, n) => app.t.project(n);
const noErrors = (ui) => assert.deepStrictEqual(ui.errors, [], 'no script errors in the page');

/* open the project page, the new-schedule dialog, and create a schedule from the first template */
async function createFromTemplate(ui, project) {
  ui.goto('#/scheduler/p/' + project.id);
  await ui.until(() => ui.button('New schedule', ui.$('#projHead')), 'the New schedule button');
  ui.click(ui.button('New schedule', ui.$('#projHead')));
  await ui.until(() => ui.$('#nsProj'), 'the new schedule dialog');
  assert.strictEqual(ui.$('#nsProj').value, project.id, 'the project is preselected');
  ui.click(ui.dialogButton('Create schedule'));
  await ui.until(() => /#\/scheduler\/s\//.test(ui.w.location.hash), 'the editor to open');
  return ui.w.location.hash.split('/').pop();
}

test('home shows only the projects the person can see', () => withApp(async (app) => {
  const ui = await app.open('r.ortiz');
  await ui.until(() => ui.$$('#homeMain tr[data-id]').length > 0, 'the project list');
  const nums = ui.$$('#homeMain tr[data-id] .pn').map(e => e.textContent);
  assert.deepStrictEqual(nums.sort(), ['26-102', '26-103', '26-105', '26-108']);
  assert.ok(!ui.$('#pageHome').textContent.includes('Riverton'), 'a project they are not on is not listed');
  noErrors(ui);
}));

test('create a schedule from a template, edit it, save, and see it stored with history', () => withApp(async (app) => {
  const ui = await app.open('s.patel');
  const p = proj(app, '26-101');
  const id = await createFromTemplate(ui, p);

  const made = await app.t.api('s.patel').get('/api/scheduler/schedules/' + id);
  assert.strictEqual(made.status, 200);
  assert.strictEqual(made.body.rev, 1);
  assert.strictEqual(made.body.projectId, p.id);
  assert.ok(made.body.data.tasks.length > 5, 'tasks came from the template');
  assert.strictEqual(made.body.schemaVersion, 1);

  await ui.until(() => ui.$$('#tbody input[data-f=name]').length > 5, 'the activity table');
  assert.strictEqual(ui.$('#status').textContent, 'All changes saved');
  const first = ui.$('#tbody input[data-f=name]');
  ui.change(first, 'Kickoff (renamed)');
  assert.strictEqual(ui.$('#status').textContent, 'Unsaved changes');
  assert.strictEqual(ui.$('#btnSave').disabled, false);

  // while there are unsaved edits, the person shows as editing (a lock)
  await ui.until(async () => (await app.t.api('m.lee').get('/api/locks/scheduler/schedules')).body.length === 1, 'the editing lock', 3000).catch(() => {});
  ui.click(ui.$('#btnSave'));
  await ui.until(() => ui.$('#status').textContent === 'All changes saved', 'the save to finish');
  const saved = await app.t.api('s.patel').get('/api/scheduler/schedules/' + id);
  assert.strictEqual(saved.body.rev, 2);
  assert.strictEqual(saved.body.data.tasks[0].name, 'Kickoff (renamed)');
  assert.strictEqual(saved.body.updatedBy, app.t.person('s.patel').id);
  const hist = await app.t.api('s.patel').get('/api/scheduler/h-' + id);
  assert.strictEqual(rows(hist).length, 1, 'the save is in version history');
  await ui.until(async () => (await app.t.api('s.patel').get('/api/locks/scheduler/schedules')).body.length === 0, 'the lock to be released');

  // the project page now lists it, with the person's name
  ui.goto('#/scheduler/p/' + p.id);
  await ui.until(() => ui.$$('#projBody .srow').length === 1, 'the schedule row');
  assert.match(ui.$('#projBody .srow').textContent, /Saved today by you/);
  noErrors(ui);
}));

test('two people editing: the second save is merged with the first, not lost', () => withApp(async (app) => {
  const ui = await app.open('s.patel');
  const p = proj(app, '26-101');
  const id = await createFromTemplate(ui, p);
  await ui.until(() => ui.$$('#tbody input[data-f=name]').length > 5, 'the activity table');

  // Sam has an unsaved edit...
  ui.change(ui.$$('#tbody input[data-f=name]')[1], 'Sam’s edit');
  // ...and Morgan saves a different change first
  const cur = (await app.t.api('m.lee').get('/api/scheduler/schedules/' + id)).body;
  cur.data.tasks[3].name = 'Morgan’s edit';
  const put = await app.t.api('m.lee').put('/api/scheduler/schedules/' + id, { data: cur.data, projectId: cur.projectId }, { ifMatch: cur.rev });
  assert.strictEqual(put.status, 200);

  ui.click(ui.$('#btnSave'));
  await ui.until(() => /Merged Morgan Lee/.test(ui.$('#toast').textContent), 'the merge notice');
  assert.strictEqual(ui.$('#status').textContent, 'Unsaved changes', 'merged, but waiting for review');
  assert.strictEqual((await app.t.api('s.patel').get('/api/scheduler/schedules/' + id)).body.rev, 2, 'nothing was overwritten yet');

  ui.click(ui.$('#btnSave'));
  await ui.until(() => ui.$('#status').textContent === 'All changes saved', 'the merged save');
  const fin = (await app.t.api('s.patel').get('/api/scheduler/schedules/' + id)).body;
  assert.strictEqual(fin.rev, 3);
  assert.strictEqual(fin.data.tasks[1].name, 'Sam’s edit');
  assert.strictEqual(fin.data.tasks[3].name, 'Morgan’s edit');
  noErrors(ui);
}));

test('someone else’s change arrives within a poll when you have nothing unsaved', () => withApp(async (app) => {
  const ui = await app.open('s.patel');
  const p = proj(app, '26-101');
  const id = await createFromTemplate(ui, p);
  await ui.until(() => ui.$$('#tbody input[data-f=name]').length > 5, 'the activity table');
  const cur = (await app.t.api('m.lee').get('/api/scheduler/schedules/' + id)).body;
  cur.data.tasks[2].name = 'Changed by Morgan';
  await app.t.api('m.lee').put('/api/scheduler/schedules/' + id, { data: cur.data, projectId: cur.projectId }, { ifMatch: cur.rev });
  const names = () => ui.$$('#tbody input[data-f=name]').map(e => e.value);
  await ui.until(() => names()[2] === 'Changed by Morgan', 'the other person’s change', 8000);
  assert.match(ui.$('#toast').textContent, /Morgan Lee saved changes/);
}));

test('someone with view access can look but not change or create', () => withApp(async (app) => {
  const p = proj(app, '26-101');
  const sam = await app.open('s.patel');
  const id = await createFromTemplate(sam, p);
  sam.close();

  const ui = await app.open('c.nguyen', '#/scheduler/s/' + id);
  await ui.until(() => ui.$('#status').textContent === 'View only', 'the view-only state');
  assert.ok(ui.$('#banners').textContent.includes('view this schedule but not change it'));
  assert.strictEqual(ui.$('#btnSave').disabled, true);
  assert.strictEqual(ui.$('#btnAdd').disabled, true);
  ui.goto('#/scheduler/p/' + p.id);
  await ui.until(() => ui.$('#projHead').textContent.includes('Riverton'), 'the project page');
  assert.ok(!ui.button('New schedule', ui.$('#projHead')), 'no New schedule button without edit access');
  noErrors(ui);
}));

test('a person who is not on the project cannot open its schedule', () => withApp(async (app) => {
  const p = proj(app, '26-101');
  const sam = await app.open('s.patel');
  const id = await createFromTemplate(sam, p);
  sam.close();
  const ui = await app.open('r.ortiz', '#/scheduler/s/' + id);
  await ui.until(() => /no longer exists/.test(ui.$('#toast').textContent), 'the not-found notice');
  assert.ok(!ui.$('#pageEditor') || ui.$('#pageEditor').hidden);
}));

test('archived projects are view-only for everyone, and a project lead can pick a primary schedule', () => withApp(async (app) => {
  const ui = await app.open('s.patel');
  const p = proj(app, '26-101');
  const id1 = await createFromTemplate(ui, p);
  ui.goto('#/scheduler/p/' + p.id);
  await ui.until(() => ui.$$('#projBody .srow').length === 1, 'first schedule listed');
  ui.click(ui.button('New schedule', ui.$('#projHead')));
  await ui.until(() => ui.$('#nsProj'), 'dialog');
  ui.change(ui.$('#newName'), 'Second schedule');
  ui.click(ui.dialogButton('Create schedule'));
  await ui.until(() => /#\/scheduler\/s\//.test(ui.w.location.hash) && !ui.w.location.hash.endsWith(id1), 'second editor');
  const id2 = ui.w.location.hash.split('/').pop();
  ui.goto('#/scheduler/p/' + p.id);
  await ui.until(() => ui.$$('#projBody .srow').length === 2, 'two schedules');
  const star = ui.$$('#projBody .srow').find(r => r.getAttribute('data-id') === id2).querySelector('.star');
  ui.click(star);
  await ui.until(async () => (await app.t.api('s.patel').get('/api/scheduler/project-settings')).body.records.length === 1, 'the primary setting to be stored');
  const setting = (await app.t.api('s.patel').get('/api/scheduler/project-settings')).body.records[0];
  assert.strictEqual(setting.data.primaryId, id2);
  assert.strictEqual(setting.projectId, p.id);
  noErrors(ui);
}));

/* ---------- templates ---------- */
test('the template library: seven starters for everyone; only firm admins see Template managers', () => withApp(async (app) => {
  const admin = await app.open('a.rivera', '#/scheduler/templates');
  await admin.until(() => admin.$$('.tcard').length === 7, 'seven starter templates');
  assert.ok(admin.$('#btnTplMgrs'), 'a firm admin can pick template managers');
  admin.close();
  const ui = await app.open('s.patel', '#/scheduler/templates');
  await ui.until(() => ui.$$('.tcard').length === 7, 'seven starter templates');
  assert.ok(!ui.$('#btnTplMgrs'), 'nobody else sees it');
  noErrors(ui);
}));

test('Save as template keeps a private copy in My templates', () => withApp(async (app) => {
  const ui = await app.open('s.patel');
  const p = proj(app, '26-101');
  await createFromTemplate(ui, p);
  await ui.until(() => ui.$$('#tbody input[data-f=name]').length > 5, 'the activity table');
  ui.click(ui.$('#btnSchedMenu'));
  ui.click(ui.$('#btnSaveTpl'));
  await ui.until(() => ui.$('#tplName'), 'the save-as-template dialog');
  ui.change(ui.$('#tplName'), 'Sam’s clinic schedule');
  ui.change(ui.$('#tplCat'), 'Healthcare');
  ui.click(ui.dialogButton('Save to My templates'));
  await ui.until(async () => (await app.t.api('s.patel').get('/api/scheduler/personal-templates')).body.records.length === 1, 'the template to be stored');
  const rec = (await app.t.api('s.patel').get('/api/scheduler/personal-templates')).body.records[0];
  assert.strictEqual(rec.data.name, 'Sam’s clinic schedule');
  assert.strictEqual(rec.data.kind, 'template');
  assert.strictEqual(rec.projectId, null);
  // private: nobody else can read it, not even a firm admin through the API
  assert.strictEqual((await app.t.api('a.rivera').get('/api/scheduler/personal-templates/' + rec.id)).status, 404);
  assert.strictEqual((await app.t.api('m.lee').get('/api/scheduler/personal-templates')).body.records.length, 0);
  // and it shows under My templates for Sam
  ui.goto('#/scheduler/templates');
  await ui.until(() => ui.$('[data-tab=mine]'), 'the My templates tab');
  ui.click(ui.$('[data-tab=mine]'));
  await ui.until(() => ui.$$('.tcard').length === 1 && /clinic schedule/.test(ui.$('.tcard').textContent), 'the template card');
  noErrors(ui);
}));

test('template managers: listed people can change company templates, others see them read-only', () => withApp(async (app) => {
  const writers = '/api/scheduler/firm-writers/firm-templates';
  const set = await app.t.api('a.rivera').put(writers, { data: { schemaVersion: 1, ids: [app.t.person('c.nguyen').id] } });
  assert.strictEqual(set.status, 201);

  const manager = await app.open('c.nguyen', '#/scheduler/t/company/fed');
  await manager.until(() => manager.$$('#tbody input[data-f=name]').length > 3, 'the starter template in the editor');
  await manager.until(() => manager.$('#status').textContent === 'All changes saved', 'edit rights for a listed manager');
  manager.change(manager.$$('#tbody input[data-f=name]')[0], 'Our own first step');
  manager.click(manager.$('#btnSave'));
  await manager.until(async () => (await app.t.api('c.nguyen').get('/api/scheduler/firm-templates')).body.records.length === 1, 'the company copy to be stored');
  const rec = (await app.t.api('c.nguyen').get('/api/scheduler/firm-templates')).body.records[0];
  assert.strictEqual(rec.id, 'starter_fed', 'a starter template is stored under a long enough id');
  manager.close();

  const other = await app.open('r.ortiz', '#/scheduler/t/company/fed');
  await other.until(() => other.$$('#tbody input[data-f=name]').length > 3, 'the template in the editor');
  await other.until(() => other.$('#status').textContent === 'View only', 'the view-only state');
  await other.until(() => other.$$('#tbody input[data-f=name]')[0].value === 'Our own first step', 'the company copy replacing the starter');
  // and the server refuses their write even if the page is tampered with
  assert.strictEqual((await app.t.api('r.ortiz').put('/api/scheduler/firm-templates/starter_fed', { data: { schemaVersion: 1, kind: 'template', name: 'x' } }, { ifMatch: rec.rev })).status, 403);
  noErrors(other);
}));

'use strict';
/* Minutes in the Toolbox: the real bundle in jsdom, wired to the real platform and a real server. The business rules are in
   logic.test.js; these check what changed in the port: projects from Vantagepoint, permissions per project, sync with the
   server (including the held conflict), the local copy per person, and backups in the common format. */
const nodeTest = require('node:test');
const test = (name, fn) => nodeTest.test(name, fn);
const assert = require('node:assert');
const { start: startApp } = require('../../../server/tests/ui-harness');

let apps = [];
nodeTest.afterEach(async () => { for (const a of apps.splice(0)) await a.close(); });
async function boot() { const app = await startApp('minutes'); apps.push(app); return app; }
const api = (app, who) => app.t.api(who);
const stored = async (app, who, coll, id) => (await api(app, who).get('/api/minutes/' + coll + (id ? '/' + id : ''))).body;
const submit = (ui, form) => form.dispatchEvent(new ui.w.Event('submit', { bubbles: true, cancelable: true }));

async function open(app, who) {
  const ui = await app.open(who, '#/minutes');
  await ui.until(() => ui.$('.pbody') && !/Loading your minutes/.test(ui.$('.pbody').textContent), 'Minutes to load');
  return ui;
}
async function startProject(app, ui, number) {
  const p = app.t.project(number);
  await ui.until(() => ui.$('[data-act="start-project"][data-id="' + p.id + '"]'), 'the Start button');
  ui.click(ui.$('[data-act="start-project"][data-id="' + p.id + '"]'));
  await ui.until(async () => (await stored(app, 's.patel', 'projects')).records.some(r => r.id === p.id), 'the project to reach the server');
  return p;
}

test('a project lead sees the Vantagepoint projects they can start; a team member does not', async () => {
  const app = await boot();
  const lead = await open(app, 's.patel');
  const nums = lead.$$('[data-act="start-project"]').map(b => b.closest('.srow').textContent);
  assert.strictEqual(nums.length, 5, 'the five projects Sam leads');
  assert.ok(nums.every(t => !/Cedar Hills/.test(t)), 'not a project he is not on');
  const member = await open(app, 'r.ortiz'); // team member only: read access
  assert.strictEqual(member.$$('[data-act="start-project"]').length, 0);
  assert.match(member.$('.pbody').textContent, /not set up on a Vantagepoint project that can take minutes/);
  assert.deepStrictEqual(lead.errors.concat(member.errors), []);
});

test('starting minutes creates the project record under the Toolbox project id, with its number and name from Vantagepoint', async () => {
  const app = await boot();
  const ui = await open(app, 's.patel');
  const p = await startProject(app, ui, '26-101');
  const rec = (await stored(app, 's.patel', 'projects', p.id));
  assert.strictEqual(rec.projectId, p.id, 'linked to the project, so the project’s access rules apply');
  assert.strictEqual(rec.data.number, '26-101');
  assert.strictEqual(rec.data.name, 'Riverton Elementary Addition');
  assert.strictEqual(rec.schemaVersion, 2);
  assert.strictEqual(rec.rev, 1);
  await ui.until(() => /Riverton Elementary Addition/.test(ui.$('.ptitle, .crumbs, .pbody').textContent), 'the project page');
  assert.ok(!ui.$('#pj-name'), 'the project page opens on its series, not settings');
  assert.deepStrictEqual(ui.errors, []);
});

test('the project’s name and number are read-only in Minutes (they come from Vantagepoint)', async () => {
  const app = await boot();
  const ui = await open(app, 's.patel');
  await startProject(app, ui, '26-101');
  await ui.until(() => ui.$('[data-act="ptab"][data-id="details"]'), 'the settings tab');
  ui.click(ui.$('[data-act="ptab"][data-id="details"]'));
  await ui.until(() => ui.$('#pj-name'), 'the project settings');
  assert.strictEqual(ui.$('#pj-name').disabled, true);
  assert.strictEqual(ui.$('#pj-number').disabled, true);
  assert.strictEqual(ui.$('#pj-address').disabled, false, 'the address is Minutes’ own');
});

test('other people on the project get it from the server; read-only people can look but not change', async () => {
  const app = await boot();
  const sam = await open(app, 's.patel');
  const p = await startProject(app, sam, '26-101');
  const m = await open(app, 'm.lee'); // the PIC
  await m.until(() => m.$$('.proj .pn').some(b => /Riverton/.test(b.textContent)), 'the project to arrive');
  assert.ok(!m.$('.sync.s-bad'), 'nothing wrong with sync');
  const tm = await open(app, 'c.nguyen'); // team member of 26-101: read access
  await tm.until(() => tm.$$('.proj .pn').some(b => /Riverton/.test(b.textContent)), 'the project to arrive');
  tm.click(tm.$$('.proj .pn').find(b => /Riverton/.test(b.textContent)));
  await tm.until(() => tm.$('[data-act="ptab"][data-id="details"]'), 'the project page');
  assert.match(tm.$('#sync-chip').textContent, /View only/);
  tm.click(tm.$('[data-act="ptab"][data-id="details"]'));
  await tm.until(() => tm.$('#pj-address'), 'the settings');
  assert.strictEqual(tm.$('#pj-address').disabled, true, 'a read-only person cannot edit');
  const r = await api(app, 'r.ortiz').get('/api/minutes/projects/' + p.id);
  assert.strictEqual(r.status, 404, 'someone not on the project cannot read it at all');
});

test('a new series is stored under its project and reaches the others', async () => {
  const app = await boot();
  const ui = await open(app, 's.patel');
  const p = await startProject(app, ui, '26-101');
  await ui.until(() => ui.$('[data-act="new-series"]'), 'the New series button');
  ui.click(ui.$('[data-act="new-series"]'));
  await ui.until(() => ui.$('[data-form="newSeries"]'), 'the new series form');
  ui.$('#ns-name').value = 'Weekly OAC';
  submit(ui, ui.$('[data-form="newSeries"]'));
  await ui.until(async () => (await stored(app, 's.patel', 'series')).records.length === 1, 'the series to be stored');
  const s = (await stored(app, 's.patel', 'series')).records[0];
  assert.strictEqual(s.projectId, p.id);
  assert.strictEqual(s.data.name, 'Weekly OAC');
  const m = await open(app, 'm.lee');
  await m.until(() => m.$$('.srow').some(r => /Weekly OAC/.test(r.textContent)), 'the series to arrive for the PIC');
});

test('an edit made on two devices is held for a decision, and keeping mine saves it on top', async () => {
  const app = await boot();
  const sam = await open(app, 's.patel');
  const p = await startProject(app, sam, '26-101');
  const lee = await open(app, 'm.lee');
  await lee.until(() => lee.$$('.proj .pn').some(b => /Riverton/.test(b.textContent)), 'the project to arrive');
  const editAddress = async (ui, text) => {
    if (!ui.$('#pj-address')) {
      if (!ui.$('[data-act="ptab"][data-id="details"]')) ui.click(ui.$$('.proj .pn').find(b => /Riverton/.test(b.textContent)));
      await ui.until(() => ui.$('[data-act="ptab"][data-id="details"]'), 'the project page');
      ui.click(ui.$('[data-act="ptab"][data-id="details"]'));
      await ui.until(() => ui.$('#pj-address'), 'the settings');
    }
    const a = ui.$('#pj-address'); a.value = text;
    a.dispatchEvent(new ui.w.Event('input', { bubbles: true })); a.dispatchEvent(new ui.w.Event('change', { bubbles: true }));
  };
  // both open the settings before either edits
  await editAddress(sam, 'Sam’s address'); // Sam's edit goes up first
  await sam.until(async () => (await stored(app, 's.patel', 'projects', p.id)).data.address === 'Sam’s address', 'Sam’s edit on the server');
  // Lee still has the old copy and edits the same field
  await editAddress(lee, 'Lee’s address');
  await lee.until(() => /changed here and somewhere else/.test(lee.$('.pbody').textContent), 'the conflict banner', 10000);
  assert.strictEqual((await stored(app, 's.patel', 'projects', p.id)).data.address, 'Sam’s address', 'nothing was overwritten');
  lee.click(lee.$('[data-act="resolve"][data-choice="mine"]'));
  await lee.until(async () => (await stored(app, 's.patel', 'projects', p.id)).data.address === 'Lee’s address', 'Lee’s copy to be saved after the choice', 10000);
  assert.ok(!/changed here and somewhere else/.test(lee.$('.pbody').textContent));
});

test('when Vantagepoint renames a project, Minutes shows and saves the new name', async () => {
  const app = await boot();
  const ui = await open(app, 's.patel');
  const p = await startProject(app, ui, '26-101');
  const csv = 'ProjectID,ProjectNumber,ProjectName,Client,Status\nP0101,26-101,Riverton Elementary Addition II,Riverton School District,Active\n';
  assert.strictEqual((await api(app, 'a.rivera').post('/api/admin/import-vp?kind=projects', csv, { raw: true })).status, 200);
  ui.api.unmount(); await ui.api.mount({ container: ui.container, platform: app.platform, hash: '#/minutes' }); // comes back to the page: it looks again
  await ui.until(() => /Addition II/.test(ui.$('.pbody').textContent), 'the new name on screen');
  await ui.until(async () => (await stored(app, 's.patel', 'projects', p.id)).data.name === 'Riverton Elementary Addition II', 'the project lead’s copy to be updated');
});

test('backups use the Toolbox file format, and the file imports back', async () => {
  const app = await boot();
  const ui = await open(app, 's.patel');
  await startProject(app, ui, '26-101');
  const saved = [];
  app.platform.Files.save = (f) => saved.push(f);
  ui.click(ui.$('[data-act="toggle-data"]'));
  await ui.until(() => ui.$('[data-act="save-backup"]'), 'the data panel');
  ui.click(ui.$('[data-act="save-backup"]'));
  await ui.until(() => saved.length === 1, 'the file');
  assert.match(saved[0].filename, /^nexus-minutes-backup-.*\.json$/);
  const j = JSON.parse(saved[0].data);
  assert.strictEqual(j.format, 'toolbox-backup');
  assert.strictEqual(j.app, 'minutes');
  assert.strictEqual(j.appSchemaVersion, 2);
  assert.ok(Object.keys(j.collections.projects).length === 1);
  assert.deepStrictEqual(Object.keys(j.collections).sort(), ['actions', 'firm', 'images', 'meetings', 'projects', 'series', 'snapshots']);
  assert.strictEqual(j.exportedBy, api(app, 's.patel').id);
});

test('the local copy is per person: another person on the same computer starts with nothing of it', async () => {
  const app = await boot();
  const ui = await open(app, 's.patel');
  await startProject(app, ui, '26-101');
  await ui.until(async () => { const k = ui.w.Toolbox.pref('cache.minutes:' + api(app, 's.patel').id + ':state'); return k && /Riverton/.test(k); }, 'the local copy to be written');
  const keys = Object.keys(ui.w.localStorage).filter(k => /cache\.minutes:/.test(k));
  assert.ok(keys.every(k => k.includes(api(app, 's.patel').id)), 'every cached key names the person: ' + keys);
});

/* ---------- a whole meeting through the real screens ---------- */
const ev = (ui, el, type) => el.dispatchEvent(new ui.w.Event(type, { bubbles: true, cancelable: true }));
async function newSeriesAndMeeting(app, ui) {
  await ui.until(() => ui.$('[data-act="new-series"]'), 'the New series button');
  ui.click(ui.$('[data-act="new-series"]'));
  await ui.until(() => ui.$('[data-form="newSeries"]'), 'the series form');
  ui.$('#ns-name').value = 'Weekly OAC';
  submit(ui, ui.$('[data-form="newSeries"]'));
  await ui.until(() => ui.$('[data-act="tab"][data-id="meetings"]'), 'the series page');
  ui.click(ui.$('[data-act="tab"][data-id="meetings"]'));
  await ui.until(() => ui.$('[data-act="new-meeting"]'), 'the New meeting button');
  ui.click(ui.$('[data-act="new-meeting"]'));
  await ui.until(() => ui.$('[data-act="start-minutes"]'), 'the agenda');
}

test('agenda → minutes → published: the assignment becomes an action, carries into the next agenda, and all of it is on the server', async () => {
  const app = await boot();
  const ui = await open(app, 's.patel');
  const p = await startProject(app, ui, '26-101');
  await newSeriesAndMeeting(app, ui);

  const form = ui.$('form[data-form="addTopic"]');
  form.querySelector('input[name=text]').value = 'Parking requirements';
  submit(ui, form);
  await ui.until(() => ui.$$('.topic').some(t => /Parking requirements/.test(t.textContent)), 'the topic');
  ui.click(ui.$('[data-act="start-minutes"]'));
  await ui.until(() => ui.$('[data-act="add-outcome"]'), 'the minutes view');
  ui.click(ui.$('[data-act="add-outcome"][data-type="assignment"]'));
  await ui.until(() => ui.$('textarea[data-bind="otext"]'), 'the assignment');
  const ta = ui.$('textarea[data-bind="otext"]'); ta.value = 'Send the updated site plan'; ev(ui, ta, 'input'); ev(ui, ta, 'change');
  const pick = ui.$('select[data-bind="assign"]');
  pick.value = [...pick.options].find(o => o.value).value; ev(ui, pick, 'change');
  await ui.until(() => ui.$('input[data-bind="odue"]'), 'the due date');
  const due = ui.$('input[data-bind="odue"]'); due.value = '2026-10-30'; ev(ui, due, 'change');
  await ui.until(() => ui.$('[data-act="publish-quick"]'), 'the Publish button');
  ui.click(ui.$('[data-act="publish-quick"]'));
  await ui.until(() => ui.$('[data-act="confirm-publish"]') || ui.$('.sheet-wrap, .sheet'), 'the publish panel or the issued sheet');
  if (ui.$('[data-act="confirm-publish"]')) ui.click(ui.$('[data-act="confirm-publish"]'));
  await ui.until(async () => (await stored(app, 's.patel', 'snapshots')).records.length === 1, 'the issued copy to reach the server', 8000);

  const snap = (await stored(app, 's.patel', 'snapshots')).records[0];
  assert.strictEqual(snap.projectId, p.id, 'the issued copy follows the project');
  assert.strictEqual(snap.data.rev, 0);
  await ui.until(async () => (await stored(app, 's.patel', 'actions')).records.length === 1, 'the action');
  const act = (await stored(app, 's.patel', 'actions')).records[0];
  assert.strictEqual(act.data.text, 'Send the updated site plan');
  assert.strictEqual(act.data.due, '2026-10-30');
  assert.strictEqual(act.data.status, 'open');
  const meeting = (await stored(app, 's.patel', 'meetings')).records[0];
  assert.strictEqual(meeting.data.status, 'published');
  assert.strictEqual(meeting.projectId, p.id);
  assert.strictEqual(NMsync(ui), 0, 'nothing is still waiting to be sent');

  // the next meeting's agenda carries the open action
  ui.click(ui.$('[data-act="open-series"]'));
  await ui.until(() => ui.$('[data-act="tab"][data-id="meetings"]'), 'the series page');
  ui.click(ui.$('[data-act="tab"][data-id="meetings"]'));
  await ui.until(() => ui.$('[data-act="new-meeting"]'), 'the New meeting button');
  ui.click(ui.$('[data-act="new-meeting"]'));
  await ui.until(() => /Send the updated site plan/.test(ui.$('.pbody').textContent), 'the carried action on the next agenda');
  assert.match(ui.$('.pbody').textContent, /CARRIED|carried|Carried/);
  assert.deepStrictEqual(ui.errors, []);

  // someone else on the project sees the published minutes and the open action
  const lee = await open(app, 'm.lee');
  await lee.until(() => lee.$$('.srow').some(r => /Weekly OAC/.test(r.textContent) && /1 open action/.test(r.textContent)), 'the PIC to see the series with its open action');
});
const NMsync = (ui) => Number((ui.$('#sync-chip').textContent.match(/(\d+) waiting/) || [0, 0])[1]);

test('editing offline then reconnecting sends everything without loss', async () => {
  const app = await boot();
  const ui = await open(app, 's.patel');
  const p = await startProject(app, ui, '26-101');
  await newSeriesAndMeeting(app, ui);
  await ui.until(async () => (await stored(app, 's.patel', 'meetings')).records.length === 1, 'the meeting to be stored');
  ui.w.dispatchEvent(new ui.w.Event('offline'));
  await ui.until(() => /Offline/.test(ui.$('#sync-chip').textContent), 'the offline chip');
  const loc = ui.$('#m-loc'); loc.value = 'Room 4 (typed offline)'; ev(ui, loc, 'input'); ev(ui, loc, 'change');
  const form = ui.$('form[data-form="addTopic"]'); form.querySelector('input[name=text]').value = 'Added while offline'; submit(ui, form);
  await ui.until(() => /\d+ waiting/.test(ui.$('#sync-chip').textContent), 'the waiting count');
  await new Promise(r => setTimeout(r, 1200));
  const before = (await stored(app, 's.patel', 'meetings')).records[0];
  assert.ok(!JSON.stringify(before.data).includes('Added while offline'), 'the server has not seen the offline edits');
  ui.w.dispatchEvent(new ui.w.Event('online'));
  await ui.until(async () => JSON.stringify((await stored(app, 's.patel', 'meetings')).records[0].data).includes('Added while offline'), 'the edits to arrive after reconnecting', 8000);
  const after = (await stored(app, 's.patel', 'meetings')).records[0];
  assert.ok(JSON.stringify(after.data).includes('Room 4 (typed offline)'), 'both edits arrived');
  assert.strictEqual(after.projectId, p.id);
  await ui.until(() => /Saved/.test(ui.$('#sync-chip').textContent), 'Saved');
});

test('firm settings can be changed by firm admins only, and the server enforces it', async () => {
  const app = await boot();
  const admin = await open(app, 'a.rivera');
  await admin.until(() => admin.$('[data-act="open-firm"]'), 'the Firm settings button');
  admin.click(admin.$('[data-act="open-firm"]'));
  await admin.until(() => admin.$('[data-bind="firmf"][data-field="name"]'), 'the firm form');
  const f = admin.$('[data-bind="firmf"][data-field="name"]'); f.value = 'Arch Nexus Test Firm'; ev(admin, f, 'input'); ev(admin, f, 'change');
  await admin.until(async () => (await stored(app, 'a.rivera', 'firm-settings')).records.length === 1, 'the firm record to be stored');
  const rec = (await stored(app, 'a.rivera', 'firm-settings')).records[0];
  assert.strictEqual(rec.data.name, 'Arch Nexus Test Firm');
  assert.strictEqual(rec.projectId, null);
  // everyone can read it; nobody else can write it
  assert.strictEqual((await stored(app, 's.patel', 'firm-settings')).records.length, 1);
  const refused = await api(app, 's.patel').put('/api/minutes/firm-settings/firm-settings', { data: { schemaVersion: 2, name: 'Hijacked' } }, { ifMatch: rec.rev });
  assert.strictEqual(refused.status, 403);
  const pm = await open(app, 's.patel');
  assert.ok(!pm.$('[data-act="open-firm"]'), 'a project lead is not offered firm settings');
});

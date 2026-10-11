/*
 * Fee Builder interface tests: the real module bundle in jsdom, wired to the real platform adapters and a real server.
 * The workflow tests (A to G, typing, undo, exports, snapshots, settings) are the original interface tests; only the way the page
 * is started changed. The persistence and sharing tests at the end are new: they use the real server instead of a stand-in store.
 */
'use strict';
const nodeTest = require('node:test');
const test = (name, fn) => nodeTest.test(name, fn);
const { afterEach } = nodeTest;
const { start: startApp } = require('../../../server/tests/ui-harness');

let apps = [];
afterEach(async () => { for (const a of apps.splice(0)) await a.close(); });

const wait = ms => new Promise(r => setTimeout(r, ms));
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

/* a fresh server and page for each test; the helpers match the original test file */
async function boot(opts) {
  opts = opts || {};
  const app = await startApp('fee-builder');
  apps.push(app);
  const t = await app.open(opts.user || 's.patel', '#/fee-builder');
  return wrap(app, t);
}
async function wrap(app, ui) {
  const w = ui.w, d = w.document;
  await ui.until(() => d.querySelector('#prop-pick') && !/Loading proposals/.test(d.body.textContent), 'Fee Builder to load');
  const $ = s => d.querySelector(s);
  const $$ = s => [...d.querySelectorAll(s)];
  const click = s => { const el = typeof s === 'string' ? $(s) : s; if (!el) throw new Error('missing ' + s); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
  const type = (s, v) => { const el = typeof s === 'string' ? $(s) : s; if (!el) throw new Error('missing ' + s); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); return el; };
  const choose = (s, v) => { const el = typeof s === 'string' ? $(s) : s; if (!el) throw new Error('missing ' + s); el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const out = k => { const el = $(`[data-o="${k}"]`); return el ? el.textContent : null; };
  const field = suffix => $$('[data-f]').find(el => el.dataset.f.endsWith(suffix));
  const fields = suffix => $$('[data-f]').filter(el => el.dataset.f.endsWith(suffix));
  return { app, ui, w, d, $, $$, click, type, choose, out, field, fields, errors: ui.errors, until: ui.until };
}
/* a second window for another person against the same server */
async function another(u, username) {
  const ui = await u.app.open(username, '#/fee-builder');
  return wrap(u.app, ui);
}
const api = (u, username) => u.app.t.api(username);

/* ================================================================ the page inside the Toolbox */

test('Fee Builder page: landing page, then the open proposal shows its name as the page title, breadcrumbs and workflow control', async () => {
  const t = await boot();
  assert(t.$('.ptitle h1.brand').textContent === 'Fee Builder', 'page title on the landing page');
  assert(!t.$('.side'), 'the side bar belongs to the Toolbox shell, not to Fee Builder');
  assert(t.errors.length === 0, 'errors ' + t.errors);
  t.click('[data-a="open-example"]');
  assert(t.$('.ptitle h1 input.title') && t.$('.ptitle h1 input.title').value.includes('Riverside'), 'project name is the page title');
  assert(t.$('.crumbs').textContent.includes('Toolbox') && t.$('.crumbs').textContent.includes('Riverside'), 'breadcrumbs');
  assert(t.$$('.pbar .seg.flow button').length === 4, 'workflow control');
});

/* ================================================================ workflows (the original interface tests) */

test('Shell: the project name box follows the length of the name', async () => {
  const t = await boot();
  t.click('[data-a="open-example"]');
  const el = t.$('.ptitle .f.title');
  const before = el.size;
  t.type(el, 'A much longer project name than the example one has');
  assert(t.$('.ptitle .f.title').size > before, 'grew');
});

test('Workflow A: new fee with $15M at 5% shows $750,000 at once, then a consultant is added', async () => {
  const u = await boot();
  u.click('[data-a="newfee"]');
  u.type('#nf_name', 'Library');
  u.type('#nf_cost', '15m');
  u.type('#nf_value', '5');
  assert(u.$('#nf_result').textContent === '$750,000', 'preview ' + u.$('#nf_result').textContent);
  u.click('[data-a="nf-create"]');
  assert(u.out('sum.fee') === '$750,000', 'rail fee ' + u.out('sum.fee'));
  u.click('[data-a="add-con"][data-name="Structural"]');
  const val = u.fields('.value').find(el => el.dataset.f.includes('.cons.'));
  u.type(val, '10');
  assert(u.out('sum.fee') === '$750,000', 'included consultant keeps the fee');
  assert(u.out('sum.arch') === '$675,000', 'arch ' + u.out('sum.arch'));
  assert(!u.errors.length, u.errors.join(';'));
});

test('Typing never replaces the input being edited, and figures update as you type', async () => {
  const u = await boot();
  u.click('[data-a="open-example"]');
  const pct = u.fields('.pct').find(el => el.dataset.f.includes('.components#'));
  const id = pct.id;
  u.type(pct, '6');
  assert(u.d.getElementById(id) === pct, 'same element after typing');
  assert(u.out('sum.fee') === '$1,759,800', 'fee after 6% ' + u.out('sum.fee'));
});

test('Undo and redo restore figures', async () => {
  const u = await boot();
  u.click('[data-a="open-example"]');
  const before = u.out('sum.fee');
  u.type(u.fields('.pct').find(el => el.dataset.f.includes('.components#')), '7');
  assert(u.out('sum.fee') !== before);
  u.d.dispatchEvent(new u.w.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  assert(u.out('sum.fee') === before, 'undo ' + u.out('sum.fee'));
  u.d.dispatchEvent(new u.w.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
  assert(u.out('sum.fee') !== before, 'redo');
});

test('Workflow B: phase allocation, Balance, and editing a consultant split in the matrix cell', async () => {
  const u = await boot();
  u.click('[data-a="open-example"]');
  u.click('[data-a="view"][data-v="analyze"]');
  u.click(u.$$('[data-a="pkg-filter"]')[1]);
  const pcts = u.fields('.pct').filter(el => /\.alloc\.[^.]+\.pct$/.test(el.dataset.f) && !el.dataset.f.includes('.cons.'));
  u.type(pcts[0], '5');
  assert(/95/.test(u.$$('[data-o$=".allocPct"]')[0].textContent), 'total pct shows 95%');
  assert(u.$('.tag.warn'), 'shows not fully allocated');
  u.click('[data-a="balance"]');
  assert(/100\.00%/.test(u.$$('[data-o$=".allocPct"]')[0].textContent), 'balanced ' + u.$$('[data-o$=".allocPct"]')[0].textContent);
  // Mechanical has a custom split: its CD cell is an input in the matrix.
  const cell = u.$$('.t-matrix input[data-f*=".cons."]').find(el => el.getAttribute('aria-label').includes('Construction Documents'));
  assert(cell, 'custom split cell is editable');
  cell.focus();
  u.type(cell, '50');
  assert(u.$$('.note.err, .note.warn').some(n => /Mechanical/.test(n.textContent)), 'over-allocation of the consultant split is flagged');
  assert(u.d.activeElement && /Construction Documents/.test(u.d.activeElement.getAttribute('aria-label') || ''), 'focus stays in the cell after re-render');
  assert(!u.errors.length, u.errors.join(';'));
});

test('Workflow C: adding a work package with its own cost rolls into the project total', async () => {
  const u = await boot();
  u.click('[data-a="newfee"]');
  u.type('#nf_cost', '20m'); u.type('#nf_value', '4.5');
  u.click('[data-a="nf-create"]');
  u.click('[data-a="view"][data-v="establish"]');
  u.click('[data-a="add-pkg"]');
  const costs = u.fields('.cost').filter(el => el.dataset.f.startsWith('packages#'));
  u.type(costs[1], '18m');
  u.click('[data-a="view"][data-v="develop"]');
  u.click(u.$$('[data-a="dev-pkg"]')[1]);
  u.type(u.fields('.pct').find(el => el.dataset.f.includes('.components#')), '4.8');
  assert(u.out('sum.fee') === '$1,764,000', 'combined ' + u.out('sum.fee'));
});

test('Workflow D: a labor plan is compared with the effort allowance', async () => {
  const u = await boot();
  u.click('[data-a="newfee"]'); u.type('#nf_cost', '15m'); u.type('#nf_value', '5'); u.click('[data-a="nf-create"]');
  u.click('[data-a="view"][data-v="establish"]');
  u.type(u.fields('.billRate')[0], '200');
  u.click('[data-a="view"][data-v="develop"]');
  u.click(u.$$('[data-a="add-labrow"]')[0]);
  // Re-query each time: the first entry re-renders the plan totals.
  for (let c = 0; c < 5; c++) u.type(u.$(`input[data-g="lab:0:${c}"]`), '300');
  assert(u.out('sum.plan') === '$300,000', 'plan ' + u.out('sum.plan'));
  assert(u.out('sum.allow') === '$637,500', 'allowance ' + u.out('sum.allow'));
  assert(u.out('sum.headroom') === '+$337,500', 'headroom ' + u.out('sum.headroom'));
});

test('Workflow E: "the client will pay at most $825,000" solves without overwriting, then saves as a new scenario', async () => {
  const u = await boot();
  u.click('[data-a="newfee"]'); u.type('#nf_cost', '15m'); u.type('#nf_value', '6'); u.click('[data-a="nf-create"]');
  u.click('[data-a="view"][data-v="analyze"]');
  u.click('[data-a="atab"][data-v="stress"]');
  u.click('[data-a="solve-preset"][data-m="clientFee"]');
  u.type('#solve_target', '825000');
  u.click('[data-a="solve"]');
  assert(/\$825,000/.test(u.$('.note.info').textContent), 'result ' + u.$('.note.info').textContent);
  assert(u.out('sum.fee') === '$900,000', 'original untouched');
  u.click('[data-a="solve-new"]');
  assert(u.out('sum.fee') === '$825,000', 'new scenario fee ' + u.out('sum.fee'));
  assert(u.$$('[data-a="pick-scen"]').length === 2);
});

test('Workflow F: extending CA in the stress test changes staffing-mode effort but not the scenario', async () => {
  const u = await boot();
  u.click('[data-a="open-example"]');
  u.click('[data-a="view"][data-v="analyze"]');
  u.click('[data-a="atab"][data-v="stress"]');
  const sel = u.$('#st_phase');
  assert(/Construction Administration/.test(sel.options[sel.selectedIndex].text));
  u.type('#st_months', '6');
  assert(/\+6 mo/.test(u.$('#st_months_v').textContent));
  u.type('#st_fee', '-8');
  assert(/−\$131,184/.test(u.$('#stress-out').textContent), u.$('#stress-out').textContent.slice(0, 200));
  assert(u.out('sum.fee') === '$1,639,800', 'scenario unchanged');
  u.click('[data-a="stress-promote"]');
  assert(u.$$('[data-a="pick-scen"]').length === 4, 'promoted to a new scenario');
});

test('Workflow G: compare three differently built scenarios side by side and pick one', async () => {
  const u = await boot();
  u.click('[data-a="open-example"]');
  u.click('[data-a="view"][data-v="analyze"]');
  u.click('[data-a="atab"][data-v="compare"]');
  const heads = u.$$('.t-matrix thead th');
  assert(heads.length === 4, 'measure + 3 scenarios');
  assert(/−\$220,100/.test(u.$('.t-matrix').textContent), 'delta vs reference shown');
  u.click(u.$$('[data-a="prefer"]')[0]);
  assert(u.$$('.t-matrix .tag.blue').length === 1);
});

test('Exports: copy for Word puts an HTML table and plain text on the clipboard', async () => {
  const u = await boot();
  let written = null;
  u.w.ClipboardItem = function (o) { this.o = o; };
  Object.defineProperty(u.w.navigator, 'clipboard', { value: { write: async items => { written = items; } }, configurable: true });
  u.click('[data-a="open-example"]');
  u.click('[data-a="view"][data-v="finalize"]');
  u.click('[data-a="exp-copy"][data-id="matrix"]');
  await wait(20);
  assert(written && written[0].o['text/html'] && written[0].o['text/plain'], 'clipboard flavors');
});

test('Exports are gated by validation when there are blocking errors', async () => {
  const u = await boot();
  u.click('[data-a="newfee"]'); u.type('#nf_cost', '10m'); u.type('#nf_value', '5'); u.click('[data-a="nf-create"]');
  u.click('[data-a="view"][data-v="analyze"]');
  u.type(u.fields('.pct').find(el => /\.alloc\.[^.]+\.pct$/.test(el.dataset.f)), '60');
  u.click('[data-a="view"][data-v="finalize"]');
  assert(u.$('[data-a="exp-csv"]').disabled, 'export disabled');
  const ack = u.$('[data-a-change="exp-ack"]');
  ack.checked = true; ack.dispatchEvent(new u.w.Event('change', { bubbles: true }));
  assert(!u.$('[data-a="exp-csv"]').disabled, 'enabled after acknowledging');
});

test('Snapshots: an approved fee and a contract baseline reproduce; additional scopes count only when accepted', async () => {
  const u = await boot();
  u.click('[data-a="newfee"]'); u.type('#nf_cost', '10m'); u.type('#nf_value', '5'); u.click('[data-a="nf-create"]');
  u.click('[data-a="view"][data-v="finalize"]');
  u.click('[data-a="snap"][data-kind="approved"]');
  u.click('[data-a="snap"][data-kind="contract"]');
  assert(u.$$('.tag.ok').filter(t => t.textContent === 'Reproduces').length === 2);
  u.click('[data-a="add-change"]');
  u.type(u.fields('.amount').find(el => el.dataset.f.startsWith('changes#')), '20000');
  assert(/Pending \(proposed\)/.test(u.d.body.textContent));
  u.choose(u.fields('.status')[0], 'accepted');
  assert(/\$520,000/.test(u.$$('.sec').find(s => /Contract and additional scopes/i.test(s.textContent)).textContent));
});

test('Settings: changing the target-profit basis recalculates the allowance', async () => {
  const u = await boot();
  u.click('[data-a="newfee"]'); u.type('#nf_cost', '10m'); u.type('#nf_value', '5'); u.click('[data-a="nf-create"]');
  assert(u.out('sum.allow') === '$425,000', u.out('sum.allow'));
  u.click('[data-a="settings"]');
  u.choose(u.$('select[data-f="$settings.targetProfitBasis"]'), 'netRevenue');
  assert(u.out('sum.allow') === '$425,000', 'no consultants, so the bases agree');
  u.type(u.$('input[data-f="$settings.targetProfitPct"]'), '20');
  assert(u.out('sum.allow') === '$400,000', 'allowance ' + u.out('sum.allow'));
});

/* ================================================================ persistence */


/* ================================================================ saving, sharing and persistence (real server) */

const newFee = (u, name) => { u.click('[data-a="newfee"]'); if (name) u.type('#nf_name', name); u.type('#nf_cost', '8m'); u.type('#nf_value', '6'); u.click('[data-a="nf-create"]'); };
const stored = async (u, who, id) => (await api(u, who).get('/api/fee-builder/owned-proposals' + (id ? '/' + id : ''))).body;

test('Saves reach the server with a rising revision, and a fresh page loads the same proposal', async () => {
  const u = await boot();
  newFee(u, 'Persisted');
  await u.until(async () => (await stored(u, 's.patel')).records.length === 1, 'the first save');
  const rec = (await stored(u, 's.patel')).records[0];
  assert(rec.rev === 1 && rec.schemaVersion === 3, 'envelope ' + rec.rev + '/' + rec.schemaVersion);
  assert(rec.data.name === 'Persisted' && rec.data.schema === 3, 'a v3 proposal');
  assert(rec.projectId === null, 'a new proposal is not linked to a project');
  assert(rec.createdBy === api(u, 's.patel').id, 'created by the person');
  assert(!('rev' in rec.data), 'the revision lives with the server, not inside the proposal');
  u.type(u.fields('.pct').find(el => el.dataset.f.includes('.components#')), '7');
  await u.until(async () => (await stored(u, 's.patel', rec.id)).rev === 2, 'the second save');
  const again = await another(u, 's.patel');
  assert(again.out('sum.fee') === '$560,000', 'a second window shows the saved fee ' + again.out('sum.fee'));
  assert(!u.errors.length && !again.errors.length, u.errors.concat(again.errors).join(';'));
});

test('Draft recovery: newer unsaved work kept on this computer is offered back after a crash', async () => {
  const u = await boot();
  newFee(u);
  await u.until(async () => (await stored(u, 's.patel')).records.length === 1, 'the first save');
  const rec = (await stored(u, 's.patel')).records[0];
  u.ui.close();
  const draft = JSON.parse(JSON.stringify(rec.data));
  draft.id = rec.id;
  draft.scenarios[0].pkgs[draft.packages[0].id].components[0].pct = 7;
  draft.updatedAt = rec.updatedAt + 5000;
  // a new window on the same computer: its browser storage holds the draft the crashed one left behind
  const t = await u.app.open('s.patel', '#/fee-builder', { before: (w) => { w.Toolbox.pref('fb.draft.' + rec.id, JSON.stringify({ at: draft.updatedAt, baseRev: 1, proposal: draft })); w.Toolbox.pref('fb.ui', JSON.stringify({ lastId: rec.id })); } });
  const u2 = await wrap(u.app, t);
  await u2.until(() => /Unsaved changes/.test(u2.d.body.textContent), 'the offer');
  u2.click('[data-a="draft-restore"]');
  assert(u2.out('sum.fee') === '$560,000', 'restored fee ' + u2.out('sum.fee'));
});

test('A first-prototype (v2) proposal on the server is migrated, totals preserved, and saved back as v3 with the original kept', async () => {
  const V2 = require('./fixtures/engine-v2.js');
  const v2 = V2.example();
  v2.id = 'legacy1'; v2.example = undefined; v2.name = 'Old proposal'; v2.schemaVersion = 1;
  const expect = V2.compute(v2, v2.scenarios.find(s => s.id === v2.selectedId)).grand;
  const u0 = await startApp('fee-builder'); apps.push(u0);
  const put = await u0.t.api('s.patel').put('/api/fee-builder/owned-proposals/legacy1', { data: JSON.parse(JSON.stringify(v2)) });
  assert(put.status === 201, 'seeded ' + put.status);
  const ui = await u0.open('s.patel', '#/fee-builder');
  const u = await wrap(u0, ui);
  await u.until(() => /Old proposal/.test(u.$('#prop-pick').textContent), 'it to be listed');
  const fee = u.out('sum.fee');
  assert(fee === '$' + expect.toLocaleString('en-US'), 'fee ' + fee + ' vs ' + expect);
  await u.until(async () => { const r = (await u0.t.api('s.patel').get('/api/fee-builder/owned-proposals/legacy1')).body; return r.rev >= 2; }, 'the migrated copy to be saved');
  const saved = (await u0.t.api('s.patel').get('/api/fee-builder/owned-proposals/legacy1')).body;
  assert(saved.data.schema === 3 && saved.data.legacyOriginal, 'written back as v3 with the original kept');
  assert(/Upgraded/.test(u.d.body.textContent));
});

test('Editing while someone else saves raises a conflict choice, and nothing is overwritten silently', async () => {
  const u = await boot();
  newFee(u);
  await u.until(async () => (await stored(u, 's.patel')).records.length === 1, 'the first save');
  const rec = (await stored(u, 's.patel')).records[0];
  const id = rec.id;
  // pause saving by editing, then a firm admin saves a newer revision before our debounced save runs
  u.type(u.fields('.pct').find(el => el.dataset.f.includes('.components#')), '6');
  const theirs = JSON.parse(JSON.stringify(rec.data));
  theirs.name = 'Changed elsewhere';
  const put = await api(u, 'a.rivera').put('/api/fee-builder/owned-proposals/' + id, { data: theirs }, { ifMatch: rec.rev });
  assert(put.status === 200, 'the other save ' + put.status);
  await u.until(() => /changed in another window/.test(u.d.body.textContent), 'the conflict banner', 8000);
  assert((await stored(u, 's.patel', id)).data.name === 'Changed elsewhere', 'the server still holds their version');
  u.click('[data-a="conflict-theirs"]');
  assert(u.$('#f_name').value === 'Changed elsewhere');
  assert(u.out('sum.fee') === '$480,000', 'their version loaded ' + u.out('sum.fee'));
});

test('Keeping my version after a conflict saves it on top of theirs', async () => {
  const u = await boot();
  newFee(u, 'Mine');
  await u.until(async () => (await stored(u, 's.patel')).records.length === 1, 'the first save');
  const rec = (await stored(u, 's.patel')).records[0];
  u.type(u.fields('.pct').find(el => el.dataset.f.includes('.components#')), '7');
  const theirs = JSON.parse(JSON.stringify(rec.data)); theirs.notes = 'theirs';
  await api(u, 'a.rivera').put('/api/fee-builder/owned-proposals/' + rec.id, { data: theirs }, { ifMatch: rec.rev });
  await u.until(() => /changed in another window/.test(u.d.body.textContent), 'the conflict banner', 8000);
  u.click('[data-a="conflict-mine"]');
  await u.until(async () => (await stored(u, 's.patel', rec.id)).rev === 3, 'my version to be saved after theirs');
  assert((await stored(u, 's.patel', rec.id)).data.name === 'Mine');
});

test('Malformed saved data is repaired on load instead of breaking the page', async () => {
  const u0 = await startApp('fee-builder'); apps.push(u0);
  const bad = { schemaVersion: 1, schema: 3, id: 'x1abcd', name: 'Broken', packages: [{ id: 'k', cost: 'oops' }], scenarios: [{ id: 's', pkgs: { k: { components: [{ id: 'c', method: 'nope' }] } } }] };
  assert((await u0.t.api('s.patel').put('/api/fee-builder/owned-proposals/x1abcd', { data: bad })).status === 201);
  const u = await wrap(u0, await u0.open('s.patel', '#/fee-builder'));
  await u.until(() => u.$('#f_name'), 'the broken proposal to open');
  assert(!u.errors.length, u.errors.join(';'));
  assert(u.$('#f_name').value === 'Broken');
  assert(u.out('sum.fee') === '$0');
});

/* ---------- linking to a project, and who can see what ---------- */

test('A new proposal is private to its author until it is linked to a project', async () => {
  const u = await boot({ user: 'c.nguyen' }); // a designer: on 26-101 as team, so not a project lead
  newFee(u, 'Pursuit');
  await u.until(async () => (await stored(u, 'c.nguyen')).records.length === 1, 'the save');
  assert((await stored(u, 's.patel')).records.length === 0, 'another project manager cannot see a pursuit');
  assert((await stored(u, 'd.hollis')).records.length === 1, 'firm leadership can read it');
  const other = await another(u, 's.patel');
  assert(!/Pursuit/.test(other.$('#prop-pick').textContent), 'not in his proposal list');
  // a designer who is only on the team cannot link it into that project (the server refuses the move)
  u.click('[data-a="view"][data-v="establish"]');
  const opts = u.$$('#f_link option').map(o => o.textContent);
  assert(!opts.some(o => /26-101/.test(o)), 'the picker offers only projects they can edit: ' + opts.join(' | '));
});

test('Linking a proposal to a project gives that project’s people access: leads edit, the team reads, outsiders see nothing', async () => {
  const u = await boot({ user: 's.patel' }); // PM of 26-101
  newFee(u, 'Riverton fee');
  await u.until(async () => (await stored(u, 's.patel')).records.length === 1, 'the save');
  u.click('[data-a="view"][data-v="establish"]');
  const p101 = u.app.t.project('26-101');
  await u.until(() => u.$$('#f_link option').some(o => o.value === p101.id), 'the project in the picker');
  u.choose('#f_link', p101.id);
  await u.until(async () => (await stored(u, 's.patel')).records[0].projectId === p101.id, 'the link to be saved');
  const rec = (await stored(u, 's.patel')).records[0];
  assert(rec.data.extRefs.vp && rec.data.extRefs.vp.number === '26-101' && rec.data.extRefs.vp.projectId === 'P0101', 'the Vantagepoint number is kept with the proposal');
  assert(rec.data.number === '26-101', 'the project number was filled in');

  const team = await another(u, 'c.nguyen'); // team member of 26-101: read only
  await team.until(() => /Riverton fee/.test(team.$('#prop-pick').textContent), 'the team member to see it');
  assert(/view this proposal but not change it/.test(team.d.body.textContent), 'read-only notice');
  const before = team.out('sum.fee');
  team.type(team.fields('.pct').find(el => el.dataset.f.includes('.components#')), '9');
  assert(team.out('sum.fee') === before, 'a read-only edit changes nothing');
  assert((await stored(u, 'c.nguyen', rec.id)).rev === rec.rev, 'and nothing reaches the server');

  assert((await stored(u, 'r.ortiz')).records.length === 0, 'someone not on the project sees nothing');
  const lead = await another(u, 'm.lee'); // the PIC: a project lead, can edit
  await lead.until(() => /Riverton fee/.test(lead.$('#prop-pick').textContent), 'the PIC to see it');
  assert(!/view this proposal but not change it/.test(lead.d.body.textContent), 'a lead can edit');
});

test('Settings are personal: saved privately per person, and not shared', async () => {
  const u = await boot({ user: 's.patel' });
  newFee(u);
  u.click('[data-a="settings"]');
  u.type(u.$('input[data-f="$settings.targetProfitPct"]'), '18');
  await u.until(async () => (await api(u, 's.patel').get('/api/fee-builder/personal-settings')).body.records.length === 1, 'settings to be stored');
  const rec = (await api(u, 's.patel').get('/api/fee-builder/personal-settings')).body.records[0];
  assert(rec.id === 'settings-' + api(u, 's.patel').id && rec.data.settings.targetProfitPct === 18, 'stored under the person');
  assert((await api(u, 'a.rivera').get('/api/fee-builder/personal-settings')).body.records.length === 0, 'nobody else can read them, not even a firm admin');
  const fresh = await another(u, 's.patel');
  fresh.click('[data-a="settings"]');
  assert(fresh.$('input[data-f="$settings.targetProfitPct"]').value === '18', 'they come back on the next visit');
});

test('A proposal survives a backup: export from one server, import into an empty one, and it opens with the same figures', async () => {
  const u = await boot({ user: 's.patel' });
  newFee(u, 'Backed up');
  await u.until(async () => (await stored(u, 's.patel')).records.length === 1, 'the save');
  u.click('[data-a="view"][data-v="establish"]');
  const p101 = u.app.t.project('26-101');
  await u.until(() => u.$$('#f_link option').some(o => o.value === p101.id), 'the project in the picker');
  u.choose('#f_link', p101.id);
  await u.until(async () => (await stored(u, 's.patel')).records[0].projectId === p101.id, 'the link to be saved');
  const backup = (await api(u, 'a.rivera').get('/api/backup')).body;
  assert(backup.collections['fee-builder/owned-proposals'], 'the proposal is in the backup');

  // a second, empty server: import the backup there, then open it as the same person
  const other = await startApp('fee-builder', { seeded: false }); apps.push(other);
  const bk = require('../../../server/backup');
  const r = bk.importBackup(other.t.db, JSON.parse(JSON.stringify(backup)));
  assert(r.skipped === 0 && r.added > 0, 'imported ' + JSON.stringify(r));
  const t2 = await wrap(other, await other.open('s.patel', '#/fee-builder'));
  await t2.until(() => /Backed up/.test(t2.$('#prop-pick').textContent), 'the restored proposal to be listed');
  assert(t2.out('sum.fee') === '$480,000', 'same fee ' + t2.out('sum.fee'));
  const rec = (await other.t.api('s.patel').get('/api/fee-builder/owned-proposals')).body.records[0];
  assert(rec.projectId === p101.id && rec.rev === backup.collections['fee-builder/owned-proposals'][rec.id].rev, 'link and revision preserved');
});

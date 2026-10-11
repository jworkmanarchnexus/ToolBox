'use strict';
/* Runs the language-neutral Scheduler fixtures (tests/fixtures/*.json) against the JavaScript implementation.
   A rebuild in another language should pass the same files. cascade.json and merge.json have their own runners. */
const test = require('node:test');
const assert = require('node:assert');
const E = require('../logic/engine.js');
const Tp = require('../logic/templates.js');
const C = require('../logic/commit.js');

const cal = E.makeCalendar([], [0, 6]);

test('commitments: forecast against a committed date', () => {
  for (const c of require('./fixtures/commitments.json').cases) {
    const r = E.schedule([c.task], cal).get(c.task.id);
    const s = C.commitStatus(c.task, r, c.riskMarginDays);
    if (c.expect.status === null) { assert.strictEqual(s, null, c.name); continue; }
    assert.strictEqual(s.status, c.expect.status, c.name);
    if (c.expect.margin !== undefined) assert.strictEqual(s.margin, c.expect.margin, c.name + ' margin');
    if (c.expect.text) assert.strictEqual(C.commitText(s), c.expect.text, c.name + ' text');
    if (c.expect.forecast) assert.strictEqual(E.fmtISO(s.forecast), c.expect.forecast, c.name + ' forecast');
  }
});

test('predecessor text: parsing and formatting', () => {
  const F = require('./fixtures/predecessors.json');
  const mk = (id) => ({ id, name: id, kind: 'task', duration: 5, start: '2026-10-05', locked: false, notBefore: null, deps: [], ignore: [] });
  const tasks = ['a', 'b', 'c'].map(mk);
  for (const c of F.parse) {
    const r = E.parsePreds(c.text, tasks, tasks[c.row - 1].id);
    if (c.expect.error) { assert.ok(r.error, c.text); continue; }
    const got = r.deps.map(d => ({ row: tasks.findIndex(t => t.id === d.id) + 1, type: d.type, lag: d.lag })).sort((x, y) => x.row - y.row);
    assert.deepStrictEqual(got, c.expect.deps, c.text);
  }
  const t3 = F.format.rows.map(mk);
  assert.strictEqual(E.formatPreds({ deps: F.format.deps.map(d => ({ id: t3[d.row - 1].id, type: d.type, lag: d.lag })) }, t3), F.format.expect);
});

test('holidays: the dates checked by hand, and the whole generated list', () => {
  const F = require('./fixtures/holidays.json');
  for (const [year, names] of Object.entries(F.must)) {
    const got = Object.fromEntries(E.generateHolidays(+year, true).map(h => [h.name, h.date]));
    for (const [name, date] of Object.entries(names)) assert.strictEqual(got[name], date, `${year} ${name}`);
  }
  for (const [year, list] of Object.entries(F.generated)) assert.deepStrictEqual(E.generateHolidays(+year, true).map(h => ({ date: h.date, name: h.name })), list, 'year ' + year);
});

test('starter templates: each produces the pinned dates from a Monday start', () => {
  const F = require('./fixtures/starter-templates.json');
  assert.ok(F.cases.length >= 6);
  for (const c of F.cases) {
    let k = 0;
    const tasks = Tp.instantiateTemplate(c.template, { start: E.parseDate(c.start), newId: () => 'r' + (k++), schedule: E.schedule, cal });
    const res = E.schedule(tasks, cal);
    assert.strictEqual(tasks.length, c.expect.length, c.id);
    c.expect.forEach((x, i) => {
      const r = res.get(tasks[i].id);
      assert.deepStrictEqual({ start: E.fmtISO(r.start), finish: E.fmtISO(r.kind === 'milestone' ? r.start : r.finish) }, { start: x.start, finish: x.finish }, `${c.id} / ${x.name}`);
    });
  }
});

test('starter templates: choosing a phase length moves what follows by exactly the difference', () => {
  const p = require('./fixtures/starter-templates.json').phaseLength;
  const tpl = Tp.tplById(p.template);
  const run = (weeks) => { let k = 0; const ts = Tp.instantiateTemplate(tpl, { start: E.parseDate(p.start), newId: () => 'x' + (k++), weeks, schedule: E.schedule, cal }); return { ts, r: E.schedule(ts, cal) }; };
  const a = run({}), b = run(p.weeks);
  const idx = (k) => tpl.tasks.findIndex(t => t.k === k);
  assert.strictEqual(b.r.get(b.ts[idx('sd')].id).dur, p.expect.schematicDays);
  assert.strictEqual(a.r.get(a.ts[idx('sd')].id).dur, p.expect.defaultSchematicDays);
  assert.strictEqual(b.r.get(b.ts[idx('sub')].id).start - a.r.get(a.ts[idx('sub')].id).start, p.expect.substantialCompletionMovesDays);
  assert.strictEqual(b.r.get(b.ts[idx('prog')].id).start !== a.r.get(a.ts[idx('prog')].id).start, p.expect.earlierTasksMove);
});

test('duplicate: dates shift together, commitments stay put, history and baseline are not copied', () => {
  const { duplicateDoc } = require('../logic/dup.js');
  const F = require('./fixtures/duplicate.json');
  for (const c of F.cases) assert.deepStrictEqual(duplicateDoc(JSON.parse(JSON.stringify(F.source)), c.opts), c.expect, c.name);
});

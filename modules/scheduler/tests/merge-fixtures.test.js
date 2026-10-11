'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { merge3 } = require('../logic/merge.js');
const E = require('../logic/engine.js');
const F = require('./fixtures/merge.json');

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
for (const c of F.cases) {
  test(c.name, () => {
    const before = JSON.stringify([c.base, c.mine, c.theirs]);
    const r = merge3(c.base, c.mine, c.theirs, c.choices || {});
    assert.strictEqual(JSON.stringify([c.base, c.mine, c.theirs]), before, 'inputs are not changed');
    const x = c.expect, byId = (id) => r.merged.tasks.find(t => t.id === id);
    assert.strictEqual(r.conflicts.length, x.conflicts, 'conflicts: ' + r.conflicts.map(k => k.label).join(' | '));
    if (x.conflictLabelContains) assert.ok(r.conflicts.some(k => k.label.includes(x.conflictLabelContains)), 'a conflict mentions "' + x.conflictLabelContains + '"');
    if (x.taskOrder) assert.strictEqual(r.merged.tasks.map(t => t.id).join(''), x.taskOrder);
    if (x.taskCount !== undefined) assert.strictEqual(r.merged.tasks.length, x.taskCount);
    for (const id of x.hasTasks || []) assert.ok(byId(id), id + ' is present');
    for (const id of x.missingTasks || []) assert.ok(!byId(id), id + ' is gone');
    for (const [id, fields] of Object.entries(x.task || {})) for (const [f, v] of Object.entries(fields)) {
      const got = f === 'depsCount' ? byId(id).deps.length : byId(id)[f];
      assert.deepStrictEqual(got, v, `${id}.${f}`);
    }
    for (const [path, v] of Object.entries(x.setting || {})) assert.deepStrictEqual(get(r.merged, path), v, path);
    if (x.customColorsCount !== undefined) assert.strictEqual(r.merged.customColors.length, x.customColorsCount);
    if (x.holidaysCount !== undefined) assert.strictEqual(r.merged.holidays.length, x.holidaysCount);
    if (x.cycle) assert.ok([...E.schedule(r.merged.tasks, E.makeCalendar([], [0, 6])).values()].some(v => v.cycle), 'a loop is visible to the engine');
  });
}

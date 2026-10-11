'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../logic/engine.js');
const F = require('./fixtures/cascade.json');

const cal = E.makeCalendar(F.calendar.holidays, F.calendar.offDays);
const BASE = { name: '', kind: 'task', duration: 5, start: '2026-10-05', locked: false, notBefore: null, deps: [], ignore: [] };

for (const c of F.cases) {
  test(c.name, () => {
    const tasks = c.tasks.map(t => Object.assign({}, BASE, { name: t.id }, t));
    const res = E.schedule(tasks, cal);
    for (const [id, want] of Object.entries(c.expect)) {
      const r = res.get(id);
      assert.ok(r, `${id} is scheduled`);
      if (want.start) assert.strictEqual(E.fmtISO(r.start), want.start, `${id} start`);
      if (want.finish) assert.strictEqual(E.fmtISO(r.finish), want.finish, `${id} finish`);
      if (want.held !== undefined) assert.strictEqual(!!r.held, want.held, `${id} held`);
      if (want.cycle !== undefined) assert.strictEqual(!!r.cycle, want.cycle, `${id} cycle`);
      if (want.flags) assert.deepStrictEqual(r.flags.map(f => f.code), want.flags, `${id} flags`);
      if (want.fixDate) assert.strictEqual(r.flags[0].fix.date, want.fixDate, `${id} suggested date`);
      if (want.levelCount) for (const [lvl, n] of Object.entries(want.levelCount)) assert.strictEqual(r.flags.filter(f => f.level === lvl).length, n, `${id} ${lvl} flags`);
    }
  });
}

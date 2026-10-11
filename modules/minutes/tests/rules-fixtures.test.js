'use strict';
/* Runs the language-neutral Minutes fixtures (tests/fixtures/*.json) against the JavaScript implementation. */
const test = require('node:test');
const assert = require('node:assert');
const NM = require('../logic/logic.js');

const noon = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); };

test('dates, times and reference numbers', () => {
  const F = require('./fixtures/dates-and-numbers.json');
  NM.setClock(() => noon(F.nextMeetingDate.today));
  for (const c of F.nextMeetingDate.cases) assert.strictEqual(NM.nextDate(c.previous, c.cadence), c.expect, JSON.stringify(c));
  for (const c of F.readTime) assert.strictEqual(NM.normTime(c.typed), c.stored, JSON.stringify(c));
  for (const c of F.showTime) assert.strictEqual(NM.fmtTime(c.stored, c.format), c.expect, JSON.stringify(c));
  for (const c of F.addMinutes) assert.strictEqual(NM.addMinutes(c.start, c.minutes), c.expect, JSON.stringify(c));
  for (const c of F.topicReference.cases) assert.strictEqual(NM.fmtRef(c.ref, c.style), c.expect, JSON.stringify(c));
  for (const c of F.topicReference.issueNumber) assert.strictEqual(NM.issueNo(c.ref), c.expect, JSON.stringify(c));
  for (const c of F.documentId.cases) assert.strictEqual(NM.docIdOf({ docIdPrefix: c.prefix }, c.meeting, c.revision), c.expect, JSON.stringify(c));
  for (const c of F.shortDueDate.cases) assert.strictEqual(NM.fmtDue(c.date, c.reference), c.expect, JSON.stringify(c));
});

/* a one-record state: a project the way the server and the device would hold it */
const project = (updatedAt) => ({ id: 'proj-0001', v: NM.SCHEMA, name: 'P', number: '1', ownerNumber: '', fileName: '', address: '', ownerOrgId: '', officeId: '', parties: [], example: false, createdAt: 1, updatedAt });
function deviceWith(local) {
  const st = NM.emptyState();
  if (!local) return st;
  st.projects['proj-0001'] = project(local.updatedAt);
  if (local.dirty) st.dirty.projects['proj-0001'] = 1;
  if (local.base !== null && local.base !== undefined) st.base.projects['proj-0001'] = local.base;
  return st;
}
const remoteOf = (r) => ({ projects: r ? { 'proj-0001': project(r.updatedAt) } : {} });

test('sync: pulling the server\'s copy', () => {
  for (const c of require('./fixtures/sync.json').pull) {
    const st = deviceWith(c.local);
    const before = c.local ? st.projects['proj-0001'].updatedAt : null;
    const r = NM.mergeRemote(st, remoteOf(c.remote), true);
    const rec = st.projects['proj-0001'], dirty = !!st.dirty.projects['proj-0001'], held = !!st.conflicts['projects/proj-0001'];
    let got;
    if (held) got = 'conflict';
    else if (!c.local) got = c.remote ? 'adopt' : 'none';
    else if (!c.remote) got = dirty ? 'queue-new' : 'none';
    else if (rec.updatedAt === c.remote.updatedAt && rec.updatedAt !== before) got = 'adopt';
    else if (rec.updatedAt === c.remote.updatedAt && !c.local.dirty) got = 'keep';
    else if (rec.updatedAt === c.remote.updatedAt && c.local.dirty && !dirty) got = 'clear';
    else got = dirty ? 'queue' : 'keep';
    assert.strictEqual(got, c.expect, c.name + ' ' + JSON.stringify(r));
    if (c.baseBecomes !== undefined) assert.strictEqual(st.base.projects['proj-0001'], c.baseBecomes, c.name + ' base');
  }
});

test('sync: before writing, compare with the server\'s current copy', () => {
  for (const c of require('./fixtures/sync.json').beforeWrite) {
    const st = deviceWith({ updatedAt: c.local.updatedAt, dirty: true, base: c.local.base });
    assert.strictEqual(NM.checkPush(st, 'projects', 'proj-0001', c.remote ? project(c.remote.updatedAt) : null), c.expect, c.name);
  }
});

test('sync: settling a held conflict', () => {
  for (const c of require('./fixtures/sync.json').resolve) {
    const st = deviceWith({ updatedAt: 250, dirty: true, base: 100 });
    NM.mergeRemote(st, remoteOf({ updatedAt: 200 }), true);
    assert.ok(st.conflicts['projects/proj-0001'], 'held first');
    NM.resolveConflict(st, 'projects', 'proj-0001', c.choice);
    assert.strictEqual(!!st.dirty.projects['proj-0001'], c.expect.dirty, c.name);
    if (c.expect.record === 'remote') assert.strictEqual(st.projects['proj-0001'].updatedAt, 200, c.name);
    if (c.expect.newerThanRemote) assert.ok(st.projects['proj-0001'].updatedAt > 200, c.name);
    assert.ok(!st.conflicts['projects/proj-0001'], 'no longer held');
  }
});

test('carry-forward: an action lives across meetings until it is completed or canceled', () => {
  const F = require('./fixtures/carry-forward.json');
  NM.setClock(() => noon('2026-10-01'));
  const st = NM.emptyState();
  const p = NM.createProject(st, { name: F.project.name });
  const who = {};
  for (const name of F.project.parties) who[name] = NM.addParty(st, p.id, { name, kind: 'person' }).id;
  const s = NM.createSeries(st, p.id, { name: F.series.name, cadence: F.series.cadence, attendeeIds: Object.values(who), template: F.series.topicTemplate.map(n => ({ name: n, topics: [] })) });
  const textOf = (id) => st.actions[id].text;
  for (const mt of F.meetings) {
    const m = NM.createMeeting(st, s.id, { date: mt.date });
    const carried = (mt.afterPublish || mt.beforePublish).carriedIntoThisMeeting;
    assert.deepStrictEqual(m.carried.map(textOf).sort(), carried.slice().sort(), 'carried into ' + mt.date);
    if (mt.publish === false) continue;
    NM.startMinutes(st, m.id); NM.setAllAttendance(st, m.id, 'present');
    for (const step of mt.steps) {
      if (step.assignment) {
        const a = step.assignment, topic = NM.addTopic(st, m.id, m.sections.find(x => x.name === a.topic).id, 'Topic for ' + a.text);
        const o = NM.addOutcome(st, m.id, topic.id, 'assignment');
        NM.setOutcome(st, m.id, o.id, { text: a.text, assigneeIds: a.to.map(n => who[n]), due: a.due });
      } else if (step.update) {
        const u = step.update, action = Object.values(st.actions).find(x => x.text === u.action);
        const patch = {};
        if (u.done) patch.done = true;
        if (u.extendTo) { patch.extendTo = u.extendTo; patch.extendNote = u.note; }
        if (u.cancel) patch.cancel = true;
        if (u.note && !u.extendTo) patch.note = u.note;
        NM.setUpdate(st, m.id, action.id, patch);
      }
    }
    NM.publish(st, m.id);
    for (const want of mt.afterPublish.actions) {
      const got = Object.values(st.actions).find(x => x.text === want.text);
      assert.ok(got, want.text + ' exists');
      assert.strictEqual(got.seq, want.number, want.text + ' number');
      assert.strictEqual(got.status, want.status, want.text + ' status after ' + mt.date);
      if (want.due) assert.strictEqual(got.due, want.due, want.text + ' due');
      if (want.originalDue) assert.strictEqual(got.origDue, want.originalDue, want.text + ' original due');
      if (want.moved !== undefined) assert.strictEqual(got.pushes.length, want.moved, want.text + ' times moved');
    }
  }
});

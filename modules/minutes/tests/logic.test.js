'use strict';
/* Nexus Minutes business rules (logic/logic.js, "NM"). The Minutes zip shipped no tests, so these characterize the rules as the
   v16 source behaves, before the port touches anything: numbering, carry-forward of actions, publishing and revising, and the
   record merge used when two devices have edited. */
const test = require('node:test');
const assert = require('node:assert');
const NM = require('../logic/logic.js');

const NOON = Date.UTC(2026, 9, 12, 12, 0, 0);
let now = NOON; // a clock the tests move forward by hand, so two "devices" never stamp the same millisecond
NM.setClock(() => now);
const tick = (ms) => { now += ms || 60000; };
const fresh = () => NM.emptyState();
const sec = (m, name) => m.sections.find(x => x.name === name);

/* a project with the firm and two outside parties, one series, ready for meetings */
function setup(opts) {
  const st = fresh();
  const p = NM.createProject(st, { name: 'Clinic TI', number: '26-114', address: '1 Main St', ownerNumber: 'RCG-1' });
  const owner = NM.addParty(st, p.id, { name: 'Riverton Clinic', kind: 'company', abbr: 'RC' });
  const dana = NM.addParty(st, p.id, { name: 'Dana Reyes', kind: 'person', companyId: owner.id });
  const gc = NM.addParty(st, p.id, { name: 'Okafor Construction', kind: 'company', abbr: 'OC' });
  const sam = NM.addParty(st, p.id, { name: 'Sam Okafor', kind: 'person', companyId: gc.id });
  const firmCo = NM.ensureFirmParty(st, p.id);
  const jordan = NM.addParty(st, p.id, { name: 'Jordan Ames', kind: 'person', companyId: firmCo.id });
  const s = NM.createSeries(st, p.id, Object.assign({
    name: 'Weekly OAC', location: 'Zoom', cadence: 'weekly', meetingType: 'OAC Meeting', defaultTime: '10:00', durationMin: 60, preparedById: jordan.id,
    attendeeIds: [jordan.id, dana.id, sam.id], template: [{ name: 'Site', topics: [] }, { name: 'Schedule', topics: ['Look-ahead'] }],
  }, opts || {}));
  return { st, p, s, dana, sam, jordan };
}
const topic = (st, m, secName, text) => NM.addTopic(st, m.id, sec(m, secName).id, text);
function outcome(st, m, tp, type, text, who, due) {
  const o = NM.addOutcome(st, m.id, tp.id, type);
  NM.setOutcome(st, m.id, o.id, { text });
  if (type === 'assignment') NM.setOutcome(st, m.id, o.id, { assigneeIds: who, due });
  return o;
}
/* run a meeting with one assignment and publish it */
function meetingWithAction(c, date, text, who, due) {
  const m = NM.createMeeting(c.st, c.s.id, { date, time: '10:00 AM' });
  const t = topic(c.st, m, 'Site', 'Parking');
  NM.startMinutes(c.st, m.id); NM.setAllAttendance(c.st, m.id, 'present');
  if (text) outcome(c.st, m, t, 'assignment', text, who, due);
  else outcome(c.st, m, t, 'info', 'Noted.');
  return m;
}

test('meetings number from the series start, follow the cadence, and only one draft can be open', () => {
  const c = setup({ startNumber: 5 });
  const m1 = NM.createMeeting(c.st, c.s.id, { date: '2026-10-12' });
  assert.strictEqual(m1.number, 5);
  assert.strictEqual(m1.status, 'agenda');
  assert.deepStrictEqual(m1.sections.map(s => s.name), ['Site', 'Schedule']);
  assert.strictEqual(sec(m1, 'Schedule').topics[0].text, 'Look-ahead', 'the template topic is on the agenda');
  assert.throws(() => NM.createMeeting(c.st, c.s.id, {}), /still open/, 'a second draft is refused');
  NM.startMinutes(c.st, m1.id); NM.setAllAttendance(c.st, m1.id, 'present');
  NM.publish(c.st, m1.id);
  const m2 = NM.createMeeting(c.st, c.s.id, {});
  assert.strictEqual(m2.number, 6);
  assert.strictEqual(m2.date, '2026-10-19', 'weekly: seven days after the last meeting');
});

test('publishing needs the meeting to be started, and published minutes are locked', () => {
  const c = setup();
  const m = NM.createMeeting(c.st, c.s.id, { date: '2026-10-12' });
  assert.throws(() => NM.publish(c.st, m.id), /Start the meeting/);
  NM.startMinutes(c.st, m.id);
  const snap = NM.publish(c.st, m.id);
  assert.strictEqual(snap.rev, 0);
  assert.throws(() => NM.publish(c.st, m.id), /already published/);
  assert.throws(() => NM.addTopic(c.st, m.id, sec(m, 'Site').id, 'late addition'), /locked/);
});

test('an assignment becomes a numbered action that is carried into the next meeting until someone closes it', () => {
  const c = setup();
  const m1 = meetingWithAction(c, '2026-10-12', 'Send the site plan', [c.sam.id], '2026-10-19');
  NM.publish(c.st, m1.id);
  const acts = NM.actionsOf(c.st, c.s.id);
  assert.strictEqual(acts.length, 1);
  assert.strictEqual(acts[0].status, 'open');
  assert.strictEqual(acts[0].due, '2026-10-19');
  assert.deepStrictEqual(acts[0].assigneeIds, [c.sam.id]);
  assert.strictEqual(acts[0].seq, 1, 'numbered from 1');

  const m2 = NM.createMeeting(c.st, c.s.id, {});
  assert.deepStrictEqual(m2.carried, [acts[0].id], 'the open action comes along');
  const home = sec(m2, 'Site').topics.find(t => t.carry.includes(acts[0].id));
  assert.ok(home && home.carried === true && home.text === 'Parking', 'placed under the topic it was raised in');

  NM.startMinutes(c.st, m2.id); NM.setAllAttendance(c.st, m2.id, 'present');
  NM.setUpdate(c.st, m2.id, acts[0].id, { done: true, note: 'Sent Tuesday.' });
  NM.publish(c.st, m2.id);
  assert.strictEqual(NM.actionsOf(c.st, c.s.id)[0].status, 'done');
  const m3 = NM.createMeeting(c.st, c.s.id, {});
  assert.deepStrictEqual(m3.carried, [], 'a closed action is not carried again');
});

test('publishing is blocked until an assignment has text, a responsible party and a due date', () => {
  const c = setup();
  const m = NM.createMeeting(c.st, c.s.id, { date: '2026-10-12' });
  const t = topic(c.st, m, 'Site', 'Parking');
  NM.startMinutes(c.st, m.id);
  const o = NM.addOutcome(c.st, m.id, t.id, 'assignment');
  const issues = NM.publishIssues(c.st, m);
  assert.ok(issues.blockers.some(b => /empty assignment/.test(b)));
  assert.ok(issues.blockers.some(b => /needs a responsible party/.test(b)));
  assert.ok(issues.blockers.some(b => /needs a due date/.test(b)));
  assert.throws(() => NM.publish(c.st, m.id), /Fix \d+ things? before publishing/);
  NM.setOutcome(c.st, m.id, o.id, { text: 'Do it', assigneeIds: [c.sam.id], due: '2026-10-20' });
  assert.deepStrictEqual(NM.publishIssues(c.st, m).blockers, []);
  assert.ok(NM.publishIssues(c.st, m).warnings.length > 0, 'warnings (attendance, next meeting...) do not block');
});

test('moving a due date needs a reason and a later date, and it keeps the history', () => {
  const c = setup();
  const m1 = meetingWithAction(c, '2026-10-12', 'Send the site plan', [c.sam.id], '2026-10-19');
  NM.publish(c.st, m1.id);
  const a = NM.actionsOf(c.st, c.s.id)[0];
  const m2 = NM.createMeeting(c.st, c.s.id, {});
  NM.startMinutes(c.st, m2.id); NM.setAllAttendance(c.st, m2.id, 'present');
  NM.setUpdate(c.st, m2.id, a.id, { extendTo: '2026-10-30' });
  assert.ok(NM.publishIssues(c.st, m2).blockers.some(b => /no note on why it moved/.test(b)), 'a reason is required');
  NM.setUpdate(c.st, m2.id, a.id, { extendTo: '2026-10-10', extendNote: 'Slipped' });
  assert.ok(NM.publishIssues(c.st, m2).blockers.some(b => /must be after/.test(b)), 'it cannot move earlier');
  NM.setUpdate(c.st, m2.id, a.id, { extendTo: '2026-10-30', extendNote: 'Waiting on survey' });
  NM.publish(c.st, m2.id);
  const after = NM.actionsOf(c.st, c.s.id)[0];
  assert.strictEqual(after.due, '2026-10-30');
  assert.strictEqual(after.origDue, '2026-10-19');
  assert.strictEqual(after.pushes.length, 1);
  assert.strictEqual(after.pushes[0].note, 'Waiting on survey');
});

test('assignments and action updates are locked once a later meeting exists', () => {
  const c = setup();
  const m1 = meetingWithAction(c, '2026-10-12', null);
  NM.publish(c.st, m1.id);
  NM.createMeeting(c.st, c.s.id, {});
  NM.reviseMeeting(c.st, m1.id, 'Fix a typo');
  const t = m1.sections[0].topics[0];
  assert.throws(() => NM.addOutcome(c.st, m1.id, t.id, 'assignment'), /Later meetings exist/);
  assert.doesNotThrow(() => NM.addOutcome(c.st, m1.id, t.id, 'decision'), 'a decision can still be added');
});

test('revising published minutes: a reason is required, it publishes as a new revision, and cancelling restores the original', () => {
  const c = setup();
  const m = meetingWithAction(c, '2026-10-12', null);
  const first = NM.publish(c.st, m.id);
  assert.throws(() => NM.reviseMeeting(c.st, m.id, '  '), /what is being corrected/);
  const before = JSON.stringify(m.sections);
  NM.reviseMeeting(c.st, m.id, 'Corrected the date');
  assert.strictEqual(m.status, 'minutes');
  assert.strictEqual(m.revising, true);
  const t2 = m.sections[0].topics[0];
  NM.addOutcome(c.st, m.id, t2.id, 'decision');
  NM.cancelRevision(c.st, m.id);
  assert.strictEqual(m.status, 'published');
  assert.strictEqual(JSON.stringify(m.sections), before, 'the meeting is back exactly as it was');

  NM.reviseMeeting(c.st, m.id, 'Corrected the date');
  m.sections[0].topics[0].outcomes.forEach(o => { o.text = o.text || 'x'; });
  const second = NM.publish(c.st, m.id);
  assert.strictEqual(second.rev, 1);
  assert.strictEqual(second.note, 'Corrected the date');
  assert.strictEqual(NM.snapshotsOf(c.st, m.id).length, 2);
  assert.ok(first.data.doc.docId !== second.data.doc.docId, 'the document id changes with the revision');
  assert.match(second.data.doc.docId, /\.02$/);
});

test('attendance: marking everyone present, and the printed states', () => {
  const c = setup();
  const m = NM.createMeeting(c.st, c.s.id, { date: '2026-10-12' });
  assert.ok(m.attendees.every(a => a.state === 'unset'));
  NM.setAllAttendance(c.st, m.id, 'present');
  assert.ok(m.attendees.every(a => NM.isHere(a)));
  NM.setAttendance(c.st, m.id, c.dana.id, 'absent');
  assert.strictEqual(m.attendees.filter(a => NM.isHere(a)).length, 2);
});

test('every generated id satisfies the id rule, and the clock never repeats a stamp', () => {
  const c = setup();
  const m = NM.createMeeting(c.st, c.s.id, {});
  for (const id of [c.p.id, c.s.id, m.id, m.sections[0].id]) assert.match(id, NM.ID_RE);
  const a = NM.stamp(), b = NM.stamp();
  assert.ok(b > a);
});

test('normalizing saved state is idempotent and keeps what was saved', () => {
  const c = setup();
  const m = meetingWithAction(c, '2026-10-12', 'Send the site plan', [c.sam.id], '2026-10-19');
  NM.publish(c.st, m.id);
  const once = NM.normalizeState(JSON.parse(JSON.stringify(c.st)));
  const twice = NM.normalizeState(JSON.parse(JSON.stringify(once)));
  assert.deepStrictEqual(twice, once, 'a second pass changes nothing');
  for (const coll of ['projects', 'series', 'meetings', 'actions', 'snapshots']) assert.deepStrictEqual(Object.keys(once[coll]).sort(), Object.keys(c.st[coll]).sort(), coll);
  const a = Object.values(once.actions)[0];
  assert.deepStrictEqual([a.text, a.due, a.status, a.assigneeIds], ['Send the site plan', '2026-10-19', 'open', [c.sam.id]]);
  assert.deepStrictEqual(once.dirty.meetings, c.st.dirty.meetings, 'unsent changes are remembered');
  assert.strictEqual(NM.normalizeState({ nonsense: true }).v, NM.SCHEMA, 'junk becomes an empty state');
});

/* ---------- sync: two devices ---------- */
const clone = (o) => JSON.parse(JSON.stringify(o));
const remoteOf = (st) => Object.fromEntries(NM.COLLS.map(c => [c, clone(st[c])]));

test('sync: a new device pulls everything, and its own unsent records are queued', () => {
  const a = setup();
  const m = meetingWithAction(a, '2026-10-12', 'Send the site plan', [a.sam.id], '2026-10-19');
  NM.publish(a.st, m.id);
  const b = fresh();
  const r = NM.mergeRemote(b, remoteOf(a.st), true);
  const total = NM.COLLS.reduce((n, k) => n + Object.keys(a.st[k]).length, 0);
  assert.ok(r.pulled === total && total >= 5 && r.conflicts === 0, 'pulled ' + r.pulled + ' of ' + total);
  assert.strictEqual(NM.dirtyCount(b), 0, 'nothing to send back');
  assert.strictEqual(Object.keys(b.meetings).length, 1);
  assert.deepStrictEqual(b.projects[a.p.id].parties.length, a.st.projects[a.p.id].parties.length);
  // a record only this device has is queued for upload
  const extra = NM.createProject(b, { name: 'Local only' });
  const r2 = NM.mergeRemote(b, remoteOf(a.st), true);
  assert.ok(b.dirty.projects[extra.id], 'queued');
  assert.ok(r2.queued >= 1);
});

test('sync: an edit made on two devices is held for a decision, never silently overwritten', () => {
  const a = setup();
  const b = fresh();
  NM.mergeRemote(b, remoteOf(a.st), true); // both devices now share the same starting point
  const id = a.p.id;
  tick();
  // device A renames the project and uploads
  NM.updateProject(a.st, id, { name: 'Clinic TI (A)' });
  const stored = remoteOf(a.st); NM.markPushed(a.st, 'projects', id, a.st.projects[id].updatedAt);
  // device B renamed it too, without having seen A's change
  tick();
  NM.updateProject(b, id, { name: 'Clinic TI (B)' });
  assert.strictEqual(NM.checkPush(b, 'projects', id, stored.projects[id]), 'conflict', 'B must not overwrite A');
  const list = NM.conflictList(b);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].mine.name, 'Clinic TI (B)');
  assert.strictEqual(list[0].theirs.name, 'Clinic TI (A)');
  // choosing theirs adopts A's copy and drops B's unsent edit
  const bTheirs = clone(b);
  NM.resolveConflict(bTheirs, 'projects', id, 'theirs');
  assert.strictEqual(bTheirs.projects[id].name, 'Clinic TI (A)');
  assert.strictEqual(bTheirs.dirty.projects[id], undefined);
  // choosing mine keeps B's copy and makes it the newest, so the next upload wins
  NM.resolveConflict(b, 'projects', id, 'mine');
  assert.strictEqual(b.projects[id].name, 'Clinic TI (B)');
  assert.ok(b.projects[id].updatedAt > stored.projects[id].updatedAt);
  assert.strictEqual(b.dirty.projects[id], 1);
  assert.strictEqual(NM.checkPush(b, 'projects', id, stored.projects[id]), 'ok');
});

test('sync: a pull never replaces local edits that have not been uploaded yet when the remote has not moved', () => {
  const a = setup();
  const b = fresh();
  NM.mergeRemote(b, remoteOf(a.st), true);
  NM.updateProject(b, a.p.id, { name: 'Edited offline' });
  const r = NM.mergeRemote(b, remoteOf(a.st), true);
  assert.strictEqual(r.conflicts, 0);
  assert.strictEqual(b.projects[a.p.id].name, 'Edited offline');
  assert.strictEqual(b.dirty.projects[a.p.id], 1, 'still waiting to upload');
});

test('backups: export then parse gives back every collection', () => {
  const c = setup();
  const m = meetingWithAction(c, '2026-10-12', 'Send the site plan', [c.sam.id], '2026-10-19');
  NM.publish(c.st, m.id);
  const parsed = NM.parseBackup(NM.exportBackup(c.st));
  for (const coll of NM.COLLS) assert.deepStrictEqual(Object.keys(parsed[coll]).sort(), Object.keys(c.st[coll]).sort(), coll);
  assert.throws(() => NM.parseBackup('not json'), /not a Nexus Minutes backup/);
  assert.throws(() => NM.parseBackup('{"app":"other"}'), /not a Nexus Minutes backup/);
});

test('text and page output carry the meeting, the assignment and the responsible party', () => {
  const c = setup();
  const m = meetingWithAction(c, '2026-10-12', 'Send the site plan', [c.sam.id], '2026-10-19');
  const snap = NM.publish(c.st, m.id);
  const text = NM.snapshotToText(snap, NM.snapshotsOf(c.st, m.id));
  assert.match(text, /Send the site plan/);
  assert.match(text, /Okafor|OC/);
  const html = NM.exportDocument(snap, NM.snapshotsOf(c.st, m.id), '/*css*/', () => '');
  assert.match(html, /<html/);
  assert.match(html, /Send the site plan/);
  assert.match(NM.fileName(NM.FILE_DEFAULT, snap, 'pdf'), /\.pdf$/);
});

test('the example project builds a believable history', () => {
  const st = fresh();
  const p = NM.buildExample(st);
  assert.strictEqual(p.example, true);
  assert.strictEqual(NM.seriesOf(st, p.id).length, 1);
  const ms = NM.meetingsOf(st, NM.seriesOf(st, p.id)[0].id);
  assert.deepStrictEqual(ms.map(m => [m.number, m.status]), [[3, 'agenda'], [2, 'published'], [1, 'published']]);
  const open = NM.actionsOf(st, NM.seriesOf(st, p.id)[0].id).filter(NM.isActive);
  assert.ok(open.length >= 3, 'open actions carry on');
  assert.ok(NM.projectSummary(st, p.id).open >= 3);
});

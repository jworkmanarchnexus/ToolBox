import test from 'node:test';
import assert from 'node:assert';
import helpers from '../../../server/tests/helpers.js';
import { configure, Session, Directory, Store, Backup, Locks, ConflictError, ApiError } from '../index.js';

const { start } = helpers;
const doc = (extra) => Object.assign({ schemaVersion: 1 }, extra);

async function withServer(fn) {
  const t = await start();
  configure({ baseUrl: t.base });
  Session.signOut();
  try { await fn(t); } finally { Session.signOut(); await t.close(); }
}
const signIn = (t, username) => Session.signInAs(t.person(username).id);

test('sign in as a test user, and out again', () => withServer(async (t) => {
  assert.strictEqual(await Session.load(), null, 'nobody at first');
  const users = await Session.devUsers();
  assert.strictEqual(users.length, 8);
  const me = await signIn(t, 's.patel');
  assert.strictEqual(me.name, 'Sam Patel');
  assert.strictEqual(Session.me().username, 's.patel');
  assert.strictEqual(Session.isAdmin(), false);
  await signIn(t, 'a.rivera');
  assert.strictEqual(Session.isAdmin(), true);
  Session.signOut();
  assert.strictEqual(Session.me(), null);
  await assert.rejects(Directory.projects(), (e) => e instanceof ApiError && e.status === 401);
}));

test('a saved sign-in that no longer exists is dropped', () => withServer(async () => {
  await assert.rejects(Session.signInAs('not-a-person'));
  assert.strictEqual(await Session.load(), null);
}));

test('Directory shows different projects to different people', () => withServer(async (t) => {
  await signIn(t, 'r.ortiz');
  const numbers = (await Directory.projects()).map(p => p.number);
  assert.ok(!numbers.includes('26-101'));
  await signIn(t, 'c.nguyen');
  const mine = await Directory.projects({ scope: 'mine' });
  assert.ok(mine.some(p => p.number === '26-101' && p.access === 'read'));
  const team = await Directory.team(t.project('26-101').id);
  assert.deepStrictEqual(team.map(m => m.role).sort(), ['pa', 'pic', 'pm', 'team']);
  assert.ok(team.every(m => m.name && m.userId));
  assert.deepStrictEqual(await Session.names([t.person('m.lee').id]), { [t.person('m.lee').id]: 'Morgan Lee' });
  assert.strictEqual((await Session.search('patel')).length, 1);
}));

test('Store saves with compare-and-set and reports conflicts', () => withServer(async (t) => {
  const p = t.project('26-101');
  const col = Store.collection('scheduler', 'schedules');
  await signIn(t, 's.patel');
  const v1 = await col.save('sched-7001', doc({ title: 'one' }), { projectId: p.id });
  assert.strictEqual(v1.rev, 1);
  const v2 = await col.save('sched-7001', doc({ title: 'two' }), { projectId: p.id, baseRev: 1 });
  assert.strictEqual(v2.rev, 2);

  await signIn(t, 'm.lee');
  await assert.rejects(col.save('sched-7001', doc({ title: 'stale' }), { projectId: p.id, baseRev: 1 }),
    (e) => e instanceof ConflictError && e.current.rev === 2 && e.current.data.title === 'two');

  await signIn(t, 'c.nguyen');
  await assert.rejects(col.save('sched-7001', doc({}), { projectId: p.id, baseRev: 2 }), (e) => e.status === 403);
  assert.strictEqual((await col.get('sched-7001')).data.title, 'two');
}));

test('Store.watch delivers the first load, then only changes made by others', () => withServer(async (t) => {
  const p = t.project('26-101');
  const col = Store.collection('scheduler', 'schedules');
  await signIn(t, 's.patel');
  await col.save('sched-7101', doc({ n: 1 }), { projectId: p.id });

  const seen = [];
  const stop = col.watch((all, changes) => seen.push({ all: all.map(r => r.id).sort(), changes: changes.map(r => r.id).sort() }), { intervalMs: 40 });
  const until = async (cond) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise(r => setTimeout(r, 25)); assert.ok(cond(), 'timed out waiting for the poll'); };

  await until(() => seen.length === 1);
  assert.deepStrictEqual(seen[0], { all: ['sched-7101'], changes: ['sched-7101'] });

  // a second person saves: the first person's poll picks it up
  await t.api('m.lee').put('/api/scheduler/schedules/sched-7102', { data: doc({ n: 2 }), projectId: p.id });
  await until(() => seen.length === 2);
  assert.deepStrictEqual(seen[1], { all: ['sched-7101', 'sched-7102'], changes: ['sched-7102'] });

  // and a delete
  const rev = (await col.get('sched-7102')).rev;
  await t.api('m.lee').del('/api/scheduler/schedules/sched-7102', { ifMatch: rev });
  await until(() => seen.length === 3);
  assert.deepStrictEqual(seen[2], { all: ['sched-7101'], changes: ['sched-7102'] });
  stop();
  const n = seen.length;
  await new Promise(r => setTimeout(r, 150));
  assert.strictEqual(seen.length, n, 'stops polling when told to');
}));

test('Locks.hold takes the lock, refuses a second person, and releases', () => withServer(async (t) => {
  const p = t.project('26-101');
  const col = Store.collection('scheduler', 'schedules');
  await signIn(t, 's.patel');
  await col.save('sched-7201', doc({}), { projectId: p.id });
  const mine = await Locks.hold('scheduler', 'schedules', 'sched-7201');
  assert.strictEqual(mine.held, true);
  assert.strictEqual((await Locks.list('scheduler', 'schedules'))[0].name, 'Sam Patel');

  await signIn(t, 'm.lee');
  const theirs = await Locks.hold('scheduler', 'schedules', 'sched-7201');
  assert.strictEqual(theirs.held, false);
  assert.strictEqual(theirs.heldBy.name, 'Sam Patel');

  await signIn(t, 's.patel');
  await mine.release();
  assert.deepStrictEqual(await Locks.list('scheduler', 'schedules'), []);
}));

test('Backup export, import and Vantagepoint CSV import go through the platform', () => withServer(async (t) => {
  await signIn(t, 's.patel');
  await assert.rejects(Backup.export(), (e) => e.status === 403);
  await signIn(t, 'a.rivera');
  const b = await Backup.export();
  assert.strictEqual(b.format, 'toolbox-backup');
  const res = await Backup.import(b);
  assert.strictEqual(res.added, 0);
  const r = await Backup.importVp('projects', 'ProjectID,ProjectNumber,ProjectName,Client,Status\nP0777,26-777,New one,Someone,Active\n');
  assert.strictEqual(r.added, 1);
}));

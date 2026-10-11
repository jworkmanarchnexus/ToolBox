/* unit tests for the pure modules added in the next iteration: templates, commitments, change impact, permissions */
const assert = require('assert');
const E = require('../logic/engine.js');
const T = require('../logic/templates.js');
global.commitStatus = require('../logic/commit.js').commitStatus; // impact.js reads it as a global, as in the browser build
const C = require('../logic/commit.js');
const I = require('../logic/impact.js');
const P = require('../../../shared/rules/permissions.js');
let n = 0;
const ok = (c, m) => { assert.ok(c, 'FAIL: ' + m); n++; };
const cal = E.makeCalendar([], [0, 6]);
const day = (s) => E.parseDate(s);
const dowName = (n) => E.dowOf(n);

/* ----- templates ----- */
ok(T.TEMPLATES.length >= 7 && T.tplById('blank') && T.tplById('blank').tasks.length === 0, 'templates present, blank is empty');
for (const tpl of T.TEMPLATES) {
  const keys = new Set(tpl.tasks.map((t) => t.k));
  ok(keys.size === tpl.tasks.length, tpl.id + ': unique keys');
  for (const t of tpl.tasks) for (const a of t.after || []) ok(keys.has(Array.isArray(a) ? a[0] : a), tpl.id + ': link to a known key ' + JSON.stringify(a));
  if (!tpl.tasks.length) continue;
  const start = day('2027-01-04');
  const tasks = T.instantiateTemplate(tpl, { start, schedule: E.schedule, cal });
  ok(tasks.length === tpl.tasks.length && new Set(tasks.map((t) => t.id)).size === tasks.length, tpl.id + ': tasks with unique ids');
  ok(tasks.slice(1).every((t) => t.deps.length > 0), tpl.id + ': everything after the first task follows a link');
  const res = E.schedule(tasks, cal);
  ok(![...res.values()].some((r) => r.cycle), tpl.id + ': no loops');
  ok(res.get(tasks[0].id).start === start, tpl.id + ': first task starts on the chosen date');
  ok(Math.min(...[...res.values()].map((r) => r.start)) >= start - 7, tpl.id + ': nothing starts long before the start date');
  ok(tasks.every((t) => !t.exec || t.lvl === 'client'), tpl.id + ': only client tasks are in the executive view');
  const flags = [...res.values()].flatMap((r) => r.flags);
  ok(!flags.length, tpl.id + ': a fresh template has no issues: ' + flags.map((f) => f.text).join('; '));
  ok([...res.values()].every((r) => !cal.reason(r.start)), tpl.id + ': every start is a working day');
}
{ // adjusting a phase pushes everything after it by exactly the difference
  const tpl = T.tplById('dbb'), start = day('2027-01-04');
  const fixedIds = () => { let k = 0; return () => 'x' + (k++); };
  const a = T.instantiateTemplate(tpl, { start, newId: fixedIds(), schedule: E.schedule, cal }), b = T.instantiateTemplate(tpl, { start, newId: fixedIds(), weeks: { sd: 8 }, schedule: E.schedule, cal });
  const ra = E.schedule(a, cal), rb = E.schedule(b, cal);
  const idx = (k) => tpl.tasks.findIndex((t) => t.k === k);
  ok(rb.get(b[idx('sd')].id).dur === 54 && ra.get(a[idx('sd')].id).dur === 40, 'schematic design set to 8 weeks: Monday to Friday, 54 calendar days');
  ok(dowName(rb.get(b[idx('sd')].id).start) === 1 && dowName(rb.get(b[idx('sd')].id).finish) === 5, 'phases run Monday to Friday');
  ok(rb.get(b[idx('sub')].id).start - ra.get(a[idx('sub')].id).start === 14, 'substantial completion moves 14 days later');
  ok(rb.get(b[idx('prog')].id).start === ra.get(a[idx('prog')].id).start, 'tasks before it do not move');
  ok(T.tplPhases(tpl).some((p) => p.k === 'sd' && p.weeks === 6), 'phases list for the wizard');
  const ex = a.filter((t) => t.exec && t.kind === 'task');
  ok(ex[0].exColor === 'nexus-t20' && ex[1].exColor === 'nexus-t40', 'executive phases run light to dark (brand guide p. 11)');
}

/* ----- commitments ----- */
const ms = { id: 'm', kind: 'milestone', duration: 0, start: '2027-12-15', deps: [] };
const rOf = (t) => E.schedule([t], cal).get(t.id);
ok(C.normCommit({ date: '2027-02-30' }) === null && C.normCommit({ date: 'x' }) === null && C.normCommit(null) === null, 'invalid commitments are dropped');
ok(C.normCommit({ date: '2027-12-15', note: '  Contract  date ' }).note === 'Contract date', 'commitment note cleaned');
{
  const t = Object.assign({}, ms, { commit: { date: '2027-12-15' } });
  ok(C.commitStatus(t, rOf(t), 0).status === 'on', 'forecast on the date: on target');
  const late = Object.assign({}, ms, { start: '2027-12-29', commit: { date: '2027-12-15' } });
  const s1 = C.commitStatus(late, rOf(late), 0);
  ok(s1.status === 'late' && s1.margin === -14 && C.commitText(s1) === '14 days late', 'forecast 14 days late');
  const early = Object.assign({}, ms, { start: '2027-12-10', commit: { date: '2027-12-15' } });
  ok(C.commitStatus(early, rOf(early), 0).status === 'early', 'forecast early with no threshold');
  ok(C.commitStatus(early, rOf(early), 7).status === 'risk' && C.commitText(C.commitStatus(early, rOf(early), 7)) === '5 days margin', 'at risk inside an explicit 7-day threshold');
  ok(C.commitStatus(early, rOf(early), 5).status === 'early', 'exactly at the threshold is not at risk');
  ok(C.commitStatus(t, rOf(t), 3).status === 'risk', 'zero margin is at risk when a threshold is set');
  const task = { id: 'a', kind: 'task', duration: 10, start: '2027-12-01', deps: [], commit: { date: '2027-12-09' } };
  const st = C.commitStatus(task, rOf(task), 0);
  ok(st.forecast === day('2027-12-10') && st.status === 'late' && st.margin === -1, 'an activity is judged by its finish');
  ok(C.commitStatus({ id: 'z', kind: 'task' }, rOf(task), 0) === null, 'no commitment, no status');
  const list = C.commitSummary([early, late, t], E.schedule([early, late, t].map((x, i) => Object.assign({}, x, { id: 'c' + i })), cal), 0);
  ok(Array.isArray(list), 'summary runs');
}

/* ----- change impact ----- */
{
  const tasks = [
    { id: 'a', name: 'Schematic design', kind: 'task', duration: 56, start: '2027-01-04', deps: [] },
    { id: 'b', name: 'Owner review', kind: 'task', duration: 14, start: '2027-03-01', deps: [{ id: 'a', type: 'FS', lag: 0 }] },
    { id: 'c', name: 'Design development', kind: 'task', duration: 70, start: '2027-03-15', deps: [{ id: 'b', type: 'FS', lag: 0 }] },
    { id: 'd', name: 'Substantial completion', kind: 'milestone', duration: 0, start: '2027-05-24', deps: [{ id: 'c', type: 'FS', lag: 0 }], commit: { date: '2027-05-24' } },
    { id: 'e', name: 'Unrelated', kind: 'task', duration: 5, start: '2027-01-04', deps: [] },
  ];
  const r0 = E.schedule(tasks, cal);
  for (const t of tasks) t.start = E.fmtISO(r0.get(t.id).start);
  tasks[3].commit = { date: E.fmtISO(r0.get('d').start) };
  const before = I.impactSnap(tasks, r0, 0);
  tasks[0].duration = 70; // 8 -> 10 weeks
  const r1 = E.schedule(tasks, cal);
  const after = I.impactSnap(tasks, r1, 0);
  const imp = I.computeImpact(before, after, ['a']);
  ok(imp.changed.length === 1 && imp.changed[0].oldDur === 56 && imp.changed[0].newDur === 70, 'the edited activity is reported');
  ok(imp.moved.length === 3 && imp.moved.every((m) => m.dStart === 14) && !imp.moved.some((m) => m.id === 'e'), 'three linked activities moved 14 days; the unrelated one did not');
  ok(imp.finish && imp.finish.d === 14, 'last date moves 14 days');
  ok(imp.commits.length === 1 && imp.commits[0].after.status === 'late' && imp.commits[0].after.margin === -14, 'the commitment is now 14 days late');
  ok(imp.severity === 'crit' && !imp.quiet, 'a missed commitment is critical');
  const lines = I.impactLines(imp, (d) => E.fmtShort(d)).map((l) => l.text).join(' | ');
  ok(/Schematic design: 8 → 10 weeks/.test(lines) && /3 linked activities moved to follow \(later, up to 14 days\)/.test(lines) && /forecast 14 days late/.test(lines), 'plain-language summary: ' + lines);
  const quiet = I.computeImpact(after, after, []);
  ok(quiet.quiet && !quiet.finish && quiet.severity === 'info', 'no change, nothing to say');
  // a fix brings it back
  tasks[0].duration = 56;
  const r2 = E.schedule(tasks, cal);
  const back = I.computeImpact(after, I.impactSnap(tasks, r2, 0), ['a']);
  ok(/back on track/.test(I.impactLines(back, (d) => E.fmtShort(d)).map((l) => l.text).join(' ')), 'recovery is reported too');
  // new issues are reported
  tasks[4].locked = true; tasks[4].deps = [{ id: 'a', type: 'FS', lag: 0 }];
  const r3 = E.schedule(tasks, cal);
  const iss = I.computeImpact(I.impactSnap(tasks, r2, 0), I.impactSnap(tasks, r3, 0), ['e']);
  ok(iss.newIssues.some((x) => x.level === 'error'), 'a lock conflict caused by the edit is a new issue');
}

/* ----- permissions (SPEC 4.3, 4.4) ----- */
{
  const base = { firmRoles: { boss: ['admin'], cfo: ['viewer'] }, vpTeam: [{ user: 'pm', role: 'pm' }, { user: 'pic', role: 'pic' }, { user: 'tm', role: 'team' }, { user: 'gone', role: 'team' }], overrides: [{ user: 'gone', kind: 'deny' }, { user: 'guest', kind: 'grant_viewer' }, { user: 'helper', kind: 'grant_editor' }, { user: 'pm2', kind: 'deny' }] };
  const lv = (u, extra) => P.effectiveAccess(Object.assign({}, base, extra || {}, { user: u }));
  ok(lv('boss') === P.ACCESS.ADMIN, 'firm admin is admin everywhere');
  ok(lv('pm') === P.ACCESS.ADMIN && lv('pic') === P.ACCESS.ADMIN, 'PM and PIC from Vantagepoint are project admins');
  ok(lv('tm') === P.ACCESS.READ, 'team member can view');
  ok(lv('gone') === P.ACCESS.NONE, 'a manual removal beats Vantagepoint');
  ok(lv('guest') === P.ACCESS.READ && lv('helper') === P.ACCESS.WRITE, 'manual grants');
  ok(lv('cfo') === P.ACCESS.READ, 'firm viewer can read every project');
  ok(lv('stranger') === P.ACCESS.NONE, 'everyone else: no access');
  ok(P.canDo(P.ACCESS.READ, 'view') && !P.canDo(P.ACCESS.READ, 'edit') && P.canDo(P.ACCESS.READ, 'duplicateFrom'), 'read can view and copy out, not edit');
  ok(P.canDo(P.ACCESS.WRITE, 'edit') && !P.canDo(P.ACCESS.WRITE, 'manageAccess'), 'write edits, does not manage access');
  ok(!P.canDo(P.ACCESS.ADMIN, 'edit', { archived: true }) && P.canDo(P.ACCESS.ADMIN, 'view', { archived: true }), 'archived projects are read-only');
  ok(!P.canDo(P.ACCESS.ADMIN, 'delete', { archived: true }) && P.canDo(P.ACCESS.ADMIN, 'delete', { archived: true, firmAdmin: true }), 'only firm admins delete on archived projects');
  ok(P.canDuplicate(P.ACCESS.READ, P.ACCESS.WRITE, false) && !P.canDuplicate(P.ACCESS.WRITE, P.ACCESS.READ, false) && !P.canDuplicate(P.ACCESS.READ, P.ACCESS.WRITE, true), 'duplicate: read on source, write on an active destination');
  ok(!P.canDeny(base, 'pm', 'pic') && !P.canDeny(base, 'pm', 'pm') && P.canDeny(base, 'pm', 'tm') && P.canDeny(base, 'boss', 'pm') && !P.canDeny(base, 'tm', 'guest'), 'deny rules: no lockouts, leads cannot remove leads');
}

/* ----- schedule <-> template (the templates module) ----- */
{
  const tpl = T.tplById('fed');
  const s0 = day('2026-10-12');
  const tasks = T.instantiateTemplate(tpl, { start: s0, keepIds: true });
  ok(tasks.every((t, i) => t.id === tpl.tasks[i].k), 'keepIds: editing a template keeps its keys as ids');
  const res = E.schedule(tasks, cal);
  const phases = new Set(tpl.tasks.filter((t) => t.phase).map((t) => t.k));
  const back = T.scheduleToTemplate(tasks, res, phases);
  const again = T.instantiateTemplate({ tasks: back }, { start: s0, keepIds: true });
  const r2 = E.schedule(again, cal);
  ok(tasks.every((t) => res.get(t.id).start === r2.get(t.id).start && res.get(t.id).finish === r2.get(t.id).finish), 'round trip keeps every date');
  ok(back.filter((t) => t.phase).length === phases.size, 'round trip keeps the wizard phases');
  ok(again.filter((t) => t.exColor).map((t) => t.exColor).join() === tasks.filter((t) => t.exColor).map((t) => t.exColor).join(), 'round trip keeps executive colors');
  // a saved schedule: locks and holds dropped, unlinked activities keep their offset, lags and SS kept
  const sched = [
    { id: 'a', name: 'Kickoff', kind: 'milestone', duration: 0, start: '2026-10-12', locked: true, deps: [] },
    { id: 'b', name: 'Design', kind: 'task', duration: 21, start: '2026-10-12', deps: [{ id: 'a', type: 'FS', lag: 0 }], notBefore: '2026-11-01', exec: true, lvl: 'client' },
    { id: 'c', name: 'Survey', kind: 'task', duration: 5, start: '2026-10-26', locked: true, deps: [], lvl: 'design' },
    { id: 'd', name: 'Consultants', kind: 'task', duration: 10, start: '2026-10-12', deps: [{ id: 'b', type: 'SS', lag: 7 }], lvl: 'internal', commit: { date: '2027-01-01', note: 'x' } },
  ];
  const sr = E.schedule(sched, cal);
  const st = T.scheduleToTemplate(sched, sr);
  const by = Object.fromEntries(st.map((t) => [t.k, t]));
  ok(st.every((t) => !('locked' in t) && !('notBefore' in t) && !('commit' in t)), 'no locks, holds or commitments in a template');
  ok(by.c.off === 14 && !('off' in by.a), 'an unlinked activity keeps its distance from the start');
  ok(JSON.stringify(by.d.after) === JSON.stringify([['b', 'SS', 7]]) && by.b.after.join() === 'a', 'links and lags kept');
  ok(by.b.phase === true && !by.d.phase && by.d.lvl === 'internal' && by.c.lvl === 'design', 'default wizard phases: client activities marked Exec; audiences kept');
  const inst = T.instantiateTemplate({ tasks: st }, { start: day('2027-03-01') });
  const ir = E.schedule(inst, cal);
  const cId = inst[2].id;
  ok(ir.get(cId).start === day('2027-03-15') && inst.every((t) => !t.locked), 'a new schedule from it: offsets kept, nothing locked');
  const span = T.tplSpan(tpl, E.schedule, cal);
  ok(span && span.days > 600 && span.tasks.length === tpl.tasks.length, 'template length for the cards');
}
console.log('unit tests passed', n);

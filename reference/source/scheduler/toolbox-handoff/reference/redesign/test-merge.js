const { merge3, mergeSummary } = require('./merge.js');
const E = require('./engine.js');
const assert = require('assert');
let n = 0;
const ok = (c, m) => { n++; assert.ok(c, 'FAIL: ' + m); };
const clone = (x) => JSON.parse(JSON.stringify(x));
const T = (id, name, extra) => Object.assign({ id, name, kind: 'task', duration: 5, start: '2026-10-12', locked: false, notBefore: null, deps: [], ignore: [], lvl: 'client', exec: false, exColor: null }, extra || {});
const W = (tasks, extra) => Object.assign({ name: 'S', scale: 'weeks', colors: { client: 'blue', design: 'teal', internal: 'violet' }, holidays: [], hset: false, offDays: [0, 6], execOn: false, execColor: 'blue', customColors: [], baselineOn: false, baseline: null, info: { number: '', client: '', issue: '' }, exportDefaults: {}, holShared: false, tasks }, extra || {});
const base = () => W([T('a', 'Alpha'), T('b', 'Bravo', { deps: [{ id: 'a', type: 'FS', lag: 0 }], start: '2026-10-19' }), T('c', 'Charlie', { deps: [{ id: 'b', type: 'FS', lag: 0 }], start: '2026-10-26' }), T('d', 'Delta')]);
const byId = (w, id) => w.tasks.find((t) => t.id === id);

// 1. nobody changed anything
{ const r = merge3(base(), base(), base()); ok(r.conflicts.length === 0 && r.merged.tasks.length === 4, 'identical'); }
// 2. different fields of the same task merge
{ const m = base(), t = base(); byId(m, 'a').name = 'Alpha mine'; byId(t, 'a').duration = 9;
  const r = merge3(base(), m, t); const a = byId(r.merged, 'a'); ok(!r.conflicts.length && a.name === 'Alpha mine' && a.duration === 9, 'different fields merge'); }
// 3. same field, different values = conflict; default keeps theirs, choice keeps mine
{ const m = base(), t = base(); byId(m, 'a').duration = 7; byId(t, 'a').duration = 9;
  const r = merge3(base(), m, t); ok(r.conflicts.length === 1 && byId(r.merged, 'a').duration === 9, 'conflict defaults to theirs: ' + JSON.stringify(r.conflicts));
  ok(/Task #1 “Alpha”, duration/.test(r.conflicts[0].label) && r.conflicts[0].mine === '7' && r.conflicts[0].theirs === '9', 'conflict label: ' + r.conflicts[0].label);
  const r2 = merge3(base(), m, t, { [r.conflicts[0].key]: 'mine' }); ok(byId(r2.merged, 'a').duration === 7, 'choose mine'); }
// 4. both change same field to the same value = no conflict
{ const m = base(), t = base(); byId(m, 'a').name = 'X'; byId(t, 'a').name = 'X'; ok(merge3(base(), m, t).conflicts.length === 0, 'same value'); }
// 5. added by each side
{ const m = base(), t = base(); m.tasks.push(T('m1', 'Mine new')); t.tasks.push(T('t1', 'Their new'));
  const r = merge3(base(), m, t); ok(r.merged.tasks.length === 6 && byId(r.merged, 'm1') && byId(r.merged, 't1'), 'both additions kept'); }
// 6. insertion position follows neighbours
{ const m = base(), t = base(); m.tasks.splice(1, 0, T('m1', 'Mine between a and b')); t.tasks.push(T('t1', 'Their new'));
  const r = merge3(base(), m, t); const o = r.merged.tasks.map((x) => x.id).join(''); ok(o === 'am1bcdt1' || o === 'am1bcdt1'.replace('t1', 't1'), 'order: ' + o); }
// 7. delete by me, untouched by them
{ const m = base(), t = base(); m.tasks = m.tasks.filter((x) => x.id !== 'd'); const r = merge3(base(), m, t); ok(!byId(r.merged, 'd') && !r.conflicts.length, 'my delete'); }
// 8. delete by them, untouched by me
{ const m = base(), t = base(); t.tasks = t.tasks.filter((x) => x.id !== 'd'); const r = merge3(base(), m, t); ok(!byId(r.merged, 'd') && !r.conflicts.length, 'their delete'); }
// 9. delete by them, edited by me = conflict (default: theirs = deleted)
{ const m = base(), t = base(); byId(m, 'd').name = 'Delta edited'; t.tasks = t.tasks.filter((x) => x.id !== 'd');
  const r = merge3(base(), m, t); ok(r.conflicts.length === 1 && !byId(r.merged, 'd'), 'delete vs edit default');
  const r2 = merge3(base(), m, t, { [r.conflicts[0].key]: 'mine' }); ok(byId(r2.merged, 'd') && byId(r2.merged, 'd').name === 'Delta edited', 'delete vs edit keep mine'); }
// 10. delete by me, edited by them = conflict (default: theirs = kept with their edits)
{ const m = base(), t = base(); m.tasks = m.tasks.filter((x) => x.id !== 'd'); byId(t, 'd').duration = 12;
  const r = merge3(base(), m, t); ok(r.conflicts.length === 1 && byId(r.merged, 'd') && byId(r.merged, 'd').duration === 12, 'delete vs their edit default'); }
// 11. deleted task's links are cleaned up
{ const m = base(), t = base(); m.tasks = m.tasks.filter((x) => x.id !== 'b'); const r = merge3(base(), m, t);
  ok(!byId(r.merged, 'b') && byId(r.merged, 'c').deps.length === 0, 'links to deleted tasks removed'); }
// 12. derived start dates never conflict (cascade changes the stored start)
{ const m = base(), t = base(); byId(m, 'a').start = '2026-10-14'; byId(m, 'b').start = '2026-10-21'; byId(m, 'c').start = '2026-10-28'; // I moved Alpha; cascade rewrote b and c
  byId(t, 'a').start = '2026-10-16'; byId(t, 'b').start = '2026-10-23'; byId(t, 'c').start = '2026-10-30'; // they moved Alpha elsewhere
  const r = merge3(base(), m, t); ok(r.conflicts.length === 1 && /start date/.test(r.conflicts[0].label) && /Alpha/.test(r.conflicts[0].label), 'only the anchored start conflicts: ' + r.conflicts.map((c) => c.label).join(' | ')); }
// 13. I move Alpha, they edit Charlie's name: both survive, no conflict
{ const m = base(), t = base(); byId(m, 'a').start = '2026-10-14'; byId(m, 'b').start = '2026-10-21'; byId(m, 'c').start = '2026-10-28'; byId(t, 'c').name = 'Charlie renamed';
  const r = merge3(base(), m, t); ok(!r.conflicts.length && byId(r.merged, 'a').start === '2026-10-14' && byId(r.merged, 'c').name === 'Charlie renamed', 'move + rename'); }
// 14. dependencies: each side adds a different link
{ const m = base(), t = base(); byId(m, 'd').deps = [{ id: 'a', type: 'FS', lag: 0 }]; byId(t, 'd').deps = [{ id: 'c', type: 'SS', lag: 2 }];
  const r = merge3(base(), m, t); const d = byId(r.merged, 'd'); ok(!r.conflicts.length && d.deps.length === 2, 'both links kept: ' + JSON.stringify(d.deps)); }
// 15. dependencies: both change the same link differently = conflict
{ const m = base(), t = base(); byId(m, 'b').deps = [{ id: 'a', type: 'FS', lag: 2 }]; byId(t, 'b').deps = [{ id: 'a', type: 'SS', lag: 0 }];
  const r = merge3(base(), m, t); ok(r.conflicts.length === 1 && /link from “Alpha”/.test(r.conflicts[0].label), 'link conflict: ' + (r.conflicts[0] && r.conflicts[0].label)); }
// 16. link removed by one, untouched by other
{ const m = base(), t = base(); byId(m, 'b').deps = []; const r = merge3(base(), m, t); ok(!r.conflicts.length && byId(r.merged, 'b').deps.length === 0, 'link removal'); }
// 17. a circular link made by combining two edits is produced (the Issues panel will flag it)
{ const m = base(), t = base(); byId(m, 'a').deps = [{ id: 'c', type: 'FS', lag: 0 }];
  const r = merge3(base(), m, t); const sch = E.schedule(r.merged.tasks, E.makeCalendar([], [0, 6])); ok([...sch.values()].some((x) => x.cycle), 'cycle visible to the engine'); }
// 18. reorder: only they reordered -> theirs
{ const m = base(), t = base(); t.tasks = [t.tasks[3], t.tasks[0], t.tasks[1], t.tasks[2]]; const r = merge3(base(), m, t); ok(r.merged.tasks.map((x) => x.id).join('') === 'dabc', 'their reorder'); }
// 19. only I reordered -> mine, and their added row is placed
{ const m = base(), t = base(); m.tasks = [m.tasks[3], m.tasks[0], m.tasks[1], m.tasks[2]]; t.tasks.push(T('t1', 'Their new')); const r = merge3(base(), m, t);
  ok(r.merged.tasks.map((x) => x.id).join('') === 'dt1abc', 'my reorder plus their add stays next to its old neighbour: ' + r.merged.tasks.map((x) => x.id).join('')); }
// 20. both reordered -> theirs wins
{ const m = base(), t = base(); m.tasks = [m.tasks[1], m.tasks[0], m.tasks[2], m.tasks[3]]; t.tasks = [t.tasks[3], t.tasks[2], t.tasks[1], t.tasks[0]]; const r = merge3(base(), m, t); ok(r.merged.tasks.map((x) => x.id).join('') === 'dcba', 'both reordered'); }
// 21. settings
{ const m = base(), t = base(); m.scale = 'quarters'; t.info = { number: '2026-014', client: 'Hill AFB', issue: '' }; m.customColors = ['#12ab9c']; t.customColors = ['#ab12cd'];
  m.holidays = [{ date: '2026-11-26', name: 'Thanksgiving' }]; t.holidays = [{ date: '2026-12-25', name: 'Christmas' }];
  const r = merge3(base(), m, t); const g = r.merged; ok(!r.conflicts.length && g.scale === 'quarters' && g.info.number === '2026-014' && g.customColors.length === 2 && g.holidays.length === 2, 'settings merge: ' + JSON.stringify(g.holidays)); }
// 22. both rename the project differently
{ const m = base(), t = base(); m.name = 'Mine'; t.name = 'Theirs'; const r = merge3(base(), m, t); ok(r.conflicts.length === 1 && r.merged.name === 'Theirs', 'project name conflict'); }
// 23. baseline: both set differently = conflict, one sets = taken
{ const m = base(), t = base(); m.baseline = { at: 1, by: 'u', tasks: { a: { s: '2026-10-12', d: 5 } } }; ok(merge3(base(), m, t).merged.baseline && !merge3(base(), m, t).conflicts.length, 'baseline set by me');
  t.baseline = { at: 2, by: 'v', tasks: { a: { s: '2026-10-13', d: 5 } } }; ok(merge3(base(), m, t).conflicts.length === 1, 'baseline conflict'); }
// 24. toggling lock and unlock independently
{ const m = base(), t = base(); byId(m, 'a').locked = true; byId(t, 'd').locked = true; const r = merge3(base(), m, t); ok(byId(r.merged, 'a').locked && byId(r.merged, 'd').locked, 'locks'); }
// 25. a task made a milestone keeps duration 0
{ const m = base(), t = base(); byId(m, 'd').kind = 'milestone'; byId(m, 'd').duration = 0; byId(t, 'd').name = 'Delta renamed'; const r = merge3(base(), m, t); ok(byId(r.merged, 'd').kind === 'milestone' && byId(r.merged, 'd').duration === 0 && byId(r.merged, 'd').name === 'Delta renamed', 'milestone + rename'); }
// 26. ignore codes
{ const m = base(), t = base(); byId(m, 'a').ignore = ['startNonwork']; byId(t, 'a').ignore = ['finishNonwork']; const r = merge3(base(), m, t); ok(byId(r.merged, 'a').ignore.sort().join() === 'finishNonwork,startNonwork', 'ignore union'); }
// 27. result tasks keep every normalized field
{ const r = merge3(base(), base(), base()); for (const t of r.merged.tasks) for (const k of ['id', 'name', 'kind', 'duration', 'start', 'locked', 'notBefore', 'deps', 'ignore', 'lvl', 'exec', 'exColor']) ok(k in t, 'field ' + k); }
// 28. stats and summary
{ const t = base(); byId(t, 'a').name = 'x'; t.tasks.push(T('n', 'new')); t.tasks = t.tasks.filter((x) => x.id !== 'd'); const r = merge3(base(), base(), t); ok(r.stats.changed === 1 && r.stats.added === 1 && r.stats.removed === 1 && /1 task changed, 1 added, 1 removed/.test(mergeSummary(r.stats, 'Maria')), 'summary: ' + mergeSummary(r.stats, 'Maria')); }
// 29. inputs are never mutated
{ const m = base(), t = base(), b = base(); byId(m, 'a').name = 'm'; merge3(b, m, t); ok(JSON.stringify(b) === JSON.stringify(base()) && byId(m, 'a').name === 'm', 'no mutation'); }
console.log('merge tests passed', n);

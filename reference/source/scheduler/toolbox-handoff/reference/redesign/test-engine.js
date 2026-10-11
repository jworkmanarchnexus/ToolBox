const E = require('./engine.js');
const assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const iso = E.fmtISO;

// holidays 2026 / 2027
const h26 = Object.fromEntries(E.generateHolidays(2026, true).map(h => [h.name, h.date]));
ok(h26["Martin Luther King Jr. Day"] === '2026-01-19', 'MLK');
ok(h26["Presidents' Day"] === '2026-02-16', 'Presidents');
ok(h26['Memorial Day'] === '2026-05-25', 'Memorial');
ok(h26['Juneteenth'] === '2026-06-19', 'Juneteenth');
ok(h26['Independence Day (observed)'] === '2026-07-03', 'July 4 observed');
ok(h26['Labor Day'] === '2026-09-07', 'Labor');
ok(h26["Columbus / Indigenous Peoples' Day"] === '2026-10-12', 'Columbus');
ok(h26['Veterans Day'] === '2026-11-11', 'Vets');
ok(h26['Thanksgiving'] === '2026-11-26', 'Thanksgiving');
ok(h26['Christmas Day'] === '2026-12-25', 'Christmas');
ok(h26['Pioneer Day (Utah)'] === '2026-07-24', 'Pioneer');
const h27 = Object.fromEntries(E.generateHolidays(2027, true).map(h => [h.name, h.date]));
ok(h27['Juneteenth (observed)'] === '2027-06-18', 'Juneteenth obs 27');
ok(h27['Independence Day (observed)'] === '2027-07-05', 'July 4 obs 27 (Sun->Mon)');
ok(h27['Christmas Day (observed)'] === '2027-12-24', 'Xmas obs 27');
ok(h27['Pioneer Day (Utah) (observed)'] === '2027-07-23', 'Pioneer obs 27');

const cal = E.makeCalendar(E.generateHolidays(2026, false));
const D = (s) => E.parseDate(s);
ok(cal.reason(D('2026-10-10')) === 'Saturday', 'sat');
ok(cal.reason(D('2026-10-12')).startsWith('Columbus'), 'holiday');
ok(iso(cal.next(D('2026-10-10'))) === '2026-10-13', 'next skips sat, sun, holiday');
ok(E.fmtShort(D('2026-10-09')) === 'Fri Oct 9', 'fmtShort');

const T = (id, o) => Object.assign({ id, name: id, kind: 'task', duration: 5, start: '2026-10-05', locked: false, notBefore: null, deps: [], ignore: [] }, o);

// FS + lag, SS + lag, multiple preds -> max
let tasks = [
  T('a', { start: '2026-10-05', duration: 5 }),                       // Oct 5-9, end exclusive Oct 10
  T('b', { duration: 3, deps: [{ id: 'a', type: 'FS', lag: 0 }] }),     // starts Oct 10
  T('c', { duration: 2, deps: [{ id: 'a', type: 'SS', lag: 2 }] }),     // starts Oct 7
  T('m', { kind: 'milestone', duration: 0, deps: [{ id: 'b', type: 'FS', lag: 0 }, { id: 'c', type: 'FS', lag: 0 }] }),
];
let r = E.schedule(tasks, cal);
ok(iso(r.get('b').start) === '2026-10-10', 'FS start');
ok(iso(r.get('c').start) === '2026-10-07', 'SS+2 start');
ok(iso(r.get('m').start) === '2026-10-13', 'milestone max of preds');
ok(iso(r.get('b').finish) === '2026-10-12', 'finish inclusive');

// push: a slips 7 days -> everything cascades
tasks[0].start = '2026-10-12';
r = E.schedule(tasks, cal);
ok(iso(r.get('b').start) === '2026-10-17', 'cascade b');
ok(iso(r.get('c').start) === '2026-10-14', 'cascade c');
ok(iso(r.get('m').start) === '2026-10-20', 'cascade m');

// pull in: a shortens
tasks[0].duration = 2;
r = E.schedule(tasks, cal);
ok(iso(r.get('b').start) === '2026-10-14', 'pull-in b');

// hold
tasks[1].notBefore = '2026-10-30';
r = E.schedule(tasks, cal);
ok(iso(r.get('b').start) === '2026-10-30' && r.get('b').held, 'hold respected');
ok(iso(r.get('m').start) === '2026-11-02', 'hold cascades (Nov 2 = Mon after Oct31 Sat end)');
tasks[1].notBefore = null;

// negative lag
tasks[1].deps = [{ id: 'a', type: 'FS', lag: -1 }];
r = E.schedule(tasks, cal);
ok(iso(r.get('b').start) === '2026-10-13', 'negative lag');
tasks[1].deps = [{ id: 'a', type: 'FS', lag: 0 }];

// locked milestone: conflict when pushed past; no movement
tasks = [
  T('a', { start: '2026-10-05', duration: 10 }), // ends Oct 15 (excl Oct 15)
  T('d', { kind: 'milestone', duration: 0, start: '2026-10-14', locked: true, deps: [{ id: 'a', type: 'FS', lag: 0 }] }),
  T('e', { duration: 2, deps: [{ id: 'd', type: 'FS', lag: 0 }] }),
];
r = E.schedule(tasks, cal);
ok(iso(r.get('d').start) === '2026-10-14', 'locked stays');
let lc = r.get('d').flags.find(f => f.code === 'lockConflict');
ok(lc && lc.fix.date === '2026-10-15' && /1 day late/.test(lc.text), 'lock conflict flagged ' + (lc && lc.text));
ok(iso(r.get('e').start) === '2026-10-14', 'successor follows locked, not driven');
tasks[0].duration = 5; r = E.schedule(tasks, cal);
ok(!r.get('d').flags.find(f => f.code === 'lockConflict'), 'no conflict once feasible');

// weekend/holiday flags
tasks = [
  T('w', { kind: 'milestone', duration: 0, start: '2026-10-10' }),   // Saturday
  T('x', { duration: 3, start: '2026-10-09' }),                        // Fri-Sun (finishes Sunday)
  T('y', { kind: 'milestone', duration: 0, start: '2026-10-12' }),    // holiday
];
r = E.schedule(tasks, cal);
let f = r.get('w').flags[0];
ok(f.level === 'error' && f.fix.date === '2026-10-13', 'weekend milestone error');
ok(r.get('y').flags[0].level === 'error' && /Columbus/.test(r.get('y').flags[0].text), 'holiday milestone error');
f = r.get('x').flags;
ok(f.length === 1 && f[0].code === 'finishNonwork' && f[0].level === 'warn' && f[0].fix.dur === 5, 'finish on weekend warn; extend to Mon Oct 12 holiday -> Tue Oct 13 = 5 days');
tasks[1].ignore = ['finishNonwork'];
ok(E.schedule(tasks, cal).get('x').flags.length === 0, 'ignore works');

// cycles
tasks = [T('p', { deps: [{ id: 'q', type: 'FS', lag: 0 }] }), T('q', { deps: [{ id: 'p', type: 'FS', lag: 0 }] }), T('z')];
r = E.schedule(tasks, cal);
ok(r.get('p').cycle && r.get('q').cycle && !r.get('z').cycle, 'cycle detected');
ok(E.wouldCycle([T('p'), T('q', { deps: [{ id: 'p' }] })], 'p', ['q']) === true, 'wouldCycle direct');
ok(E.wouldCycle([T('p'), T('q', { deps: [{ id: 'p' }] }), T('r2', { deps: [{ id: 'q' }] })], 'p', ['r2']) === true, 'wouldCycle transitive');
ok(E.wouldCycle([T('p'), T('q')], 'p', ['q']) === false, 'no cycle');
ok(E.wouldCycle([T('p')], 'p', ['p']) === true, 'self');

// preds text
const tt = [T('a'), T('b'), T('c')];
let pp = E.parsePreds('1, 2SS+3, 1FS-2', tt, 'c');
ok(!pp.error && pp.deps.length === 2, 'parse dedupes');
ok(pp.deps.find(d => d.id === 'a').lag === -2, 'later dup wins');
ok(pp.deps.find(d => d.id === 'b').type === 'SS' && pp.deps.find(d => d.id === 'b').lag === 3, 'SS+3');
ok(E.parsePreds('9', tt, 'c').error, 'no row 9');
ok(E.parsePreds('3', tt, 'c').error, 'self');
ok(E.parsePreds('x', tt, 'c').error, 'junk');
ok(E.parsePreds('', tt, 'c').deps.length === 0, 'empty ok');
ok(E.formatPreds({ deps: [{ id: 'a', type: 'FS', lag: 0 }, { id: 'b', type: 'SS', lag: 3 }, { id: 'a2', type: 'FS', lag: -1 }] }, [T('a'), T('b'), T('a2')]) === '1, 2SS+3, 3-1', 'format');

// example schedule is clean
const ex = E.exampleTasks(D('2026-10-09'), E.makeCalendar(E.generateHolidays(2026, true).concat(E.generateHolidays(2027, true))));
const er = E.schedule(ex, E.makeCalendar(E.generateHolidays(2026, true).concat(E.generateHolidays(2027, true))));
const bad = [...er.values()].filter(x => x.flags.some(f => f.level === 'error'));
ok(bad.length === 0, 'example has no errors: ' + JSON.stringify(bad.map(b => b.flags)));
{ const c = E.makeCalendar(E.generateHolidays(2026, true).concat(E.generateHolidays(2027, true))); const st = er.get(ex[0].id).start; ok(st >= D('2026-10-12') && c.isWork(st), 'example starts on the first working day after the reference (2026-10-12 is Columbus Day): ' + iso(st)); }
console.log('passed', n, 'checks');

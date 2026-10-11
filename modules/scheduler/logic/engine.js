/* ===== Scheduling engine (pure, no DOM) ===== */
const DAY_MS = 86400000;
const DOW_S = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DOW_L = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MON_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MON_L = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return NaN;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
}
function fmtISO(n) {
  const d = new Date(n * DAY_MS);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}
function dowOf(n) { return new Date(n * DAY_MS).getUTCDay(); }
function ymdOf(n) { const d = new Date(n * DAY_MS); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }; }
function fmtShort(n) { const p = ymdOf(n); return DOW_S[dowOf(n)] + ' ' + MON_S[p.m] + ' ' + p.d; }
function fmtMed(n) { const p = ymdOf(n); return MON_S[p.m] + ' ' + p.d + ', ' + p.y; }
function fmtLong(n) { const p = ymdOf(n); return DOW_S[dowOf(n)] + ' ' + MON_S[p.m] + ' ' + p.d + ', ' + p.y; }
function dayNum(y, m, d) { return Math.round(Date.UTC(y, m, d) / DAY_MS); }

/* ----- typed dates: 10/15, 10/15/26, Oct 15, 15 Oct 2026, 2026-10-15, today, +7, -3 ----- */
const MONTH_WORDS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
function parseTyped(text, ref, today) {
  let s = String(text == null ? '' : text).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return NaN;
  const mk = (y, m, d) => {
    if (!(m >= 0 && m <= 11 && d >= 1 && d <= 31)) return NaN;
    const n = dayNum(y, m, d), p = ymdOf(n);
    return p.y === y && p.m === m && p.d === d ? n : NaN;
  };
  const refDay = isNaN(ref) || ref == null ? today : ref;
  const near = (m, d) => {
    const ry = ymdOf(refDay).y;
    let best = NaN;
    for (const y of [ry - 1, ry, ry + 1]) {
      const n = mk(y, m, d);
      if (!isNaN(n) && (isNaN(best) || Math.abs(n - refDay) < Math.abs(best - refDay))) best = n;
    }
    return best;
  };
  const yr = (v) => (v.length === 2 ? 2000 + parseInt(v, 10) : parseInt(v, 10));
  let m;
  if (s === 'today') return today;
  if ((m = /^([+-])\s?(\d{1,4})$/.exec(s))) return refDay + (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10);
  s = s.replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/, '');
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return mk(+m[1], +m[2] - 1, +m[3]);
  if ((m = /^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{4}|\d{2}))?$/.exec(s))) return m[3] ? mk(yr(m[3]), +m[1] - 1, +m[2]) : near(+m[1] - 1, +m[2]);
  if ((m = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? ?(\d{4}|\d{2}))?$/.exec(s)) && m[1] in MONTH_WORDS) return m[3] ? mk(yr(m[3]), MONTH_WORDS[m[1]], +m[2]) : near(MONTH_WORDS[m[1]], +m[2]);
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?(?:,? ?(\d{4}|\d{2}))?$/.exec(s)) && m[2] in MONTH_WORDS) return m[3] ? mk(yr(m[3]), MONTH_WORDS[m[2]], +m[1]) : near(MONTH_WORDS[m[2]], +m[1]);
  return NaN;
}

/* ----- calendar: weekends + holiday list ----- */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/* non-working weekdays, 0 = Sunday. Default Saturday and Sunday. An empty list means every day works; seven days off is not allowed. */
function normOffDays(a) {
  if (!Array.isArray(a)) return [0, 6];
  const s = new Set(a.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6));
  return s.size >= 7 ? [0, 6] : [...s].sort((x, y) => x - y);
}
function makeCalendar(holidays, offDays) {
  const off = new Set(normOffDays(offDays));
  const hol = new Map();
  for (const h of holidays || []) {
    const n = parseDate(h.date);
    if (!isNaN(n)) hol.set(n, h.name || 'Holiday');
  }
  const reason = (n) => {
    if (hol.has(n)) return hol.get(n);
    const d = dowOf(n);
    return off.has(d) ? DAY_NAMES[d] : null;
  };
  const isWork = (n) => reason(n) === null;
  const next = (n) => { let i = 0; while (!isWork(n) && i < 400) { n++; i++; } return n; };
  return { reason, isWork, next, holidays: hol, isHoliday: (n) => hol.has(n), offDays: [...off] };
}

/* ----- holiday generator (U.S. federal, observed dates; optional Utah Pioneer Day) ----- */
function nthWeekday(y, m, wd, n) {
  const first = dayNum(y, m, 1);
  const shift = (wd - dowOf(first) + 7) % 7;
  return first + shift + (n - 1) * 7;
}
function lastWeekday(y, m, wd) {
  const last = dayNum(y, m + 1, 0);
  return last - ((dowOf(last) - wd + 7) % 7);
}
function observed(n) {
  const d = dowOf(n);
  if (d === 6) return { n: n - 1, shifted: true };
  if (d === 0) return { n: n + 1, shifted: true };
  return { n, shifted: false };
}
function generateHolidays(year, withPioneer) {
  const fixed = (m, d, name) => ({ n: dayNum(year, m, d), name });
  const list = [
    fixed(0, 1, "New Year's Day"),
    { n: nthWeekday(year, 0, 1, 3), name: 'Martin Luther King Jr. Day', floating: true },
    { n: nthWeekday(year, 1, 1, 3), name: "Presidents' Day", floating: true },
    { n: lastWeekday(year, 4, 1), name: 'Memorial Day', floating: true },
    fixed(5, 19, 'Juneteenth'),
    fixed(6, 4, 'Independence Day'),
    { n: nthWeekday(year, 8, 1, 1), name: 'Labor Day', floating: true },
    { n: nthWeekday(year, 9, 1, 2), name: "Columbus / Indigenous Peoples' Day", floating: true },
    fixed(10, 11, 'Veterans Day'),
    { n: nthWeekday(year, 10, 4, 4), name: 'Thanksgiving', floating: true },
    fixed(11, 25, 'Christmas Day'),
  ];
  if (withPioneer) list.push(fixed(6, 24, 'Pioneer Day (Utah)'));
  return list.map((h) => {
    if (h.floating) return { date: fmtISO(h.n), name: h.name };
    const o = observed(h.n);
    return { date: fmtISO(o.n), name: o.shifted ? h.name + ' (observed)' : h.name };
  });
}

/* ----- predecessor text:  "3, 5SS+2, 4FS-1" ----- */
function formatPreds(task, tasks) {
  const idx = new Map(tasks.map((t, i) => [t.id, i + 1]));
  return (task.deps || [])
    .filter((d) => idx.has(d.id))
    .map((d) => {
      const lag = d.lag || 0;
      return idx.get(d.id) + (d.type === 'SS' ? 'SS' : '') + (lag ? (lag > 0 ? '+' : '-') + Math.abs(lag) : '');
    })
    .join(', ');
}
function parsePreds(text, tasks, selfId) {
  const out = new Map();
  const parts = String(text || '').split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
  for (const tok of parts) {
    const m = /^(\d+)\s*(fs|ss)?\s*([+-]\s*\d+)?\s*(d|day|days)?$/i.exec(tok);
    if (!m) return { error: '“' + tok + '” isn’t a valid predecessor. Use a row number, like 3, 5SS+2 or 4FS-1.' };
    const row = parseInt(m[1], 10);
    const t = tasks[row - 1];
    if (!t) return { error: 'There is no row ' + row + '.' };
    if (t.id === selfId) return { error: 'A task can’t depend on itself.' };
    out.set(t.id, { id: t.id, type: (m[2] || 'FS').toUpperCase(), lag: m[3] ? parseInt(m[3].replace(/\s+/g, ''), 10) : 0 });
  }
  return { deps: [...out.values()] };
}
function wouldCycle(tasks, taskId, depIds) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set();
  const stack = [...depIds];
  while (stack.length) {
    const id = stack.pop();
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = byId.get(id);
    if (t) for (const d of t.deps || []) stack.push(d.id);
  }
  return false;
}

/* ----- the cascade -----
   Task: {id,name,kind:'task'|'milestone',start:'YYYY-MM-DD',duration,locked,notBefore,deps:[{id,type,lag}],ignore:[]}
   - No predecessors: start is the date entered (anchored).
   - Predecessors: start = latest date the links allow, or "notBefore" if later (a hold).
   - Locked: start never moves; a conflict is flagged if predecessors need a later date.
   end is exclusive (start + duration); finish is the last day the task occupies. */
function schedule(tasks, cal) {
  const ids = new Set(tasks.map((t) => t.id));
  const preds = new Map();
  const succs = new Map(tasks.map((t) => [t.id, []]));
  for (const t of tasks) {
    const seen = new Set();
    const ds = [];
    for (const d of t.deps || []) {
      if (d.id === t.id || !ids.has(d.id) || seen.has(d.id)) continue;
      seen.add(d.id);
      ds.push(d);
      succs.get(d.id).push(t.id);
    }
    preds.set(t.id, ds);
  }
  const indeg = new Map(tasks.map((t) => [t.id, preds.get(t.id).length]));
  const queue = tasks.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const s of succs.get(id)) {
      indeg.set(s, indeg.get(s) - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  const done = new Set(order);
  const cyc = tasks.filter((t) => !done.has(t.id)).map((t) => t.id);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const res = new Map();

  const run = (t, inCycle) => {
    const kind = t.kind === 'milestone' ? 'milestone' : 'task';
    const dur = kind === 'milestone' ? 0 : Math.max(1, Math.round(+t.duration || 1));
    const ds = inCycle ? [] : preds.get(t.id);
    const anchorDay = parseDate(t.start);
    let driven = null, drivenBy = null;
    for (const d of ds) {
      const p = res.get(d.id);
      const lag = d.lag || 0;
      const v = d.type === 'SS' ? p.start + lag : p.end + lag;
      if (driven === null || v > driven) { driven = v; drivenBy = d.id; }
    }
    const nb = t.notBefore ? parseDate(t.notBefore) : NaN;
    let start, held = false;
    if (ds.length === 0) {
      start = isNaN(anchorDay) ? (cal.next(Math.floor(Date.now() / DAY_MS))) : anchorDay;
    } else {
      start = driven;
      if (!isNaN(nb) && nb > driven) { start = nb; held = true; }
    }
    const flags = [];
    const ign = (c) => (t.ignore || []).includes(c);
    if (t.locked && !isNaN(anchorDay)) {
      if (ds.length && driven > anchorDay) {
        const late = driven - anchorDay;
        flags.push({
          code: 'lockConflict', level: 'error',
          text: 'Locked for ' + fmtShort(anchorDay) + ', but predecessors push it to ' + fmtShort(driven) + ' (' + late + (late === 1 ? ' day' : ' days') + ' late)',
          fix: { type: 'setStart', date: fmtISO(driven), label: 'Move to ' + fmtShort(driven) },
        });
      }
      start = anchorDay;
      held = false;
    }
    const end = start + dur;
    const finish = dur > 0 ? end - 1 : start;
    if (inCycle) flags.push({ code: 'cycle', level: 'error', text: 'Part of a circular dependency. Remove one of the links.' });
    const r0 = cal.reason(start);
    if (kind === 'milestone') {
      if (r0) {
        const nx = cal.next(start);
        flags.push({ code: 'milestoneNonwork', level: 'error', text: 'Falls on ' + r0 + ' (' + fmtShort(start) + ')', fix: { type: 'setStart', date: fmtISO(nx), label: 'Move to ' + fmtShort(nx) } });
      }
    } else {
      if (r0 && !ign('startNonwork')) {
        const nx = cal.next(start);
        flags.push({ code: 'startNonwork', level: 'warn', text: 'Starts on ' + r0 + ' (' + fmtShort(start) + ')', fix: { type: 'setStart', date: fmtISO(nx), label: 'Start ' + fmtShort(nx) }, ignorable: true });
      }
      const r1 = cal.reason(finish);
      if (r1 && !ign('finishNonwork')) {
        const nx = cal.next(finish);
        flags.push({ code: 'finishNonwork', level: 'warn', text: 'Finishes on ' + r1 + ' (' + fmtShort(finish) + ')', fix: { type: 'setDuration', dur: nx - start + 1, label: 'Extend to ' + fmtShort(nx) }, ignorable: true });
      }
    }
    res.set(t.id, { id: t.id, kind, dur, start, end, finish, driven, drivenBy, held, locked: !!t.locked, anchored: ds.length === 0, cycle: !!inCycle, flags });
  };
  for (const id of order) run(byId.get(id), false);
  for (const id of cyc) run(byId.get(id), true);
  return res;
}


/* ----- audience levels and colors ----- */
const LEVELS = ['client', 'design', 'internal'];
const LEVEL_INFO = {
  client: { label: 'Client', hint: 'Shown in every export' },
  design: { label: 'Design team', hint: 'Left out of the client export' },
  internal: { label: 'Internal', hint: 'Only in the internal export' },
};
const PRESETS = {
  blue:   { label: 'Blue',   light: '#3B79C3', dark: '#5B9BEA', print: '#3B79C3' },
  teal:   { label: 'Teal',   light: '#1F8A8A', dark: '#45B8B0', print: '#1F8A8A' },
  green:  { label: 'Green',  light: '#4C8F3F', dark: '#7BC46B', print: '#4C8F3F' },
  violet: { label: 'Violet', light: '#7653B5', dark: '#A68BE0', print: '#7653B5' },
  slate:  { label: 'Slate',  light: '#5F7285', dark: '#9AAEC2', print: '#5F7285' },
  brown:  { label: 'Brown',  light: '#8A5A3A', dark: '#C79770', print: '#8A5A3A' },
  amber:  { label: 'Amber',  light: '#C98A1B', dark: '#E8B04B', print: '#C98A1B' },
  red:    { label: 'Red',    light: '#B94A48', dark: '#E07A78', print: '#B94A48' },
  rose:   { label: 'Rose',   light: '#B5527E', dark: '#DE8AB0', print: '#B5527E' },
  olive:  { label: 'Olive',  light: '#7F8A2E', dark: '#B5C25A', print: '#7F8A2E' },
  navy:     { label: 'Navy',     light: '#2B4C7E', dark: '#7DA2D6', print: '#2B4C7E', extra: true },
  sky:      { label: 'Sky',      light: '#3C9BD1', dark: '#7CC4EE', print: '#3C9BD1', extra: true },
  mint:     { label: 'Mint',     light: '#2FA77A', dark: '#6FD3A8', print: '#2FA77A', extra: true },
  coral:    { label: 'Coral',    light: '#E0663F', dark: '#F09A7A', print: '#E0663F', extra: true },
  plum:     { label: 'Plum',     light: '#7A3E6E', dark: '#B87BAB', print: '#7A3E6E', extra: true },
  indigo:   { label: 'Indigo',   light: '#4B4FB5', dark: '#8E92E6', print: '#4B4FB5', extra: true },
  sand:     { label: 'Sand',     light: '#B49A6B', dark: '#D9C79F', print: '#B49A6B', extra: true },
  charcoal: { label: 'Charcoal', light: '#3A4550', dark: '#A9B4BF', print: '#3A4550', extra: true },
};
const DEFAULT_COLORS = { client: 'blue', design: 'teal', internal: 'violet' };
/* a bar color is a preset name or a custom #rrggbb the project saved */
const HEX_RE = /^#[0-9a-f]{6}$/i;
const isColor = (v) => typeof v === 'string' && (!!PRESETS[v] || HEX_RE.test(v));
const normColor = (v) => (HEX_RE.test(v) ? v.toLowerCase() : PRESETS[v] ? v : null);
const colorCss = (v) => (PRESETS[v] ? 'var(--p-' + v + ')' : HEX_RE.test(v) ? v.toLowerCase() : 'var(--p-blue)');
const colorPrint = (v) => (PRESETS[v] ? PRESETS[v].print : HEX_RE.test(v) ? v.toLowerCase() : PRESETS.blue.print);
const colorLabel = (v) => (PRESETS[v] ? PRESETS[v].label : HEX_RE.test(v) ? v.toUpperCase() : 'Blue');
const execKey = (t, def) => (t && isColor(t.exColor) ? normColor(t.exColor) : isColor(def) ? normColor(def) : 'blue');
const lvRank = (t) => { const i = LEVELS.indexOf(t && t.lvl); return i < 0 ? 0 : i; };
/* the executive summary is for client executives: a task needs the flag AND client-level visibility */
const isExecTask = (t) => !!(t && t.exec) && lvRank(t) === 0;
function normColors(c) {
  const out = {};
  for (const k of LEVELS) out[k] = (c && normColor(c[k])) || DEFAULT_COLORS[k];
  return out;
}

/* ----- example schedule ----- */
function newId() { return 't' + Math.random().toString(36).slice(2, 9); }
function exampleTasks(todayDay, cal) {
  const monday = todayDay + ((8 - dowOf(todayDay)) % 7 || 7);
  const T = (name, kind, duration, deps, extra) => Object.assign({ id: newId(), name, kind, duration, start: fmtISO(monday), locked: false, notBefore: null, deps: deps || [], ignore: [] }, extra || {});
  const t = [];
  t.push(T('Notice to proceed', 'milestone', 0, [], { start: fmtISO(monday) }));
  t.push(T('Programming and site survey', 'task', 10, [{ id: t[0].id, type: 'FS', lag: 0 }]));
  t.push(T('Schematic design', 'task', 21, [{ id: t[1].id, type: 'FS', lag: 0 }]));
  t.push(T('Owner review of schematic design', 'task', 7, [{ id: t[2].id, type: 'FS', lag: 0 }]));
  t.push(T('Design development', 'task', 28, [{ id: t[3].id, type: 'FS', lag: 0 }]));
  t.push(T('Structural and MEP coordination', 'task', 21, [{ id: t[4].id, type: 'SS', lag: 7 }], { lvl: 'design' }));
  t.push(T('Design development submittal', 'milestone', 0, [{ id: t[4].id, type: 'FS', lag: 0 }, { id: t[5].id, type: 'FS', lag: 0 }]));
  t.push(T('Construction documents', 'task', 35, [{ id: t[6].id, type: 'FS', lag: 7 }]));
  t.push(T('Permit review', 'task', 21, [{ id: t[7].id, type: 'FS', lag: 0 }]));
  t.push(T('Bid documents issued', 'milestone', 0, [{ id: t[7].id, type: 'FS', lag: 1 }]));
  t.push(T('Bids due', 'milestone', 0, [{ id: t[9].id, type: 'FS', lag: 21 }]));
  t.push(T('Contract award', 'milestone', 0, [{ id: t[10].id, type: 'FS', lag: 7 }]));
  // move any date that lands off a working day, then lock the bid deadline where it falls
  for (let pass = 0; pass < 3; pass++) {
    const r = schedule(t, cal);
    for (const x of t) {
      const y = r.get(x.id);
      if (x.kind === 'milestone' && cal.reason(y.start)) {
        if (x.deps.length) x.notBefore = fmtISO(cal.next(y.start));
        else x.start = fmtISO(cal.next(y.start));
      }
    }
  }
  const r = schedule(t, cal);
  for (const x of t) x.start = fmtISO(r.get(x.id).start);
  t[10].locked = true;
  return t;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseTyped, parseDate, fmtISO, fmtShort, fmtMed, fmtLong, dowOf, makeCalendar, normOffDays, DAY_NAMES, generateHolidays, formatPreds, parsePreds, wouldCycle, schedule, exampleTasks, newId, LEVELS, LEVEL_INFO, PRESETS, DEFAULT_COLORS, lvRank, normColors, isExecTask, execKey, isColor, normColor, colorCss, colorPrint, colorLabel };
}

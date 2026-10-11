/* ===== Schedule templates =====
   Centrally maintained starting points. In production these are firm-admin records (SPEC 5.3);
   here they ship with the app. Durations are typical starting points, not firm standards:
   every one is meant to be adjusted, and the wizard asks for the main phases up front.
   A template task:  { k: key, name, d: days, ms?: true, after?: [keys] | [[key, 'SS'|'FS', lagDays]],
                       lvl?: 'client'|'design'|'internal', exec?: true, phase?: true (adjustable in the wizard),
                       exColor?: color | null (absent = shade light to dark), off?: days after the start
                       (only for activities with no links; absent = on the start date) }
   The same shape is used for the starter templates below, company templates and personal
   templates (stored in the database, see tpl-store.js).
   Pure: no DOM. Node-testable (tests/test-units.js). */

const TPL_W = (n) => n * 7;
const TEMPLATES = [
  {
    id: 'blank', name: 'Blank schedule', category: 'Start from scratch',
    description: 'An empty schedule. Add activities and milestones yourself.',
    scale: 'weeks', tasks: [],
  },
  {
    id: 'dbb', name: 'Design services, design-bid-build', category: 'Architectural design',
    description: 'Programming through construction administration with owner reviews after each design phase, permit, bidding and award.',
    scale: 'months', execOn: true,
    tasks: [
      { k: 'ntp', name: 'Notice to proceed', ms: true, exec: true },
      { k: 'prog', name: 'Programming', d: TPL_W(3), after: ['ntp'], phase: true, exec: true },
      { k: 'sd', name: 'Schematic design', d: TPL_W(6), after: ['prog'], phase: true, exec: true },
      { k: 'sdr', name: 'Owner review: schematic design', d: TPL_W(2), after: ['sd'], phase: true },
      { k: 'sda', name: 'Schematic design approved', ms: true, after: ['sdr'] },
      { k: 'dd', name: 'Design development', d: TPL_W(8), after: ['sda'], phase: true, exec: true },
      { k: 'cons', name: 'Consultant coordination', d: TPL_W(14), after: [['dd', 'SS', 7]], lvl: 'design' },
      { k: 'ddr', name: 'Owner review: design development', d: TPL_W(2), after: ['dd'], phase: true },
      { k: 'dda', name: 'Design development approved', ms: true, after: ['ddr'] },
      { k: 'cd', name: 'Construction documents', d: TPL_W(12), after: ['dda'], phase: true, exec: true },
      { k: 'qa', name: 'Internal QA/QC review', d: TPL_W(1), after: [['cd', 'FS', -7]], lvl: 'internal' },
      { k: 'cdr', name: 'Owner review: construction documents', d: TPL_W(2), after: ['cd'], phase: true },
      { k: 'permit', name: 'Permit set issued', ms: true, after: ['cdr'], exec: true },
      { k: 'pr', name: 'Building permit review', d: TPL_W(6), after: ['permit'], phase: true },
      { k: 'bid', name: 'Bidding and negotiation', d: TPL_W(4), after: ['permit'], phase: true, exec: true },
      { k: 'bdue', name: 'Bids due', ms: true, after: ['bid'] },
      { k: 'award', name: 'Construction contract award', ms: true, after: [['bdue', 'FS', 14], 'pr'], exec: true },
      { k: 'ca', name: 'Construction administration', d: TPL_W(40), after: ['award'], phase: true, exec: true },
      { k: 'sub', name: 'Substantial completion', ms: true, after: ['ca'], exec: true },
    ],
  },
  {
    id: 'ti', name: 'Tenant improvement', category: 'Architectural design',
    description: 'A compressed interiors schedule: test fit, schematic design, construction documents, permit and a short build-out.',
    scale: 'weeks', execOn: true,
    tasks: [
      { k: 'ntp', name: 'Notice to proceed', ms: true, exec: true },
      { k: 'tf', name: 'Programming and test fit', d: TPL_W(2), after: ['ntp'], phase: true, exec: true },
      { k: 'sd', name: 'Schematic design', d: TPL_W(3), after: ['tf'], phase: true, exec: true },
      { k: 'sdr', name: 'Owner review: schematic design', d: TPL_W(1), after: ['sd'], phase: true },
      { k: 'cd', name: 'Construction documents', d: TPL_W(5), after: ['sdr'], phase: true, exec: true },
      { k: 'mep', name: 'MEP engineering', d: TPL_W(4), after: [['cd', 'SS', 3]], lvl: 'design' },
      { k: 'qa', name: 'Internal QA/QC review', d: TPL_W(1), after: [['cd', 'FS', -7]], lvl: 'internal' },
      { k: 'permit', name: 'Permit set issued', ms: true, after: ['cd'], exec: true },
      { k: 'pr', name: 'Permit review', d: TPL_W(4), after: ['permit'], phase: true },
      { k: 'bid', name: 'Pricing and contractor selection', d: TPL_W(3), after: ['permit'], phase: true },
      { k: 'award', name: 'Contractor award', ms: true, after: ['bid', 'pr'], exec: true },
      { k: 'con', name: 'Construction', d: TPL_W(12), after: ['award'], phase: true, exec: true },
      { k: 'sub', name: 'Substantial completion', ms: true, after: ['con'], exec: true },
      { k: 'move', name: 'Owner move-in', ms: true, after: [['sub', 'FS', 14]], exec: true },
    ],
  },
  {
    id: 'fed', name: 'Federal design-bid-build', category: 'Government',
    description: '35, 65, 95 and 100 percent design submittals, each followed by a government review, then ready-to-advertise, solicitation, award and construction.',
    scale: 'months', execOn: true,
    tasks: [
      { k: 'ntp', name: 'Design notice to proceed', ms: true, exec: true },
      { k: 'char', name: 'Design charrette', d: TPL_W(1), after: ['ntp'] },
      { k: 'd35', name: '35% concept design', d: TPL_W(6), after: ['char'], phase: true, exec: true },
      { k: 'r35', name: 'Government review: 35%', d: TPL_W(3), after: ['d35'], phase: true },
      { k: 'c35', name: '35% review conference', ms: true, after: ['r35'] },
      { k: 'd65', name: '65% design', d: TPL_W(8), after: ['c35'], phase: true, exec: true },
      { k: 'r65', name: 'Government review: 65%', d: TPL_W(3), after: ['d65'], phase: true },
      { k: 'd95', name: '95% design', d: TPL_W(8), after: ['r65'], phase: true, exec: true },
      { k: 'qa', name: 'Internal QA/QC review', d: TPL_W(1), after: [['d95', 'FS', -7]], lvl: 'internal' },
      { k: 'r95', name: 'Government review: 95%', d: TPL_W(3), after: ['d95'], phase: true },
      { k: 'bc', name: 'Backcheck and comment resolution', d: TPL_W(2), after: ['r95'], lvl: 'design' },
      { k: 'd100', name: '100% final design', d: TPL_W(3), after: ['bc'], phase: true, exec: true },
      { k: 'rta', name: 'Ready to advertise', ms: true, after: ['d100'], exec: true },
      { k: 'sol', name: 'Solicitation and proposals', d: TPL_W(8), after: ['rta'], phase: true, exec: true },
      { k: 'award', name: 'Construction contract award', ms: true, after: [['sol', 'FS', 30]], exec: true },
      { k: 'con', name: 'Construction', d: TPL_W(52), after: ['award'], phase: true, exec: true },
      { k: 'bod', name: 'Beneficial occupancy', ms: true, after: ['con'], exec: true },
    ],
  },
  {
    id: 'db', name: 'Design-build', category: 'Delivery methods',
    description: 'Design and construction overlap: an early site and foundation package goes to permit and construction while the rest of the documents are finished.',
    scale: 'months', execOn: true,
    tasks: [
      { k: 'ntp', name: 'Notice to proceed', ms: true, exec: true },
      { k: 'con1', name: 'Concept design', d: TPL_W(4), after: ['ntp'], phase: true, exec: true },
      { k: 'gmp', name: 'Pricing and GMP development', d: TPL_W(3), after: ['con1'], phase: true },
      { k: 'gmpa', name: 'GMP approved', ms: true, after: ['gmp'], exec: true },
      { k: 'dd', name: 'Design development', d: TPL_W(6), after: ['gmpa'], phase: true, exec: true },
      { k: 'ep', name: 'Early package: site and foundations', d: TPL_W(4), after: [['dd', 'SS', 14]], phase: true },
      { k: 'epp', name: 'Early package permit', d: TPL_W(4), after: ['ep'], phase: true },
      { k: 'cs', name: 'Construction start', ms: true, after: ['epp'], exec: true },
      { k: 'cd', name: 'Construction documents, remaining packages', d: TPL_W(8), after: ['dd'], phase: true, exec: true },
      { k: 'fp', name: 'Full building permit', d: TPL_W(6), after: ['cd'], phase: true },
      { k: 'con', name: 'Construction', d: TPL_W(44), after: ['cs'], phase: true, exec: true },
      { k: 'sub', name: 'Substantial completion', ms: true, after: ['con', 'fp'], exec: true },
    ],
  },
  {
    id: 'feas', name: 'Programming and feasibility', category: 'Pre-design',
    description: 'Gather needs, write the space program, test options on the site, price them and deliver a report.',
    scale: 'weeks', execOn: true,
    tasks: [
      { k: 'kick', name: 'Kickoff meeting', ms: true, exec: true },
      { k: 'data', name: 'Interviews and data gathering', d: TPL_W(3), after: ['kick'], phase: true, exec: true },
      { k: 'prog', name: 'Draft space program', d: TPL_W(2), after: ['data'], phase: true, exec: true },
      { k: 'pr', name: 'Owner review: program', d: TPL_W(1), after: ['prog'], phase: true },
      { k: 'opt', name: 'Site and massing options', d: TPL_W(3), after: ['pr'], phase: true, exec: true },
      { k: 'cost', name: 'Cost estimate of options', d: TPL_W(2), after: [['opt', 'SS', 7]], lvl: 'design' },
      { k: 'rep', name: 'Feasibility report', d: TPL_W(2), after: ['opt', 'cost'], phase: true, exec: true },
      { k: 'pres', name: 'Presentation to owner', ms: true, after: ['rep'], exec: true },
    ],
  },
  {
    id: 'pursuit', name: 'Proposal and conceptual design', category: 'Pursuits',
    description: 'For a pursuit: proposal, interview, award and agreement, then conceptual design. Mirrors the brand guide’s example schedule.',
    scale: 'months', execOn: true,
    tasks: [
      { k: 'due', name: 'Proposal due', ms: true, exec: true },
      { k: 'int', name: 'Interview', ms: true, after: [['due', 'FS', 21]], exec: true },
      { k: 'aw', name: 'Award announcement', ms: true, after: [['int', 'FS', 14]], exec: true },
      { k: 'neg', name: 'Negotiations and agreement', d: TPL_W(4), after: ['aw'], phase: true, exec: true },
      { k: 'sd', name: 'Schematic design', d: TPL_W(8), after: ['neg'], phase: true, exec: true },
      { k: 'ent', name: 'Entitlements and incentives', d: TPL_W(16), after: [['sd', 'SS', 14]], lvl: 'design' },
      { k: 'dd', name: 'Design development', d: TPL_W(10), after: ['sd'], phase: true, exec: true },
      { k: 'cd', name: 'Construction documents', d: TPL_W(14), after: ['dd'], phase: true, exec: true },
      { k: 'bid', name: 'Permit and bidding', d: TPL_W(8), after: ['cd'], phase: true, exec: true },
      { k: 'con', name: 'Construction', d: TPL_W(52), after: ['bid'], phase: true, exec: true },
      { k: 'done', name: 'Project complete', ms: true, after: ['con'], exec: true },
    ],
  },
  {
    id: 'ca', name: 'Construction administration', category: 'Construction',
    description: 'For a project already in construction: preconstruction, submittals, site observation, punch list and closeout.',
    scale: 'months', execOn: true,
    tasks: [
      { k: 'pre', name: 'Preconstruction meeting', ms: true, exec: true },
      { k: 'sub', name: 'Submittal review', d: TPL_W(10), after: [['pre', 'FS', 7]], phase: true, exec: true },
      { k: 'obs', name: 'Construction observation and RFIs', d: TPL_W(40), after: ['pre'], phase: true, exec: true },
      { k: 'sc', name: 'Substantial completion inspection', ms: true, after: ['obs'], exec: true },
      { k: 'punch', name: 'Punch list', d: TPL_W(3), after: ['sc'], phase: true },
      { k: 'fc', name: 'Final completion', ms: true, after: ['punch'], exec: true },
      { k: 'close', name: 'Closeout documents', d: TPL_W(4), after: ['fc'], phase: true },
    ],
  },
];

const tplById = (id) => TEMPLATES.find((t) => t.id === id) || null;
/* the phases the wizard lets people adjust, in weeks */
const tplPhases = (tpl) => (tpl ? tpl.tasks.filter((t) => t.phase && !t.ms).map((t) => ({ k: t.k, name: t.name, weeks: Math.max(1, Math.round(t.d / 7)), days: t.d })) : []);

/* Phases are given in weeks and run Monday to Friday: a whole-week phase lasts 7 x weeks - 2
   calendar days, so it ends on a Friday and the next one starts on Monday. Durations stay in
   calendar days (the engine is unchanged); this is only how the starting point is laid out. */
/* Make the tasks for a new schedule.
   opts: { start: day number (epoch days), weeks: { key: whole weeks }, newId: () => string,
           schedule, cal: the engine's schedule() and a calendar, used to land every start on a working day }
   The first task is anchored on the start date; everything else follows links, so the engine
   computes every other date. */
function instantiateTemplate(tpl, opts) {
  opts = opts || {};
  const mkId = opts.newId || (() => 't' + Math.random().toString(36).slice(2, 9));
  const ids = new Map(tpl.tasks.map((t) => [t.k, opts.keepIds ? t.k : mkId()])); // keepIds: editing the template itself
  const start = Number.isFinite(opts.start) ? opts.start : 0;
  let shade = 0;
  const weekly = new Map(); // whole-week phases: they end on the last working day of their last week
  const tasks = tpl.tasks.map((t) => {
    const wk = opts.weeks && Number.isFinite(+opts.weeks[t.k]) ? Math.max(1, Math.round(+opts.weeks[t.k])) : null;
    const days = t.ms ? 0 : Math.max(1, wk != null ? wk * 7 : t.d || 7);
    if (!t.ms && days % 7 === 0) weekly.set(ids.get(t.k), days / 7);
    const dur = days;
    const deps = (t.after || []).map((a) => {
      const [k, type, lag] = Array.isArray(a) ? a : [a, 'FS', 0];
      return { id: ids.get(k), type: type === 'SS' ? 'SS' : 'FS', lag: Math.round(+lag || 0) };
    }).filter((d) => d.id);
    const exec = !!t.exec && (t.lvl || 'client') === 'client';
    const exColor = t.exColor !== undefined ? (exec ? t.exColor || null : null) : exec && !t.ms ? PHASE_SHADES_TPL[Math.min(PHASE_SHADES_TPL.length - 1, shade++)] : null;
    const off = !deps.length && Number.isFinite(+t.off) ? Math.round(+t.off) : 0;
    return {
      id: ids.get(t.k), name: t.name, kind: t.ms ? 'milestone' : 'task', duration: dur,
      start: isoOfDay(start + off), locked: false, notBefore: null,
      deps, ignore: [], lvl: t.lvl || 'client', exec, exColor, commit: null,
    };
  });
  if (opts.schedule && opts.cal) snapToWorkdays(tasks, opts.schedule, opts.cal, weekly);
  return tasks;
}
/* Nudge link lags so no activity starts on a non-working day, and a milestone that follows a
   phase lands on that phase's last day. Runs once, when the schedule is made: after that the
   lags are ordinary data the team can change. */
function snapToWorkdays(tasks, schedule, cal, weekly) {
  weekly = weekly || new Map();
  for (let pass = 0; pass < tasks.length * 4 + 5; pass++) {
    const res = schedule(tasks, cal);
    let changed = false;
    for (const t of tasks) {
      const r = res.get(t.id);
      if (!r || r.cycle) continue;
      if (weekly.has(t.id)) { // N weeks from its start, ending on the last working day before the same weekday
        let fin = r.start + weekly.get(t.id) * 7 - 1;
        while (cal.reason(fin) && fin > r.start) fin--;
        const want = Math.max(1, fin - r.start + 1);
        if (t.duration !== want) { t.duration = want; changed = true; break; }
      }
      if (r.anchored) continue;
      const d = t.deps.find((x) => x.id === r.drivenBy);
      if (!d) continue;
      const pr = res.get(d.id);
      // work that follows a milestone marking the end of something starts the next working day
      if (t.kind !== 'milestone' && pr && pr.kind === 'milestone' && !pr.anchored && d.type === 'FS' && r.start <= pr.start) {
        d.lag += cal.next(pr.start + 1) - r.start; changed = true; break;
      }
      if (!cal.reason(r.start)) continue;
      if (t.kind === 'milestone' && d.type === 'FS' && pr && pr.kind !== 'milestone' && !cal.reason(pr.finish) && pr.finish < r.start) d.lag += pr.finish - r.start;
      else d.lag += cal.next(r.start) - r.start;
      changed = true;
      break;
    }
    if (!changed) return;
  }
}
/* A schedule (or the template editor's working copy) back to the template shape.
   tasks: engine tasks; res: schedule(tasks, cal); phases: Set of ids the wizard asks about
   (absent: client-level activities marked Exec, a sensible default for a saved schedule).
   Dates become offsets: activities with no links keep their distance from the earliest one.
   Locked dates, holds, commitments, issues dismissed and baselines are not part of a template:
   a locked date is unlocked (it follows its links, or keeps its offset if it has none). */
function scheduleToTemplate(tasks, res, phases) {
  const valid = new Set(tasks.map((t) => t.id));
  const roots = tasks.filter((t) => !(t.deps || []).some((d) => valid.has(d.id)));
  const startOf = (t) => { const r = res && res.get(t.id); return r ? r.start : NaN; };
  const t0 = Math.min(...roots.map(startOf).filter(Number.isFinite));
  return tasks.map((t) => {
    const ms = t.kind === 'milestone';
    const deps = (t.deps || []).filter((d) => valid.has(d.id) && d.id !== t.id);
    const o = { k: t.id, name: String(t.name || '') };
    if (ms) o.ms = true; else o.d = Math.max(1, Math.round(+t.duration || 1));
    if (deps.length) o.after = deps.map((d) => (d.type === 'SS' || d.lag ? [d.id, d.type === 'SS' ? 'SS' : 'FS', Math.round(+d.lag || 0)] : d.id));
    else if (Number.isFinite(t0)) { const off = startOf(t) - t0; if (off) o.off = off; }
    if (t.lvl && t.lvl !== 'client') o.lvl = t.lvl;
    if (t.exec) { o.exec = true; o.exColor = t.exColor || null; }
    const ph = phases ? phases.has(t.id) : !!t.exec && (t.lvl || 'client') === 'client';
    if (ph && !ms) o.phase = true;
    return o;
  });
}
/* the template's length from a start date, for lists and cards */
function tplSpan(tpl, schedule, cal) {
  const tasks = instantiateTemplate(tpl, { start: 0, keepIds: true });
  if (!tasks.length) return null;
  const res = schedule(tasks, cal);
  const rs = [...res.values()];
  const lo = Math.min(...rs.map((r) => r.start)), hi = Math.max(...rs.map((r) => (r.kind === 'milestone' ? r.start : r.finish)));
  return { days: hi - lo + 1, tasks, res, lo, hi };
}
/* light to dark through the project, as on page 11 of the brand guide */
const PHASE_SHADES_TPL = ['nexus-t20', 'nexus-t40', 'nexus-t70', 'nexus', 'nexus-d20', 'nexus-d40', 'nexus-d60'];
function isoOfDay(n) {
  const d = new Date(n * 86400000);
  const p = (x) => (x < 10 ? '0' : '') + x;
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

if (typeof module !== 'undefined' && module.exports) module.exports = { TEMPLATES, tplById, tplPhases, instantiateTemplate, snapToWorkdays, scheduleToTemplate, tplSpan };

/* ===== Change impact: what an edit did to the rest of the schedule =====
   Compares the engine's results before and after one edit. Pure: no DOM, Node-testable
   (tests/test-units.js). The editor shows the result as a short card with Undo, and a
   before-and-after table on request. Nothing here changes dates. */

/* what we keep about each task before an edit */
function impactSnap(tasks, res, warnDays) {
  const m = new Map();
  tasks.forEach((t, i) => {
    const r = res.get(t.id);
    if (!r) return;
    m.set(t.id, {
      row: i + 1, name: t.name || 'Untitled', kind: r.kind, start: r.start, finish: r.finish, end: r.end, dur: r.dur,
      flags: r.flags.map((f) => f.code + ':' + f.level), flagText: r.flags.map((f) => ({ code: f.code, level: f.level, text: f.text })),
      commit: typeof commitStatus === 'function' ? commitStatus(t, r, warnDays) : null,
      t: { duration: t.duration, start: t.start, notBefore: t.notBefore, locked: !!t.locked, kind: t.kind, deps: JSON.stringify(t.deps || []) },
    });
  });
  return m;
}
const projectEnd = (snap) => { let e = null; for (const v of snap.values()) { const f = v.kind === 'milestone' ? v.start : v.finish; if (e === null || f > e) e = f; } return e; };

/* before, after: impactSnap maps. edited: ids the person touched directly. */
function computeImpact(before, after, edited) {
  const ed = new Set(edited || []);
  const moved = [], changed = [], newIssues = [], commits = [];
  let resolved = 0;
  for (const [id, a] of after) {
    const b = before.get(id);
    if (!b) continue;
    const dS = a.start - b.start, dF = (a.kind === 'milestone' ? a.start : a.finish) - (b.kind === 'milestone' ? b.start : b.finish);
    const row = { id, row: a.row, name: a.name, kind: a.kind, oldStart: b.start, newStart: a.start, oldFinish: b.kind === 'milestone' ? b.start : b.finish, newFinish: a.kind === 'milestone' ? a.start : a.finish, dStart: dS, dFinish: dF, oldDur: b.dur, newDur: a.dur };
    if (ed.has(id)) { if (dS || dF || a.dur !== b.dur) changed.push(row); }
    else if (dS || dF) moved.push(row);
    const bf = new Set(b.flags);
    for (const f of a.flagText) if (!bf.has(f.code + ':' + f.level)) newIssues.push({ id, row: a.row, name: a.name, level: f.level, text: f.text });
    const af = new Set(a.flags);
    for (const f of b.flags) if (!af.has(f)) resolved++;
    const bc = b.commit, ac = a.commit;
    if (ac && (!bc || bc.status !== ac.status || bc.margin !== ac.margin)) commits.push({ id, row: a.row, name: a.name, before: bc, after: ac });
  }
  const e0 = projectEnd(before), e1 = projectEnd(after);
  const latest = moved.reduce((m, x) => Math.max(m, Math.abs(x.dFinish), Math.abs(x.dStart)), 0);
  const later = moved.filter((x) => x.dStart > 0 || x.dFinish > 0).length, earlier = moved.length - later;
  const worse = commits.filter((c) => c.after.status === 'late' || c.after.status === 'risk');
  return {
    changed, moved, newIssues, resolved, commits,
    finish: e0 !== null && e1 !== null && e0 !== e1 ? { from: e0, to: e1, d: e1 - e0 } : null,
    later, earlier, maxShift: latest,
    severity: worse.some((c) => c.after.status === 'late') || newIssues.some((i) => i.level === 'error') ? 'crit' : worse.length || newIssues.length ? 'warn' : 'info',
    quiet: !moved.length && !newIssues.length && !commits.length,
  };
}
const dayWord = (n) => Math.abs(n) + (Math.abs(n) === 1 ? ' day' : ' days');
const durWord = (d) => (d % 7 === 0 && d >= 14 ? (d / 7) + ' weeks' : d + (d === 1 ? ' day' : ' days'));
/* one unit for both sides: weeks only when both are whole weeks */
const durPair = (a, b) => (a % 7 === 0 && b % 7 === 0 && a >= 7 && b >= 7 ? (a / 7) + ' → ' + (b / 7) + ' weeks' : a + ' → ' + b + ' days');
/* plain sentences for the card; fmt turns a day number into a short date */
function impactLines(imp, fmt) {
  const out = [];
  for (const c of imp.changed.slice(0, 2)) {
    if (c.oldDur !== c.newDur && c.kind !== 'milestone') out.push({ text: c.name + ': ' + durPair(c.oldDur, c.newDur) + '.' });
    else if (c.dStart) out.push({ text: c.name + ' moved ' + (c.dStart > 0 ? 'later' : 'earlier') + ' by ' + dayWord(c.dStart) + ' (' + fmt(c.newStart) + ').' });
    else if (c.dFinish) out.push({ text: c.name + ' now finishes ' + fmt(c.newFinish) + '.' });
  }
  if (imp.moved.length) {
    const n = imp.moved.length;
    const dir = imp.later && !imp.earlier ? 'later' : imp.earlier && !imp.later ? 'earlier' : null;
    out.push({ text: n + ' linked ' + (n === 1 ? 'activity' : 'activities') + ' moved to follow' + (dir ? ' (' + dir + ', up to ' + dayWord(imp.maxShift) + ')' : '') + '.' });
  }
  if (imp.finish) out.push({ text: 'Last date in the schedule: ' + fmt(imp.finish.from) + ' → ' + fmt(imp.finish.to) + ' (' + (imp.finish.d > 0 ? '+' : '−') + dayWord(imp.finish.d) + ').' });
  for (const c of imp.commits.slice(0, 3)) {
    const a = c.after;
    if (a.status === 'late') out.push({ cls: 'c', text: 'Commitment “' + c.name + '” is now forecast ' + dayWord(a.margin) + ' late.' });
    else if (a.status === 'risk') out.push({ cls: 'w', text: 'Commitment “' + c.name + '” is at risk: ' + (a.margin ? dayWord(a.margin) + ' of margin left.' : 'no margin left.') });
    else if (c.before && (c.before.status === 'late' || c.before.status === 'risk')) out.push({ text: 'Commitment “' + c.name + '” is back on track (' + (a.margin ? dayWord(a.margin) + ' early' : 'on the date') + ').' });
  }
  const errs = imp.newIssues.filter((i) => i.level === 'error'), warns = imp.newIssues.filter((i) => i.level !== 'error');
  for (const i of errs.slice(0, 2)) out.push({ cls: 'c', text: 'New conflict on “' + i.name + '”: ' + i.text + '.' });
  if (errs.length > 2) out.push({ cls: 'c', text: (errs.length - 2) + ' more new conflicts. See Issues.' });
  if (warns.length === 1) out.push({ cls: 'w', text: '“' + warns[0].name + '”: ' + warns[0].text.charAt(0).toLowerCase() + warns[0].text.slice(1) + '.' });
  else if (warns.length) out.push({ cls: 'w', text: warns.length + ' new warnings, such as a start or finish on a non-working day. See Issues.' });
  return out;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { impactSnap, computeImpact, impactLines };

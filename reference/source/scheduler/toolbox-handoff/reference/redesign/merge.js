/* ===== Three-way merge of two edited copies of one schedule (pure, no DOM) =====
   base   = the version I loaded (or last saved)
   mine   = what is on my screen now
   theirs = the latest saved version, which someone else saved after my base
   All three are normalized working copies (see docToWork). Tasks are matched by id and merged field by field.
   Dates the engine computes (a task that follows predecessors and is not locked) are NOT inputs and are never compared;
   the caller recalculates after merging.
   choices: { [conflict key]: 'mine' | 'theirs' }. A conflict with no choice keeps THEIRS, so nothing already saved is lost silently. */

const jeq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const jclone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const isDerived = (t) => !!(t && t.deps && t.deps.length && !t.locked);
const startInput = (t) => (isDerived(t) ? null : t.start);
const depKey = (d) => (d ? d.type + ':' + (d.lag || 0) : null);
const depText = (d) => (d ? (d.type === 'SS' ? 'start-to-start' : 'finish-to-start') + (d.lag ? ' ' + (d.lag > 0 ? '+' : '') + d.lag + 'd' : '') : 'no link');
const FIELD_LABEL = { name: 'name', kind: 'type', duration: 'duration', locked: 'lock', notBefore: 'hold date', lvl: 'audience', exec: 'executive flag', exColor: 'executive color', start: 'start date', commit: 'commitment' };

/* one value, three versions */
function pick3(b, m, t) {
  if (jeq(m, t)) return { v: m };
  if (jeq(m, b)) return { v: t };
  if (jeq(t, b)) return { v: m };
  return { v: t, conflict: true };
}
/* the part of a task a person actually sets */
function taskSig(t) {
  if (!t) return '';
  const deps = (t.deps || []).map((d) => d.id + ':' + depKey(d)).sort();
  return JSON.stringify([t.name, t.kind, t.duration, t.locked, t.notBefore, t.lvl, t.exec, t.exColor, deps, (t.ignore || []).slice().sort(), startInput(t), t.commit || null]);
}

function merge3(base, mine, theirs, choices) {
  choices = choices || {};
  const conflicts = [];
  const take = (key, label, b, m, t, show) => {
    const r = pick3(b, m, t);
    if (!r.conflict) return r.v;
    conflicts.push({ key, label, mine: show ? show(m) : String(m), theirs: show ? show(t) : String(t) });
    return choices[key] === 'mine' ? m : t;
  };
  const mapOf = (w) => new Map(((w && w.tasks) || []).map((t) => [t.id, t]));
  const B = mapOf(base), M = mapOf(mine), T = mapOf(theirs);
  const rowOf = (id) => {
    let i = (mine.tasks || []).findIndex((t) => t.id === id);
    if (i < 0) i = (theirs.tasks || []).findIndex((t) => t.id === id);
    return i < 0 ? '' : '#' + (i + 1) + ' ';
  };
  const nameOf = (id) => { const t = M.get(id) || T.get(id) || B.get(id); return t ? (t.name || 'Untitled') : 'Untitled'; };
  const tl = (id) => 'Task ' + rowOf(id) + '“' + nameOf(id) + '”';

  // ---- which tasks survive
  const ids = new Set([...B.keys(), ...M.keys(), ...T.keys()]);
  const kept = new Map(); // id -> merged task
  for (const id of ids) {
    const b = B.get(id), m = M.get(id), t = T.get(id);
    if (!m && !t) continue; // gone on both sides
    if (m && !t) {
      if (!b) { kept.set(id, jclone(m)); continue; } // I added it
      if (taskSig(m) === taskSig(b)) continue; // they deleted it, I never touched it
      const pick = take('task:' + id + ':delete', tl(id) + ' was deleted by someone else, and you changed it', 'x', 'edit', 'del', (v) => (v === 'del' ? 'Delete the task' : 'Keep it with your changes'));
      if (pick === 'edit') kept.set(id, jclone(m));
      continue;
    }
    if (!m && t) {
      if (!b) { kept.set(id, jclone(t)); continue; } // they added it
      if (taskSig(t) === taskSig(b)) continue; // I deleted it, they never touched it
      const pick = take('task:' + id + ':delete', tl(id) + ' was deleted by you, and someone else changed it', 'x', 'del', 'edit', (v) => (v === 'del' ? 'Delete the task' : 'Keep it with their changes'));
      if (pick === 'edit') kept.set(id, jclone(t));
      continue;
    }
    // in both: merge field by field
    const bb = b || {};
    const out = { id };
    for (const f of ['name', 'kind', 'duration', 'locked', 'notBefore', 'lvl', 'exec', 'exColor', 'commit']) {
      out[f] = take('task:' + id + ':' + f, tl(id) + ', ' + FIELD_LABEL[f], bb[f] === undefined ? null : bb[f], m[f] === undefined ? null : m[f], t[f] === undefined ? null : t[f],
        (v) => (v === null || v === undefined || v === '' ? 'none' : typeof v === 'object' ? (v.date || '') + (v.note ? ' (' + v.note + ')' : '') : String(v)));
    }
    // links, one predecessor at a time
    const bd = new Map((bb.deps || []).map((d) => [d.id, d])), md = new Map((m.deps || []).map((d) => [d.id, d])), td = new Map((t.deps || []).map((d) => [d.id, d]));
    const dids = [...new Set([...md.keys(), ...td.keys(), ...bd.keys()])];
    out.deps = [];
    for (const did of dids) {
      const v = take('task:' + id + ':dep:' + did, tl(id) + ', link from “' + nameOf(did) + '”', bd.get(did) || null, md.get(did) || null, td.get(did) || null, depText);
      if (v) out.deps.push(jclone(v));
    }
    // dismissed issue codes: add and remove independently
    const bi = new Set(bb.ignore || []), mi = new Set(m.ignore || []), ti = new Set(t.ignore || []);
    out.ignore = [...new Set([...mi, ...ti, ...bi])].filter((c) => pick3(bi.has(c), mi.has(c), ti.has(c)).v);
    // start only matters when the merged task is not driven by predecessors
    if (isDerived(out)) out.start = t.start;
    else {
      const sb = startInput(bb), sm = startInput(m), st = startInput(t);
      const r = pick3(sb, sm, st);
      if (r.conflict && (sm === null || st === null)) out.start = sm !== null ? sm : st; // one side is computed, not set by a person
      else out.start = take('task:' + id + ':start', tl(id) + ', ' + FIELD_LABEL.start, sb, sm, st, (v) => (v === null ? 'follows its links' : String(v)));
      if (out.start === null || out.start === undefined) out.start = m.start || t.start;
    }
    if (out.kind === 'milestone') out.duration = 0; else out.duration = Math.max(1, Math.round(+out.duration || 1));
    kept.set(id, out);
  }
  // links to tasks that no longer exist are dropped
  for (const t of kept.values()) t.deps = t.deps.filter((d) => d.id !== t.id && kept.has(d.id));

  // ---- row order: start from the order of whoever reordered; if both did, theirs wins
  const relOrder = (w) => (w.tasks || []).map((t) => t.id).filter((id) => B.has(id));
  const reordered = (w) => { const mine0 = relOrder(w), b0 = (base.tasks || []).map((t) => t.id).filter((id) => w.tasks.some((x) => x.id === id)); return !jeq(mine0, b0); };
  const mineMoved = reordered(mine), theirsMoved = reordered(theirs);
  const skelIsMine = mineMoved && !theirsMoved;
  const skelList = (skelIsMine ? mine : theirs).tasks.map((t) => t.id);
  const otherList = (skelIsMine ? theirs : mine).tasks.map((t) => t.id);
  const order = skelList.filter((id) => kept.has(id));
  const seen = new Set(order);
  otherList.forEach((id, i) => {
    if (!kept.has(id) || seen.has(id)) return;
    let at = -1;
    for (let j = i - 1; j >= 0 && at < 0; j--) { const k = order.indexOf(otherList[j]); if (k >= 0) at = k + 1; }
    if (at < 0) { for (let j = i + 1; j < otherList.length && at < 0; j++) { const k = order.indexOf(otherList[j]); if (k >= 0) at = k; } }
    if (at < 0) at = order.length;
    order.splice(at, 0, id);
    seen.add(id);
  });
  for (const id of kept.keys()) if (!seen.has(id)) order.push(id); // safety net

  // ---- everything that is not a task
  const merged = { tasks: order.map((id) => kept.get(id)) };
  for (const f of ['name', 'scale', 'execOn', 'execColor', 'baselineOn', 'hset', 'commitWarn']) merged[f] = take('set:' + f, 'Project setting: ' + f, base[f], mine[f], theirs[f], (v) => String(v));
  merged.offDays = take('set:offDays', 'Project setting: working days', base.offDays, mine.offDays, theirs.offDays, (v) => (v || []).join(', '));
  merged.info = {};
  for (const k of ['number', 'client', 'issue']) merged.info[k] = take('set:info:' + k, 'Project details: ' + k, (base.info || {})[k], (mine.info || {})[k], (theirs.info || {})[k], (v) => (v ? String(v) : 'blank'));
  merged.colors = {};
  for (const k of ['client', 'design', 'internal']) merged.colors[k] = take('set:colors:' + k, 'Audience color: ' + k, (base.colors || {})[k], (mine.colors || {})[k], (theirs.colors || {})[k]);
  const bc = new Set(base.customColors || []), mc = new Set(mine.customColors || []), tc = new Set(theirs.customColors || []);
  merged.customColors = [...new Set([...mc, ...tc])].filter((c) => pick3(bc.has(c), mc.has(c), tc.has(c)).v).slice(0, 16);
  // holidays, date by date
  const hb = new Map((base.holidays || []).map((h) => [h.date, h.name])), hm = new Map((mine.holidays || []).map((h) => [h.date, h.name])), ht = new Map((theirs.holidays || []).map((h) => [h.date, h.name]));
  merged.holidays = [];
  for (const d of [...new Set([...hm.keys(), ...ht.keys(), ...hb.keys()])].sort()) {
    const v = take('hol:' + d, 'Holiday on ' + d, hb.has(d) ? hb.get(d) : null, hm.has(d) ? hm.get(d) : null, ht.has(d) ? ht.get(d) : null, (x) => (x === null ? 'not a holiday' : x || 'holiday'));
    if (v !== null && v !== undefined) merged.holidays.push({ date: d, name: v });
  }
  merged.holShared = !!(mine.holShared && theirs.holShared);
  merged.baseline = take('set:baseline', 'Baseline', base.baseline || null, mine.baseline || null, theirs.baseline || null, (v) => (v ? 'baseline set ' + (v.at ? new Date(v.at).toLocaleDateString() : '') : 'no baseline'));
  merged.exportDefaults = {};
  for (const k of ['executive', 'client', 'design', 'internal']) {
    const v = take('set:export:' + k, 'Shared export settings: ' + k, (base.exportDefaults || {})[k] || null, (mine.exportDefaults || {})[k] || null, (theirs.exportDefaults || {})[k] || null, (x) => (x ? 'shared settings' : 'none'));
    if (v) merged.exportDefaults[k] = v;
  }

  // ---- what their save changed, for the "merged" message
  let added = 0, removed = 0, changed = 0;
  for (const [id, t] of T) { const b = B.get(id); if (!b) added++; else if (taskSig(t) !== taskSig(b)) changed++; }
  for (const id of B.keys()) if (!T.has(id)) removed++;
  return { merged, conflicts, stats: { added, removed, changed, mineMoved, theirsMoved } };
}

/* a short sentence for the toast after a merge */
function mergeSummary(stats, who) {
  const bits = [];
  if (stats.changed) bits.push(stats.changed + ' task' + (stats.changed === 1 ? '' : 's') + ' changed');
  if (stats.added) bits.push(stats.added + ' added');
  if (stats.removed) bits.push(stats.removed + ' removed');
  return 'Merged ' + who + '’s changes' + (bits.length ? ' (' + bits.join(', ') + ')' : '') + ' with yours.';
}

if (typeof module !== 'undefined' && module.exports) module.exports = { merge3, mergeSummary, taskSig, pick3 };

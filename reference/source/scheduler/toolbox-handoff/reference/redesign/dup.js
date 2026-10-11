/* ===== Duplicating a schedule (SPEC 5.4) =====
   Pure: builds the new schedule document from the source. No DOM, Node-testable.
   - Every date moves by the same number of calendar days (delta), so links, lags, locks
     and holds keep their meaning. delta 0 keeps the dates exactly.
   - Version history, baseline data and the primary flag are not copied.
   - Commitments are copied only within the same project, and never shifted: they are real
     dates promised to that project's client, not part of a reusable schedule.
   - Project details come from the destination project. */
function shiftISO(iso, delta) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + delta * 86400000);
  const p = (x) => (x < 10 ? '0' : '') + x;
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}
function duplicateDoc(src, opts) {
  opts = opts || {};
  const delta = Math.round(+opts.delta || 0);
  const sameProject = (src.projectId || null) === (opts.projectId || null);
  const out = JSON.parse(JSON.stringify(src));
  for (const k of ['id', 'sid', 'updatedBy', 'updatedAt', 'createdBy', 'createdAt', 'history']) delete out[k];
  out.name = opts.name || ('Copy of ' + (src.name || 'schedule'));
  out.projectId = opts.projectId || null;
  out.baseline = null;
  out.tasks = (src.tasks || []).map((t) => {
    const n = Object.assign({}, t);
    n.start = shiftISO(t.start, delta);
    if (t.notBefore) n.notBefore = shiftISO(t.notBefore, delta);
    n.commit = t.commit && sameProject ? Object.assign({}, t.commit) : null; // a promised date is a real date: never shifted
    return n;
  });
  if (opts.info) out.info = Object.assign({}, src.info || {}, opts.info);
  return out;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { duplicateDoc, shiftISO };

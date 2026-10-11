/* ===== Commitments: dates the team has promised =====
   A commitment is optional metadata on an activity or milestone: { date: 'YYYY-MM-DD', note: '' }.
   It never moves the schedule. The engine still forecasts every date; the commitment is only
   compared with that forecast, so there is one source of truth for dates and no duplicate tasks.
     forecast = the finish date (a milestone's date)
     margin   = commitment date - forecast, in calendar days (positive = room to spare)
   Status, using one explicit threshold the schedule owner sets (commitWarn, default 0 = off):
     late   margin < 0                       the forecast misses the commitment
     risk   0 <= margin < commitWarn          meets it, with less margin than the team asked for
     on     margin == 0 (and not risk)        forecast lands exactly on the date
     early  margin > 0 (and not risk)         forecast is ahead of the date
   Nothing is guessed: with commitWarn = 0 a commitment is never called "at risk".
   Pure: no DOM. Node-testable (tests/test-units.js). */

const COMMIT_NOTE_MAX = 80;
function normCommit(c) {
  if (!c || typeof c !== 'object') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.date || '');
  if (!m) return null;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (dt.getUTCFullYear() !== +m[1] || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) return null;
  return { date: c.date, note: String(c.note || '').replace(/\s+/g, ' ').trim().slice(0, COMMIT_NOTE_MAX) };
}
const normCommitWarn = (v) => { const n = Math.round(+v); return Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 0; };
const commitDay = (c) => Math.round(Date.UTC(+c.date.slice(0, 4), +c.date.slice(5, 7) - 1, +c.date.slice(8, 10)) / 86400000);
/* r: the engine's result for the task */
function commitStatus(t, r, warnDays) {
  const c = normCommit(t && t.commit);
  if (!c || !r) return null;
  const forecast = r.kind === 'milestone' ? r.start : r.finish;
  const margin = commitDay(c) - forecast;
  const warn = normCommitWarn(warnDays);
  const status = margin < 0 ? 'late' : margin < warn ? 'risk' : margin === 0 ? 'on' : 'early';
  return { status, margin, forecast, date: c.date, note: c.note };
}
const COMMIT_WORD = { late: 'Forecast late', risk: 'At risk', on: 'On target', early: 'Forecast early' };
function commitText(st) {
  if (!st) return '';
  const n = Math.abs(st.margin), d = n === 1 ? ' day' : ' days';
  if (st.status === 'late') return n + d + ' late';
  if (st.status === 'risk') return st.margin === 0 ? 'No margin' : n + d + ' margin';
  if (st.status === 'on') return 'On the date';
  return n + d + ' early';
}
/* every commitment in the schedule, worst first */
function commitSummary(tasks, res, warnDays) {
  const out = [];
  tasks.forEach((t, i) => { const st = commitStatus(t, res.get(t.id), warnDays); if (st) out.push(Object.assign({ id: t.id, row: i + 1, name: t.name || 'Untitled' }, st)); });
  const rank = { late: 0, risk: 1, on: 2, early: 3 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || a.margin - b.margin);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { normCommit, normCommitWarn, commitStatus, commitText, commitSummary, COMMIT_WORD };

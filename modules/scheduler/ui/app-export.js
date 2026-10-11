/* ===== Exports: CSV, Excel, PNG, PDF ===== */
const LIBS = {
  xlsx: { url: '/shared/vendor/xlsx.full.min.js', get: () => window.XLSX },
  pdf: { url: '/shared/vendor/jspdf.umd.min.js', get: () => window.jspdf },
  zip: { url: '/shared/vendor/jszip.min.js', get: () => window.JSZip },
};
const libCache = {};
function loadLib(k) {
  if (LIBS[k].get()) return Promise.resolve(LIBS[k].get());
  if (!libCache[k]) {
    libCache[k] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = LIBS[k].url;
      s.onload = () => (LIBS[k].get() ? res(LIBS[k].get()) : rej(new Error('missing')));
      s.onerror = () => { delete libCache[k]; rej(new Error('blocked')); };
      document.head.append(s);
    });
  }
  return libCache[k];
}
// An export type is an audience level (each includes its own level and everything below it),
// plus the optional executive summary: client-level tasks that are checked Exec.
const xTypes = () => (S.work && S.work.execOn ? ['executive'].concat(LEVELS) : LEVELS.slice());
const xRank = (type) => (type === 'executive' ? 0 : Math.max(0, LEVELS.indexOf(type)));
const typeLabel = (type) => (type === 'executive' ? 'Executive summary' : LEVEL_INFO[type].label);
function stemName() {
  return (S.work.name || 'schedule').replace(/[^\w\- ]+/g, '').replace(/\s+/g, ' ').trim() || 'schedule';
}
function fileName(type, ext) { return stemName() + ' - ' + typeLabel(type) + ' - ' + fmtISO(todayDay()) + '.' + ext; }
const exportTasks = (type) => (type === 'executive' ? S.work.tasks.filter(isExecTask) : S.work.tasks.filter((t) => lvRank(t) <= xRank(type)));
async function saveFile(filename, data) {
  if (!S.dl) { toast('Downloading files isn’t available in this view.'); return; }
  try {
    const r = await S.dl.save({ filename, data });
    if (r && r.status === 'saved') toast('Saved ' + filename + '.');
  } catch (e) {
    if (e && e.code === 'declined') return;
    toast('Could not save the file' + (e && e.code === 'too_large' ? ' (too large).' : '.'));
  }
}
/* the task table for one export type. Hidden tasks are removed (not just hidden), rows renumbered, links to hidden tasks dropped. */
function tableData(type, O) {
  const rank = xRank(type), tasks = exportTasks(type), full = type === 'internal';
  // baseline columns only when the project has it on AND this export keeps it; an export can never add it on its own
  const withBase = baseActive() && !!(O && O.baseline);
  const head = ['#', 'Activity', 'Type', 'Start', 'Days', 'Finish', 'Predecessors'].concat(withBase ? ['Baseline start', 'Baseline finish', 'Slip (days)'] : [], full ? ['Audience', 'Locked', 'Held', 'Issues'] : []);
  const dateCols = withBase ? [3, 5, 7, 8] : [3, 5];
  const rows = tasks.map((t, i) => {
    const r = S.res.get(t.id);
    const row = [i + 1, t.name, t.kind === 'milestone' ? 'Milestone' : 'Activity', r.start, r.kind === 'milestone' ? 0 : r.dur, r.finish, formatPreds(t, tasks)];
    if (withBase) { const b = baseRow(t.id), n = slipOf(t.id); row.push(b ? b.start : '', b ? (b.kind === 'milestone' ? b.start : b.finish) : '', n == null ? 'new' : n); }
    return full ? row.concat([LEVEL_INFO[t.lvl || 'client'].label, t.locked ? 'Yes' : '', r.held ? 'Yes' : '', r.flags.map((f) => f.text).join('; ')]) : row;
  });
  return { head, rows, dateCols };
}
function buildCSV(type, O) {
  const q = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const { head, rows, dateCols } = tableData(type, O);
  const lines = [head.join(',')];
  for (const r of rows) lines.push(r.map((v, c) => q(dateCols.includes(c) && v !== '' ? fmtISO(v) : v)).join(','));
  return '\uFEFF' + lines.join('\r\n');
}
async function buildXLSX(type, O) {
  const X = await loadLib('xlsx');
  const { head, rows, dateCols } = tableData(type, O);
  const aoa = [head].concat(rows.map((r) => r.map((v, c) => (dateCols.includes(c) && v !== '' ? v + 25569 : v))));
  const ws = X.utils.aoa_to_sheet(aoa);
  for (let i = 1; i <= rows.length; i++) for (const c of dateCols) { const cell = ws[X.utils.encode_cell({ r: i, c })]; if (cell) cell.z = 'ddd mmm d, yyyy'; }
  const W = { '#': 4, Task: 38, Type: 11, Start: 16, Days: 6, Finish: 16, Predecessors: 16, 'Baseline start': 16, 'Baseline finish': 16, 'Slip (days)': 11, Audience: 12, Locked: 7, Held: 6, Issues: 50 };
  ws['!cols'] = head.map((h0) => ({ wch: W[h0] || 12 }));
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Schedule');
  return new Uint8Array(X.write(wb, { bookType: 'xlsx', type: 'array' }));
}


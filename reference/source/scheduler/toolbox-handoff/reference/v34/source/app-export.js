/* ===== Exports: CSV, Excel, PNG, PDF ===== */
const LIBS = {
  xlsx: { url: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', get: () => window.XLSX },
  pdf: { url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', get: () => window.jspdf },
  zip: { url: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', get: () => window.JSZip },
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
  const head = ['#', 'Task', 'Type', 'Start', 'Days', 'Finish', 'Predecessors'].concat(withBase ? ['Baseline start', 'Baseline finish', 'Slip (days)'] : [], full ? ['Audience', 'Locked', 'Held', 'Issues'] : []);
  const dateCols = withBase ? [3, 5, 7, 8] : [3, 5];
  const rows = tasks.map((t, i) => {
    const r = S.res.get(t.id);
    const row = [i + 1, t.name, t.kind === 'milestone' ? 'Milestone' : 'Task', r.start, r.kind === 'milestone' ? 0 : r.dur, r.finish, formatPreds(t, tasks)];
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

/* ----- export options ----- */
const PAL = { ghost: '#8E9BA8', bg: '#FFFFFF', ink: '#15202B', muted: '#5A6978', line: '#C7D0D7', line2: '#E2E7EB', bar: '#3B79C3', held: '#8FB3DE', wknd: '#EEF1F3', hol: '#D6DDE3', err: '#B3261E', warn: '#8A5300', today: '#D2452B', accent: '#1B4F8F' };
let logoImg = null, logoPromise = null;
function loadLogo() {
  if (logoImg) return Promise.resolve(logoImg);
  if (!logoPromise) {
    logoPromise = new Promise((res) => {
      const im = new Image();
      im.onload = () => { logoImg = im; res(im); };
      im.onerror = () => { logoPromise = null; res(null); };
      im.src = LOGO.src;
      setTimeout(() => res(logoImg), 4000);
    });
  }
  return logoPromise;
}
const XO_DEFAULTS = { projInfo: true, logo: true, fit: false, numbers: true, arrows: true, today: true, shade: true, dur: true, flags: false, legend: true, saved: true, printed: true, descOn: true, ganttDates: 'range', leftDates: 'none', paper: 'letter', catColors: true, scale: 'auto' };
const PAPER = { letter: { w: 792, h: 612, label: 'Letter, 8.5 × 11 in' }, tabloid: { w: 1224, h: 792, label: 'Tabloid, 11 × 17 in' }, a4: { w: 842, h: 595, label: 'A4' }, a3: { w: 1191, h: 842, label: 'A3' } };
const XO_TYPES = ['executive', 'client', 'design', 'internal'];
const typeDefaults = (type) => Object.assign({}, XO_DEFAULTS, { baseline: type === 'internal' || type === 'design' }, type === 'client' || type === 'executive' ? { catColors: false } : {});
/* keep only known options of the right kind, so a shared setting can never carry anything unexpected */
function cleanXO(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  const sel = { ganttDates: ['none', 'start', 'finish', 'range'], leftDates: ['none', 'start', 'finish', 'both'], paper: Object.keys(PAPER), scale: ['auto', 'days', 'weeks', 'months', 'quarters'] };
  for (const k of Object.keys(XO_DEFAULTS).concat('baseline')) {
    if (!(k in o)) continue;
    if (sel[k]) { if (sel[k].includes(o[k])) out[k] = o[k]; }
    else if (typeof o[k] === 'boolean') out[k] = o[k];
  }
  return out;
}
function normExportDefaults(o) {
  const out = {};
  for (const t of XO_TYPES) { const c = o && o[t] ? cleanXO(o[t]) : null; if (c && Object.keys(c).length) out[t] = c; }
  return out;
}
const sharedXO = (type) => (S.work && S.work.exportDefaults && S.work.exportDefaults[type]) || null;
function loadXO(type) {
  const d = typeDefaults(type);
  if (sharedXO(type)) return Object.assign(d, cleanXO(sharedXO(type))); // the project's look wins over anything saved on this device
  try {
    const raw = localStorage.getItem('schedsheet:xo2:' + type) || (type === 'internal' ? localStorage.getItem('schedsheet:xo') : null);
    return Object.assign(d, JSON.parse(raw || '{}'));
  } catch (e) { return d; }
}
function saveXO(type, o) { try { localStorage.setItem('schedsheet:xo2:' + type, JSON.stringify(Object.assign({}, o, { desc: undefined }))); } catch (e) { /* optional */ } }
function loadDesc(type) { try { return localStorage.getItem('schedsheet:desc:' + S.cur + ':' + type) || localStorage.getItem('schedsheet:desc:' + S.cur) || ''; } catch (e) { return ''; } }
function saveDesc(type, v) { try { localStorage.setItem('schedsheet:desc:' + S.cur + ':' + type, v); } catch (e) { /* optional */ } }
const dshort = (n) => { const p = ymdOf(n); return MON_S[p.m] + ' ' + p.d; };

function exportLayout(O0) {
  const type = O0.type || 'internal', rank = xRank(type);
  // issue markers are internal; colors by audience only mean something above the client level
  const O = Object.assign({}, O0, { flags: !!O0.flags && type === 'internal', catColors: !!O0.catColors && (type === 'design' || type === 'internal') });
  const tasks = exportTasks(type), rows = tasks.map((t) => S.res.get(t.id));
  const sc = SCALES[O0.scale] ? O0.scale : scaleOf(), dayW = SCALES[sc].px; // 'auto' follows the schedule
  // baseline and slip: the project must have it on and set; an export can only turn it off, never on
  const showBase = baseActive() && !!O0.baseline;
  const baseRows = showBase ? tasks.map((t) => baseRow(t.id)) : [];
  const slips = showBase ? tasks.map((t) => slipOf(t.id)) : [];
  const { minD, maxD } = ganttRange(rows.concat(baseRows.filter(Boolean)), dayW, sc, 150);
  const cols = O.leftDates === 'both' ? ['start', 'finish'] : O.leftDates === 'start' ? ['start'] : O.leftDates === 'finish' ? ['finish'] : [];
  const numW = O.numbers ? 30 : 8, nameW = 220, dcW = 58;
  const subLine = [O.projInfo && projText(), O.descOn && (O.desc || '').trim()].filter(Boolean).join(' \u00b7 ');
  const hasDesc = !!subLine;
  const logo = O.logo && logoImg ? LOGO : null;
  const titleH = Math.max(hasDesc ? 56 : 40, logo ? 62 : 0);
  const logoH = titleH - 12, logoW = logo ? Math.round(logoH * LOGO.w / LOGO.h) : 0;
  return {
    subLine, showBase, baseRows, slips, logo, logoH, logoW, O, rank, showLocks: type === 'internal', colors: normColors(S.work.colors), sc, tasks, rows, minD, maxD, span: maxD - minD + 1, dayW, cols, numW, nameW, dcW,
    labelW: numW + nameW + cols.length * dcW + 10, rowH: 26, headerH: 40, titleH, footH: O.legend ? 30 : 24,
  };
}
function fitText(c, text, maxW) {
  if (c.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && c.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
function barLabel(r, O) {
  const parts = [], ms = r.kind === 'milestone';
  if (ms) { if (O.ganttDates !== 'none') parts.push(dshort(r.start)); }
  else if (O.ganttDates === 'start') parts.push(dshort(r.start));
  else if (O.ganttDates === 'finish') parts.push(dshort(r.finish));
  else if (O.ganttDates === 'range') parts.push(dshort(r.start) + ' – ' + dshort(r.finish));
  if (O.dur && !ms) parts.push(r.dur + 'd');
  return parts.join(' · ');
}
/* how a PDF is cut into pages: rows down, date windows across */
function planPages(L, O) {
  const P = PAPER[O.paper] || PAPER.letter, M = 28;
  const availW = P.w - 2 * M, availH = P.h - 2 * M;
  const W = L.labelW + L.span * L.dayW;
  const sFit = availW / W;
  let s, wins;
  if (O.fit || sFit >= 0.85) {
    s = Math.min(1.4, sFit);
    wins = [{ minD: L.minD, maxD: L.maxD }];
  } else {
    s = 0.85;
    let per = Math.floor((availW / s - L.labelW) / L.dayW);
    per = Math.max(14, per - (per % 7));
    wins = [];
    for (let d = L.minD; d <= L.maxD; d += per) wins.push({ minD: d, maxD: Math.min(L.maxD, d + per - 1) });
  }
  const perPage = Math.max(5, Math.floor((availH / s - L.titleH - L.headerH - L.footH) / L.rowH));
  return { P, M, s, wins, perPage, rowPages: Math.ceil(L.tasks.length / perPage) };
}
/* design team = one diagonal, internal = crosshatch, so the levels still read in black and white */
function patternFill(c, x, y, w, hh, lvl) {
  if (lvl === 'client' || w < 3) return;
  c.save();
  c.beginPath(); c.rect(x, y, w, hh); c.clip();
  c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 1.2;
  const dirs = lvl === 'internal' ? [1, -1] : [1];
  for (const d of dirs) {
    for (let k = -hh; k < w + hh; k += 5) {
      c.beginPath();
      if (d === 1) { c.moveTo(x + k, y + hh); c.lineTo(x + k + hh, y); } else { c.moveTo(x + k, y); c.lineTo(x + k + hh, y + hh); }
      c.stroke();
    }
  }
  c.restore();
}
function drawExportPage(L, i0, i1, page, pages, maxPx, win) {
  const O = L.O;
  const mn = win ? win.minD : L.minD, mx = win ? win.maxD : L.maxD, span = mx - mn + 1;
  const W = L.labelW + span * L.dayW, n = i1 - i0;
  const H = L.titleH + L.headerH + n * L.rowH + L.footH;
  const SC = Math.min(2, (maxPx || 12000) / H, (maxPx || 12000) / W);
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(W * SC); cv.height = Math.ceil(H * SC);
  const c = cv.getContext('2d');
  c.scale(SC, SC);
  const SANS = '"IBM Plex Sans", Arial, sans-serif', MONO = '"IBM Plex Mono", Menlo, monospace', COND = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  c.fillStyle = PAL.bg; c.fillRect(0, 0, W, H);
  const y0 = L.titleH, yr = y0 + L.headerH, X = (d) => L.labelW + (d - mn) * L.dayW, bodyH = n * L.rowH;
  // title block
  c.fillStyle = PAL.ink; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  const right = [];
  if (O.saved) right.push(S.base.at ? 'Last saved by ' + nameOf(S.base.by) + ' · ' + whenText(S.base.at) : 'Not saved yet');
  if (O.printed) right.push('Printed ' + fmtLong(todayDay()));
  c.font = '12px ' + SANS;
  const logoSpace = L.logo ? L.logoW + 14 : 0;
  const rightW = (right.length ? Math.max(...right.map((t) => c.measureText(t).width)) + 20 : 0) + logoSpace;
  if (L.logo) c.drawImage(logoImg, W - 6 - L.logoW, 6, L.logoW, L.logoH);
  c.font = '600 24px ' + COND;
  c.fillText(fitText(c, S.work.name.toUpperCase(), W - rightW - 12), 6, 27);
  if (L.subLine) { c.font = '12px ' + SANS; c.fillStyle = PAL.muted; c.fillText(fitText(c, L.subLine, W - rightW - 12), 6, 45); }
  c.font = '12px ' + SANS; c.fillStyle = PAL.muted; c.textAlign = 'right';
  // bottom-aligned with the logo; with two lines the second sits above the first
  right.forEach((t, k) => c.fillText(t, W - 6 - logoSpace, y0 - 7 - (right.length - 1 - k) * 16));
  c.textAlign = 'left';
  c.strokeStyle = PAL.ink; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, L.titleH - 3); c.lineTo(W, L.titleH - 3); c.stroke();
  // shading (days and weeks only; too fine to read at a monthly scale)
  if (O.shade && !isCoarse(L.sc)) {
    for (let d = mn; d <= mx; d++) {
      const why = S.cal.reason(d);
      if (!why) continue;
      c.fillStyle = S.cal.isHoliday(d) ? PAL.hol : PAL.wknd;
      c.fillRect(X(d), yr, L.dayW, bodyH);
    }
  }
  // header, by the schedule's time scale
  c.fillStyle = PAL.muted; c.font = '600 11px ' + COND; c.fillText('TASK', L.numW, y0 + 26);
  L.cols.forEach((col, k) => { c.textAlign = 'right'; c.fillText(col.toUpperCase(), L.numW + L.nameW + k * L.dcW + L.dcW - 4, y0 + 26); });
  c.textAlign = 'left';
  const topSegs = isCoarse(L.sc) ? yearSegs(mn, mx) : monthSegs(mn, mx);
  for (const g of topSegs) {
    const w = (g.end - g.d + 1) * L.dayW;
    c.strokeStyle = PAL.line; c.lineWidth = 1; c.beginPath(); c.moveTo(X(g.d), y0); c.lineTo(X(g.d), y0 + 16); c.stroke();
    const label = isCoarse(L.sc) ? String(g.p.y) : w > 90 ? MON_L[g.p.m] + ' ' + g.p.y : MON_S[g.p.m];
    if (w > 28) { c.fillStyle = PAL.ink; c.font = '600 11px ' + SANS; c.fillText(fitText(c, label, w - 6), X(g.d) + 4, y0 + 13); }
  }
  c.font = '10px ' + MONO;
  if (L.sc === 'quarters') {
    for (const g of quarterSegs(mn, mx)) {
      c.strokeStyle = PAL.line2; c.beginPath(); c.moveTo(X(g.d), y0 + 16); c.lineTo(X(g.d), yr + bodyH); c.stroke();
      c.fillStyle = PAL.ink; c.fillText(fitText(c, 'Q' + g.q, (g.end - g.d + 1) * L.dayW - 3), X(g.d) + 3, y0 + 33);
    }
  } else if (L.sc === 'months') {
    for (const g of monthSegs(mn, mx)) {
      c.strokeStyle = PAL.line2; c.beginPath(); c.moveTo(X(g.d), y0 + 16); c.lineTo(X(g.d), yr + bodyH); c.stroke();
      c.fillStyle = PAL.ink; c.fillText(fitText(c, MON_S[g.p.m], (g.end - g.d + 1) * L.dayW - 3), X(g.d) + 3, y0 + 33);
    }
  } else {
    for (let k = mn; k <= mx; k++) {
      const mon = dowOf(k) === 1;
      if (mon) { c.strokeStyle = PAL.line2; c.beginPath(); c.moveTo(X(k), y0 + 16); c.lineTo(X(k), yr + bodyH); c.stroke(); }
      if (L.sc === 'days' || mon) { c.fillStyle = S.cal.reason(k) ? PAL.muted : PAL.ink; c.fillText(String(ymdOf(k).d), X(k) + 2, y0 + 33); }
    }
  }
  c.strokeStyle = PAL.ink; c.lineWidth = 1; c.beginPath(); c.moveTo(0, yr); c.lineTo(W, yr); c.stroke();
  // rows and left panel
  for (let i = i0; i < i1; i++) {
    const y = yr + (i - i0) * L.rowH, t = L.tasks[i], r = L.rows[i];
    c.strokeStyle = PAL.line2; c.beginPath(); c.moveTo(0, y + L.rowH); c.lineTo(W, y + L.rowH); c.stroke();
    if (O.numbers) { c.fillStyle = PAL.muted; c.font = '11px ' + MONO; c.textAlign = 'right'; c.fillText(String(i + 1), L.numW - 6, y + 17); }
    c.textAlign = 'left'; c.fillStyle = PAL.ink; c.font = (t.kind === 'milestone' ? '600 ' : '') + '12px ' + SANS;
    c.fillText(fitText(c, t.name || 'Untitled', L.nameW - (O.flags ? 16 : 6)), L.numW, y + 17);
    L.cols.forEach((col, k) => {
      c.fillStyle = PAL.muted; c.font = '11px ' + MONO; c.textAlign = 'right';
      c.fillText(dshort(col === 'start' ? r.start : r.finish), L.numW + L.nameW + k * L.dcW + L.dcW - 4, y + 17);
    });
    c.textAlign = 'left';
    const w = worst(r.flags);
    if (O.flags && w) { c.fillStyle = w === 'err' ? PAL.err : PAL.warn; c.beginPath(); c.arc(L.numW + L.nameW - 6, y + L.rowH / 2, 4, 0, 7); c.fill(); }
  }
  c.strokeStyle = PAL.ink; c.beginPath(); c.moveTo(L.labelW, y0); c.lineTo(L.labelW, yr + bodyH); c.stroke();
  // chart contents, clipped to the date window
  c.save();
  c.beginPath(); c.rect(L.labelW, yr, W - L.labelW, bodyH); c.clip();
  const td = todayDay();
  if (O.today && td >= mn && td <= mx) { c.strokeStyle = PAL.today; c.lineWidth = 1.5; c.beginPath(); c.moveTo(X(td) + L.dayW / 2, yr); c.lineTo(X(td) + L.dayW / 2, yr + bodyH); c.stroke(); }
  const geo = (r) => { const g = ganttGeom(r, mn, L.dayW); return { l: g.l + L.labelW, r: g.r + L.labelW }; };
  if (O.arrows) {
    const idx = new Map(L.tasks.map((t, i) => [t.id, i]));
    c.lineWidth = 1; c.strokeStyle = PAL.muted; c.fillStyle = PAL.muted;
    L.tasks.forEach((t, j) => {
      if (j < i0 || j >= i1 || L.rows[j].cycle) return;
      for (const dp of t.deps || []) {
        const i = idx.get(dp.id);
        if (i == null || i < i0 || i >= i1) continue;
        const pts = arrowPath(geo(L.rows[i]), geo(L.rows[j]), dp.type, yr + (i - i0) * L.rowH + L.rowH / 2, yr + (j - i0) * L.rowH + L.rowH / 2, L.rowH);
        c.beginPath(); pts.forEach((pt, k) => (k ? c.lineTo(pt[0], pt[1]) : c.moveTo(pt[0], pt[1]))); c.stroke();
        const [x2, y2] = pts[pts.length - 1];
        c.beginPath(); c.moveTo(x2, y2); c.lineTo(x2 - 5, y2 - 3); c.lineTo(x2 - 5, y2 + 3); c.closePath(); c.fill();
      }
    });
  }
  for (let i = i0; i < i1; i++) {
    const r = L.rows[i], t = L.tasks[i], cy = yr + (i - i0) * L.rowH + L.rowH / 2, w = worst(r.flags), g = geo(r);
    const lvl = t.lvl || 'client';
    if (L.showBase && L.baseRows[i]) {
      const gb = geo(L.baseRows[i]);
      c.fillStyle = PAL.ghost; c.strokeStyle = PAL.ghost;
      if (r.kind === 'milestone') { const bx = (gb.l + gb.r) / 2, by = cy + 9; c.lineWidth = 1.2; c.beginPath(); c.moveTo(bx, by - 4); c.lineTo(bx + 4, by); c.lineTo(bx, by + 4); c.lineTo(bx - 4, by); c.closePath(); c.stroke(); }
      else c.fillRect(gb.l, cy + 8, gb.r - gb.l, 3);
    }
    const exc = O.type === 'executive' ? colorPrint(execKey(t, S.work.execColor)) : null;
    const base = exc || (O.catColors ? colorPrint(L.colors[lvl]) : null);
    const lockedInk = L.showLocks && t.locked && !O.catColors; // without colors, locked is drawn dark as before
    if (r.kind === 'milestone') {
      const cx = (g.l + g.r) / 2;
      c.beginPath(); c.moveTo(cx, cy - 7); c.lineTo(cx + 7, cy); c.lineTo(cx, cy + 7); c.lineTo(cx - 7, cy); c.closePath();
      c.fillStyle = lockedInk ? PAL.ink : base || PAL.accent; c.fill();
      if (L.showLocks && t.locked && O.catColors) { c.strokeStyle = PAL.ink; c.lineWidth = 1.5; c.stroke(); }
      if (O.flags && w === 'err') { c.strokeStyle = PAL.err; c.lineWidth = 2; c.stroke(); }
    } else {
      c.fillStyle = lockedInk ? PAL.ink : base || PAL.bar;
      c.fillRect(g.l, cy - 7, g.r - g.l, 14);
      if (O.catColors) patternFill(c, g.l, cy - 7, g.r - g.l, 14, lvl);
      if (L.showLocks && t.locked && O.catColors) { c.strokeStyle = PAL.ink; c.lineWidth = 1.5; c.strokeRect(g.l + 0.75, cy - 6.25, g.r - g.l - 1.5, 12.5); }
      if (L.showLocks && r.held) { c.save(); c.setLineDash([3, 2]); c.strokeStyle = PAL.ink; c.lineWidth = 1; c.strokeRect(g.l - 1.5, cy - 8.5, g.r - g.l + 3, 17); c.restore(); }
      if (O.flags && w === 'err') { c.strokeStyle = PAL.err; c.lineWidth = 2; c.strokeRect(g.l, cy - 7, g.r - g.l, 14); }
    }
    let lab = barLabel(r, O);
    if (L.showBase) { const n = L.slips[i]; const st = n == null ? 'new' : n ? slipText(n) : ''; if (st) lab = lab ? lab + ' \u00b7 ' + st : st; }
    if (lab) { c.fillStyle = PAL.muted; c.font = '10px ' + MONO; c.textAlign = 'left'; c.fillText(lab, g.r + 6, cy + 3.5); }
  }
  c.restore();
  // legend and page number
  const fy = yr + bodyH + 19;
  c.font = '10px ' + SANS;
  if (O.legend) {
    let lx = 6;
    const sw = (col, label, diamond) => {
      c.fillStyle = col;
      if (diamond) { c.beginPath(); c.moveTo(lx + 5, fy - 9); c.lineTo(lx + 10, fy - 4); c.lineTo(lx + 5, fy + 1); c.lineTo(lx, fy - 4); c.closePath(); c.fill(); } else c.fillRect(lx, fy - 9, 12, 9);
      c.fillStyle = PAL.muted; c.textAlign = 'left'; c.fillText(label, lx + 17, fy); lx += 17 + c.measureText(label).width + 16;
    };
    if (O.catColors) {
      const present = LEVELS.filter((k) => L.tasks.some((t) => (t.lvl || 'client') === k));
      for (const k of present) {
        sw(colorPrint(L.colors[k]), LEVEL_INFO[k].label);
        patternFill(c, lx - 17 - c.measureText(LEVEL_INFO[k].label).width - 16, fy - 9, 12, 9, k);
      }
      sw(PAL.muted, 'Milestone', true);
    } else if (O.type === 'executive') {
      const used = [...new Set(L.tasks.map((t) => execKey(t, S.work.execColor)))];
      if (used.length === 1) { sw(colorPrint(used[0]), 'Task'); sw(colorPrint(used[0]), 'Milestone', true); } // several colors: no key, each bar is labeled by its row
    } else { sw(PAL.bar, 'Task'); sw(PAL.accent, 'Milestone', true); }
    if (L.showBase) sw(PAL.ghost, 'Baseline (+/\u2212 = days later/earlier)');
    if (L.showLocks) sw(PAL.ink, 'Locked date');
    if (O.shade && !isCoarse(L.sc)) { sw(PAL.wknd, S.cal.offDays.length === 2 && S.cal.offDays.includes(0) && S.cal.offDays.includes(6) ? 'Weekend' : 'Non-working'); sw(PAL.hol, 'Holiday'); }
  }
  if (pages > 1) { c.textAlign = 'right'; c.fillStyle = PAL.muted; c.fillText('Page ' + page + ' of ' + pages, W - 6, fy); }
  return { cv, W, H };
}
async function buildPNG(O) {
  if (O.logo) await loadLogo();
  const L = exportLayout(O);
  const { cv } = drawExportPage(L, 0, L.tasks.length, 1, 1, 12000);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  if (!blob) throw new Error('png');
  return blob;
}
async function buildPDF(O) {
  if (O.logo) await loadLogo();
  const lib = await loadLib('pdf');
  const L = exportLayout(O);
  const plan = planPages(L, O);
  const total = plan.rowPages * plan.wins.length;
  const doc = new lib.jsPDF({ orientation: 'landscape', unit: 'pt', format: [plan.P.h, plan.P.w] });
  let k = 0;
  for (let rp = 0; rp < plan.rowPages; rp++) {
    const i0 = rp * plan.perPage, i1 = Math.min(L.tasks.length, i0 + plan.perPage);
    for (const win of plan.wins) {
      k++;
      const { cv, W: w, H: hh } = drawExportPage(L, i0, i1, k, total, 6000, win);
      if (k > 1) doc.addPage();
      doc.addImage(cv.toDataURL('image/png'), 'PNG', plan.M, plan.M, w * plan.s, hh * plan.s);
    }
  }
  return doc.output('arraybuffer');
}
/* one file per selected type; several files go out as a single zip */
async function runExportJob(kind, types, Os) {
  const files = [];
  for (const type of types) {
    const O = Object.assign({}, Os[type], { type });
    let data;
    if (kind === 'csv') data = buildCSV(type, Os[type]);
    else if (kind === 'xlsx') data = await buildXLSX(type, Os[type]);
    else if (kind === 'png') data = await buildPNG(O);
    else data = await buildPDF(O);
    files.push({ name: fileName(type, kind), data });
  }
  if (files.length === 1) return saveFile(files[0].name, files[0].data);
  const Z = await loadLib('zip');
  const z = new Z();
  for (const f of files) z.file(f.name, f.data);
  const out = await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return saveFile(stemName() + ' - exports - ' + fmtISO(todayDay()) + '.zip', out);
}

/* ----- export dialog ----- */
const KIND_LABEL = { pdf: 'PDF', png: 'image', xlsx: 'Excel file', csv: 'CSV file' };
function openExportDialog(kind) {
  const isPdf = kind === 'pdf', isGantt = kind === 'pdf' || kind === 'png';
  const XT = xTypes();
  const counts = Object.fromEntries(XT.map((t) => [t, exportTasks(t).length]));
  const picks = Object.fromEntries(XT.map((t) => [t, new Set(exportTasks(t).map((x) => x.id))]));
  const total = S.work.tasks.length;
  const Os = {};
  const optsOf = (type) => { if (!Os[type]) { Os[type] = loadXO(type); Os[type].desc = loadDesc(type) || S.work.info.issue || ''; } return Os[type]; };
  let active = null;
  try { active = localStorage.getItem('schedsheet:xtype'); } catch (e) { active = null; }
  if (!XT.includes(active) || !counts[active]) active = counts.internal ? 'internal' : (XT.find((t) => counts[t] > 0) || 'internal');

  const tabs = h('div', { class: 'xtabs', role: 'tablist', 'aria-label': 'Export for' });
  const info = h('div', { class: 'xt-info' });
  const shareBar = h('div', { class: 'xo-share' });
  const body = h('div');
  const preview = h('div', { class: 'xo-prev' });
  let timer = null, dlgApi = null;

  const updateButton = () => {
    if (!dlgApi) return;
    const go = dlgApi.dlg.querySelectorAll('.dlg-act button')[1];
    go.disabled = counts[active] === 0;
    go.textContent = 'Download ' + typeLabel(active) + ' ' + KIND_LABEL[kind];
  };
  const paintTabs = () => {
    tabs.textContent = '';
    for (const type of XT) {
      const n = counts[type];
      const btn = h('button', { type: 'button', role: 'tab', 'aria-selected': String(active === type), class: 'xtab-b', onclick: () => { active = type; paintAll(); } },
        h('strong', { text: typeLabel(type) }), h('small', { text: n + (n === 1 ? ' task' : ' tasks') }));
      tabs.append(h('div', { class: 'xtab' + (active === type ? ' on' : '') }, btn));
    }
  };
  const paintInfo = () => {
    const kept = counts[active], left = total - kept;
    info.textContent = '';
    info.append(h('p', { class: 'xt-sum' }, h('strong', { text: typeLabel(active) + ' export: ' }),
      kept + ' of ' + total + ' tasks. ' + (left ? left + ' left out.' : 'Nothing is left out.')));
    if (active === 'executive') {
      info.append(h('p', { class: 'muted xo-note', text: kept ? 'Only Client-level tasks marked Exec are included, for client executives.' : 'No tasks are marked for the executive summary yet. Check Exec on the Client-level tasks you want, in the Table.' }));
    }
    if (left) {
      const hidden = S.work.tasks.filter((t) => !picks[active].has(t.id));
      info.append(h('details', { class: 'xo-hidden' }, h('summary', { text: 'Show the ' + left + ' left out' }),
        h('ul', null, hidden.map((t) => h('li', null, (t.name || 'Untitled') + ' ', h('small', { class: 'muted', text: '(' + (active === 'executive' && lvRank(t) === 0 ? 'not marked Exec' : LEVEL_INFO[t.lvl || 'client'].label) + ')' }))))));
    }
    if (active !== 'internal') info.append(h('p', { class: 'muted xo-note', text: 'Dates still come from the full schedule, including the tasks left out. Locks, holds, issues and arrows to hidden tasks are not included.' }));
  };

  const redraw = () => {
    clearTimeout(timer);
    if (!isGantt) return;
    timer = setTimeout(async () => {
      if (optsOf(active).logo) await loadLogo();
      preview.textContent = '';
      try {
        const O = Object.assign({}, optsOf(active), { type: active });
        const L = exportLayout(O);
        const plan = isPdf ? planPages(L, O) : null;
        const rows = Math.min(L.tasks.length, plan ? plan.perPage : 16, 16);
        const { cv } = drawExportPage(L, 0, rows, 1, 1, 1500, plan ? plan.wins[0] : null);
        cv.setAttribute('aria-label', 'Preview of the first rows of the ' + typeLabel(active) + ' export');
        preview.append(cv);
        const pages = plan ? plan.rowPages * plan.wins.length : 1;
        const bits = [];
        if (L.tasks.length > rows) bits.push('Preview shows the first ' + rows + ' of ' + L.tasks.length + ' tasks.');
        if (plan && O.fit && plan.s < 0.6) bits.push('Fit to width prints at about ' + Math.round(plan.s * 100) + '% size, so text will be small. Try a coarser scale or a larger paper size.');
        if (plan) bits.push('The PDF will be ' + pages + (pages === 1 ? ' page' : ' pages') + (plan.wins.length > 1 ? ' (' + plan.wins.length + ' across, ' + plan.rowPages + ' down)' : '') + '.');
        if (bits.length) preview.append(h('p', { class: 'muted xo-note', text: bits.join(' ') }));
      } catch (e) { preview.append(h('p', { class: 'muted', text: 'Preview unavailable.' })); }
    }, 60);
  };

  const paintBody = () => {
    body.textContent = '';
    const O = optsOf(active), type = active;
    const chk = (key, label) => {
      const i = h('input', { type: 'checkbox', id: 'xo_' + key });
      i.checked = !!O[key];
      i.addEventListener('change', () => { O[key] = i.checked; if (key === 'descOn') descIn.disabled = !i.checked; if (isGantt) redraw(); else paintBody(); });
      return h('label', { class: 'chk', for: 'xo_' + key }, i, ' ' + label);
    };
    if (!isGantt) {
      const head = tableData(active, O).head;
      body.append(baseActive() ? chk('baseline', 'Include baseline and slip columns') : null,
        h('p', { class: 'muted', text: 'Columns: ' + head.join(', ') + '.' }),
        type !== 'internal' ? h('p', { class: 'muted', text: 'Issues, locks and holds are only included in the Internal file.' }) : null);
      return;
    }
    const sel = (key, label, opts) => {
      const s2 = h('select', { id: 'xo_' + key, class: 'txt' }, opts.map(([v, t]) => h('option', { value: v, text: t })));
      s2.value = O[key];
      s2.addEventListener('change', () => { O[key] = s2.value; redraw(); });
      return h('div', { class: 'xo-field' }, h('label', { for: 'xo_' + key, text: label }), s2);
    };
    const descIn = h('input', { type: 'text', id: 'xo_desc', class: 'txt', placeholder: 'e.g. Issued for owner review, rev 2', autocomplete: 'off', maxlength: '160' });
    descIn.value = O.desc || '';
    descIn.disabled = !O.descOn;
    descIn.addEventListener('input', () => { O.desc = descIn.value; redraw(); });
    const dateOpts = (both) => [['none', 'None'], ['start', 'Start'], ['finish', 'Finish'], [both, 'Start and finish']];
    body.append(h('div', { class: 'xo-form' },
      h('fieldset', null, h('legend', { text: 'Time scale' }),
        sel('scale', 'Scale for this export', [['auto', 'Same as the schedule (' + SCALES[scaleOf()].label + ')']].concat(Object.keys(SCALES).map((k) => [k, SCALES[k].label]))),
        h('p', { class: 'muted xo-note', text: 'Only changes the export. The schedule keeps its own scale.' })),
      h('fieldset', null, h('legend', { text: 'Dates' }),
        sel('ganttDates', 'Next to each bar', dateOpts('range')),
        sel('leftDates', 'In the task list on the left', dateOpts('both')),
        chk('dur', 'Show durations next to bars')),
      h('fieldset', null, h('legend', { text: 'Show' }),
        chk('numbers', 'Task numbers'), chk('arrows', 'Dependency arrows'), chk('today', 'Current date line'),
        chk('shade', 'Weekend and holiday shading'),
        baseActive() ? chk('baseline', 'Baseline and slip') : null,
        type === 'internal' ? chk('flags', 'Issue markers') : null,
        type === 'design' || type === 'internal' ? chk('catColors', 'Color by audience (with legend)') : null,
        chk('legend', 'Legend')),
      h('fieldset', null, h('legend', { text: 'Heading' }),
        projText() ? chk('projInfo', 'Project number and client') : null, chk('logo', 'Arch Nexus logo (top right)'), chk('saved', 'Last saved by and date'), chk('printed', 'Print date'), chk('descOn', 'Description under the title'), descIn),
      isPdf ? h('fieldset', null, h('legend', { text: 'Page' }),
        sel('paper', 'Paper size (landscape)', Object.keys(PAPER).map((k) => [k, PAPER[k].label])),
        chk('fit', 'Fit all dates on one page width'),
        h('p', { class: 'muted xo-note', text: 'Shrinks the chart so it never splits across pages sideways. A coarser scale (Weeks or Months) keeps the text readable on long projects.' })) : null));
  };
  /* project defaults: one shared look per report type, saved with the schedule */
  const paintShare = () => {
    shareBar.textContent = '';
    if (!isGantt) return;
    const t = active, label = typeLabel(t), shared = !!sharedXO(t), ro = S.readonly;
    shareBar.append(h('p', { class: 'muted xo-note' }, shared
      ? 'Using the project\u2019s ' + label + ' settings, shared with everyone on this project. Changes made here apply to this download only. The line under the title comes from the issue note in Project settings.'
      : 'These ' + label + ' settings are remembered on this device only.'));
    if (ro) return;
    const row = h('div', { class: 'xo-share-btns' });
    row.append(h('button', { type: 'button', class: 'btn sm', text: shared ? 'Update project default' : 'Share as the project default for ' + label,
      title: 'Save the options below with the project so everyone gets the same ' + label + ' look. Save the schedule afterwards to share it.',
      onclick: () => {
        const o = cleanXO(optsOf(t));
        edit(() => { S.work.exportDefaults = Object.assign({}, S.work.exportDefaults, { [t]: o }); });
        toast('Saved as the project default for the ' + label + ' export. Save the schedule to share it with the team.');
        paintAll();
      } }));
    if (shared) {
      row.append(h('button', { type: 'button', class: 'btn sm ghost', text: 'Reset to project default', onclick: () => { delete Os[t]; paintAll(); } }),
        h('button', { type: 'button', class: 'btn sm ghost', text: 'Stop sharing', title: 'Go back to settings remembered on each device',
          onclick: () => { edit(() => { const n = Object.assign({}, S.work.exportDefaults); delete n[t]; S.work.exportDefaults = n; }); delete Os[t]; paintAll(); } }));
    }
    shareBar.append(row);
  };
  const paintAll = () => { paintTabs(); paintInfo(); paintShare(); paintBody(); updateButton(); redraw(); };

  paintTabs(); paintInfo(); paintShare(); paintBody();
  dlgApi = openDialog({
    title: 'Export ' + KIND_LABEL[kind], wide: isGantt ? 'x' : true,
    body: h('div', null,
      h('p', { class: 'muted xo-lead', text: 'Choose who this is for. Each report keeps its own settings, and they are remembered the next time you export it.' }),
      tabs, info, shareBar,
      isGantt ? h('div', { class: 'xo' }, body, preview) : body),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Download', primary: true,
        run: () => {
          if (!counts[active]) return false;
          const o = optsOf(active);
          if (!sharedXO(active)) saveXO(active, o); // with a project default, this device keeps nothing of its own
          saveDesc(active, o.desc || '');
          try { localStorage.setItem('schedsheet:xtype', active); } catch (e) { /* optional */ }
          toast('Preparing the ' + KIND_LABEL[kind] + '…');
          runExportJob(kind, [active], Os).catch(() => toast(kind === 'csv' ? 'Export failed.' : 'Could not load the export tools. Check your connection and try again.'));
        },
      },
    ],
  });
  updateButton();
  redraw();
}
function runExport(kind) {
  if (!S.work) return;
  if (!S.work.tasks.length) { toast('Add a task before exporting.'); return; }
  openExportDialog(kind);
}

/* ----- boot ----- */
async function boot() {
  setInterval(nagTick, 20000);
  bindStatic();
  renderAll();
  const c = window.claude;
  if (!c || !c.use) { S.noStore = true; renderAll(); return; }
  const [db, room, user, dl] = await Promise.all([c.use('db'), c.use('room'), c.use('user'), c.use('downloads')]);
  S.db = db; S.room = room; S.user = user; S.dl = dl;
  if (!db) { S.noStore = true; renderAll(); return; }
  if (user) {
    S.meId = await user.id();
    const cw = await user.can('data.write');
    S.readonly = cw === false;
  }
  db.collection('schedules').onSnapshot(onSchedSnap, (e) => fail('Could not load schedules', e));
  db.doc('config/holidays').onSnapshot(onHolSnap, (e) => fail('Could not load holidays', e));
  if (room) room.onPeers(onPeers, () => {});
  renderAll();
}
boot();

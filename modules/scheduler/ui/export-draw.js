/* ===== Export drawing: one set of drawing code for the preview, the image and the PDF =====
   Everything is drawn through a 2D-context interface. The preview and the image draw on a
   canvas; the PDF draws on jsPDF's context2d, so text and lines stay vector and the fonts are
   embedded. The preview paints the exact page the PDF will contain (same layout, same page cut,
   same fonts), so what you see is what downloads.
   Only these context calls are used, because jsPDF supports them: save/restore, translate,
   scale, rotate, beginPath/moveTo/lineTo/closePath/rect/arc, fill/stroke/clip, fillRect,
   strokeRect, fillText, measureText, setLineDash, and solid colors (no alpha). */

/* print palette: Nexus Blue leads; grays from the brand guide (Pantone 171-1 C, 174-5 U, 178-11 C).
   Orange is only the small today marker. The error red is not a brand color; it marks real conflicts only. */
const PAL = {
  bg: '#FFFFFF', ink: '#24292E', text2: '#50585E', muted: '#6E777D', blue: '#0099D8', blueInk: '#0077A8',
  grid: '#CDD1D2', grid2: '#E7E9EA', bar: '#0099D8', ms: '#005175', ghost: '#9AA3A9',
  wknd: '#F2F4F5', hol: '#E0E5E8', err: '#B3261E', warn: '#8A5300', today: '#F18A00', locked: '#24292E',
};
const FONTS_CANVAS = { ui: 'Lato, Arial, sans-serif', cond: '"Roboto Condensed", "Arial Narrow", Arial, sans-serif' };
const FONTS_PDF = { ui: 'Lato', cond: 'RobotoCondensed' };
const fnt = (F, kind, size, bold) => (bold ? 'bold ' : '') + size + 'px ' + F[kind];
let fontsReadyP = null;
function fontsReady() {
  if (!fontsReadyP) {
    const fs = document.fonts;
    fontsReadyP = fs && fs.load ? Promise.all(['12px Lato', 'bold 12px Lato', '12px "Roboto Condensed"', 'bold 12px "Roboto Condensed"'].map((f) => fs.load(f).catch(() => null))).catch(() => null) : Promise.resolve();
  }
  return fontsReadyP;
}

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
/* the brand guide: never narrower than 1 inch (72 pt), clear space on all sides equal to the
   size of "ARC" in the wordmark, about 29% of the logo's width */
const LOGO_MIN_PT = 72, LOGO_CLEAR = 0.29, LOGO_PX = 96;

/* colors */
const hexRGB = (hx) => { const m = /^#?([0-9a-f]{6})$/i.exec(hx || ''); const n = m ? parseInt(m[1], 16) : 0; return [n >> 16, (n >> 8) & 255, n & 255]; };
const rgbHex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = hexRGB(a), y = hexRGB(b); return rgbHex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = (hx) => { const [r, g, b] = hexRGB(hx).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/* white text where it reads (4.5:1 for small text), the brand's dark gray otherwise */
const inkOn = (hx, large) => (1.05 / (lum(hx) + 0.05) >= (large ? 3 : 4.5) ? '#FFFFFF' : '#1E2428');

const XO_DEFAULTS = { style: 'bars', projInfo: true, logo: true, fit: false, numbers: true, arrows: true, today: true, shade: true, dur: true, flags: false, legend: true, saved: true, printed: true, descOn: true, ganttDates: 'range', leftDates: 'none', paper: 'letter', catColors: true, scale: 'auto', phaseShades: true };
const PAPER = { letter: { w: 792, h: 612, label: 'Letter, 8.5 × 11 in' }, tabloid: { w: 1224, h: 792, label: 'Tabloid, 11 × 17 in' }, a4: { w: 842, h: 595, label: 'A4' }, a3: { w: 1191, h: 842, label: 'A3' } };
const XO_TYPES = ['executive', 'client', 'design', 'internal'];
/* audience presets: what each report starts with before anyone changes it */
const PRESETS_XO = {
  executive: { style: 'bands', numbers: false, arrows: false, dur: false, shade: false, legend: false, catColors: false, baseline: false, ganttDates: 'range' },
  client: { style: 'bars', catColors: false, baseline: false, arrows: true, ganttDates: 'range' },
  design: { style: 'bars', catColors: true, baseline: true },
  internal: { style: 'bars', catColors: true, baseline: true, flags: true, leftDates: 'both' },
};
const typeDefaults = (type) => Object.assign({}, XO_DEFAULTS, PRESETS_XO[type] || PRESETS_XO.internal);
const PRESET_NOTE = {
  executive: 'A one-page overview for client executives: Client-level activities marked Exec, drawn as phase bands like the schedule example in the brand guide.',
  client: 'For the owner and consultants: Client-level activities only. No internal notes, locks, holds or issues.',
  design: 'For the design team: Client and Design team activities, colored by audience, with the baseline when it is set.',
  internal: 'Everything, including internal activities, locks, holds and issue markers.',
};
function cleanXO(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  const sel = { style: ['bars', 'bands'], ganttDates: ['none', 'start', 'finish', 'range'], leftDates: ['none', 'start', 'finish', 'both'], paper: Object.keys(PAPER), scale: ['auto', 'days', 'weeks', 'months', 'quarters'] };
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
    const raw = pref('sched.xo3.' + type);
    return Object.assign(d, cleanXO(JSON.parse(raw || '{}')));
  } catch (e) { return d; }
}
function saveXO(type, o) { pref('sched.xo3.' + type, JSON.stringify(cleanXO(o))); }
function loadDesc(type) { return pref('sched.desc.' + S.cur + '.' + type) || ''; }
function saveDesc(type, v) { pref('sched.desc.' + S.cur + '.' + type, v); }
const dshort = (n) => { const p = ymdOf(n); return MON_S[p.m] + ' ' + p.d; };
/* a bands export only makes sense when there is something to band */
const usesBands = (O) => O.style === 'bands' && (O.type === 'executive' || O.type === 'client');

function fitText(c, text, maxW) {
  if (maxW <= 0) return '';
  if (c.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && c.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s.length > 1 ? s + '…' : '';
}

/* ---------- heading shared by both styles ----------
   Title in Roboto Condensed, Nexus Blue, upper case; the project line under it in the brand's
   dark gray; the logo top right with its clear space; the saved and printed lines bottom-aligned
   with the logo, the second above the first. A thin Nexus Blue rule closes the heading. */
function headingInfo(O) {
  const subLine = [O.projInfo && projText(), O.descOn && (O.desc || '').trim()].filter(Boolean).join('  ·  ');
  const right = [];
  if (O.saved) right.push(S.base.at ? 'Last saved by ' + nameOf(S.base.by) + ' · ' + whenText(S.base.at) : 'Not saved yet');
  if (O.printed) right.push('Printed ' + fmtLong(todayDay()));
  return { subLine, right, logo: !!(O.logo && logoImg) };
}
function setHeading(L, logoW) {
  const hd = L.hd;
  L.logoW = hd.logo ? Math.ceil(logoW) : 0;
  L.logoH = hd.logo ? Math.ceil(L.logoW * LOGO.h / LOGO.w) : 0;
  L.clear = hd.logo ? Math.ceil(L.logoW * LOGO_CLEAR) : 0;
  const textH = hd.subLine ? 52 : 36;
  L.titleH = Math.max(textH, L.logoH + L.clear) + 8;
}
function paintHeading(c, F, L, W, logoAt) {
  const hd = L.hd, rx = W - (hd.logo ? L.logoW + L.clear : 0);
  c.font = fnt(F, 'ui', 10.5);
  const rightW = hd.right.length ? Math.max(...hd.right.map((t) => c.measureText(t).width)) + 16 : 0;
  if (hd.logo) logoAt(W - L.logoW, 0, L.logoW, L.logoH);
  c.textAlign = 'left';
  c.fillStyle = PAL.blue; c.font = fnt(F, 'cond', 25, true);
  c.fillText(fitText(c, (S.work.name || 'Schedule').toUpperCase(), rx - rightW - 4), 0, 24);
  if (hd.subLine) { c.fillStyle = PAL.text2; c.font = fnt(F, 'cond', 12.5); c.fillText(fitText(c, hd.subLine.toUpperCase(), rx - rightW - 4), 0, 44); }
  c.fillStyle = PAL.muted; c.font = fnt(F, 'ui', 10.5); c.textAlign = 'right';
  const bottom = hd.logo ? L.logoH - 2 : L.titleH - 12;
  hd.right.forEach((t, k) => c.fillText(t, rx, bottom - (hd.right.length - 1 - k) * 15));
  c.textAlign = 'left';
  c.fillStyle = PAL.blue; c.fillRect(0, L.titleH - 3, W, 1.25);
}

/* ---------- bars: one row per activity ---------- */
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
  const numW = O.numbers ? 28 : 4, nameW = 230, dcW = 54;
  const L = {
    hd: headingInfo(O), showBase, baseRows, slips, O, rank, showLocks: type === 'internal', colors: normColors(S.work.colors), sc, tasks, rows, minD, maxD, span: maxD - minD + 1, dayW, cols, numW, nameW, dcW,
    labelW: numW + nameW + cols.length * dcW + 10, rowH: 24, headerH: 38, footH: O.legend ? 30 : 22,
  };
  setHeading(L, LOGO_PX);
  return L;
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
  const P = PAPER[O.paper] || PAPER.letter, M = 30;
  const availW = P.w - 2 * M, availH = P.h - 2 * M;
  const W = L.labelW + L.span * L.dayW;
  const sFit = availW / W;
  let s, wins;
  if (O.fit || sFit >= 0.85) {
    s = Math.min(1.25, sFit);
    wins = [{ minD: L.minD, maxD: L.maxD }];
  } else {
    s = 0.85;
    let per = Math.floor((availW / s - L.labelW) / L.dayW);
    per = Math.max(14, per - (per % 7));
    wins = [];
    for (let d = L.minD; d <= L.maxD; d += per) wins.push({ minD: d, maxD: Math.min(L.maxD, d + per - 1) });
  }
  setHeading(L, Math.max(LOGO_MIN_PT / s, LOGO_PX * 0.75)); // never under 1 inch on paper
  const perPage = Math.max(4, Math.floor((availH / s - L.titleH - L.headerH - L.footH) / L.rowH));
  return { P, M, s, wins, perPage, rowPages: Math.max(1, Math.ceil(L.tasks.length / perPage)) };
}
const diamond = (c, cx, cy, r) => { c.beginPath(); c.moveTo(cx, cy - r); c.lineTo(cx + r, cy); c.lineTo(cx, cy + r); c.lineTo(cx - r, cy); c.closePath(); };
const hline = (c, x1, x2, y) => { c.beginPath(); c.moveTo(x1, y); c.lineTo(x2, y); c.stroke(); };
const vline = (c, x, y1, y2) => { c.beginPath(); c.moveTo(x, y1); c.lineTo(x, y2); c.stroke(); };
function sheetSize(L, i0, i1, win) {
  const span = (win ? win.maxD - win.minD : L.maxD - L.minD) + 1;
  return { W: L.labelW + span * L.dayW, H: L.titleH + L.headerH + (i1 - i0) * L.rowH + L.footH };
}
function paintBars(c, F, L, i0, i1, page, pages, win, logoAt) {
  const O = L.O;
  const mn = win ? win.minD : L.minD, mx = win ? win.maxD : L.maxD;
  const { W, H } = sheetSize(L, i0, i1, win), n = i1 - i0;
  c.fillStyle = PAL.bg; c.fillRect(0, 0, W, H);
  c.textAlign = 'left'; c.setLineDash([]);
  paintHeading(c, F, L, W, logoAt);
  const y0 = L.titleH, yr = y0 + L.headerH, X = (d) => L.labelW + (d - mn) * L.dayW, bodyH = n * L.rowH;
  // shading (days and weeks only; too fine to read at a monthly scale)
  if (O.shade && !isCoarse(L.sc)) {
    for (let d = mn; d <= mx; d++) {
      if (!S.cal.reason(d)) continue;
      c.fillStyle = S.cal.isHoliday(d) ? PAL.hol : PAL.wknd;
      c.fillRect(X(d), yr, L.dayW, bodyH);
    }
  }
  // header: the upper tier in bold Nexus Blue, the lower in small capitals, as on page 11 of the brand guide
  c.fillStyle = PAL.blue; c.font = fnt(F, 'cond', 10, true); c.fillText('ACTIVITY', L.numW, y0 + 31);
  L.cols.forEach((col, k) => { c.textAlign = 'right'; c.fillText(col.toUpperCase(), L.numW + L.nameW + k * L.dcW + L.dcW - 4, y0 + 31); });
  c.textAlign = 'left';
  const coarse = isCoarse(L.sc);
  c.strokeStyle = PAL.grid; c.lineWidth = 0.75;
  for (const g of coarse ? yearSegs(mn, mx) : monthSegs(mn, mx)) {
    const w = (g.end - g.d + 1) * L.dayW;
    vline(c, X(g.d), y0 + 4, yr + bodyH);
    const label = coarse ? String(g.p.y) : (w > 90 ? MON_L[g.p.m] + ' ' + g.p.y : MON_S[g.p.m]).toUpperCase();
    if (w > 26) { c.fillStyle = PAL.blue; c.font = fnt(F, 'cond', 10.5, true); c.fillText(fitText(c, label, w - 6), X(g.d) + 4, y0 + 15); }
  }
  c.font = fnt(F, 'cond', 9);
  c.strokeStyle = PAL.grid2; c.lineWidth = 0.75;
  if (L.sc === 'quarters') {
    for (const g of quarterSegs(mn, mx)) {
      vline(c, X(g.d), y0 + 20, yr + bodyH);
      c.fillStyle = PAL.blueInk; c.fillText(fitText(c, 'Q' + g.q, (g.end - g.d + 1) * L.dayW - 3), X(g.d) + 3, y0 + 31);
    }
  } else if (L.sc === 'months') {
    for (const g of monthSegs(mn, mx)) {
      vline(c, X(g.d), y0 + 20, yr + bodyH);
      c.fillStyle = PAL.blueInk; c.fillText(fitText(c, MON_S[g.p.m].toUpperCase(), (g.end - g.d + 1) * L.dayW - 3), X(g.d) + 3, y0 + 31);
    }
  } else {
    for (let k = mn; k <= mx; k++) {
      const mon = dowOf(k) === 1;
      if (mon) vline(c, X(k), y0 + 20, yr + bodyH);
      if (L.sc === 'days' || mon) { c.fillStyle = S.cal.reason(k) ? PAL.muted : PAL.blueInk; c.fillText(String(ymdOf(k).d), X(k) + 2, y0 + 31); }
    }
  }
  c.strokeStyle = PAL.text2; c.lineWidth = 0.75; hline(c, 0, W, yr);
  // rows and the activity list
  for (let i = i0; i < i1; i++) {
    const y = yr + (i - i0) * L.rowH, t = L.tasks[i], r = L.rows[i];
    c.strokeStyle = PAL.grid2; c.lineWidth = 0.5; hline(c, 0, W, y + L.rowH);
    if (O.numbers) { c.fillStyle = PAL.muted; c.font = fnt(F, 'cond', 10); c.textAlign = 'right'; c.fillText(String(i + 1), L.numW - 7, y + 16); }
    c.textAlign = 'left'; c.fillStyle = PAL.ink; c.font = fnt(F, 'ui', 11, t.kind === 'milestone');
    c.fillText(fitText(c, t.name || 'Untitled', L.nameW - (O.flags ? 16 : 6)), L.numW, y + 16);
    L.cols.forEach((col, k) => {
      c.fillStyle = PAL.text2; c.font = fnt(F, 'cond', 10); c.textAlign = 'right';
      c.fillText(dshort(col === 'start' ? r.start : r.finish), L.numW + L.nameW + k * L.dcW + L.dcW - 4, y + 16);
    });
    c.textAlign = 'left';
    const w = worst(r.flags);
    if (O.flags && w) { c.fillStyle = w === 'err' ? PAL.err : PAL.warn; c.beginPath(); c.arc(L.numW + L.nameW - 6, y + L.rowH / 2, 3.5, 0, Math.PI * 2); c.fill(); }
  }
  c.strokeStyle = PAL.text2; c.lineWidth = 0.75; vline(c, L.labelW, y0 + 20, yr + bodyH);
  // chart, clipped to the date window
  c.save();
  c.beginPath(); c.rect(L.labelW, yr, W - L.labelW, bodyH); c.clip();
  const td = todayDay();
  if (O.today && td >= mn && td <= mx) { c.strokeStyle = PAL.today; c.lineWidth = 1.25; vline(c, X(td) + L.dayW / 2, yr, yr + bodyH); }
  const geo = (r) => { const g = ganttGeom(r, mn, L.dayW); return { l: g.l + L.labelW, r: g.r + L.labelW }; };
  if (O.arrows) {
    const idx = new Map(L.tasks.map((t, i) => [t.id, i]));
    c.lineWidth = 0.75; c.strokeStyle = PAL.muted; c.fillStyle = PAL.muted;
    L.tasks.forEach((t, j) => {
      if (j < i0 || j >= i1 || L.rows[j].cycle) return;
      for (const dp of t.deps || []) {
        const i = idx.get(dp.id);
        if (i == null || i < i0 || i >= i1) continue;
        const pts = arrowPath(geo(L.rows[i]), geo(L.rows[j]), dp.type, yr + (i - i0) * L.rowH + L.rowH / 2, yr + (j - i0) * L.rowH + L.rowH / 2, L.rowH);
        c.beginPath(); pts.forEach((pt, k) => (k ? c.lineTo(pt[0], pt[1]) : c.moveTo(pt[0], pt[1]))); c.stroke();
        const [x2, y2] = pts[pts.length - 1];
        c.beginPath(); c.moveTo(x2, y2); c.lineTo(x2 - 4.5, y2 - 2.75); c.lineTo(x2 - 4.5, y2 + 2.75); c.closePath(); c.fill();
      }
    });
  }
  for (let i = i0; i < i1; i++) {
    const r = L.rows[i], t = L.tasks[i], cy = yr + (i - i0) * L.rowH + L.rowH / 2, w = worst(r.flags), g = geo(r);
    const lvl = t.lvl || 'client';
    if (L.showBase && L.baseRows[i]) {
      const gb = geo(L.baseRows[i]);
      c.fillStyle = PAL.ghost; c.strokeStyle = PAL.ghost;
      if (r.kind === 'milestone') { c.lineWidth = 1; diamond(c, (gb.l + gb.r) / 2, cy + 8, 3.5); c.stroke(); }
      else c.fillRect(gb.l, cy + 7, gb.r - gb.l, 2.5);
    }
    const exc = O.type === 'executive' ? colorPrint(execKey(t, S.work.execColor)) : null;
    const base = exc || (O.catColors ? colorPrint(L.colors[lvl]) : null);
    const lockedInk = L.showLocks && t.locked && !O.catColors;
    if (r.kind === 'milestone') {
      diamond(c, (g.l + g.r) / 2, cy, 6.5);
      c.fillStyle = lockedInk ? PAL.locked : base || PAL.ms; c.fill();
      if (L.showLocks && t.locked && O.catColors) { c.strokeStyle = PAL.locked; c.lineWidth = 1.25; c.stroke(); }
      if (O.flags && w === 'err') { c.strokeStyle = PAL.err; c.lineWidth = 1.75; c.stroke(); }
    } else {
      const col = lockedInk ? PAL.locked : base || PAL.bar;
      c.fillStyle = col; c.fillRect(g.l, cy - 6, g.r - g.l, 12);
      if (L.showLocks && t.locked && O.catColors) { c.strokeStyle = PAL.locked; c.lineWidth = 1.25; c.strokeRect(g.l + 0.6, cy - 5.4, g.r - g.l - 1.2, 10.8); }
      if (L.showLocks && r.held) { c.save(); c.setLineDash([3, 2]); c.strokeStyle = PAL.locked; c.lineWidth = 0.9; c.strokeRect(g.l - 1.5, cy - 7.5, g.r - g.l + 3, 15); c.restore(); }
      if (O.flags && w === 'err') { c.strokeStyle = PAL.err; c.lineWidth = 1.75; c.strokeRect(g.l, cy - 6, g.r - g.l, 12); }
    }
    let lab = barLabel(r, O);
    if (L.showBase) { const nn = L.slips[i]; const st = nn == null ? 'new' : nn ? slipText(nn) : ''; if (st) lab = lab ? lab + ' · ' + st : st; }
    if (lab) { c.fillStyle = PAL.text2; c.font = fnt(F, 'cond', 9.5); c.textAlign = 'left'; c.fillText(lab, g.r + 6, cy + 3.5); }
  }
  c.restore();
  // footer: legend and page number under a thin Nexus Blue rule
  const fy = yr + bodyH + 18;
  c.fillStyle = PAL.blue; c.fillRect(0, yr + bodyH + 5, W, 0.75);
  c.font = fnt(F, 'ui', 9.5);
  if (O.legend) {
    let lx = 0;
    const sw = (col, label, shape, lvl) => {
      c.fillStyle = col;
      if (shape === 'diamond') { diamond(c, lx + 5, fy - 4, 4.5); c.fill(); }
      else if (shape === 'line') { c.fillRect(lx, fy - 5, 12, 2.5); }
      else if (shape === 'today') { c.fillRect(lx + 5, fy - 10, 1.5, 11); }
      else { c.fillRect(lx, fy - 9, 12, 9); }
      c.fillStyle = PAL.text2; c.textAlign = 'left'; c.fillText(label, lx + 17, fy); lx += 17 + c.measureText(label).width + 16;
    };
    if (O.catColors) {
      for (const k of LEVELS.filter((k2) => L.tasks.some((t) => (t.lvl || 'client') === k2))) sw(colorPrint(L.colors[k]), LEVEL_INFO[k].label, 'box', k);
      sw(PAL.ms, 'Milestone', 'diamond');
    } else if (O.type === 'executive') {
      const used = [...new Set(L.tasks.map((t) => execKey(t, S.work.execColor)))];
      if (used.length === 1) { sw(colorPrint(used[0]), 'Activity'); sw(colorPrint(used[0]), 'Milestone', 'diamond'); }
    } else { sw(PAL.bar, 'Activity'); sw(PAL.ms, 'Milestone', 'diamond'); }
    if (L.showBase) sw(PAL.ghost, 'Baseline (+/− = days later/earlier)', 'line');
    if (L.showLocks) sw(PAL.locked, 'Locked date');
    if (O.today && td >= mn && td <= mx) sw(PAL.today, 'Today', 'today');
    if (O.shade && !isCoarse(L.sc)) { sw(PAL.wknd, S.cal.offDays.length === 2 && S.cal.offDays.includes(0) && S.cal.offDays.includes(6) ? 'Weekend' : 'Non-working'); sw(PAL.hol, 'Holiday'); }
  }
  if (pages > 1) { c.textAlign = 'right'; c.fillStyle = PAL.text2; c.font = fnt(F, 'cond', 10); c.fillText('PAGE ' + page + ' OF ' + pages, W, fy); c.textAlign = 'left'; }
}

/* ---------- phase bands: the brand guide's schedule example ----------
   Activities that follow one another fill the full height as bands, light to dark through the
   project. Activities that overlap them sit on thin lines underneath. Milestones are dashed
   lines with a diamond and a label below. The whole schedule always fits one page. */
function bandLayout(O0, W, H) {
  const O = Object.assign({}, O0);
  const tasks = exportTasks(O.type);
  const items = tasks.map((t) => ({ t, r: S.res.get(t.id) })).filter((x) => x.r);
  const ms = items.filter((x) => x.r.kind === 'milestone').sort((a, b) => a.r.start - b.r.start);
  const bars = items.filter((x) => x.r.kind !== 'milestone').sort((a, b) => a.r.start - b.r.start || b.r.end - a.r.end);
  const main = [], subs = [];
  let lastEnd = -Infinity;
  for (const x of bars) { if (x.r.start >= lastEnd) { main.push(x); lastEnd = x.r.end; } else subs.push(x); }
  const lanes = [];
  for (const x of subs) { let k = lanes.findIndex((ln) => ln.end <= x.r.start); if (k < 0) { lanes.push({ end: 0, items: [] }); k = lanes.length - 1; } lanes[k].items.push(x); lanes[k].end = x.r.end; }
  let minD = Math.min(...items.map((x) => x.r.start)), maxD = Math.max(...items.map((x) => x.r.end));
  const p = ymdOf(minD), q = ymdOf(maxD);
  minD = dayNum(p.y, p.m, 1); maxD = dayNum(q.y, q.m + 1, 0);
  const L = { O, hd: headingInfo(O), items, main, lanes, ms, minD, maxD, span: maxD - minD + 1, W, H, headerH: 40 };
  return L;
}
function bandColors(L) {
  const own = L.main.map((x) => execKey(x.t, S.work.execColor));
  const uniform = new Set(own).size <= 1;
  if (L.O.phaseShades && uniform) {
    const n = L.main.length;
    return L.main.map((x, i) => colorPrint(PHASE_SHADES[n <= 1 ? 3 : Math.round(i * (PHASE_SHADES.length - 1) / (n - 1))]));
  }
  return own.map(colorPrint);
}
function bandDate(x, O) {
  const r = x.r, a = ymdOf(r.start), b = ymdOf(r.finish);
  const d = (p) => MON_S[p.m].toUpperCase() + ' ' + p.d;
  const parts = [];
  if (O.ganttDates === 'range') parts.push(d(a) + ' – ' + d(b) + (a.y !== b.y ? ', ' + b.y : ''));
  else if (O.ganttDates === 'start') parts.push(d(a));
  else if (O.ganttDates === 'finish') parts.push(d(b));
  if (O.dur) parts.push(r.dur % 7 === 0 ? (r.dur / 7) + ' WK' : r.dur + ' D');
  return parts.join('  ·  ');
}
function paintBands(c, F, L, logoAt) {
  const O = L.O, W = L.W, H = L.H;
  c.fillStyle = PAL.bg; c.fillRect(0, 0, W, H);
  c.textAlign = 'left'; c.setLineDash([]);
  paintHeading(c, F, L, W, logoAt);
  const dayW = W / L.span, X = (d) => (d - L.minD) * dayW;
  const y0 = L.titleH + 4, yb = y0 + L.headerH;
  // milestone labels need rows under the chart; work them out first
  c.font = fnt(F, 'cond', 9.5, true);
  const msRows = [];
  const msPos = L.ms.map((x) => {
    const cx = X(x.r.start) + dayW / 2;
    const label = (x.t.name || 'Milestone').toUpperCase() + (O.ganttDates !== 'none' ? '  ' + MON_S[ymdOf(x.r.start).m].toUpperCase() + ' ' + ymdOf(x.r.start).d : '');
    const w = Math.min(c.measureText(label).width, W * 0.4);
    let lx = Math.min(Math.max(0, cx - 8), W - w);
    let row = msRows.findIndex((end) => end + 10 <= lx);
    if (row < 0) { msRows.push(0); row = msRows.length - 1; }
    msRows[row] = lx + w;
    return { x, cx, label, lx, w, row };
  });
  const laneH = 24, msRowH = 15;
  const footH = 10 + L.lanes.length * laneH + (msRows.length ? 12 + msRows.length * msRowH : 0) + 6;
  const bandH = Math.max(80, H - yb - footH);
  const ye = yb + bandH;
  // header: years then months (or quarters when months get too narrow)
  c.strokeStyle = PAL.grid; c.lineWidth = 0.75;
  for (const g of yearSegs(L.minD, L.maxD)) {
    const w = (g.end - g.d + 1) * dayW;
    if (g.d > L.minD) vline(c, X(g.d), y0, ye);
    c.fillStyle = PAL.blue; c.font = fnt(F, 'cond', 11, true);
    if (w > 30) c.fillText(String(g.p.y), X(g.d) + 4, y0 + 13);
  }
  const monthW = 30.4 * dayW;
  c.font = fnt(F, 'cond', 8.5, false);
  if (monthW >= 17) {
    for (const g of monthSegs(L.minD, L.maxD)) {
      const w = (g.end - g.d + 1) * dayW, lab = MON_S[g.p.m].toUpperCase();
      c.strokeStyle = PAL.grid2; vline(c, X(g.d), y0 + 20, y0 + 36);
      c.fillStyle = PAL.blueInk; c.textAlign = 'center'; c.fillText(fitText(c, lab, w - 2), X(g.d) + w / 2, y0 + 32);
    }
  } else {
    for (const g of quarterSegs(L.minD, L.maxD)) {
      const w = (g.end - g.d + 1) * dayW;
      c.strokeStyle = PAL.grid2; vline(c, X(g.d), y0 + 20, y0 + 36);
      if (w >= 14) { c.fillStyle = PAL.blueInk; c.textAlign = 'center'; c.fillText('Q' + g.q, X(g.d) + w / 2, y0 + 32); }
    }
  }
  c.textAlign = 'left';
  c.strokeStyle = PAL.blue; c.lineWidth = 0.75; hline(c, 0, W, y0 + 18); hline(c, 0, W, yb - 2);
  // bands
  const cols = bandColors(L);
  L.main.forEach((x, i) => {
    const l = X(x.r.start), w = Math.max(2, x.r.dur * dayW), col = cols[i], ink = inkOn(col, true); // names are large text (14 pt bold); see docs/DESIGN-SYSTEM.md on the date line
    c.fillStyle = col; c.fillRect(l, yb, w, bandH);
    const name = (x.t.name || 'Untitled').toUpperCase(), sub = bandDate(x, O);
    c.font = fnt(F, 'cond', 14, true);
    const nw = c.measureText(name).width;
    c.font = fnt(F, 'cond', 10, true);
    const sw2 = sub ? c.measureText(sub).width : 0;
    c.fillStyle = ink;
    if (Math.max(nw, sw2) + 14 <= w) { // fits across: centered near the top
      c.textAlign = 'center';
      c.font = fnt(F, 'cond', 14, true); c.fillText(name, l + w / 2, yb + 22);
      if (sub) { c.font = fnt(F, 'cond', 10, true); c.fillText(sub, l + w / 2, yb + 37); }
      c.textAlign = 'left';
    } else if (w >= 15) { // narrow: read upward, as in the brand guide
      c.save(); c.translate(l + w / 2, yb + bandH - 8); c.rotate(-Math.PI / 2);
      const two = sub && w >= 30;
      c.font = fnt(F, 'cond', 14, true); c.fillText(fitText(c, name, bandH - 16), 0, two ? -2 : 5);
      if (two) { c.font = fnt(F, 'cond', 10, true); c.fillText(fitText(c, sub, bandH - 16), 0, 11); }
      c.restore();
    }
  });
  c.strokeStyle = PAL.bg; c.lineWidth = 1;
  for (const x of L.main) vline(c, X(x.r.start), yb, ye); // a hairline of white between phases
  // concurrent work on thin lines beneath the bands
  let ly = ye + 10;
  for (const ln of L.lanes) {
    for (const x of ln.items) {
      const l = X(x.r.start), w = Math.max(2, x.r.dur * dayW), col = colorPrint(execKey(x.t, S.work.execColor));
      c.fillStyle = col; c.fillRect(l, ly, w, 5);
      c.fillRect(l, ly - 3, 1.25, 11); c.fillRect(l + w - 1.25, ly - 3, 1.25, 11);
      c.fillStyle = PAL.text2; c.font = fnt(F, 'cond', 9.5, true);
      const name = (x.t.name || 'Untitled').toUpperCase(), sub = bandDate(x, O);
      const label = sub ? name + '  ' + sub : name;
      c.fillText(fitText(c, label, Math.max(w - 4, 120)), l + 2, ly + 16);
    }
    ly += laneH;
  }
  // milestones: dashed line through the bands, diamond at the base, label below
  const msTop = ly + (L.lanes.length ? 0 : 0) + 4;
  // lines first, then each label on a white knockout, so a line to a lower label passes behind the text instead of through it
  for (const m of msPos) {
    c.save(); c.setLineDash([2.5, 2]); c.strokeStyle = PAL.ink; c.lineWidth = 0.9; vline(c, m.cx, yb, msTop + m.row * msRowH + 2); c.restore();
    c.fillStyle = PAL.ms; diamond(c, m.cx, ye, 5); c.fill();
  }
  c.font = fnt(F, 'cond', 9.5, true);
  for (const m of msPos) {
    const ty = msTop + m.row * msRowH + 11, txt = fitText(c, m.label, m.w + 1);
    c.fillStyle = PAL.bg; c.fillRect(m.lx - 3, ty - 10, c.measureText(txt).width + 6, 13);
    c.fillStyle = PAL.ink; c.fillText(txt, m.lx, ty);
  }
  // today
  const td = todayDay();
  if (O.today && td >= L.minD && td <= L.maxD) {
    const tx = X(td) + dayW / 2;
    c.fillStyle = PAL.today; c.fillRect(tx - 0.75, yb - 2, 1.5, bandH + 2);
    c.beginPath(); c.moveTo(tx - 4, yb - 8); c.lineTo(tx + 4, yb - 8); c.lineTo(tx, yb - 2); c.closePath(); c.fill();
  }
}

/* ---------- jobs: everything needed to paint, page by page ---------- */
const bandPlanFor = (O, P, M) => {
  const W = P.w - 2 * M, Hh = P.h - 2 * M;
  const L = bandLayout(O, W, Hh);
  setHeading(L, LOGO_MIN_PT);
  return L;
};
/* PDF: page geometry in points; paint(c, F, k, logoAt) draws page k in page coordinates */
function pdfJob(O) {
  if (usesBands(O)) {
    const P = PAPER[O.paper] || PAPER.letter, M = 30;
    const L = bandPlanFor(O, P, M);
    return { P, M, count: 1, tasks: L.items.length, paint: (c, F, k, logoAt) => { c.save(); c.translate(M, M); paintBands(c, F, L, (x, y, w, h0) => logoAt(M + x, M + y, w, h0)); c.restore(); } };
  }
  const L = exportLayout(O);
  const plan = planPages(L, O);
  const pages = [];
  for (let rp = 0; rp < plan.rowPages; rp++) {
    const i0 = rp * plan.perPage, i1 = Math.min(L.tasks.length, i0 + plan.perPage);
    for (const win of plan.wins) pages.push({ i0, i1, win });
  }
  const s = plan.s, M = plan.M;
  return {
    P: plan.P, M, s, count: pages.length, across: plan.wins.length, down: plan.rowPages, tasks: L.tasks.length,
    paint: (c, F, k, logoAt) => {
      const pg = pages[k];
      c.save(); c.translate(M, M); c.scale(s, s);
      paintBars(c, F, L, pg.i0, pg.i1, k + 1, pages.length, pg.win, (x, y, w, h0) => logoAt(M + x * s, M + y * s, w * s, h0 * s));
      c.restore();
    },
  };
}
/* image: one picture of the whole schedule, in layout pixels */
function pngJob(O) {
  if (usesBands(O)) {
    const W = 1500, Hh = 900;
    const L = bandLayout(O, W, Hh);
    setHeading(L, LOGO_PX * 1.25);
    return { W, H: Hh, tasks: L.items.length, paint: (c, F, logoAt) => paintBands(c, F, L, logoAt) };
  }
  const L = exportLayout(O);
  const { W, H } = sheetSize(L, 0, L.tasks.length, null);
  const pad = 24;
  return { W: W + 2 * pad, H: H + 2 * pad, tasks: L.tasks.length, paint: (c, F, logoAt) => { c.fillStyle = PAL.bg; c.fillRect(0, 0, W + 2 * pad, H + 2 * pad); c.save(); c.translate(pad, pad); paintBars(c, F, L, 0, L.tasks.length, 1, 1, null, (x, y, w, h0) => logoAt(x + pad, y + pad, w, h0)); c.restore(); } };
}
/* logoAt callbacks get page (or image) coordinates, like jsPDF's addImage, so draw with the base transform only */
const canvasLogo = (c, z) => (x, y, w, h0) => { if (!logoImg) return; c.save(); c.setTransform(z, 0, 0, z, 0, 0); c.drawImage(logoImg, x, y, w, h0); c.restore(); };
/* a canvas of one PDF page, at a given pixel width: used by the preview and the raster fallback */
function pdfPageCanvas(job, k, pxW) {
  const z = pxW / job.P.w;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(job.P.w * z); cv.height = Math.ceil(job.P.h * z);
  const c = cv.getContext('2d');
  c.scale(z, z);
  c.fillStyle = PAL.bg; c.fillRect(0, 0, job.P.w, job.P.h);
  job.paint(c, FONTS_CANVAS, k, canvasLogo(c, z));
  return cv;
}
function pngCanvas(job, maxPx) {
  const SC = Math.min(2, (maxPx || 12000) / job.H, (maxPx || 12000) / job.W);
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(job.W * SC); cv.height = Math.ceil(job.H * SC);
  const c = cv.getContext('2d');
  c.scale(SC, SC);
  job.paint(c, FONTS_CANVAS, canvasLogo(c, SC));
  return cv;
}
async function buildPNG(O) {
  await fontsReady();
  if (O.logo) await loadLogo();
  const cv = pngCanvas(pngJob(O), 12000);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  if (!blob) throw new Error('png');
  return blob;
}
/* vector PDF: the same painting on jsPDF's context2d, with Lato and Roboto Condensed embedded.
   If that drawing surface is missing, fall back to one sharp image per page. */
async function buildPDF(O) {
  await fontsReady();
  if (O.logo) await loadLogo();
  const lib = await loadLib('pdf');
  const job = pdfJob(O);
  const doc = new lib.jsPDF({ orientation: 'landscape', unit: 'pt', format: [job.P.h, job.P.w], compress: true });
  if (doc.setProperties) doc.setProperties({ title: (S.work.name || 'Schedule') + ' - ' + typeLabel(O.type), creator: 'Arch Nexus Toolbox: Scheduler' });
  const vector = !!(doc.context2d && doc.addFileToVFS && doc.addFont);
  if (vector) for (const f of PDF_FONTS) { doc.addFileToVFS(f.file, f.data); doc.addFont(f.file, f.family, f.style); }
  for (let k = 0; k < job.count; k++) {
    if (k > 0) doc.addPage();
    if (vector) {
      const c = doc.context2d;
      job.paint(c, FONTS_PDF, k, (x, y, w, h0) => doc.addImage(LOGO.src, 'PNG', x, y, w, h0, 'arch-nexus-logo', 'SLOW'));
    } else {
      const cv = pdfPageCanvas(job, k, job.P.w * 3);
      doc.addImage(cv.toDataURL('image/png'), 'PNG', 0, 0, job.P.w, job.P.h);
    }
  }
  return doc.output('arraybuffer');
}

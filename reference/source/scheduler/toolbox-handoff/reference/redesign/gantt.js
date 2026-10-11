/* ===== Timeline: the activity list beside the chart, in one scroller =====
   One scroll container holds a grid; the header row is sticky to the top and the activity
   list is sticky to the left, so rows, selection and vertical scrolling can never drift apart.
   Dragging a bar moves an activity (or holds it, if it follows links); dragging its right
   edge changes the duration; the handles at its ends create links. Every drag is one edit,
   so it is undoable and explained like any other. */
let GH = 50, GROW = 32;
const SCALES = { days: { px: 26, label: 'Days' }, weeks: { px: 9, label: 'Weeks' }, months: { px: 2.6, label: 'Months' }, quarters: { px: 1, label: 'Quarters' } };
/* months and quarters are coarse: no day shading, lines at month or quarter starts */
const isCoarse = (sc) => sc === 'months' || sc === 'quarters';
const scaleOf = () => (S.work && SCALES[S.work.scale] ? S.work.scale : 'weeks');
/* the header follows the effective zoom, not just the saved scale */
const tierOf = (dayW) => (dayW >= 16 ? 'days' : dayW >= 4.5 ? 'weeks' : dayW >= 1.6 ? 'months' : 'quarters');
function monthSegs(minD, maxD) {
  const out = [];
  let d = minD;
  while (d <= maxD) { const p = ymdOf(d); const end = Math.min(maxD, dayNum(p.y, p.m + 1, 1) - 1); out.push({ d, end, p }); d = end + 1; }
  return out;
}
function quarterSegs(minD, maxD) {
  const out = [];
  let d = minD;
  while (d <= maxD) { const p = ymdOf(d); const q = Math.floor(p.m / 3); const end = Math.min(maxD, dayNum(p.y, q * 3 + 3, 1) - 1); out.push({ d, end, p, q: q + 1 }); d = end + 1; }
  return out;
}
function yearSegs(minD, maxD) {
  const out = [];
  let d = minD;
  while (d <= maxD) { const p = ymdOf(d); const end = Math.min(maxD, dayNum(p.y + 1, 0, 1) - 1); out.push({ d, end, p }); d = end + 1; }
  return out;
}
/* date window for a schedule at a given scale; pad leaves room for the labels after the last bar */
function ganttRange(rows, dayW, sc, padPx) {
  let minD = Math.min(...rows.map((r) => r.start)) - 2;
  let maxD = Math.max(...rows.map((r) => r.end)) + 3 + Math.ceil((padPx || 120) / dayW);
  if (sc === 'quarters') {
    const p = ymdOf(minD), q = ymdOf(maxD);
    minD = dayNum(p.y, Math.floor(p.m / 3) * 3, 1);
    maxD = dayNum(q.y, Math.floor(q.m / 3) * 3 + 3, 0);
  } else if (sc === 'months') {
    const p = ymdOf(minD), q = ymdOf(maxD);
    minD = dayNum(p.y, p.m, 1);
    maxD = dayNum(q.y, q.m + 1, 0);
  } else {
    minD -= (dowOf(minD) + 6) % 7;
  }
  return { minD, maxD };
}
function ganttGeom(r, minD, dayW) {
  if (r.kind === 'milestone') { const cx = (r.start - minD) * dayW + dayW / 2; return { l: cx - 7, r: cx + 7 }; }
  const l = (r.start - minD) * dayW;
  return { l, r: l + Math.max(3, r.dur * dayW) };
}
function arrowPath(gp, gt, type, y1, y2, rowH) {
  const pts = [];
  if (type === 'SS') {
    const x1 = gp.l, x2 = gt.l, xm = Math.min(x1, x2) - 9;
    pts.push([x1, y1], [xm, y1], [xm, y2], [x2, y2]);
  } else {
    const x1 = gp.r, x2 = gt.l;
    if (x2 - x1 >= 14) { const xm = x1 + 7; pts.push([x1, y1], [xm, y1], [xm, y2], [x2, y2]); }
    else { const ym = y2 > y1 ? y1 + rowH / 2 : y1 - rowH / 2, xa = x1 + 7, xb = x2 - 9; pts.push([x1, y1], [xa, y1], [xa, ym], [xb, ym], [xb, y2], [x2, y2]); }
  }
  return pts;
}
/* everything that follows `id`, directly or through other links */
function downstreamOf(id) {
  const out = new Set();
  if (!id || !S.work) return out;
  const succ = new Map();
  for (const t of S.work.tasks) for (const d of t.deps || []) { if (!succ.has(d.id)) succ.set(d.id, []); succ.get(d.id).push(t.id); }
  const stack = [id];
  while (stack.length) { const x = stack.pop(); for (const y of succ.get(x) || []) if (!out.has(y)) { out.add(y); stack.push(y); } }
  return out;
}
let tlView = null; // geometry of the last render, for zoom, fit and scroll to today

function renderGantt() {
  const root = $('#ganttView');
  const old = root.querySelector('.tl');
  const keepL = old ? old.scrollLeft : null, keepT = old ? old.scrollTop : 0;
  const keepDay = tlView && old ? tlView.minD + (old.scrollLeft + (old.clientWidth - tlView.listW) / 2) / tlView.dayW : null;
  root.textContent = '';
  const exView = S.view === 'exec', ro = S.readonly || exView;
  const tasks = exView ? S.work.tasks.filter(isExecTask) : S.work.tasks;
  if (exView) root.append(exDefaultStrip());
  if (!tasks.length) { root.append(h('div', { class: 'ed-empty', text: exView ? 'No activities are marked for the executive overview yet. In the Table, check Exec on the Client-level activities you want here.' : 'No activities yet. Add one to see the timeline.' })); tlView = null; return; }
  GROW = document.body.classList.contains('dense') ? 27 : 32;
  const rows = tasks.map((t) => S.res.get(t.id));
  const narrow = window.innerWidth <= 860;
  let listW = parseInt(pref('tlList'), 10);
  if (!(listW >= 160 && listW <= 640)) listW = narrow ? 168 : 320;
  if (narrow) listW = Math.min(listW, 168);
  const sc = scaleOf(), dayW = SCALES[sc].px * S.zoomF, tier = tierOf(dayW);
  const avail = Math.max(360, (root.clientWidth || 1000) - listW - 2);
  const showBase = baseActive() && !exView;
  const baseRows = showBase ? tasks.map((t) => baseRow(t.id)) : [];
  const commits = new Map();
  if (!exView) for (const t of tasks) { const cs = commitStatus(t, S.res.get(t.id), S.work.commitWarn); if (cs) commits.set(t.id, cs); }
  const extra = [...commits.values()].map((c) => ({ start: parseDate(c.date), end: parseDate(c.date) + 1 }));
  let { minD, maxD } = ganttRange(rows.concat(baseRows.filter(Boolean), extra), dayW, tier);
  if ((maxD - minD + 1) * dayW < avail) maxD = minD + Math.ceil(avail / dayW);
  const days = maxD - minD + 1, chartW = Math.ceil(days * dayW), bodyH = tasks.length * GROW;
  const X = (d) => (d - minD) * dayW;
  const sel = S.sel && tasks.some((t) => t.id === S.sel) ? S.sel : null;
  const down = exView ? new Set() : downstreamOf(sel);
  const hs = hot();

  const tl = h('div', { class: 'tl', tabindex: '-1' });
  const grid = h('div', { class: 'tl-grid' });
  grid.style.setProperty('--tl-list', listW + 'px');
  grid.style.setProperty('--tl-w', chartW + 'px');
  grid.style.setProperty('--tl-head', GH + 'px');
  const showDate = listW >= 280;

  /* corner + activity list */
  const corner = h('div', { class: 'tl-corner' }, h('span', { class: 'lbl', text: exView ? 'Executive overview' : 'Activity' }), showDate ? h('span', { class: 'lbl cdate', text: 'Finish' }) : null);
  const list = h('div', { class: 'tl-list' });
  tasks.forEach((t, i) => {
    const r = rows[i], w = worst(r.flags);
    const fl = h('span', { class: 'gfl ' + w });
    if (w) { fl.innerHTML = ICON[w]; fl.title = r.flags.map((f) => f.text).join('\n'); }
    list.append(h('button', { class: 'grl' + (isSel(t.id) ? ' sel' : '') + (t.kind === 'milestone' ? ' ms' : ''), type: 'button', 'data-id': t.id,
      title: (t.name || 'Untitled') + (exView ? '' : '\nClick to select. Double-click for details. Shift-click or Ctrl-click for several. Drag to reorder.'),
      onclick: (ev) => { if (!exView) selectGantt(t.id, ev); }, ondblclick: () => { if (!exView) openTask(t.id); },
      onpointerdown: (ev) => { if (!exView) startRowDrag(ev, t.id, labelRowsOf); } },
    exView ? exSwatch(t) : null,
    h('span', { class: 'rn mono', text: S.work.tasks.indexOf(t) + 1 }), h('span', { class: 'nm', text: t.name || 'Untitled' }), fl,
    showDate ? h('span', { class: 'cd', text: fmtShortNoDow(r.kind === 'milestone' ? r.start : r.finish) }) : null));
  });

  /* header: two tiers */
  const head = h('div', { class: 'tl-head' });
  const t1 = h('div', { class: 'tier t1' }), t2 = h('div', { class: 'tier t2' });
  const seg = (tierEl, cls, d0, d1, text) => { const e = h('div', { class: cls, text }); e.style.left = X(d0) + 'px'; e.style.width = (d1 - d0 + 1) * dayW + 'px'; tierEl.append(e); };
  if (tier === 'quarters' || tier === 'months') {
    for (const g of yearSegs(minD, maxD)) seg(t1, 'mo', g.d, g.end, (g.end - g.d + 1) * dayW > 40 ? String(g.p.y) : '');
    if (tier === 'quarters') for (const g of quarterSegs(minD, maxD)) seg(t2, 'mo m2', g.d, g.end, (g.end - g.d + 1) * dayW > 30 ? 'Q' + g.q : '');
    else for (const g of monthSegs(minD, maxD)) seg(t2, 'mo m2', g.d, g.end, (g.end - g.d + 1) * dayW > 26 ? MON_S[g.p.m] : '');
  } else {
    for (const g of monthSegs(minD, maxD)) { const wpx = (g.end - g.d + 1) * dayW; seg(t1, 'mo', g.d, g.end, wpx > 90 ? MON_L[g.p.m] + ' ' + g.p.y : wpx > 34 ? MON_S[g.p.m] + (g.p.m === 0 ? ' ' + g.p.y : '') : ''); }
  }
  head.append(t1, t2);

  /* chart body */
  const chart = h('div', { class: 'tl-chart' });
  const gin = h('div', { class: 'gin' });
  gin.style.width = chartW + 'px';
  gin.style.height = bodyH + 'px';
  for (let n = minD; n <= maxD; n++) {
    const x = X(n), why = S.cal.reason(n), p = ymdOf(n);
    if (why && (tier === 'days' || tier === 'weeks')) {
      const isHol = S.cal.isHoliday(n);
      const e = h('div', { class: isHol ? 'hl' : 'wk', title: isHol ? why + ' · ' + fmtShort(n) : '' });
      e.style.left = x + 'px'; e.style.width = dayW + 'px';
      gin.append(e);
    }
    const isMon = dowOf(n) === 1, isFirst = p.d === 1, qStart = isFirst && p.m % 3 === 0, yStart = isFirst && p.m === 0;
    const minor = tier === 'quarters' ? qStart : tier === 'months' ? isFirst : isMon;
    const major = tier === 'quarters' || tier === 'months' ? yStart : isFirst;
    if (minor || major) { const l = h('div', { class: 'wl' + (major ? ' major' : '') }); l.style.left = x + 'px'; gin.append(l); }
    if (tier === 'days' || (tier === 'weeks' && isMon)) {
      const tk = h('div', { class: 'tk' + (why ? ' off' : '') }, h('span', { text: p.d }), tier === 'days' ? h('small', { text: DOW_S[dowOf(n)][0] }) : null);
      tk.style.left = x + 'px'; tk.style.width = (tier === 'days' ? dayW : 7 * dayW) + 'px';
      t2.append(tk);
    }
  }
  for (let i = 1; i <= tasks.length; i++) { const l = h('div', { class: 'rl' }); l.style.top = i * GROW - 1 + 'px'; gin.append(l); }
  for (const sid of selIds()) { const i = tasks.findIndex((t) => t.id === sid); if (i >= 0) { const b = h('div', { class: 'selband' }); b.style.top = i * GROW + 'px'; gin.append(b); } }
  const td = todayDay();
  if (td >= minD && td <= maxD) {
    const tx = X(td) + dayW / 2;
    const tl2 = h('div', { class: 'today', title: 'Today, ' + fmtShort(td) }); tl2.style.left = tx + 'px'; gin.append(tl2);
    const tt = h('div', { class: 'today-tag', text: 'Today' }); tt.style.left = tx + 'px'; head.append(tt);
  }
  /* links */
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'deps' + (sel ? ' has-sel' : ''));
  svg.setAttribute('width', chartW); svg.setAttribute('height', bodyH);
  const idx = new Map(tasks.map((t, i) => [t.id, i]));
  tasks.forEach((t, j) => {
    for (const dp of t.deps || []) {
      const i = idx.get(dp.id);
      if (i == null || rows[j].cycle) continue;
      const pts = arrowPath(ganttGeom(rows[i], minD, dayW), ganttGeom(rows[j], minD, dayW), dp.type, i * GROW + GROW / 2, j * GROW + GROW / 2, GROW);
      const isHot = sel && (sel === t.id || sel === dp.id || (down.has(t.id) && (down.has(dp.id) || dp.id === sel)));
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', 'M' + pts.map((pt) => pt[0].toFixed(1) + ' ' + pt[1].toFixed(1)).join('L'));
      path.setAttribute('class', 'dp' + (isHot ? ' hot' : ''));
      svg.append(path);
      const [x2, y2] = pts[pts.length - 1];
      const hd = document.createElementNS(NS, 'path');
      hd.setAttribute('d', 'M' + x2 + ' ' + y2 + 'l-6 -3.5v7z');
      hd.setAttribute('class', 'dh' + (isHot ? ' hot' : ''));
      svg.append(hd);
    }
  });
  gin.append(svg);
  /* bars */
  tasks.forEach((t, i) => {
    const r = rows[i], g = ganttGeom(r, minD, dayW), top = i * GROW;
    const w = worst(r.flags), ms = r.kind === 'milestone';
    const cs = commits.get(t.id);
    const tip = (t.name || 'Untitled') + '\n' + fmtShort(r.start) + (ms ? '' : ' – ' + fmtShort(r.finish) + ' (' + r.dur + (r.dur === 1 ? ' day)' : ' days)')) + (t.locked ? '\nLocked date' : '') + (r.held ? '\nHeld: starts later than its links require' : '') + (showBase && slipOf(t.id) ? '\nSlip: ' + slipText(slipOf(t.id)) + ' vs baseline' : '') + (cs ? '\nCommitment ' + fmtShort(parseDate(cs.date)) + ': ' + COMMIT_WORD[cs.status].toLowerCase() + ' (' + commitText(cs) + ')' : '') + ((t.lvl || 'client') !== 'client' ? '\nAudience: ' + LEVEL_INFO[t.lvl].label : '') + (ro || t.locked ? '' : '\nDrag to move' + (ms ? '' : ', drag the right edge to change the duration') + '. Click for details.');
    const PAD = 10, bw0 = g.r - g.l;
    const wrap = h('div', { class: 'bw' + (isSel(t.id) ? ' sel' : '') + (down.has(t.id) ? ' down' : '') + (hs && hs.has(t.id) ? ' moved' : ''), 'data-id': t.id });
    wrap.style.left = g.l - PAD + 'px'; wrap.style.width = bw0 + 2 * PAD + 'px'; wrap.style.top = top + 'px';
    let el;
    if (ms) {
      el = h('div', { class: 'dia lv-' + (t.lvl || 'client') + (t.locked ? ' lk' : '') + (w === 'err' ? ' err' : ''), title: tip });
      el.style.left = PAD + 1 + 'px'; el.style.top = (GROW - 12) / 2 + 'px';
    } else {
      el = h('div', { class: 'bar lv-' + (t.lvl || 'client') + (t.locked ? ' lk' : '') + (r.held ? ' held' : '') + (w === 'err' ? ' err' : w === 'warn' ? ' wr' : ''), title: tip });
      el.style.left = PAD + 'px'; el.style.width = bw0 + 'px'; el.style.top = (GROW - 14) / 2 + 'px';
      if (r.held && r.driven != null) el.style.setProperty('--hold-w', Math.max(0, (r.start - r.driven) * dayW) + 'px');
      if (t.locked && bw0 >= 18) el.append(h('span', { class: 'bl', html: icon('lock', 11) }));
      if (!ro && !t.locked) el.append(h('span', { class: 'rsz', 'data-rsz': '1', title: 'Drag to change the duration' }));
    }
    if (!exView) { el.tabIndex = 0; el.setAttribute('role', 'button'); }
    el.setAttribute('aria-label', (t.name || 'Untitled') + ', ' + fmtShort(r.start) + (ms ? '' : ' to ' + fmtShort(r.finish)) + (exView ? '.' : '. Open details.'));
    if (!exView) {
      el.addEventListener('pointerdown', (e) => startBarDrag(e, t.id, { el, wrap, gin, minD, dayW, top, tl }));
      el.addEventListener('click', () => { if (S.suppressClick) return; openTask(t.id); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTask(t.id); } });
    } else { el.style.cursor = 'default'; el.style.background = colorCss(execKey(t, S.work.execColor)); }
    wrap.append(el);
    if (!ro) {
      const out = ms ? 5 : 0;
      for (const end of ['start', 'finish']) {
        const nd = h('div', { class: 'node ' + end, 'data-end': end, title: end === 'finish' ? 'Drag onto another activity to make it start after this one finishes' : 'Drag onto another activity to make it start when this one starts' });
        nd.style.left = (end === 'start' ? PAD - 5 - out : PAD + bw0 - 5 + out) + 'px';
        nd.style.top = GROW / 2 - 5 + 'px';
        nd.addEventListener('pointerdown', (e) => startLinkDrag(e, { id: t.id, end, gin, rows, tasks, x: (end === 'start' ? g.l - out : g.r + out), y: top + GROW / 2 }));
        wrap.append(nd);
      }
    }
    if (showBase) {
      const br = baseRow(t.id);
      if (br) {
        const gb = ganttGeom(br, minD, dayW);
        const gh = h('div', { class: 'bghost' + (ms ? ' ms' : ''), title: 'Baseline: ' + (ms ? fmtShort(br.start) : fmtShort(br.start) + ' – ' + fmtShort(br.finish)) });
        if (ms) { gh.style.left = (gb.l + gb.r) / 2 - 4 + 'px'; gh.style.top = top + GROW - 9 + 'px'; }
        else { gh.style.left = gb.l + 'px'; gh.style.width = gb.r - gb.l + 'px'; gh.style.top = top + (GROW + 14) / 2 + 3 + 'px'; }
        gin.append(gh);
      }
    }
    if (cs) {
      const cd = parseDate(cs.date);
      const mk = h('div', { class: 'cmk ' + cs.status, title: 'Commitment: ' + fmtShort(cd) + (cs.note ? ' (' + cs.note + ')' : '') + '. ' + COMMIT_WORD[cs.status] + ', ' + commitText(cs) + '.' });
      mk.style.left = (ms ? X(cd) + dayW / 2 : X(cd + 1)) + 'px'; mk.style.top = top + 4 + 'px';
      gin.append(mk);
    }
    gin.append(wrap);
    const lab = h('div', { class: 'blab', text: ms ? fmtShortNoDow(r.start) : fmtShortNoDow(r.start) + ' – ' + fmtShortNoDow(r.finish) + ' · ' + r.dur + 'd' });
    if (showBase) { const n = slipOf(t.id); if (n) lab.append(h('span', { class: 'slip ' + (n > 0 ? 'late' : 'early'), text: ' · ' + slipText(n) })); else if (n == null) lab.append(h('span', { class: 'slip new', text: ' · new' })); }
    let lx = g.r + 8;
    if (cs) lx = Math.max(lx, (ms ? X(parseDate(cs.date)) + dayW / 2 : X(parseDate(cs.date) + 1)) + 12);
    lab.style.left = lx + 'px'; lab.style.top = top + (GROW - 14) / 2 + 'px';
    gin.append(lab);
  });
  chart.append(gin);
  grid.append(corner, head, list, chart);
  tl.append(grid);
  // the split between the list and the chart
  for (const host of [corner, list]) {
    const sp = h('div', { class: 'tl-split', title: 'Drag to resize the activity list' });
    sp.style.left = listW + 'px';
    sp.style.position = 'absolute'; sp.style.top = '0'; sp.style.bottom = '0'; sp.style.left = 'auto'; sp.style.right = '-5px';
    sp.addEventListener('pointerdown', (e) => startSplit(e, listW, grid, sp));
    host.append(sp);
  }
  tl.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e); } }, { passive: false });
  root.append(tl);

  /* legend and notes */
  const foot = h('div', { class: 'tl-foot' });
  let any = false;
  if (S.detail && !exView) {
    any = true;
    for (const k of LEVELS) foot.append(h('span', { class: 'lg aud', title: LEVEL_INFO[k].hint }, h('span', { class: 'sw lv-' + k }), LEVEL_INFO[k].label));
  }
  if (!exView) { foot.append(h('span', { class: 'lg' }, h('span', { class: 'sw dm' }), 'Milestone')); }
  if (showBase) {
    any = true;
    const bl = S.work.baseline;
    foot.append(h('span', { class: 'lg basestrip' }, h('span', { class: 'bghost key' }), 'Baseline, set ' + whenText(bl.at) + (bl.by ? ' by ' + nameOf(bl.by) : '')), h('span', { class: 'slip late', text: '+ later' }), h('span', { class: 'slip early', text: '− earlier' }));
  }
  if (commits.size) { any = true; foot.append(h('span', { class: 'lg' }, h('span', { class: 'cmk', style: 'position:relative;height:12px;display:inline-block;margin:0 4px 0 2px' }), 'Commitment (red when the forecast misses it)')); }
  if (S.detail && !exView && !S.readonly) foot.append(h('button', { class: 'btn sm', type: 'button', text: 'Colors…', onclick: openSettings }));
  if (any || !exView) root.append(foot);

  tlView = { minD, maxD, dayW, listW, chartW, tier };
  if (keepDay != null && S.zoomJustChanged) tl.scrollLeft = Math.max(0, (keepDay - minD) * dayW - (tl.clientWidth - listW) / 2);
  else if (keepL != null) tl.scrollLeft = keepL;
  else if (td >= minD && td <= maxD && !S.didScrollToday) { tl.scrollLeft = Math.max(0, X(td) - 80); }
  tl.scrollTop = keepT;
  S.zoomJustChanged = false;
}
function selectGantt(id, ev) {
  if (S.suppressClick) return;
  clickSelect(id, ev, { toggle: true });
  renderGantt();
  renderBulk();
  if (S.inspect && S.sel && !multiOn()) openTask(S.sel, { keep: true });
}

/* ----- zoom: changes only this person's view; the saved scale is for exports ----- */
function zoomBy(f) {
  if (!S.work) return;
  S.zoomF = clamp(S.zoomF * f, 0.08, 14);
  S.zoomJustChanged = true;
  renderGantt();
}
function fitTimeline() {
  if (!S.work) return;
  const tasks = S.view === 'exec' ? S.work.tasks.filter(isExecTask) : S.work.tasks;
  if (!tasks.length) return;
  const rows = tasks.map((t) => S.res.get(t.id));
  const lo = Math.min(...rows.map((r) => r.start)), hi = Math.max(...rows.map((r) => r.end));
  const root = $('#ganttView');
  const listW = tlView ? tlView.listW : 320;
  const avail = Math.max(300, (root.clientWidth || 1000) - listW - 150);
  const want = avail / Math.max(7, hi - lo + 6);
  S.zoomF = clamp(want / SCALES[scaleOf()].px, 0.08, 14);
  renderGantt();
  const tl = root.querySelector('.tl');
  if (tl && tlView) tl.scrollLeft = Math.max(0, (lo - 2 - tlView.minD) * tlView.dayW);
}
function scrollToToday() {
  const tl = $('#ganttView .tl');
  if (!tl || !tlView) return;
  const td = todayDay();
  if (td < tlView.minD || td > tlView.maxD) { toast('Today is outside this schedule’s dates.'); return; }
  tl.scrollTo({ left: Math.max(0, (td - tlView.minD) * tlView.dayW - (tl.clientWidth - tlView.listW) / 3), behavior: 'smooth' });
}
function startSplit(e, w0, grid, sp) {
  e.preventDefault(); e.stopPropagation();
  const x0 = e.clientX;
  sp.classList.add('on');
  let w = w0;
  const move = (ev) => { w = clamp(Math.round(w0 + ev.clientX - x0), 160, 640); grid.style.setProperty('--tl-list', w + 'px'); };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); sp.classList.remove('on'); pref('tlList', String(w)); renderGantt(); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}

/* ----- drag a bar to move it, or its right edge to change the duration ----- */
function startBarDrag(e, id, g) {
  if (S.readonly || S.view === 'exec' || (e.button != null && e.button > 0)) return;
  const t = taskById(id), r = S.res.get(id);
  if (!t || !r) return;
  const resize = !!(e.target && e.target.dataset && e.target.dataset.rsz);
  if (t.locked) return; // locked dates stay put; a click opens details where it can be unlocked
  e.stopPropagation();
  const x0 = e.clientX;
  let started = false, delta = 0, ghost = null, tip = null, valid = true;
  const ms = r.kind === 'milestone';
  const begin = () => {
    started = true;
    document.body.classList.add(resize ? 'bar-resizing' : 'bar-dragging');
    g.el.classList.add('drag');
    ghost = h('div', { class: 'bar-ghost' });
    tip = h('div', { class: 'dragtip' });
    g.gin.append(ghost, tip);
  };
  const describe = () => {
    let text = '', ns = r.start, dur = r.dur;
    valid = true;
    if (resize) {
      dur = Math.max(1, r.dur + delta);
      text = 'Finish ' + fmtShort(r.start + dur - 1) + ' · ' + dur + (dur === 1 ? ' day' : ' days');
    } else {
      ns = r.start + delta;
      if (!r.anchored && ns < r.driven) { valid = false; ns = r.driven; text = 'Its links don’t allow a start before ' + fmtShort(r.driven); }
      else if (!r.anchored) text = (ns === r.driven ? 'Follows its links: ' : 'Hold until ') + fmtShort(ns) + (ms ? '' : ' – ' + fmtShort(ns + r.dur - 1));
      else text = (ms ? '' : 'Start ') + fmtShort(ns) + (ms ? '' : ' – ' + fmtShort(ns + r.dur - 1));
      const why = S.cal.reason(ns);
      if (why && valid) text += ' · ' + why;
    }
    const left = (ns - g.minD) * g.dayW, width = ms ? 12 : Math.max(3, dur * g.dayW);
    ghost.className = 'bar-ghost' + (valid ? '' : ' bad');
    ghost.style.left = (ms ? left + g.dayW / 2 - 6 : left) + 'px'; ghost.style.width = width + 'px';
    ghost.style.top = g.top + (GROW - (ms ? 12 : 14)) / 2 + 'px'; ghost.style.height = (ms ? 12 : 14) + 'px';
    if (ms) ghost.style.transform = 'rotate(45deg)';
    tip.className = 'dragtip' + (valid ? '' : ' bad');
    tip.textContent = text;
    tip.style.left = Math.max(4, Math.min(left + width + 12, parseFloat(g.gin.style.width) - 260)) + 'px';
    tip.style.top = Math.max(0, g.top - 30) + 'px';
  };
  const move = (ev) => {
    const dx = ev.clientX - x0;
    if (!started) { if (Math.abs(dx) < 4) return; begin(); }
    delta = Math.round(dx / g.dayW);
    describe();
  };
  const end = (commit) => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel);
    document.removeEventListener('keydown', key);
    if (!started) return;
    document.body.classList.remove('bar-dragging', 'bar-resizing');
    S.suppressClick = true; setTimeout(() => { S.suppressClick = false; }, 0);
    if (ghost) ghost.remove(); if (tip) tip.remove(); g.el.classList.remove('drag');
    if (!commit || !delta) { renderGantt(); return; }
    S.sel = id; S.multi = new Set();
    if (resize) { const dur = Math.max(1, r.dur + delta); if (dur !== r.dur) edit(() => { taskById(id).duration = dur; }); else renderGantt(); return; }
    let ns = r.start + delta;
    if (r.anchored) { edit(() => { taskById(id).start = fmtISO(ns); }); return; }
    if (ns < r.driven) ns = r.driven;
    edit(() => { taskById(id).notBefore = ns === r.driven ? null : fmtISO(ns); });
    if (!valid) toast('Its links don’t allow a start before ' + fmtShort(r.driven) + '. Change a link or lag to move it earlier.');
  };
  const up = () => end(true);
  const cancel = () => end(false);
  const key = (ev) => { if (ev.key === 'Escape') end(false); };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
  document.addEventListener('keydown', key);
}

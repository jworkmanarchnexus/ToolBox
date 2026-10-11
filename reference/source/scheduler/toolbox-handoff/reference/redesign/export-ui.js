/* ===== Export workspace =====
   A full-window workspace: settings on the left, a true preview on the right, the download
   at the bottom. Format and audience can both change without leaving it. The PDF preview is the
   actual page (same layout, page cut, fonts and logo), and the table formats preview their rows. */
const KIND_LABEL = { pdf: 'PDF', png: 'image', xlsx: 'Excel file', csv: 'CSV file' };
const KIND_SHORT = { pdf: 'PDF', png: 'Image', xlsx: 'Excel', csv: 'CSV' };
let xwReturnFocus = null;
function openExportDialog(kind0) {
  let kind = kind0;
  const isGantt = () => kind === 'pdf' || kind === 'png';
  const XT = xTypes();
  const counts = Object.fromEntries(XT.map((t) => [t, exportTasks(t).length]));
  const picks = Object.fromEntries(XT.map((t) => [t, new Set(exportTasks(t).map((x) => x.id))]));
  const total = S.work.tasks.length;
  const Os = {};
  const optsOf = (type) => { if (!Os[type]) { Os[type] = loadXO(type); Os[type].desc = loadDesc(type) || S.work.info.issue || ''; } return Os[type]; };
  let active = null, page = 0;
  try { active = localStorage.getItem('schedsheet:xtype'); } catch (e) { active = null; }
  if (!XT.includes(active) || !counts[active]) active = counts.internal ? 'internal' : (XT.find((t) => counts[t] > 0) || 'internal');

  const root = $('#modalRoot');
  xwReturnFocus = document.activeElement;
  const fmtSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Format' });
  const tabs = h('div', { class: 'xtabs', role: 'tablist', 'aria-label': 'Export for' });
  const info = h('div', { class: 'xt-info' });
  const shareBar = h('div', { class: 'xo-share' });
  const body = h('div');
  const preview = h('div', { class: 'xo-prev', 'aria-live': 'polite' });
  const prevNav = h('div', { class: 'xw-pnav' });
  const summary = h('span', { class: 'xw-sum' });
  const dl = h('button', { type: 'button', class: 'btn primary', text: 'Download' });
  const cancel = h('button', { type: 'button', class: 'btn', text: 'Cancel' });
  const closeBtn = h('button', { type: 'button', class: 'btn icon ghost', title: 'Close export', 'aria-label': 'Close export', html: icon('x', 18) });
  const ws = h('div', { class: 'xw', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'xwTitle' },
    h('div', { class: 'xw-top' },
      h('h2', { id: 'xwTitle', text: 'Export' }),
      h('div', { class: 'xw-grp' }, h('span', { class: 'xw-lbl', text: 'Format' }), fmtSeg),
      h('div', { class: 'xw-grp' }, h('span', { class: 'xw-lbl', text: 'For' }), tabs),
      h('span', { class: 'grow' }), closeBtn),
    h('div', { class: 'xw-main' },
      h('div', { class: 'xw-opts' }, info, shareBar, body),
      h('div', { class: 'xw-prev' }, preview, prevNav)),
    h('div', { class: 'xw-foot' }, summary, h('span', { class: 'grow' }), h('div', { class: 'dlg-act' }, cancel, dl)));
  let timer = null, token = 0;
  const close = () => {
    clearTimeout(timer);
    root.textContent = '';
    document.removeEventListener('keydown', onKey, true);
    if (xwReturnFocus && xwReturnFocus.focus && document.contains(xwReturnFocus)) xwReturnFocus.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') { // keep focus inside the workspace
      const f = [...ws.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex="0"]')].filter((x) => x.offsetParent !== null || !x.getClientRects);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };

  const paintFormat = () => {
    fmtSeg.textContent = '';
    for (const k of ['pdf', 'png', 'xlsx', 'csv']) {
      fmtSeg.append(h('button', { type: 'button', 'aria-pressed': String(kind === k), 'data-kind': k, text: KIND_SHORT[k], onclick: () => { if (kind === k) return; kind = k; page = 0; paintAll(); } }));
    }
  };
  const updateButton = () => {
    dl.disabled = counts[active] === 0;
    dl.textContent = 'Download ' + typeLabel(active) + ' ' + KIND_LABEL[kind];
  };
  const paintTabs = () => {
    tabs.textContent = '';
    for (const type of XT) {
      const n = counts[type];
      const btn = h('button', { type: 'button', role: 'tab', 'aria-selected': String(active === type), class: 'xtab-b', onclick: () => { active = type; page = 0; paintAll(); } },
        h('strong', { text: typeLabel(type) }), h('small', { text: n + (n === 1 ? ' activity' : ' activities') }));
      tabs.append(h('div', { class: 'xtab' + (active === type ? ' on' : '') }, btn));
    }
  };
  const paintInfo = () => {
    const kept = counts[active], left = total - kept;
    info.textContent = '';
    info.append(h('p', { class: 'xo-note xo-preset', text: PRESET_NOTE[active] || '' }));
    info.append(h('p', { class: 'xt-sum' }, h('strong', { text: kept + ' of ' + total + ' activities. ' }), left ? left + ' left out.' : 'Nothing is left out.'));
    if (active === 'executive' && !kept) info.append(h('p', { class: 'muted xo-note', text: 'No activities are marked for the executive overview yet. Check Exec on the Client-level activities you want, in the Table.' }));
    if (left) {
      const hidden = S.work.tasks.filter((t) => !picks[active].has(t.id));
      info.append(h('details', { class: 'xo-hidden' }, h('summary', { text: 'Show the ' + left + ' left out' }),
        h('ul', null, hidden.map((t) => h('li', null, (t.name || 'Untitled') + ' ', h('small', { class: 'muted', text: '(' + (active === 'executive' && lvRank(t) === 0 ? 'not marked Exec' : LEVEL_INFO[t.lvl || 'client'].label) + ')' }))))));
    }
    if (active !== 'internal') info.append(h('p', { class: 'muted xo-note', text: 'Dates still come from the full schedule, including what is left out. Locks, holds, issues and arrows to hidden activities are never included.' }));
  };

  /* ----- preview ----- */
  const fmtCell = (v, c, dateCols) => (dateCols.includes(c) && v !== '' && typeof v === 'number' ? fmtLong(v) : String(v == null ? '' : v));
  const redraw = () => {
    clearTimeout(timer);
    const my = ++token;
    timer = setTimeout(async () => {
      const O = Object.assign({}, optsOf(active), { type: active });
      if (isGantt()) { await fontsReady(); if (O.logo) await loadLogo(); }
      if (my !== token) return;
      preview.textContent = ''; prevNav.textContent = '';
      if (!counts[active]) { preview.append(h('p', { class: 'pnote', text: 'Nothing to export for this audience yet.' })); summary.textContent = ''; return; }
      try {
        if (kind === 'pdf') {
          const job = pdfJob(O);
          page = Math.max(0, Math.min(page, job.count - 1));
          const avail = (preview.parentNode && preview.parentNode.clientWidth) || 1000;
          const cv = pdfPageCanvas(job, page, Math.min(2400, Math.max(800, (avail - 48) * (window.devicePixelRatio || 1))));
          cv.setAttribute('role', 'img');
          cv.setAttribute('aria-label', 'Page ' + (page + 1) + ' of ' + job.count + ' of the ' + typeLabel(active) + ' PDF');
          preview.append(h('div', { class: 'sheet', style: 'aspect-ratio:' + job.P.w + '/' + job.P.h }, cv));
          if (job.count > 1) {
            prevNav.append(
              h('button', { type: 'button', class: 'btn sm', html: icon('chevron-left', 14), 'aria-label': 'Previous page', disabled: page === 0 ? '' : null, onclick: () => { page--; redraw(); } }),
              h('span', { text: 'Page ' + (page + 1) + ' of ' + job.count }),
              h('button', { type: 'button', class: 'btn sm', html: icon('chevron-right', 14), 'aria-label': 'Next page', disabled: page >= job.count - 1 ? '' : null, onclick: () => { page++; redraw(); } }));
          }
          const bits = [(PAPER[O.paper] || PAPER.letter).label + ', landscape', job.count + (job.count === 1 ? ' page' : ' pages') + (job.across > 1 ? ' (' + job.across + ' across, ' + job.down + ' down)' : '')];
          summary.textContent = 'PDF · ' + bits.join(' · ') + ' · vector text';
          if (job.s && job.s < 0.6) prevNav.append(h('p', { class: 'pnote', text: 'Fitting to the page prints at about ' + Math.round(job.s * 100) + '% size, so text will be small. A coarser time scale or larger paper keeps it readable.' }));
        } else if (kind === 'png') {
          const job = pngJob(O);
          const cv = pngCanvas(job, 2400);
          cv.setAttribute('role', 'img');
          cv.setAttribute('aria-label', 'Preview of the ' + typeLabel(active) + ' image');
          preview.append(h('div', { class: 'sheet' }, cv));
          const SC = Math.min(2, 12000 / job.H, 12000 / job.W);
          summary.textContent = 'PNG image · ' + Math.ceil(job.W * SC) + ' × ' + Math.ceil(job.H * SC) + ' px';
        } else {
          const { head, rows, dateCols } = tableData(active, O);
          const n = Math.min(rows.length, 14);
          preview.append(h('div', { class: 'sheet xw-table' }, h('table', { class: 'xw-tbl' },
            h('thead', null, h('tr', null, head.map((x) => h('th', { text: x })))),
            h('tbody', null, rows.slice(0, n).map((r) => h('tr', null, r.map((v, c) => h('td', { text: fmtCell(v, c, dateCols) }))))))));
          if (rows.length > n) preview.append(h('p', { class: 'pnote', text: 'Showing the first ' + n + ' of ' + rows.length + ' rows.' }));
          summary.textContent = (kind === 'csv' ? 'CSV' : 'Excel') + ' · ' + rows.length + ' rows · ' + head.length + ' columns';
        }
      } catch (e) {
        preview.append(h('p', { class: 'pnote', text: 'Preview unavailable.' }));
      }
    }, 70);
  };

  /* ----- options ----- */
  const paintBody = () => {
    body.textContent = '';
    const O = optsOf(active), type = active;
    const chk = (key, label) => {
      const i = h('input', { type: 'checkbox', id: 'xo_' + key });
      i.checked = !!O[key];
      i.addEventListener('change', () => { O[key] = i.checked; if (key === 'descOn') { const d = $('#xo_desc'); if (d) d.disabled = !i.checked; } redraw(); if (!isGantt()) paintBody(); });
      return h('label', { class: 'chk', for: 'xo_' + key }, i, ' ' + label);
    };
    const sel = (key, label, opts, after) => {
      const s2 = h('select', { id: 'xo_' + key, class: 'txt' }, opts.map(([v, t]) => h('option', { value: v, text: t })));
      s2.value = O[key];
      s2.addEventListener('change', () => { O[key] = s2.value; page = 0; if (after) after(); redraw(); });
      return h('div', { class: 'xo-field' }, h('label', { for: 'xo_' + key, text: label }), s2);
    };
    if (!isGantt()) {
      const head = tableData(active, O).head;
      body.append(h('div', { class: 'xo-form' }, h('fieldset', null, h('legend', { text: 'Columns' }),
        baseActive() ? chk('baseline', 'Include baseline and slip columns') : null,
        h('p', { class: 'muted xo-note', text: head.join(', ') + '.' }),
        type !== 'internal' ? h('p', { class: 'muted xo-note', text: 'Issues, locks and holds are only in the Internal file.' }) : null)));
      return;
    }
    const canBands = type === 'executive' || type === 'client';
    const bands = canBands && O.style === 'bands';
    const descIn = h('input', { type: 'text', id: 'xo_desc', class: 'txt', placeholder: 'e.g. Issued for owner review, rev 2', autocomplete: 'off', maxlength: '160' });
    descIn.value = O.desc || '';
    descIn.disabled = !O.descOn;
    descIn.addEventListener('input', () => { O.desc = descIn.value; redraw(); });
    const dateOpts = (both) => [['none', 'None'], ['start', 'Start'], ['finish', 'Finish'], [both, 'Start and finish']];
    body.append(h('div', { class: 'xo-form' },
      canBands ? h('fieldset', null, h('legend', { text: 'Layout' }),
        sel('style', 'Draw activities as', [['bars', 'Bars, one row per activity'], ['bands', 'Phase bands (one-page overview)']], paintBody),
        bands ? h('p', { class: 'muted xo-note', text: 'Activities that follow one another become full-height bands; overlapping ones sit on lines underneath. Always one page.' }) : null) : null,
      bands ? null : h('fieldset', null, h('legend', { text: 'Time scale' }),
        sel('scale', 'Scale for this export', [['auto', 'Same as the schedule (' + SCALES[scaleOf()].label + ')']].concat(Object.keys(SCALES).map((k) => [k, SCALES[k].label]))),
        h('p', { class: 'muted xo-note', text: 'Only changes the export. The schedule keeps its own scale.' })),
      h('fieldset', null, h('legend', { text: 'Dates' }),
        sel('ganttDates', bands ? 'On each phase' : 'Next to each bar', dateOpts('range')),
        bands ? null : sel('leftDates', 'In the activity list', dateOpts('both')),
        chk('dur', 'Durations')),
      h('fieldset', null, h('legend', { text: 'Show' }),
        bands ? chk('phaseShades', 'Shade phases light to dark (brand guide)') : null,
        bands ? null : chk('numbers', 'Activity numbers'),
        bands ? null : chk('arrows', 'Dependency arrows'),
        chk('today', 'Today marker'),
        bands ? null : chk('shade', 'Weekend and holiday shading'),
        !bands && baseActive() ? chk('baseline', 'Baseline and slip') : null,
        !bands && type === 'internal' ? chk('flags', 'Issue markers') : null,
        !bands && (type === 'design' || type === 'internal') ? chk('catColors', 'Color by audience (with legend)') : null,
        bands ? null : chk('legend', 'Legend')),
      h('fieldset', null, h('legend', { text: 'Heading' }),
        projText() ? chk('projInfo', 'Project number and client') : null,
        chk('logo', 'Arch Nexus logo'),
        chk('saved', 'Last saved by and date'), chk('printed', 'Print date'),
        chk('descOn', 'Description under the title'), descIn),
      kind === 'pdf' ? h('fieldset', null, h('legend', { text: 'Page' }),
        sel('paper', 'Paper size (landscape)', Object.keys(PAPER).map((k) => [k, PAPER[k].label])),
        bands ? null : chk('fit', 'Fit all dates on one page width'),
        bands ? null : h('p', { class: 'muted xo-note', text: 'Shrinks the chart so it never splits across pages sideways. Weeks or Months keep the text readable on long projects.' })) : null,
      h('p', { class: 'muted xo-note xo-brand', text: 'The logo is never printed narrower than 1 inch and keeps its clear space, per the Arch Nexus brand guide.' })));
  };
  /* project defaults: one shared look per report type, saved with the schedule */
  const paintShare = () => {
    shareBar.textContent = '';
    if (!isGantt()) return;
    const t = active, label = typeLabel(t), shared = !!sharedXO(t), ro = S.readonly;
    shareBar.append(h('p', { class: 'muted xo-note' }, shared
      ? 'Using the project’s ' + label + ' settings, shared with everyone on this project. Changes here apply to this download only.'
      : 'These ' + label + ' settings are remembered on this device.'));
    if (ro) return;
    const row = h('div', { class: 'xo-share-btns' });
    row.append(h('button', { type: 'button', class: 'btn sm', text: shared ? 'Update project default' : 'Share as the project default',
      title: 'Save these options with the project so everyone gets the same ' + label + ' look. Save the schedule afterwards to share it.',
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
    } else {
      row.append(h('button', { type: 'button', class: 'btn sm ghost', text: 'Reset to preset', title: 'Start again from the ' + label + ' preset', onclick: () => { try { localStorage.removeItem('schedsheet:xo3:' + t); } catch (e) { /* optional */ } delete Os[t]; paintAll(); } }));
    }
    shareBar.append(row);
  };
  const paintAll = () => { paintFormat(); paintTabs(); paintInfo(); paintShare(); paintBody(); updateButton(); redraw(); };

  cancel.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  dl.addEventListener('click', () => {
    if (!counts[active]) return;
    const o = optsOf(active);
    if (!sharedXO(active)) saveXO(active, o); // with a project default, this device keeps nothing of its own
    saveDesc(active, o.desc || '');
    try { localStorage.setItem('schedsheet:xtype', active); localStorage.setItem('schedsheet:xkind', kind); } catch (e) { /* optional */ }
    const k = kind, t = active;
    close();
    toast('Preparing the ' + KIND_LABEL[k] + '…');
    runExportJob(k, [t], Os).catch(() => toast(k === 'csv' ? 'Export failed.' : 'Could not load the export tools. Check your connection and try again.'));
  });
  root.textContent = '';
  root.append(ws);
  document.addEventListener('keydown', onKey, true);
  paintAll();
  const first = tabs.querySelector('.xtab.on .xtab-b') || dl;
  if (first) first.focus();
  return { close, ws };
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
/* Export opens straight into the workspace, on the format used last (PDF the first time);
   format and audience are both chosen there */
const XKINDS = ['pdf', 'png', 'xlsx', 'csv'];
function lastKind() { try { const k = localStorage.getItem('schedsheet:xkind'); return XKINDS.includes(k) ? k : 'pdf'; } catch (e) { return 'pdf'; } }
function runExport(kind) {
  if (!S.work) return;
  if (!S.work.tasks.length) { toast('Add an activity before exporting.'); return; }
  openExportDialog(XKINDS.includes(kind) ? kind : lastKind());
}

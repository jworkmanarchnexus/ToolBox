/* ===== UI rendering ===== */
const ICON = {
  up: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  down: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  splice: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1 8h4M11 8h4M8 4.5v7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  minus: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8h10" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  plus: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  del: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  lock: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  cal: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  err: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="currentColor"/><path d="M8 4.6v4M8 10.4v1.2" style="stroke:var(--panel)" stroke-width="1.7"/></svg>',
  warn: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 1.8 15 14H1z" fill="currentColor"/><path d="M8 6.2v4M8 11.4v1" style="stroke:var(--panel)" stroke-width="1.7"/></svg>',
};
const worst = (flags) => (flags.some((f) => f.level === 'error') ? 'err' : flags.length ? 'warn' : '');

/* ----- dialogs ----- */
function openDialog({ title, body, actions, wide }) {
  const root = $('#modalRoot');
  const close = () => { root.textContent = ''; document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const btns = actions.map((a) => h('button', {
    class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), type: 'button', text: a.label, title: a.title || '',
    onclick: () => { if (a.run && a.run(close) === false) return; close(); },
  }));
  const dlg = h('div', { class: 'dlg' + (wide ? ' wide' : '') + (wide === 'x' ? ' xwide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', { text: title }), body, h('div', { class: 'dlg-act' }, btns));
  root.textContent = '';
  root.append(h('div', { class: 'scrim', onmousedown: (e) => { if (e.target.classList.contains('scrim')) close(); } }, dlg));
  document.addEventListener('keydown', esc);
  const f = dlg.querySelector('input,select,button');
  if (f) f.focus();
  return { close, dlg };
}
function openNew() {
  const input = h('input', { type: 'text', id: 'newName', class: 'txt', value: '', placeholder: 'e.g. Wasatch Meadows TI', autocomplete: 'off' });
  const ex = h('input', { type: 'checkbox', id: 'newEx' });
  if (!S.schedules.size) ex.checked = true;
  openDialog({
    title: 'New schedule',
    body: h('div', { class: 'form' },
      h('label', { for: 'newName', text: 'Name' }), input,
      h('label', { class: 'chk' }, ex, ' Start with an example schedule (a design-phase timeline you can edit or delete)')),
    actions: [
      { label: 'Cancel' },
      { label: 'Create', primary: true, run: () => { const n = input.value.trim(); if (!n) { input.focus(); return false; } createSchedule(n, ex.checked); } },
    ],
  });
}
function openRename() {
  if (!S.work) return;
  const input = h('input', { type: 'text', id: 'renName', class: 'txt', value: S.work.name, autocomplete: 'off' });
  openDialog({
    title: 'Rename schedule',
    body: h('div', { class: 'form' }, h('label', { for: 'renName', text: 'Name' }), input),
    actions: [
      { label: 'Cancel' },
      { label: 'Rename', primary: true, run: () => { const n = input.value.trim(); if (!n) { input.focus(); return false; } edit(() => { S.work.name = n; }); } },
    ],
  });
}
function openDelete() {
  if (!S.work) return;
  openDialog({
    title: 'Delete this schedule?',
    body: h('p', { text: '“' + S.work.name + '” will be deleted for everyone. This can’t be undone.' }),
    actions: [{ label: 'Cancel' }, { label: 'Delete schedule', danger: true, run: () => { deleteSchedule(); } }],
  });
}
function useFederalHolidays() {
  const y = new Date().getFullYear();
  const items = [...generateHolidays(y, false), ...generateHolidays(y + 1, false)];
  edit(() => { S.work.holidays = items; S.work.hset = true; });
  toast('Added U.S. federal holidays for ' + y + ' and ' + (y + 1) + '. Open Project settings to change them.');
}
function openHolidays() {
  const list = S.work.holidays.map((x) => ({ date: x.date, name: x.name || '' })).sort((a, b) => a.date.localeCompare(b.date));
  const rows = h('div', { class: 'hol-list' });
  const y0 = new Date().getFullYear();
  const yearSel = h('select', { id: 'holYear', class: 'txt sm' }, [y0, y0 + 1, y0 + 2].map((y) => h('option', { value: y, text: y })));
  const pion = h('input', { type: 'checkbox', id: 'holPion' });
  pion.checked = true;
  const ro = S.readonly;
  const draw = () => {
    rows.textContent = '';
    if (!list.length) rows.append(h('p', { class: 'muted', text: 'No holidays yet.' }));
    list.forEach((x, i) => {
      const d = h('input', { type: 'text', class: 'txt mono', value: isNaN(parseDate(x.date)) ? '' : fmtMed(parseDate(x.date)), 'aria-label': 'Holiday date', placeholder: 'e.g. 12/24/26', autocomplete: 'off', spellcheck: 'false' });
      const n = h('input', { type: 'text', class: 'txt', value: x.name, 'aria-label': 'Holiday name', placeholder: 'Name' });
      d.disabled = n.disabled = ro;
      d.addEventListener('change', () => {
        const v = parseTyped(d.value, parseDate(x.date), todayDay());
        if (isNaN(v)) { toast(BAD_DATE); d.value = isNaN(parseDate(x.date)) ? '' : fmtMed(parseDate(x.date)); return; }
        x.date = fmtISO(v); d.value = fmtMed(v);
      });
      n.addEventListener('input', () => { x.name = n.value; });
      const del = h('button', { class: 'ib', type: 'button', 'aria-label': 'Remove holiday', onclick: () => { list.splice(i, 1); draw(); } });
      del.innerHTML = ICON.del; del.disabled = ro;
      rows.append(h('div', { class: 'hol-row' }, d, n, del));
    });
  };
  draw();
  const addYear = () => {
    const have = new Set(list.map((x) => x.date));
    for (const x of generateHolidays(+yearSel.value, pion.checked)) if (!have.has(x.date)) list.push(x);
    list.sort((a, b) => a.date.localeCompare(b.date));
    draw();
  };
  const others = [...S.schedules.values()].filter((d) => d.id !== S.cur && Array.isArray(d.holidays) && d.holidays.length);
  const copySel = h('select', { class: 'txt sm', 'aria-label': 'Copy holidays from another project' }, others.map((d) => h('option', { value: d.id, text: d.name || 'Untitled schedule' })));
  const copyFrom = others.length ? h('span', { class: 'grp' },
    h('button', { class: 'btn sm', type: 'button', text: 'Copy the list from', onclick: () => {
      const src = S.schedules.get(copySel.value);
      if (!src) return;
      const have = new Set(list.map((x) => x.date));
      for (const x of validHol(src.holidays)) if (!have.has(x.date)) list.push({ date: x.date, name: x.name });
      list.sort((a, b) => a.date.localeCompare(b.date));
      draw();
    } }), copySel) : null;
  const body = h('div', null,
    h('p', { class: 'muted', text: 'Holidays here apply to this project only, on top of the non-working weekdays (Saturday and Sunday unless changed under Advanced). Dates that land on a non-working day are flagged, never moved on their own.' }),
    ro ? null : h('div', { class: 'hol-tools' },
      h('button', { class: 'btn sm', type: 'button', text: 'Add U.S. federal holidays for', onclick: addYear }), yearSel,
      h('label', { class: 'chk' }, pion, ' include Utah Pioneer Day'),
      h('button', { class: 'btn sm', type: 'button', text: 'Add a date', onclick: () => { list.push({ date: fmtISO(todayDay()), name: '' }); draw(); } }),
      copyFrom),
    rows);
  openDialog({
    title: 'Holidays for this project', body, wide: true,
    actions: ro ? [{ label: 'Close' }] : [
      { label: 'Cancel' },
      {
        label: 'Save holidays', primary: true, run: () => {
          const seen = new Map();
          for (const x of list) { if (!x.date || isNaN(parseDate(x.date))) continue; seen.set(x.date, { date: x.date, name: (x.name || '').trim() || 'Holiday' }); }
          const items = [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
          edit(() => { S.work.holidays = items; S.work.hset = true; });
          toast('Holidays updated for this project. Save the schedule to keep them.');
        },
      },
    ],
  });
}

/* ----- title block ----- */
let schedSig = '';
function renderSheet() {
  const sel = $('#schedSel');
  const list = [...S.schedules.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const names = list.map((d) => d.id === S.cur && S.work ? S.work.name : d.name);
  const sig = list.map((d, i) => d.id + ':' + names[i]).join('|');
  if (sig !== schedSig) {
    schedSig = sig;
    sel.textContent = '';
    if (!list.length) sel.append(h('option', { value: '', text: S.schedLoaded ? 'No schedules yet' : 'Loading…' }));
    list.forEach((d, i) => sel.append(h('option', { value: d.id, text: names[i] || 'Untitled schedule' })));
  }
  sel.value = S.cur || '';
  sel.disabled = !list.length;
  $('#btnNew').disabled = S.readonly || !S.db;
  $('#btnRename').disabled = !S.work || S.readonly;
  $('#btnDelete').disabled = !S.work || S.readonly;

  const saved = $('#savedBy');
  if (!S.work) saved.textContent = '—';
  else if (!S.base.at) saved.textContent = 'Not saved yet';
  else saved.textContent = nameOf(S.base.by) + ' · ' + whenText(S.base.at);

  const st = $('#status');
  st.className = 'val';
  if (!S.work) { st.textContent = '—'; }
  else if (S.saving) { st.textContent = 'Saving…'; }
  else if (S.readonly) { st.textContent = 'View only'; }
  else if (S.dirty) { st.textContent = 'Unsaved changes'; st.classList.add('dirty'); }
  else { st.textContent = 'All changes saved'; }

  const here = $('#here');
  here.textContent = '';
  const mine = peersHere(), other = peersElsewhere();
  if (!S.room) here.append(h('span', { class: 'muted', text: 'Live presence unavailable' }));
  else if (!mine.length && !other.length) here.append(h('span', { class: 'muted', text: 'Just you' }));
  else {
    for (const p of mine) here.append(h('span', { class: 'chip' + (p.editing ? ' editing' : ''), title: nameOf(p.by) + (p.editing ? ' is editing' : ' has this open'), text: nameOf(p.by).split(' ')[0] + (p.editing ? ' · editing' : '') }));
    if (other.length) here.append(h('span', { class: 'chip away', title: other.map((p) => nameOf(p.by)).join(', ') + ' on other schedules', text: '+' + other.length + ' elsewhere' }));
  }
}

/* ----- merging: choose between my edit and theirs where both changed the same thing ----- */
function openMergeDialog(who, conflicts, done) {
  const picks = {};
  const rows = conflicts.map((c, i) => {
    picks[c.key] = 'theirs';
    const mk = (val, text) => {
      const inp = h('input', { type: 'radio', name: 'mg' + i, value: val });
      inp.checked = val === 'theirs';
      inp.addEventListener('change', () => { picks[c.key] = val; });
      return h('label', { class: 'chk mg-opt' }, inp, ' ' + text);
    };
    return h('div', { class: 'mg-row' }, h('p', { class: 'mg-label', text: c.label }), mk('mine', 'Keep mine: ' + c.mine), mk('theirs', 'Keep ' + who + '\u2019s: ' + c.theirs));
  });
  const body = h('div', { class: 'mg' },
    h('p', { class: 'muted', text: 'You and ' + who + ' both changed ' + (conflicts.length === 1 ? 'this' : 'these') + '. Everything else merged on its own. ' + who + '\u2019s version is selected so nothing they saved is replaced unless you choose to.' }), rows);
  openDialog({ title: 'Choose between your edit and ' + who + '\u2019s', body, wide: true, actions: [{ label: 'Cancel' }, { label: 'Merge', primary: true, run: () => { done(picks); } }] });
}

/* ----- banners ----- */
function banner(kind, parts, actions) {
  return h('div', { class: 'banner ' + kind, role: kind === 'err' ? 'alert' : 'status' },
    h('span', { class: 'bmsg' }, parts), h('span', { class: 'bact' }, (actions || []).map((a) => h('button', { class: 'btn sm', type: 'button', text: a.label, onclick: a.run }))));
}
function renderBanners() {
  const box = $('#banners');
  box.textContent = '';
  if (S.noStore) box.append(banner('err', ['This page needs to be opened from Claude to load and save schedules.']));
  if (S.err) box.append(banner('err', [S.err + '. Try reloading the page.']));
  if (S.readonly && S.work) box.append(banner('info', ['You can view this schedule but not change it. Ask the owner for Contributor access to edit.']));
  S.nagShown = nagDue();
  if (S.nagShown) {
    const mins = Math.round((Date.now() - S.dirtySince) / 60000);
    box.append(banner('warn', [h('strong', { text: 'You\u2019ve had unsaved changes for ' + mins + ' minutes.' }), ' Save so your work isn\u2019t lost and your team sees it.'],
      [{ label: 'Save now', run: () => save() }, { label: 'Remind me later', run: () => { S.nagUntil = Date.now() + NAG_AGAIN; nagTick(); } }]));
  }
  if (S.work && !S.readonly) {
    if (S.remote) {
      box.append(banner('warn', [
        h('strong', { text: nameOf(S.remote.by) + ' saved a newer version' }), (S.remote.at ? ' at ' + whenText(S.remote.at) : '') + '. When you save, their changes are merged with yours and you review the result first.',
      ], [{ label: 'Merge now', run: () => { const d = S.schedules.get(S.cur); if (d) reconcile(d); } }, { label: 'Load theirs', title: 'Throw away my unsaved changes', run: () => { S.dirty = false; loadTheirs(); } }]));
    }
    const others = peersHere().filter((p) => p.editing);
    if (others.length) {
      const nm = others.map((p) => nameOf(p.by)).join(' and ');
      box.append(banner('warn', [
        h('strong', { text: nm + (others.length > 1 ? ' are' : ' is') + ' editing this schedule right now.' }),
        ' If you both save, the second save is merged with the first and reviewed before it goes through.',
      ]));
    }
  }
  {
    if (S.work && !S.work.hset) {
      const msg = ['Holidays haven\u2019t been customized for this project yet. Weekends are flagged, but holiday dates are not.'];
      box.append(banner('info', msg, S.readonly ? [] : [
        { label: 'Use U.S. federal holidays', run: useFederalHolidays },
        { label: 'Customize\u2026', run: openHolidays },
        { label: 'None needed', run: () => { edit(() => { S.work.hset = true; }); } },
      ]));
    }
  }
}

/* ----- toolbar ----- */
function counts() {
  let err = 0, warn = 0;
  if (S.work) for (const r of S.res.values()) for (const f of r.flags) f.level === 'error' ? err++ : warn++;
  return { err, warn };
}
function renderToolbar() {
  const has = !!S.work;
  const ro = S.readonly || !has;
  $('#vTable').setAttribute('aria-pressed', S.view === 'table');
  $('#vGantt').setAttribute('aria-pressed', S.view === 'gantt');
  $('#vExec').hidden = !(has && S.work.execOn);
  $('#vExec').setAttribute('aria-pressed', S.view === 'exec');
  $('#vTable').disabled = $('#vGantt').disabled = $('#vExec').disabled = !has;
  $('#btnAdd').disabled = ro || S.view === 'exec';
  $('#btnDetail').setAttribute('aria-pressed', String(!!S.detail));
  $('#btnDetail').disabled = !has;
  $('#btnUndo').disabled = ro || !S.undo.length;
  $('#btnHistory').disabled = !has || !S.db;
  $('#scaleWrap').hidden = (S.view !== 'gantt' && S.view !== 'exec') || !has;
  $('#btnScale').title = 'Time scale: ' + SCALES[scaleOf()].label;
  $('#btnScale').disabled = S.readonly;
  $$('#scaleMenu [data-scale]').forEach((b) => b.setAttribute('aria-checked', scaleOf() === b.dataset.scale));
  $('#filterGrp').hidden = S.view !== 'table' || !has;
  $('#onlyIssues').checked = S.onlyIssues;
  const c = counts();
  const ib = $('#btnIssues');
  ib.textContent = '';
  ib.append('Issues ');
  if (!c.err && !c.warn) ib.append(h('span', { class: 'cnt ok', text: 'none' }));
  if (c.err) ib.append(h('span', { class: 'cnt err', text: c.err, title: c.err + ' to fix' }));
  if (c.warn) ib.append(h('span', { class: 'cnt warn', text: c.warn, title: c.warn + ' to check' }));
  ib.setAttribute('aria-pressed', S.issuesOpen);
  ib.disabled = !has;
  $('#btnSettings').disabled = !has;
  $('#btnExport').disabled = !has;
  const sv = $('#btnSave');
  sv.disabled = !has || !S.dirty || S.readonly || S.saving;
  sv.textContent = S.saving ? 'Saving…' : 'Save';
  sv.classList.toggle('pulse', S.dirty && !S.saving);
}

/* ----- issues panel ----- */
function renderIssues() {
  const box = $('#issues');
  box.textContent = '';
  const items = [];
  if (S.work) S.work.tasks.forEach((t, i) => { for (const f of S.res.get(t.id).flags) items.push({ t, i, f }); });
  items.sort((a, b) => (a.f.level === b.f.level ? a.i - b.i : a.f.level === 'error' ? -1 : 1));
  box.hidden = !S.issuesOpen || !items.length;
  if (box.hidden) return;
  for (const it of items) {
    const lv = it.f.level === 'error' ? 'err' : 'warn';
    const ico = h('span', { class: 'ico ' + lv }); ico.innerHTML = ICON[lv];
    const row = h('div', { class: 'iss ' + lv },
      ico,
      h('button', { class: 'iss-txt', type: 'button', onclick: () => jumpTo(it.t.id) },
        h('span', { class: 'mono', text: '#' + (it.i + 1) + ' ' }), h('strong', { text: it.t.name || 'Untitled' }), ' — ' + it.f.text),
      h('span', { class: 'iss-act' },
        it.f.fix && !S.readonly ? h('button', { class: 'btn sm', type: 'button', text: it.f.fix.label, onclick: () => applyFix(it.t.id, it.f.fix) }) : null,
        it.f.ignorable && !S.readonly ? h('button', { class: 'btn sm ghost', type: 'button', text: 'Ignore', title: 'Stop flagging this on this task', onclick: () => ignoreFlag(it.t.id, it.f.code) }) : null));
    box.append(row);
  }
}
function jumpTo(id) {
  S.sel = id;
  if (S.view !== 'table') { S.view = 'table'; renderAll(); }
  else markSel();
  const tr = $('#tbody tr[data-id="' + id + '"]');
  if (tr) tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function markSel() {
  const on = new Set(selIds());
  $$('#tbody tr').forEach((tr) => tr.classList.toggle('sel', on.has(tr.dataset.id)));
}

/* ----- bar color picker (Executive view and export only) ----- */
function openColorPick(anchor, cur, onPick, o) {
  o = o || {};
  const old = document.querySelector('.cpick');
  if (old) old.remove();
  cur = normColor(cur);
  const close = () => { const m = document.querySelector('.cpick'); if (m) m.remove(); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc, true); };
  const away = (e) => { if (!e.target.closest('.cpick') && e.target !== anchor) close(); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }; // closes only the picker, not a dialog behind it
  const menu = h('div', { class: 'cpick', role: 'dialog', 'aria-label': 'Choose a bar color' });
  const place = () => {
    const r = anchor.getBoundingClientRect();
    menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, r.bottom + 4)) + 'px';
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.left - 20)) + 'px';
  };
  const sw = (v, label, extra) => {
    const b = h('button', { type: 'button', class: 'swatch', title: label, 'aria-label': label, 'aria-pressed': String(cur === v) });
    b.style.background = colorCss(v);
    b.addEventListener('click', () => { close(); onPick(v); });
    return extra ? h('span', { class: 'cw' }, b, extra) : b;
  };
  let adding = false;
  const paint = () => {
    menu.textContent = '';
    menu.append(h('p', { class: 'muted', text: o.title || 'Bar color for this task' }));
    menu.append(h('div', { class: 'swatches', role: 'group', 'aria-label': 'Standard colors' }, Object.keys(PRESETS).map((p) => sw(p, PRESETS[p].label))));
    const mine = validCustom(S.work.customColors);
    menu.append(h('h4', { text: 'This project\u2019s colors' }));
    const row = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Project colors' });
    for (const c of mine) {
      const x = S.readonly ? null : h('button', { type: 'button', class: 'cx', title: 'Remove ' + c.toUpperCase() + ' from this project\u2019s colors. Bars already using it keep it.', 'aria-label': 'Remove ' + c.toUpperCase(), text: '\u00d7',
        onclick: (e) => { e.stopPropagation(); removeCustomColor(c); paint(); place(); } });
      row.append(sw(c, 'Custom ' + c.toUpperCase(), x));
    }
    if (!S.readonly) row.append(h('button', { type: 'button', class: 'addc', title: 'Add a custom color to this project', 'aria-label': 'Add a custom color', 'aria-expanded': String(adding), text: '+', onclick: () => { adding = !adding; paint(); place(); } }));
    menu.append(row);
    if (!mine.length && !adding) menu.append(h('p', { class: 'muted td-note', text: 'Use + to save a custom color for everyone on this project.' }));
    if (adding) {
      const pick = h('input', { type: 'color', value: '#3b79c3', 'aria-label': 'Pick a color' });
      const hex = h('input', { type: 'text', class: 'txt mono', value: '#3B79C3', maxlength: '7', 'aria-label': 'Hex color', spellcheck: 'false', autocomplete: 'off' });
      const add = h('button', { type: 'button', class: 'btn sm primary', text: 'Add color' });
      const ok = () => HEX_RE.test(hex.value.trim().startsWith('#') ? hex.value.trim() : '#' + hex.value.trim());
      const val = () => { const v = hex.value.trim(); return v.startsWith('#') ? v : '#' + v; };
      pick.addEventListener('input', () => { hex.value = pick.value.toUpperCase(); add.disabled = false; });
      hex.addEventListener('input', () => { add.disabled = !ok(); if (ok()) pick.value = val().toLowerCase(); });
      hex.addEventListener('keydown', (e) => { if (e.key === 'Enter' && ok()) add.click(); });
      add.addEventListener('click', () => { if (!ok()) return; const c = addCustomColor(val()); if (c) { close(); onPick(c); } });
      menu.append(h('div', { class: 'newc' }, pick, hex, add));
    }
    if (!o.noDefault) menu.append(h('button', { type: 'button', class: 'btn sm ghost dflt', text: 'Use the default color', onclick: () => { close(); onPick(null); } }));
  };
  paint();
  document.body.append(menu);
  place();
  document.addEventListener('pointerdown', away, true);
  document.addEventListener('keydown', esc, true);
}

/* ----- table ----- */
const ROW_HTML =
  '<td class="c-n"><button class="rn" type="button" data-act="sel" aria-label="Select row" title="Click to select. Shift-click or Ctrl-click for several. Drag to reorder."></button></td>' +
  '<td class="c-flag"><button class="fl" type="button" data-act="flag" hidden></button></td>' +
  '<td class="c-name"><input data-f="name" type="text" aria-label="Task name" autocomplete="off"></td>' +
  '<td class="c-kind"><select data-f="kind" aria-label="Type"><option value="task">Task</option><option value="milestone">Milestone</option></select></td>' +
  '<td class="c-aud"><select data-f="lvl" aria-label="Audience" title="Who sees this task in exports. Client: every export. Design team: not the client export. Internal: only the internal export."><option value="client">Client</option><option value="design">Design team</option><option value="internal">Internal</option></select></td>' +
  '<td class="c-exec"><input type="checkbox" data-f="exec" aria-label="Show in the executive summary"></td>' +
  '<td class="c-start"><div class="dcell"><input data-f="start" type="text" class="mono" aria-label="Start date" placeholder="e.g. 10/15" autocomplete="off" spellcheck="false"><span class="dow"></span><span class="pick" title="Pick from a calendar">' + ICON.cal + '<input type="date" class="pickin" data-pick="start" data-edit tabindex="-1" aria-label="Choose start date from a calendar"></span><button class="hold" type="button" data-act="release" data-edit title="Held until this date. Click to follow predecessors again." hidden>Held</button></div></td>' +
  '<td class="c-dur"><input data-f="dur" type="number" min="1" step="1" class="mono" aria-label="Duration in days"></td>' +
  '<td class="c-fin"><div class="dcell"><input data-f="finish" type="text" class="mono" aria-label="Finish date" placeholder="e.g. 10/30" autocomplete="off" spellcheck="false"><span class="dow"></span><span class="pick" title="Pick from a calendar">' + ICON.cal + '<input type="date" class="pickin" data-pick="finish" data-edit tabindex="-1" aria-label="Choose finish date from a calendar"></span></div></td>' +
  '<td class="c-slip"><span class="slip"></span></td>' +
  '<td class="c-pred"><input data-f="preds" type="text" class="mono" aria-label="Predecessors" placeholder="e.g. 3, 5SS+2" autocomplete="off"></td>' +
  '<td class="c-lock"><button class="ib lockb" type="button" data-act="lock" data-edit aria-pressed="false" aria-label="Lock date" title="Lock this date. It won’t move when predecessors change; a conflict is flagged instead.">' + ICON.lock + '</button></td>' +
  '<td class="c-act"><button class="ib" type="button" data-act="up" data-edit aria-label="Move up" title="Move this task up one row. Dates follow the links, not the row order.">' + ICON.up + '</button><button class="ib" type="button" data-act="down" data-edit aria-label="Move down" title="Move this task down one row. Dates follow the links, not the row order.">' + ICON.down + '</button><button class="ib" type="button" data-act="add" data-edit aria-label="Add task below" title="Add a new, unlinked task below this one.">' + ICON.plus + '</button><button class="ib" type="button" data-act="splice" data-edit aria-label="Insert linked task below" title="Insert a task below and link it into the chain: it follows this task, and tasks that followed this one (finish-to-start) follow it instead.">' + ICON.splice + '</button><button class="ib del" type="button" data-act="del" data-edit aria-label="Delete task" title="Delete this task and remove its links. Tasks that followed it stay, no longer linked to it. Undo brings it back.">' + ICON.del + '</button></td>';

function buildRow(id) {
  const tr = document.createElement('tr');
  tr.dataset.id = id;
  tr.innerHTML = ROW_HTML;
  return tr;
}
function setDow(span, day, blank) {
  if (blank) { span.textContent = ''; span.classList.remove('off'); span.title = ''; return; }
  const why = S.cal.reason(day);
  span.textContent = DOW_S[dowOf(day)];
  span.classList.toggle('off', !!why);
  span.title = why || '';
}
function setVal(el, v) { if (document.activeElement !== el && el.value !== String(v)) el.value = v; }
function patchRow(tr, t, i) {
  const r = S.res.get(t.id);
  const ms = t.kind === 'milestone';
  tr.className = [isSel(t.id) ? 'sel' : '', worst(r.flags), ms ? 'ms' : '', t.locked ? 'lk' : '', 'lv-' + (t.lvl || 'client')].filter(Boolean).join(' ');
  tr.hidden = S.onlyIssues && !r.flags.length;
  $('.rn', tr).textContent = i + 1;
  setVal($('[data-f=name]', tr), t.name);
  setVal($('[data-f=kind]', tr), t.kind);
  setVal($('[data-f=lvl]', tr), t.lvl || 'client');
  tr.dataset.lv = t.lvl || 'client';
  const ex = $('[data-f=exec]', tr), clientLv = (t.lvl || 'client') === 'client';
  ex.checked = !!t.exec;
  ex.title = clientLv ? 'Show in the executive summary' : 'Only Client-level tasks can appear in the executive summary' + (t.exec ? '. This one is marked but stays out.' : '.');
  const st = $('[data-f=start]', tr), fi = $('[data-f=finish]', tr), du = $('[data-f=dur]', tr), pr = $('[data-f=preds]', tr);
  setVal(st, fmtMed(r.start));
  setVal(fi, ms ? '' : fmtMed(r.finish));
  setVal($('[data-pick=start]', tr), fmtISO(r.start));
  setVal($('[data-pick=finish]', tr), ms ? '' : fmtISO(r.finish));
  setVal(du, ms ? '' : r.dur);
  setVal(pr, formatPreds(t, S.work.tasks));
  const dc = $$('.dow', tr);
  setDow(dc[0], r.start);
  setDow(dc[1], r.finish, ms);
  const auto = !r.anchored && !t.locked;
  st.closest('.dcell').classList.toggle('auto', auto);
  st.title = auto ? 'Follows predecessors. Enter a later date to hold this task.' : '';
  const hold = $('.hold', tr);
  hold.hidden = !r.held;
  $$('[data-f],[data-edit]', tr).forEach((e) => { e.disabled = S.readonly; });
  ex.disabled = S.readonly || !clientLv;
  du.disabled = fi.disabled = $('[data-pick=finish]', tr).disabled = S.readonly || ms;
  const sl = $('.slip', tr);
  if (baseActive()) {
    const n = slipOf(t.id), b = baseRow(t.id);
    sl.className = 'slip' + (n == null ? ' new' : n > 0 ? ' late' : n < 0 ? ' early' : '');
    sl.textContent = n == null ? 'new' : n === 0 ? '\u2014' : slipText(n);
    sl.title = b ? 'Baseline: ' + (ms ? fmtShort(b.start) : fmtShort(b.start) + ' \u2013 ' + fmtShort(b.finish) + ' (' + b.dur + 'd)') + (n ? '. ' + (n > 0 ? n + ' days later.' : -n + ' days earlier.') : '. On the baseline.') : 'Added after the baseline was set.';
  } else { sl.textContent = ''; sl.title = ''; }
  const lk = $('.lockb', tr);
  lk.setAttribute('aria-pressed', !!t.locked);
  lk.title = t.locked ? 'Locked. This date won\u2019t move when predecessors change, and it can\u2019t be edited. Click to unlock.' : 'Lock this date. It won\u2019t move when predecessors change; a conflict is flagged instead.';
  lk.setAttribute('aria-label', t.locked ? 'Unlock date' : 'Lock date');
  const fl = $('.fl', tr);
  const w = worst(r.flags);
  fl.hidden = !w;
  if (w) {
    fl.className = 'fl ' + w;
    fl.innerHTML = ICON[w];
    fl.title = r.flags.map((f) => f.text).join('\n');
    fl.setAttribute('aria-label', r.flags.length + (r.flags.length === 1 ? ' issue' : ' issues') + ' on this task');
  }
}
function renderTable() {
  const tbody = $('#tbody');
  const tasks = S.work.tasks;
  const have = new Map([...tbody.children].map((tr) => [tr.dataset.id, tr]));
  const want = new Set(tasks.map((t) => t.id));
  for (const [id, tr] of have) if (!want.has(id)) tr.remove();
  tasks.forEach((t, i) => {
    let tr = have.get(t.id);
    if (!tr) tr = buildRow(t.id);
    patchRow(tr, t, i);
    const cur = tbody.children[i];
    if (cur !== tr) tbody.insertBefore(tr, cur || null);
  });
  $('#tEmpty').hidden = tasks.length > 0;
  if (S.focusId) {
    const tr = $('#tbody tr[data-id="' + S.focusId + '"]');
    S.focusId = null;
    if (tr) { const n = $('[data-f=name]', tr); n.focus(); n.select(); }
  }
}


function colorRows() {
  const box = h('div', { class: 'lv-rows' });
  const paint = () => {
    box.textContent = '';
    const cols = normColors(S.work.colors);
    for (const k of LEVELS) {
      const cur = cols[k];
      const btn = h('button', { type: 'button', class: 'lvbtn', disabled: S.readonly, title: 'Change the ' + LEVEL_INFO[k].label + ' color', 'aria-label': LEVEL_INFO[k].label + ' color: ' + colorLabel(cur) + '. Change it.' },
        h('span', { class: 'lvsw' }), h('span', { text: colorLabel(cur) }));
      $('.lvsw', btn).style.background = colorCss(cur);
      btn.addEventListener('click', () => openColorPick(btn, cur, (v) => {
        v = normColor(v);
        if (!v || v === cur) return;
        edit(() => {
          const next = normColors(S.work.colors);
          const other = LEVELS.find((x) => x !== k && next[x] === v);
          if (other) next[other] = next[k]; // two audiences never share a color
          next[k] = v;
          S.work.colors = next;
        });
        paint();
      }, { title: 'Color for ' + LEVEL_INFO[k].label + ' tasks', noDefault: true }));
      box.append(h('div', { class: 'lv-row' }, h('div', null, h('strong', { text: LEVEL_INFO[k].label }), h('small', { text: LEVEL_INFO[k].hint })), btn));
    }
  };
  paint();
  return box;
}
function askReplaceBaseline(done) {
  const bl = S.work.baseline;
  openDialog({
    title: 'Replace the baseline?',
    body: h('div', null, h('p', { text: 'Today\u2019s dates become the new baseline, so every task\u2019s slip starts again from zero.' }),
      h('p', { class: 'muted', text: 'The current baseline (set ' + whenText(bl.at) + ') is replaced. If it was already saved, it stays in Version history.' })),
    actions: [{ label: 'Cancel', run: () => { setTimeout(() => openSettings(), 0); } }, { label: 'Replace baseline', primary: true, run: () => { setBaseline(); toast('Baseline replaced. Save to keep it.'); setTimeout(() => openSettings(), 0); } }],
  });
}
function openSettings() {
  if (!S.work) return;
  const ro = S.readonly;
  const box = h('div', { class: 'ps' });
  let api = null, advOpen = false;
  const paint = () => {
    box.textContent = '';
    const sc = scaleOf(), n = S.work.holidays.length;
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Time scale' }, Object.keys(SCALES).map((k) =>
      h('button', { type: 'button', class: sc === k ? 'on' : '', 'aria-pressed': String(sc === k), disabled: ro, 'data-scale': k, text: SCALES[k].label,
        onclick: () => { if (sc !== k) { edit(() => { S.work.scale = k; }); paint(); } } })));
    const infoIn = (key, label, ph) => {
      const el = h('input', { type: 'text', class: 'txt', id: 'psInfo_' + key, maxlength: String(INFO_MAX[key]), placeholder: ph, autocomplete: 'off', disabled: ro });
      el.value = S.work.info[key] || '';
      el.addEventListener('change', () => { const v = normInfo(Object.assign({}, S.work.info, { [key]: el.value })); edit(() => { S.work.info = v; }); el.value = v[key]; });
      return h('div', { class: 'ps-field' }, h('label', { for: 'psInfo_' + key, text: label }), el);
    };
    const off = normOffDays(S.work.offDays), custom = !(off.length === 2 && off.includes(0) && off.includes(6));
    const working = DAY_NAMES.filter((_, d) => !off.includes(d));
    const dayBoxes = [1, 2, 3, 4, 5, 6, 0].map((d) => {
      const on = !off.includes(d);
      const cb = h('input', { type: 'checkbox', id: 'psDay' + d, checked: on ? 'checked' : null, disabled: ro || (on && working.length === 1), 'aria-label': DAY_NAMES[d] });
      cb.addEventListener('change', () => { const next = cb.checked ? off.filter((x) => x !== d) : off.concat(d); edit(() => { S.work.offDays = normOffDays(next); }); paint(); });
      return h('label', { class: 'chk', for: 'psDay' + d }, cb, ' ' + DAY_NAMES[d].slice(0, 3));
    });
    box.append(
      h('fieldset', null, h('legend', { text: 'Project details' }),
        h('p', { class: 'muted ps-note', text: 'Shown under the title on exports. The name is on the Rename button at the top.' }),
        infoIn('number', 'Project number', 'e.g. 2026-014'), infoIn('client', 'Client', 'e.g. Hill AFB'),
        infoIn('issue', 'Issue note', 'e.g. Issued for owner review, rev 2')),
      h('fieldset', null, h('legend', { text: 'Time scale' }), seg,
        h('p', { class: 'muted ps-note', text: 'How the Gantt and the PDF and image exports are laid out. Also on the calendar button in the Gantt view.' })),
      h('fieldset', null, h('legend', { text: 'Holidays' }),
        h('p', { class: 'ps-hol' + (S.work.hset ? '' : ' warn'), text: S.work.hset ? n + (n === 1 ? ' holiday' : ' holidays') + ' set for this project.' : 'Not customized yet. Weekends are flagged, but holiday dates are not.' }),
        h('button', { class: 'btn', type: 'button', text: ro ? 'View holidays' : 'Edit holidays\u2026', onclick: () => { api.close(); openHolidays(); } })),
      h('fieldset', null, h('legend', { text: 'Executive summary' }),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', id: 'psExec', checked: S.work.execOn ? 'checked' : null, disabled: ro,
          onchange: (ev) => { const on = ev.target.checked; edit(() => { S.work.execOn = on; }); paint(); } }), ' Turn on the executive summary for this project'),
        h('p', { class: 'muted ps-note', text: 'Adds an Exec checkbox to each task, an Executive view, and an Executive export. Only Client-level tasks you check appear in it. Off by default.' })),
      h('fieldset', null, h('legend', { text: 'Baseline and slip' }),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', id: 'psBase', checked: S.work.baselineOn ? 'checked' : null, disabled: ro,
          onchange: (ev) => { const on = ev.target.checked; edit(() => { S.work.baselineOn = on; }); paint(); } }), ' Track slip against a baseline'),
        h('p', { class: 'muted ps-note', text: 'Save a snapshot of every task\u2019s dates, then see how far each task has moved since. Adds a Slip column to the Table and a thin bar under each task in the Gantt. Each export can leave it out. Off by default.' }),
        ...(S.work.baselineOn ? [
          h('p', { class: 'ps-hol' + (S.work.baseline ? '' : ' warn'), text: S.work.baseline
            ? 'Baseline set ' + whenText(S.work.baseline.at) + (S.work.baseline.by ? ' by ' + nameOf(S.work.baseline.by) : '') + ', ' + Object.keys(S.work.baseline.tasks).length + ' tasks.'
            : 'No baseline yet. Set one to start tracking slip.' }),
          ro ? null : h('div', { class: 'ps-btns' },
            h('button', { class: 'btn' + (S.work.baseline ? '' : ' primary'), type: 'button', text: S.work.baseline ? 'Replace baseline\u2026' : 'Set baseline from today\u2019s dates',
              onclick: () => { if (!S.work.baseline) { setBaseline(); toast('Baseline set. Save to keep it.'); paint(); } else askReplaceBaseline(paint); } }),
            S.work.baseline ? h('button', { class: 'btn', type: 'button', text: 'Clear baseline', onclick: () => { clearBaseline(); paint(); } }) : null)] : [])),
      h('fieldset', null, h('legend', { text: 'Audience colors' }),
        h('p', { class: 'muted ps-note', text: 'Shown in the Detailed view and in Design team and Internal exports.' }), colorRows()),
      h('details', { class: 'ps-adv', open: advOpen ? 'open' : null, ontoggle: (ev) => { advOpen = ev.target.open; } },
        h('summary', { text: 'Advanced' + (custom ? ' \u00b7 working days customized' : '') }),
        h('fieldset', null, h('legend', { text: 'Working days' }),
          h('div', { class: 'ps-days' }, dayBoxes),
          h('p', { class: 'muted ps-note', text: 'Checked days are working days. Unchecked days are flagged like weekends and shaded in the Gantt and exports. Dependencies still count calendar days, so this never moves a date by itself.' }),
          custom && !ro ? h('button', { class: 'btn sm', type: 'button', text: 'Back to Monday to Friday', onclick: () => { edit(() => { S.work.offDays = [0, 6]; }); paint(); } }) : null)));
  };
  paint();
  api = openDialog({ title: 'Project settings', body: h('div', null, h('p', { class: 'muted', text: S.work.name + '. These apply to this project and are saved with it.' }), box), actions: [{ label: 'Done', primary: true }], wide: true });
}

/* ----- gantt ----- */
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
const GH = 44, GROW = 30;
const SCALES = { days: { px: 26, label: 'Days' }, weeks: { px: 9, label: 'Weeks' }, months: { px: 2.6, label: 'Months' }, quarters: { px: 1, label: 'Quarters' } };
/* months and quarters are coarse: no day shading, lines at month or quarter starts */
const isCoarse = (sc) => sc === 'months' || sc === 'quarters';
const scaleOf = () => (S.work && SCALES[S.work.scale] ? S.work.scale : 'weeks');
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
function renderGantt() {
  const root = $('#ganttView');
  const keep = root.querySelector('.gc') ? root.querySelector('.gc').scrollLeft : 0;
  root.textContent = '';
  const exView = S.view === 'exec', ro = S.readonly || exView;
  const tasks = exView ? S.work.tasks.filter(isExecTask) : S.work.tasks;
  if (!tasks.length) { root.append(h('p', { class: 'muted pad', text: exView ? 'No tasks are marked for the executive summary yet. Open the Table, then check Exec on the Client-level tasks you want here.' : 'No tasks yet. Add a task to see the timeline.' })); return; }
  const rows = tasks.map((t) => S.res.get(t.id));
  const narrow = window.innerWidth <= 640;
  const labelW = narrow ? 150 : 240;
  const sc = scaleOf(), dayW = SCALES[sc].px;
  const avail = Math.max(420, (root.clientWidth || 960) - labelW - 6);
  const showBase = baseActive() && !exView;
  const baseRows = showBase ? tasks.map((t) => baseRow(t.id)) : [];
  let { minD, maxD } = ganttRange(rows.concat(baseRows.filter(Boolean)), dayW, sc);
  if ((maxD - minD + 1) * dayW < avail) maxD = minD + Math.ceil(avail / dayW);
  const days = maxD - minD + 1;
  const chartW = days * dayW;
  const totalH = GH + tasks.length * GROW;
  root.style.setProperty('--gl', labelW + 'px');

  /* label panel */
  const gl = h('div', { class: 'gl' }, h('div', { class: 'gh' }, h('span', { class: 'lbl', text: 'Task' })));
  tasks.forEach((t, i) => {
    const r = rows[i], w = worst(r.flags);
    const fl = h('span', { class: 'gfl ' + w });
    if (w) { fl.innerHTML = ICON[w]; fl.title = r.flags.map((f) => f.text).join('\n'); }
    gl.append(h('button', { class: 'grl' + (isSel(t.id) ? ' sel' : '') + (t.kind === 'milestone' ? ' ms' : ''), type: 'button', 'data-id': t.id, title: exView ? (t.name || 'Untitled') : (t.name || 'Untitled') + '\nClick to select. Shift-click or Ctrl-click for several. Drag to reorder.', onclick: (ev) => { if (!exView) selectGantt(t.id, ev); }, onpointerdown: (ev) => { if (!exView) startRowDrag(ev, t.id, labelRowsOf); } },
      exView ? exSwatch(t) : null,
      h('span', { class: 'rn mono', text: i + 1 }), h('span', { class: 'nm', text: t.name || 'Untitled' }), fl));
  });

  /* chart panel */
  const gc = h('div', { class: 'gc' });
  const gin = h('div', { class: 'gin' });
  gin.style.width = chartW + 'px';
  gin.style.height = totalH + 'px';
  const seg = (cls, d0, d1, text, top) => {
    const e = h('div', { class: cls, text });
    e.style.left = (d0 - minD) * dayW + 'px';
    e.style.width = (d1 - d0 + 1) * dayW + 'px';
    if (top != null) e.style.top = top + 'px';
    gin.append(e);
  };
  if (sc === 'quarters') {
    for (const g of yearSegs(minD, maxD)) seg('mo', g.d, g.end, (g.end - g.d + 1) * dayW > 40 ? String(g.p.y) : '');
    for (const g of quarterSegs(minD, maxD)) seg('mo m2', g.d, g.end, (g.end - g.d + 1) * dayW > 36 ? 'Q' + g.q : '', 22);
  } else if (sc === 'months') {
    for (const g of yearSegs(minD, maxD)) seg('mo', g.d, g.end, (g.end - g.d + 1) * dayW > 40 ? String(g.p.y) : '');
    for (const g of monthSegs(minD, maxD)) seg('mo m2', g.d, g.end, MON_S[g.p.m], 22);
  } else {
    for (const g of monthSegs(minD, maxD)) {
      const wpx = (g.end - g.d + 1) * dayW;
      seg('mo', g.d, g.end, wpx > 90 ? MON_L[g.p.m] + ' ' + g.p.y : wpx > 34 ? MON_S[g.p.m] + (g.p.m === 0 ? ' ' + g.p.y : '') : '');
    }
  }
  for (let n = minD; n <= maxD; n++) {
    const x = (n - minD) * dayW;
    const why = S.cal.reason(n);
    if (why && !isCoarse(sc)) {
      const isHol = S.cal.isHoliday(n);
      const e = h('div', { class: isHol ? 'hl' : 'wk', title: isHol ? why + ' · ' + fmtShort(n) : '' });
      e.style.left = x + 'px'; e.style.width = dayW + 'px'; e.style.top = GH + 'px'; e.style.height = tasks.length * GROW + 'px';
      gin.append(e);
    }
    const isMon = dowOf(n) === 1, isFirst = ymdOf(n).d === 1;
    const qStart = isFirst && ymdOf(n).m % 3 === 0;
    if (sc === 'quarters' ? qStart : sc === 'months' ? isFirst : isMon) { const l = h('div', { class: 'wl' }); l.style.left = x + 'px'; l.style.top = GH - 8 + 'px'; l.style.height = totalH - GH + 8 + 'px'; gin.append(l); }
    if (sc === 'days' || (sc === 'weeks' && isMon)) {
      const tk = h('div', { class: 'tk' + (why ? ' off' : '') }, h('span', { text: ymdOf(n).d }), sc === 'days' ? h('small', { text: DOW_S[dowOf(n)][0] }) : null);
      tk.style.left = x + 'px'; tk.style.width = (sc === 'days' ? dayW : 7 * dayW) + 'px';
      gin.append(tk);
    }
  }
  for (let i = 0; i <= tasks.length; i++) { const l = h('div', { class: 'rl' }); l.style.top = GH + i * GROW + 'px'; gin.append(l); }
  for (const sid of selIds()) { const i = tasks.findIndex((t) => t.id === sid); if (i >= 0) { const b = h('div', { class: 'selband' }); b.style.top = GH + i * GROW + 'px'; gin.append(b); } }
  const td = todayDay();
  if (td >= minD && td <= maxD) {
    const tl = h('div', { class: 'today' }); tl.style.left = (td - minD) * dayW + dayW / 2 - 1 + 'px'; gin.append(tl);
    const tt = h('div', { class: 'today-tag', text: 'Today' }); tt.style.left = (td - minD) * dayW + dayW / 2 + 'px'; gin.append(tt);
  }
  // arrows
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'deps' + (S.sel ? ' has-sel' : ''));
  svg.setAttribute('width', chartW); svg.setAttribute('height', totalH);
  const idx = new Map(tasks.map((t, i) => [t.id, i]));
  tasks.forEach((t, j) => {
    for (const dp of t.deps || []) {
      const i = idx.get(dp.id);
      if (i == null || rows[j].cycle) continue;
      const pts = arrowPath(ganttGeom(rows[i], minD, dayW), ganttGeom(rows[j], minD, dayW), dp.type, GH + i * GROW + GROW / 2, GH + j * GROW + GROW / 2, GROW);
      const hot = S.sel && (S.sel === t.id || S.sel === dp.id);
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', 'M' + pts.map((pt) => pt[0].toFixed(1) + ' ' + pt[1].toFixed(1)).join('L'));
      path.setAttribute('class', 'dp' + (hot ? ' hot' : ''));
      svg.append(path);
      const [x2, y2] = pts[pts.length - 1];
      const hd = document.createElementNS(NS, 'path');
      hd.setAttribute('d', 'M' + x2 + ' ' + y2 + 'l-6 -3.5v7z');
      hd.setAttribute('class', 'dh' + (hot ? ' hot' : ''));
      svg.append(hd);
    }
  });
  gin.append(svg);
  // bars
  tasks.forEach((t, i) => {
    const r = rows[i], g = ganttGeom(r, minD, dayW), top = GH + i * GROW;
    const w = worst(r.flags);
    const tip = (t.name || 'Untitled') + '\n' + fmtShort(r.start) + (r.kind === 'milestone' ? '' : ' – ' + fmtShort(r.finish) + ' (' + r.dur + (r.dur === 1 ? ' day)' : ' days)')) + (t.locked ? '\nLocked date' : '') + (r.held ? '\nHeld' : '') + (showBase && slipOf(t.id) ? '\nSlip: ' + slipText(slipOf(t.id)) + ' vs baseline' : '') + ((t.lvl || 'client') !== 'client' ? '\nAudience: ' + LEVEL_INFO[t.lvl].label : '');
    const PAD = 10, ms = r.kind === 'milestone', bw0 = g.r - g.l;
    const wrap = h('div', { class: 'bw' + (isSel(t.id) ? ' sel' : ''), 'data-id': t.id });
    wrap.style.left = g.l - PAD + 'px'; wrap.style.width = bw0 + 2 * PAD + 'px'; wrap.style.top = top + 'px';
    let el;
    if (ms) {
      el = h('div', { class: 'dia lv-' + (t.lvl || 'client') + (t.locked ? ' lk' : '') + (w === 'err' ? ' err' : ''), title: tip });
      el.style.left = PAD + 0.5 + 'px'; el.style.top = (GROW - 14) / 2 + 'px';
    } else {
      el = h('div', { class: 'bar lv-' + (t.lvl || 'client') + (t.locked ? ' lk' : '') + (r.held ? ' held' : '') + (w === 'err' ? ' err' : w === 'warn' ? ' wr' : ''), title: tip });
      el.style.left = PAD + 'px'; el.style.width = bw0 + 'px'; el.style.top = (GROW - 16) / 2 + 'px';
    }
    if (!ms && t.locked && bw0 >= 18) el.append(h('span', { class: 'bl', html: ICON.lock }));
    if (!exView) { el.tabIndex = 0; el.setAttribute('role', 'button'); }
    el.setAttribute('aria-label', (t.name || 'Untitled') + ', ' + fmtShort(r.start) + (ms ? '' : ' to ' + fmtShort(r.finish)) + (exView ? '.' : '. Open details.'));
    if (!exView) {
      el.addEventListener('click', () => openTask(t.id));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTask(t.id); } });
    } else { el.style.cursor = 'default'; }
    if (exView) el.style.background = colorCss(execKey(t, S.work.execColor));
    wrap.append(el);
    if (!ro) {
      const out = ms ? 5 : 0;
      for (const end of ['start', 'finish']) {
        const nd = h('div', { class: 'node ' + end, 'data-end': end, title: end === 'finish' ? 'Drag onto another task to make it start after this one finishes' : 'Drag onto another task to make it start when this one starts' });
        nd.style.left = (end === 'start' ? PAD - 5 - out : PAD + bw0 - 5 + out) + 'px';
        nd.addEventListener('pointerdown', (e) => startLinkDrag(e, { id: t.id, end, gin, rows, tasks, x: (end === 'start' ? g.l - out : g.r + out), y: top + GROW / 2 }));
        wrap.append(nd);
      }
    }
    if (showBase) {
      const br = baseRow(t.id);
      if (br) {
        const gb = ganttGeom(br, minD, dayW);
        const gh = h('div', { class: 'bghost' + (ms ? ' ms' : ''), title: 'Baseline: ' + (ms ? fmtShort(br.start) : fmtShort(br.start) + ' \u2013 ' + fmtShort(br.finish)) });
        if (ms) { gh.style.left = (gb.l + gb.r) / 2 - 4 + 'px'; gh.style.top = top + GROW - 9 + 'px'; }
        else { gh.style.left = gb.l + 'px'; gh.style.width = gb.r - gb.l + 'px'; gh.style.top = top + GROW - 7 + 'px'; }
        gin.append(gh);
      }
    }
    gin.append(wrap);
    const lab = h('div', { class: 'blab', text: r.kind === 'milestone' ? fmtShort(r.start) : fmtShort(r.start).slice(4) + ' – ' + fmtShort(r.finish).slice(4) + ' · ' + r.dur + 'd' });
    if (showBase) { const n = slipOf(t.id); if (n) lab.append(h('span', { class: 'slip ' + (n > 0 ? 'late' : 'early'), text: ' \u00b7 ' + slipText(n) })); else if (n == null) lab.append(h('span', { class: 'slip new', text: ' \u00b7 new' })); }
    lab.style.left = g.r + 6 + 'px'; lab.style.top = top + (GROW - 14) / 2 + 'px';
    gin.append(lab);
  });
  gc.append(gin);
  if (S.detail && !exView) {
    const lg = h('div', { class: 'glegend' }, h('strong', { text: 'Audience' }));
    for (const k of LEVELS) lg.append(h('span', { class: 'lg', title: LEVEL_INFO[k].hint }, h('span', { class: 'sw lv-' + k }), LEVEL_INFO[k].label));
    lg.append(h('span', { class: 'muted', text: 'Client tasks appear in every export.' }));
    if (!S.readonly) lg.append(h('button', { class: 'btn sm', type: 'button', text: 'Colors\u2026', onclick: openSettings }));
    root.append(lg);
  }
  if (showBase) {
    const bl = S.work.baseline;
    root.append(h('div', { class: 'glegend basestrip' }, h('strong', { text: 'Baseline' }), h('span', { class: 'bghost key' }),
      h('span', { class: 'muted', text: 'Set ' + whenText(bl.at) + (bl.by ? ' by ' + nameOf(bl.by) : '') + '. The thin bar under each task is where it was. ' }),
      h('span', { class: 'slip late', text: '+ later' }), h('span', { class: 'slip early', text: '\u2212 earlier' })));
  }
  if (exView) root.append(exDefaultStrip());
  root.append(h('div', { class: 'gwrap' }, gl, gc));
  gc.scrollLeft = keep;
}
/* ----- version history ----- */
async function openHistory() {
  if (!S.work || !S.db) return;
  const body = h('div', { class: 'hist' }, h('p', { class: 'muted', text: 'Loading earlier versions\u2026' }));
  const api = openDialog({ title: 'Version history', body, actions: [{ label: 'Close', primary: true }], wide: true });
  let list = [];
  try { list = await loadHistory(); } catch (e) { body.textContent = ''; body.append(h('p', { class: 'muted', text: 'Could not load the history. Check your connection and try again.' })); return; }
  await refreshNames(list.map((v) => v.by).filter(Boolean));
  body.textContent = '';
  if (!list.length) {
    body.append(h('p', { text: 'No earlier versions yet.' }), h('p', { class: 'muted', text: 'Each time anyone saves, the saved version is kept here. Saves by one person within ten minutes are combined. The newest 40 are kept.' }));
    return;
  }
  body.append(h('p', { class: 'muted', text: 'Every save is kept here, newest first. Restoring puts that version on screen as an unsaved change. Look it over, then Save, or Undo to go back. Nobody\u2019s work is overwritten until you save.' }));
  const ul = h('div', { class: 'hist-list' });
  list.forEach((v, i) => {
    const d = historyDiff(v.tasks, S.work.tasks);
    const bits = [];
    if (d.moved) bits.push(d.moved + (d.moved === 1 ? ' task with different dates' : ' tasks with different dates'));
    if (d.add) bits.push(d.add + ' task' + (d.add === 1 ? '' : 's') + ' would come back');
    if (d.gone) bits.push(d.gone + ' task' + (d.gone === 1 ? '' : 's') + ' added since would go');
    if (d.renamed) bits.push(d.renamed + ' renamed');
    ul.append(h('div', { class: 'hist-row' },
      h('div', null, h('strong', { text: whenText(v.at) }), ' ' + (v.by ? nameOf(v.by) : 'Someone') + (i === 0 ? ' \u00b7 latest save' : ''),
        h('small', { class: 'muted', text: (v.tasks || []).length + ' tasks. ' + (d.same ? 'Same as what is on screen now.' : bits.join('; ') + ' compared with now.') })),
      S.readonly || d.same ? null : h('button', { type: 'button', class: 'btn sm', text: 'Restore', title: 'Put this version on screen as an unsaved change', onclick: () => { api.close(); restoreVersion(v); } })));
  });
  body.append(ul);
}

/* ----- Executive view: bar colors ----- */
function exSwatch(t) {
  const own = isColor(t.exColor) ? normColor(t.exColor) : null;
  const sw = h('span', { class: 'exc', role: 'button', tabindex: S.readonly ? '-1' : '0', 'aria-label': 'Bar color for ' + (t.name || 'task'),
    title: S.readonly ? 'Bar color (view-only)' : own ? 'Bar color: ' + colorLabel(own) + '. Click to change.' : 'Uses the default color. Click to give this task its own.' });
  sw.style.background = colorCss(execKey(t, S.work.execColor));
  if (own) sw.classList.add('own');
  const open = (ev) => { ev.stopPropagation(); if (S.readonly) return; openColorPick(sw, own, (k) => setExColor(t.id, k), { title: 'Bar color for this task' }); };
  sw.addEventListener('click', open);
  sw.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
  return sw;
}
function askExDefault(key) {
  const cur = execKey(null, S.work.execColor);
  if (key === cur) return;
  const own = S.work.tasks.filter((t) => isColor(t.exColor)).length;
  if (!own) { setExDefault(key, false); return; }
  openDialog({
    title: 'Change the default color?',
    body: h('div', null, h('p', { text: 'Make ' + colorLabel(key) + ' the default for every task you haven\u2019t colored yourself and for new ones. ' + own + (own === 1 ? ' task has its own color.' : ' tasks have their own colors.') }),
      h('p', { class: 'muted', text: 'Choose \u201cAll activities\u201d to also recolor those, so every bar becomes ' + colorLabel(key) + '.' })),
    actions: [
      { label: 'Cancel' },
      { label: 'Default only', title: 'Keep the colors tasks already have', run: () => { setExDefault(key, false); } },
      { label: 'All activities', primary: true, title: 'Every bar becomes ' + colorLabel(key), run: () => { setExDefault(key, true); } },
    ],
  });
}
function exDefaultStrip() {
  const key = execKey(null, S.work.execColor);
  const sw = h('button', { type: 'button', class: 'exc big', disabled: S.readonly, 'aria-label': 'Default bar color: ' + colorLabel(key),
    title: S.readonly ? 'Default bar color (view-only)' : 'Default bar color: ' + colorLabel(key) + '. Click to change.' });
  sw.style.background = colorCss(key);
  sw.addEventListener('click', () => openColorPick(sw, key, askExDefault, { title: 'Default bar color', noDefault: true }));
  return h('div', { class: 'glegend exdef' }, h('strong', { text: 'Default bar color' }), sw,
    h('span', { class: 'muted', text: 'Used for every task you haven\u2019t colored, and for tasks you add. Use the squares by each task to give it its own.' }));
}
function selectGantt(id, ev) {
  if (S.suppressClick) return;
  clickSelect(id, ev, { toggle: true });
  renderGantt();
}

/* ----- empty state, orchestration ----- */
function renderEmpty() {
  const box = $('#empty');
  box.textContent = '';
  if (S.noStore) { box.append(h('h2', { text: 'Schedules can’t load here' }), h('p', { class: 'muted', text: 'Open this page from Claude to load and save schedules.' })); return; }
  if (!S.schedLoaded) { box.append(h('h2', { text: 'Loading schedules…' })); return; }
  box.append(
    h('h2', { text: 'No schedules yet' }),
    h('p', { class: 'muted', text: 'Add tasks, link them with predecessors, and move one date to watch everything after it shift. Start from the example to see it work, or begin with a blank sheet.' }),
    S.readonly ? h('p', { class: 'muted', text: 'You have view-only access, so you can’t create schedules.' }) :
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', text: 'Load the example schedule', onclick: () => createSchedule('Example: TI design schedule', true) }),
        h('button', { class: 'btn', type: 'button', text: 'Start a blank schedule', onclick: openNew })));
}
function applyAudienceStyle() {
  document.body.classList.toggle('detail', !!S.detail);
  document.body.classList.toggle('base-on', baseActive());
  document.body.classList.toggle('exec-on', !!(S.work && S.work.execOn));
  const cols = normColors(S.work && S.work.colors);
  for (const k of LEVELS) document.documentElement.style.setProperty('--lv-' + k, colorCss(cols[k]));
}
function renderAll() {
  if (S.view === 'exec' && !(S.work && S.work.execOn)) S.view = 'gantt';
  applyAudienceStyle();
  renderSheet();
  renderBanners();
  renderToolbar();
  const has = !!S.work;
  $('#empty').hidden = has;
  $('#tableView').hidden = !has || S.view !== 'table';
  $('#ganttView').hidden = !has || (S.view !== 'gantt' && S.view !== 'exec');
  if (!has) { $('#issues').hidden = true; renderEmpty(); return; }
  renderIssues();
  if (S.view === 'table') renderTable(); else renderGantt();
}

/* ----- static bindings ----- */
function bindStatic() {
  $('#schedSel').addEventListener('change', (e) => switchTo(e.target.value));
  $('#btnNew').addEventListener('click', openNew);
  $('#btnRename').addEventListener('click', openRename);
  $('#btnDelete').addEventListener('click', openDelete);
  $('#vTable').addEventListener('click', () => { S.view = 'table'; renderAll(); });
  $('#vGantt').addEventListener('click', () => { S.view = 'gantt'; renderAll(); });
  $('#vExec').addEventListener('click', () => { S.view = 'exec'; renderAll(); });
  $('#btnAdd').addEventListener('click', () => addTask(S.sel ? S.work.tasks.findIndex((t) => t.id === S.sel) : -1));
  $('#btnUndo').addEventListener('click', undo);
  $('#btnHistory').addEventListener('click', openHistory);
  $('#btnSave').addEventListener('click', save);
  $('#btnIssues').addEventListener('click', () => { S.issuesOpen = !S.issuesOpen; renderToolbar(); renderIssues(); });
  $('#btnSettings').addEventListener('click', openSettings);
  $('#onlyIssues').addEventListener('change', (e) => { S.onlyIssues = e.target.checked; renderTable(); });
  $('#btnAddEmpty').addEventListener('click', () => addTask(-1));
  try { S.detail = localStorage.getItem('schedsheet:detail') === '1'; } catch (e) { S.detail = false; }
  $('#btnDetail').addEventListener('click', () => {
    S.detail = !S.detail;
    try { localStorage.setItem('schedsheet:detail', S.detail ? '1' : '0'); } catch (e) { /* optional */ }
    renderAll();
  });

  const menu = $('#exportMenu'), smenu = $('#scaleMenu');
  const closeMenus = () => { menu.hidden = true; smenu.hidden = true; $('#btnExport').setAttribute('aria-expanded', 'false'); $('#btnScale').setAttribute('aria-expanded', 'false'); };
  $('#btnExport').addEventListener('click', (e) => { e.stopPropagation(); const open = menu.hidden; closeMenus(); menu.hidden = !open; $('#btnExport').setAttribute('aria-expanded', open); });
  $('#btnScale').addEventListener('click', (e) => { e.stopPropagation(); const open = smenu.hidden; closeMenus(); smenu.hidden = !open; $('#btnScale').setAttribute('aria-expanded', open); });
  smenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('[data-scale]');
    if (!b) return;
    closeMenus();
    if (S.readonly || !S.work || scaleOf() === b.dataset.scale) return;
    edit(() => { S.work.scale = b.dataset.scale; });
  });
  document.addEventListener('click', closeMenus);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
  menu.addEventListener('click', (e) => { const b = e.target.closest('[data-exp]'); if (!b) return; menu.hidden = true; runExport(b.dataset.exp); });

  const tbody = $('#tbody');
  tbody.addEventListener('change', (e) => {
    const el = e.target, tr = el.closest('tr');
    const f = el.dataset && (el.dataset.f || el.dataset.pick);
    if (!tr || !f) return;
    if (el.dataset.cancel) { delete el.dataset.cancel; renderAll(); return; }
    if (!el.value && el.dataset.pick) return;
    onField(tr.dataset.id, f, el);
  });
  tbody.addEventListener('keydown', (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.f) return;
    if (e.key === 'Enter' && el.tagName === 'INPUT') { e.preventDefault(); el.blur(); }
    else if (e.key === 'Escape') { el.dataset.cancel = '1'; el.blur(); delete el.dataset.cancel; renderAll(); }
  });
  tbody.addEventListener('focusin', (e) => {
    const tr = e.target.closest('tr');
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && S.multi.size) S.multi = new Set();
    if (tr && S.sel !== tr.dataset.id) { S.sel = tr.dataset.id; markSel(); }
  });
  tbody.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.c-n'), tr = e.target.closest('tr');
    if (cell && tr) startRowDrag(e, tr.dataset.id, tableRowsOf);
  });
  tbody.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    const tr = e.target.closest('tr');
    if (!tr) return;
    const id = tr.dataset.id;
    if (!b) { if (S.sel !== id) { S.sel = id; markSel(); } return; }
    const i = S.work.tasks.findIndex((t) => t.id === id);
    switch (b.dataset.act) {
      case 'sel': if (!S.suppressClick) { clickSelect(id, e); markSel(); } break;
      case 'flag': S.issuesOpen = true; S.sel = id; renderToolbar(); renderIssues(); markSel(); break;
      case 'up': moveTask(id, -1); break;
      case 'down': moveTask(id, 1); break;
      case 'add': addTask(i); break;
      case 'splice': spliceTask(i); break;
      case 'del': deleteTask(id); break;
      case 'lock': toggleLock(id); break;
      case 'release': edit(() => { taskById(id).notBefore = null; }); break;
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) { e.preventDefault(); undo(); }
  });
  let rz = null;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.work && S.view === 'gantt') renderGantt(); }, 150); });
}

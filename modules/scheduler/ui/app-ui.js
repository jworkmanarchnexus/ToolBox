/* ===== Schedule editor: rendering and interaction (table, bars, dialogs, settings) =====
   The timeline lives in gantt.js, the activity inspector in app-task.js, exports in app-export.js. */
const ICON = {
  up: icon('arrow-up', 15), down: icon('arrow-down', 15), splice: icon('corner-down-right', 15), minus: icon('minus', 15), plus: icon('plus', 15),
  del: icon('trash-2', 15), lock: icon('lock', 14), cal: icon('calendar', 14), err: icon('circle-alert', 15), warn: icon('triangle-alert', 15),
  edit: icon('square-pen', 15), flag: icon('flag', 13), x: icon('x', 16), info: icon('info', 15), link: icon('link', 15),
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
    h('h2', { text: title }), h('div', { class: 'dlg-body' }, body), h('div', { class: 'dlg-act' }, btns));
  root.textContent = '';
  root.append(h('div', { class: 'scrim', onmousedown: (e) => { if (e.target.classList.contains('scrim')) close(); } }, dlg));
  document.addEventListener('keydown', esc);
  const f = dlg.querySelector('.dlg-body input:not([type=checkbox]):not([type=radio]),.dlg-body select') || dlg.querySelector('.dlg-act .primary') || dlg.querySelector('button');
  if (f) f.focus();
  return { close, dlg };
}
function openNew() { openNewSchedule(S.meta.projectId); }
function openRename() {
  if (!S.work) return;
  const input = h('input', { type: 'text', id: 'renName', class: 'txt', value: S.work.name, autocomplete: 'off' });
  openDialog({
    title: 'Rename schedule',
    body: h('div', { class: 'form' }, h('div', { class: 'field' }, h('label', { for: 'renName', text: 'Name' }), input)),
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
    body: h('p', { text: '“' + S.work.name + '” will be deleted for everyone, with its version history. This can’t be undone.' }),
    actions: [{ label: 'Cancel' }, { label: 'Delete schedule', danger: true, run: () => { deleteSchedule(); } }],
  });
}
function useFederalHolidays() {
  const y = new Date().getFullYear();
  const items = [...generateHolidays(y, false), ...generateHolidays(y + 1, false)];
  edit(() => { S.work.holidays = items; S.work.hset = true; });
  toast('Added U.S. federal holidays for ' + y + ' and ' + (y + 1) + '. Change them in Settings.');
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
      const del = h('button', { class: 'ib del', type: 'button', 'aria-label': 'Remove holiday', title: 'Remove', onclick: () => { list.splice(i, 1); draw(); } });
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
  // copy from another schedule in the same project first, then any other schedule
  const others = [...S.schedules.values()].filter((d) => d.id !== S.cur && Array.isArray(d.holidays) && d.holidays.length)
    .sort((a, b) => ((b.projectId || null) === S.meta.projectId) - ((a.projectId || null) === S.meta.projectId));
  const copySel = h('select', { class: 'txt sm', 'aria-label': 'Copy holidays from another schedule' }, others.map((d) => h('option', { value: d.id, text: (d.name || 'Untitled schedule') + (projectOf(d) ? ' (' + (projectOf(d).number || projectOf(d).name) + ')' : '') })));
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
    h('p', { class: 'muted', text: 'Holidays here apply to this schedule only, on top of the non-working weekdays (Saturday and Sunday unless changed under Advanced). Dates that land on a non-working day are flagged, never moved on their own.' }),
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
          toast('Holidays updated. Save the schedule to keep them.');
        },
      },
    ],
  });
}

/* ----- context bar: project, schedule, save state, who else is here ----- */
let schedSig = '';
function renderSheet() {
  const sel = $('#schedSel');
  const pid = S.meta.projectId || null;
  const list = schedulesOf(pid).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (S.cur && !list.some((d) => d.id === S.cur) && S.schedules.get(S.cur)) list.push(S.schedules.get(S.cur));
  const names = list.map((d) => (d.id === S.cur && S.work ? S.work.name : d.name));
  const sig = pid + '|' + list.map((d, i) => d.id + ':' + names[i]).join('|');
  if (sig !== schedSig) {
    schedSig = sig;
    sel.textContent = '';
    if (!list.length) sel.append(h('option', { value: '', text: S.schedLoaded ? 'No schedules yet' : 'Loading…' }));
    list.forEach((d, i) => sel.append(h('option', { value: d.id, text: names[i] || 'Untitled schedule' })));
  }
  sel.value = S.cur || '';
  sel.disabled = list.length < 2;
  sel.title = list.length < 2 ? (S.work ? S.work.name : '') : 'Switch to another schedule in this project';
  const p = S.projects.get(pid);
  const ep = $('#edProj');
  ep.textContent = p ? projLabel(p) : 'Not in a project · choose one';
  ep.href = pid ? '#/scheduler/p/' + pid : '#/scheduler/p/unassigned';
  ep.classList.toggle('none', !p);
  ep.title = p ? 'Open the project' : 'This schedule isn’t in a project yet. Click to choose its project so the team can find it.';
  $('#btnNew').disabled = !canCreateAnywhere();
  $('#btnRename').disabled = !S.work || S.readonly;
  $('#btnDelete').disabled = !S.work || S.readonly;
  $('#btnDup').disabled = !S.work || !S.db;

  const saved = $('#savedBy');
  if (!S.work) saved.textContent = '—';
  else if (!S.base.at) saved.textContent = 'Not saved yet';
  else saved.textContent = 'Saved by ' + nameOf(S.base.by) + ' · ' + whenText(S.base.at);

  const st = $('#status');
  st.className = '';
  if (!S.work) { st.textContent = '—'; st.classList.add('none'); }
  else if (S.saving) { st.textContent = 'Saving…'; st.classList.add('saving'); }
  else if (S.readonly) { st.textContent = 'View only'; st.classList.add('ro'); }
  else if (S.dirty) { st.textContent = 'Unsaved changes'; st.classList.add('dirty'); }
  else { st.textContent = 'All changes saved'; }

  const here = $('#here');
  here.textContent = '';
  const mine = peersHere(), other = peersElsewhere();
  if (!S.room) here.append(h('span', { class: 'muted', text: 'Live presence unavailable' }));
  else if (!mine.length && !other.length) here.append(h('span', { class: 'muted', text: 'Just you' }));
  else {
    for (const p2 of mine) here.append(h('span', { class: 'avatar' + (p2.editing ? ' editing' : ''), title: nameOf(p2.by) + (p2.editing ? ' is editing (unsaved changes)' : ' has this open'), text: initials(nameOf(p2.by)) }), h('span', { class: 'sr', text: nameOf(p2.by).split(' ')[0] + (p2.editing ? ' · editing' : '') }));
    if (mine.some((p2) => p2.editing)) here.append(h('span', { class: 'chip editing', text: mine.filter((p2) => p2.editing).map((p2) => nameOf(p2.by).split(' ')[0]).join(', ') + ' · editing' }));
    if (other.length) here.append(h('span', { class: 'chip away', title: other.map((p2) => nameOf(p2.by)).join(', ') + ' on other schedules', text: '+' + other.length + ' elsewhere' }));
  }
  applyTplMode();
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
    return h('div', { class: 'mg-row' }, h('p', { class: 'mg-label', text: c.label }), mk('mine', 'Keep mine: ' + c.mine), mk('theirs', 'Keep ' + who + '’s: ' + c.theirs));
  });
  const body = h('div', { class: 'mg' },
    h('p', { class: 'muted', text: 'You and ' + who + ' both changed ' + (conflicts.length === 1 ? 'this' : 'these') + '. Everything else merged on its own. ' + who + '’s version is selected so nothing they saved is replaced unless you choose to.' }), rows);
  openDialog({ title: 'Choose between your edit and ' + who + '’s', body, wide: true, actions: [{ label: 'Cancel' }, { label: 'Merge', primary: true, run: () => { done(picks); } }] });
}

/* ----- banners: one line each, with a rule, an icon and actions ----- */
function banner(kind, parts, actions) {
  const ic = h('span', { html: kind === 'err' ? ICON.err : kind === 'warn' ? ICON.warn : ICON.info });
  return h('div', { class: 'banner ' + kind, role: kind === 'err' ? 'alert' : 'status' },
    h('span', { class: 'bmsg' }, ic.firstChild, h('span', null, parts)), h('span', { class: 'bact' }, (actions || []).map((a) => h('button', { class: 'btn sm', type: 'button', text: a.label, title: a.title || '', onclick: a.run }))));
}
function renderBanners() {
  const box = $('#banners');
  box.textContent = '';
  if (S.noStore) box.append(banner('err', ['This page needs to be opened from Claude to load and save schedules.']));
  if (S.err) box.append(banner('err', [S.err + '. Try reloading the page.']));
  tplBanner(box);
  if (S.readonly && S.work && !S.tpl) box.append(banner('info', [projectOf(S.schedules.get(S.cur)) && projectOf(S.schedules.get(S.cur)).status === 'archived' ? 'This project is archived, so its schedules are view-only.' : 'You can view this schedule but not change it. Ask a project lead (PIC, PM or PA) for edit access.'], S.db ? [{ label: 'Duplicate…', run: () => openDuplicate(S.cur) }] : []));
  S.nagShown = nagDue();
  if (S.nagShown) {
    const mins = Math.round((Date.now() - S.dirtySince) / 60000);
    box.append(banner('warn', [h('strong', { text: 'You’ve had unsaved changes for ' + mins + ' minutes.' }), ' Save so your work isn’t lost and your team sees it.'],
      [{ label: 'Save now', run: () => save() }, { label: 'Remind me later', run: () => { S.nagUntil = Date.now() + NAG_AGAIN; nagTick(); } }]));
  }
  if (S.work && !S.readonly && !S.tpl) {
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
  if (S.work && !S.tpl && !S.work.hset) {
    const msg = ['Holidays haven’t been customized for this project yet. Weekends are flagged, but holiday dates are not.'];
    box.append(banner('info', msg, S.readonly ? [] : [
      { label: 'Use U.S. federal holidays', run: useFederalHolidays },
      { label: 'Customize…', run: openHolidays },
      { label: 'None needed', run: () => { edit(() => { S.work.hset = true; }); } },
    ]));
  }
}

/* ----- view bar ----- */
/* the list opens by itself when something conflicts; warnings wait behind the count */
const issuesShown = (c) => (S.issuesOpen === null ? c.err > 0 : S.issuesOpen);
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
  $('#btnAdd').disabled = $('#btnAddMs').disabled = ro || S.view === 'exec';
  $('#btnDetail').setAttribute('aria-pressed', String(!!S.detail));
  $('#btnDetail').disabled = !has;
  $('#btnUndo').disabled = ro || !S.undo.length;
  $('#btnHistory').disabled = !has || !S.db;
  $('#scaleWrap').hidden = (S.view !== 'gantt' && S.view !== 'exec') || !has;
  $('#btnScale').title = 'Time scale: ' + SCALES[scaleOf()].label + '. Saved with the schedule.';
  $('#scaleLbl').textContent = SCALES[scaleOf()].label;
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
  ib.setAttribute('aria-pressed', issuesShown(c));
  ib.disabled = !has;
  $('#btnSettings').disabled = !has;
  $('#btnExport').disabled = !has;
  const sv = $('#btnSave');
  sv.disabled = !has || !S.dirty || S.readonly || S.saving;
  sv.textContent = S.saving ? 'Saving…' : 'Save';
  sv.classList.toggle('pulse', S.dirty && !S.saving);
  sv.title = S.tpl ? (S.tpl.scope === 'mine' ? 'Save the template (Ctrl+S)' : 'Save the company template for everyone (Ctrl+S)') : 'Save for everyone (Ctrl+S)';
  applyTplMode();
}

/* ----- issues ----- */
function renderIssues() {
  const box = $('#issues');
  box.textContent = '';
  const items = [];
  if (S.work) S.work.tasks.forEach((t, i) => { for (const f of S.res.get(t.id).flags) items.push({ t, i, f }); });
  items.sort((a, b) => (a.f.level === b.f.level ? a.i - b.i : a.f.level === 'error' ? -1 : 1));
  box.hidden = !issuesShown(counts()) || !items.length;
  if (box.hidden) return;
  for (const it of items) {
    const lv = it.f.level === 'error' ? 'err' : 'warn';
    const ico = h('span', { class: 'ico ' + lv, html: ICON[lv] });
    const row = h('div', { class: 'iss ' + lv },
      ico,
      h('button', { class: 'iss-txt', type: 'button', onclick: () => jumpTo(it.t.id) },
        h('span', { class: 'num', text: '#' + (it.i + 1) + ' ' }), h('strong', { text: it.t.name || 'Untitled' }), ' — ' + it.f.text),
      h('span', { class: 'iss-act' },
        it.f.fix && !S.readonly ? h('button', { class: 'btn sm', type: 'button', text: it.f.fix.label, onclick: () => applyFix(it.t.id, it.f.fix) }) : null,
        it.f.ignorable && !S.readonly ? h('button', { class: 'btn sm ghost', type: 'button', text: 'Ignore', title: 'Stop flagging this on this activity', onclick: () => ignoreFlag(it.t.id, it.f.code) }) : null));
    box.append(row);
  }
}
function jumpTo(id) {
  S.sel = id; S.multi = new Set();
  if (S.view !== 'table') { S.view = 'table'; renderAll(); }
  else markSel();
  const tr = $('#tbody tr[data-id="' + id + '"]');
  if (tr) tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function markSel() {
  const on = new Set(selIds());
  $$('#tbody tr').forEach((tr) => tr.classList.toggle('sel', on.has(tr.dataset.id)));
  renderBulk();
  if (S.inspect && S.sel && S.inspect !== S.sel && !multiOn()) openTask(S.sel, { keep: true });
}

/* ----- bar color picker (Executive view and export, audience colors) ----- */
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
    menu.append(h('p', { text: o.title || 'Bar color for this activity' }));
    menu.append(h('h4', { text: 'Arch Nexus colors' }));
    menu.append(h('div', { class: 'swatches', role: 'group', 'aria-label': 'Arch Nexus colors' }, BRAND_COLORS.map((p) => sw(p, PRESETS[p].label))));
    const extra = Object.keys(PRESETS).filter((p) => !PRESETS[p].brand);
    menu.append(h('details', { open: extra.includes(cur) ? 'open' : null }, h('summary', { text: 'Other colors' }),
      h('div', { class: 'swatches', role: 'group', 'aria-label': 'Other colors' }, extra.map((p) => sw(p, PRESETS[p].label)))));
    const mine = validCustom(S.work.customColors);
    menu.append(h('h4', { text: 'This project’s colors' }));
    const row = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Project colors' });
    for (const c of mine) {
      const x = S.readonly ? null : h('button', { type: 'button', class: 'cx', title: 'Remove ' + c.toUpperCase() + ' from this project’s colors. Bars already using it keep it.', 'aria-label': 'Remove ' + c.toUpperCase(), text: '×',
        onclick: (e) => { e.stopPropagation(); removeCustomColor(c); paint(); place(); } });
      row.append(sw(c, 'Custom ' + c.toUpperCase(), x));
    }
    if (!S.readonly) row.append(h('button', { type: 'button', class: 'addc', title: 'Add a custom color to this project', 'aria-label': 'Add a custom color', 'aria-expanded': String(adding), text: '+', onclick: () => { adding = !adding; paint(); place(); } }));
    menu.append(row);
    if (!mine.length && !adding) menu.append(h('p', { class: 'muted td-note', text: 'Use + to save a custom color for everyone on this project.' }));
    if (adding) {
      const pick = h('input', { type: 'color', value: '#0099d8', 'aria-label': 'Pick a color' });
      const hex = h('input', { type: 'text', class: 'txt mono', value: '#0099D8', maxlength: '7', 'aria-label': 'Hex color', spellcheck: 'false', autocomplete: 'off' });
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
  '<td class="c-name"><input data-f="name" type="text" aria-label="Activity name" autocomplete="off"></td>' +
  '<td class="c-kind"><select data-f="kind" aria-label="Type"><option value="task">Activity</option><option value="milestone">Milestone</option></select></td>' +
  '<td class="c-aud"><select data-f="lvl" aria-label="Audience" title="Who sees this activity in exports. Client: every export. Design team: not the client export. Internal: only the internal export."><option value="client">Client</option><option value="design">Design team</option><option value="internal">Internal</option></select></td>' +
  '<td class="c-exec"><input type="checkbox" data-f="exec" aria-label="Show in the executive overview"></td>' +
  '<td class="c-start"><div class="dcell"><input data-f="start" type="text" class="mono" aria-label="Start date" placeholder="e.g. 10/15" autocomplete="off" spellcheck="false"><span class="dow"></span><span class="pick" title="Pick from a calendar">' + ICON.cal + '<input type="date" class="pickin" data-pick="start" data-edit tabindex="-1" aria-label="Choose start date from a calendar"></span><button class="hold" type="button" data-act="release" data-edit title="Held until this date. Click to follow predecessors again." hidden>Held</button></div></td>' +
  '<td class="c-dur"><input data-f="dur" type="text" inputmode="numeric" class="mono" aria-label="Duration in days" autocomplete="off"></td>' +
  '<td class="c-fin"><div class="dcell"><input data-f="finish" type="text" class="mono" aria-label="Finish date" placeholder="e.g. 10/30" autocomplete="off" spellcheck="false"><span class="dow"></span><span class="pick" title="Pick from a calendar">' + ICON.cal + '<input type="date" class="pickin" data-pick="finish" data-edit tabindex="-1" aria-label="Choose finish date from a calendar"></span></div></td>' +
  '<td class="c-slip"><span class="slip"></span></td>' +
  '<td class="c-commit"><button class="cm" type="button" data-act="commit"></button></td>' +
  '<td class="c-pred"><input data-f="preds" type="text" class="mono" aria-label="Predecessors" placeholder="e.g. 3, 5SS+2" autocomplete="off"></td>' +
  '<td class="c-lock"><button class="ib lockb" type="button" data-act="lock" data-edit aria-pressed="false" aria-label="Lock date" title="Lock this date. It won’t move when predecessors change; a conflict is flagged instead.">' + ICON.lock + '</button></td>' +
  '<td class="c-act"><button class="ib" type="button" data-act="info" aria-label="Open details" title="Open the details panel: dates, links in plain words, commitment, lock and hold">' + ICON.edit + '</button><button class="ib" type="button" data-act="up" data-edit aria-label="Move up" title="Move this activity up one row. Dates follow the links, not the row order.">' + ICON.up + '</button><button class="ib" type="button" data-act="down" data-edit aria-label="Move down" title="Move this activity down one row. Dates follow the links, not the row order.">' + ICON.down + '</button><button class="ib" type="button" data-act="add" data-edit aria-label="Add activity below" title="Add a new, unlinked activity below this one.">' + ICON.plus + '</button><button class="ib" type="button" data-act="splice" data-edit aria-label="Insert linked activity below" title="Insert an activity below and link it into the chain: it follows this one, and activities that followed this one (finish-to-start) follow it instead.">' + ICON.splice + '</button><button class="ib del" type="button" data-act="del" data-edit aria-label="Delete activity" title="Delete this activity and remove its links. Activities that followed it stay, no longer linked to it. Undo brings it back.">' + ICON.del + '</button></td>';

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
  span.title = why ? 'Non-working day: ' + why : '';
}
function setVal(el, v) { if (document.activeElement !== el && el.value !== String(v)) el.value = v; }
const hot = () => (S.impact && Date.now() - S.impact.at < 2600 ? new Set(S.impact.moved.map((m) => m.id)) : null);
function patchRow(tr, t, i, hotSet) {
  const r = S.res.get(t.id);
  const ms = t.kind === 'milestone';
  tr.className = [isSel(t.id) ? 'sel' : '', worst(r.flags), ms ? 'ms' : '', t.locked ? 'lk' : '', 'lv-' + (t.lvl || 'client'), hotSet && hotSet.has(t.id) ? 'flash' : ''].filter(Boolean).join(' ');
  tr.hidden = S.onlyIssues && !r.flags.length;
  $('.rn', tr).textContent = i + 1;
  setVal($('[data-f=name]', tr), t.name);
  setVal($('[data-f=kind]', tr), t.kind);
  setVal($('[data-f=lvl]', tr), t.lvl || 'client');
  tr.dataset.lv = t.lvl || 'client';
  const ex = $('[data-f=exec]', tr), clientLv = (t.lvl || 'client') === 'client';
  ex.checked = !!t.exec;
  ex.title = clientLv ? 'Show in the executive overview' : 'Only Client-level activities can appear in the executive overview' + (t.exec ? '. This one is marked but stays out.' : '.');
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
  st.title = auto ? 'Follows its predecessors. Enter a later date to hold this activity.' : '';
  const hold = $('.hold', tr);
  hold.hidden = !r.held;
  $$('[data-f],[data-edit]', tr).forEach((e) => { e.disabled = S.readonly; });
  ex.disabled = S.readonly || !clientLv;
  du.disabled = fi.disabled = $('[data-pick=finish]', tr).disabled = S.readonly || ms;
  du.placeholder = ms ? '' : 'days';
  fi.placeholder = ms ? '' : 'e.g. 10/30';
  const sl = $('.slip', tr);
  if (baseActive()) {
    const n = slipOf(t.id), b = baseRow(t.id);
    sl.className = 'slip' + (n == null ? ' new' : n > 0 ? ' late' : n < 0 ? ' early' : '');
    sl.textContent = n == null ? 'new' : n === 0 ? '—' : slipText(n);
    sl.title = b ? 'Baseline: ' + (ms ? fmtShort(b.start) : fmtShort(b.start) + ' – ' + fmtShort(b.finish) + ' (' + b.dur + 'd)') + (n ? '. ' + (n > 0 ? n + ' days later.' : -n + ' days earlier.') : '. On the baseline.') : 'Added after the baseline was set.';
  } else { sl.textContent = ''; sl.title = ''; }
  const cm = $('.cm', tr), cs = commitStatus(t, r, S.work.commitWarn);
  cm.className = 'cm ' + (cs ? cs.status : 'add');
  cm.textContent = cs ? fmtShortNoDow(parseDate(cs.date)) + ' · ' + commitText(cs) : '+ Add';
  cm.title = cs ? COMMIT_WORD[cs.status] + '. Committed ' + fmtShort(parseDate(cs.date)) + ', forecast ' + fmtShort(cs.forecast) + (cs.note ? ' (' + cs.note + ')' : '') + '. Click to change.' : 'Add a committed date to protect (contract, owner or agency date). It never moves the schedule.';
  cm.disabled = S.readonly && !cs;
  const lk = $('.lockb', tr);
  lk.setAttribute('aria-pressed', !!t.locked);
  lk.title = t.locked ? 'Locked. This date won’t move when predecessors change, and it can’t be edited. Click to unlock.' : 'Lock this date. It won’t move when predecessors change; a conflict is flagged instead.';
  lk.setAttribute('aria-label', t.locked ? 'Unlock date' : 'Lock date');
  const fl = $('.fl', tr);
  const w = worst(r.flags);
  fl.hidden = !w;
  if (w) {
    fl.className = 'fl ' + w;
    fl.innerHTML = ICON[w];
    fl.title = r.flags.map((f) => f.text).join('\n');
    fl.setAttribute('aria-label', r.flags.length + (r.flags.length === 1 ? ' issue' : ' issues') + ' on this activity');
  }
}
const fmtShortNoDow = (n) => { const p = ymdOf(n); return MON_S[p.m] + ' ' + p.d; };
function renderTable() {
  const tbody = $('#tbody');
  const tasks = S.work.tasks;
  const have = new Map([...tbody.children].map((tr) => [tr.dataset.id, tr]));
  const want = new Set(tasks.map((t) => t.id));
  for (const [id, tr] of have) if (!want.has(id)) tr.remove();
  const hs = hot();
  tasks.forEach((t, i) => {
    let tr = have.get(t.id);
    if (!tr) tr = buildRow(t.id);
    patchRow(tr, t, i, hs);
    const cur = tbody.children[i];
    if (cur !== tr) tbody.insertBefore(tr, cur || null);
  });
  $('#tEmpty').hidden = tasks.length > 0;
  document.body.classList.toggle('commit-col', !!S.detail || tasks.some((t) => t.commit));
  if (S.focusId) {
    const tr = $('#tbody tr[data-id="' + S.focusId + '"]');
    S.focusId = null;
    if (tr) { const n = $('[data-f=name]', tr); n.focus(); n.select(); }
  }
  renderBulk();
}

/* column widths: drag the edge of a header; remembered on this device */
/* Column widths in the Table: drag the right edge of any header to widen or narrow it; double-click the edge to put it back.
   Temporary on purpose: kept in memory only, so a reload starts fresh, and never saved with the schedule or in any setting. */
const colW = {}; // column key (the <col> class, e.g. 'k-name') -> width in pixels
const COL_MIN = 40;
const colEl = (k) => $('col.' + k);
function applyColWidths() {
  for (const col of $$('.twrap colgroup col')) {
    const k = [...col.classList].find((c) => c.startsWith('k-'));
    if (k) col.style.width = colW[k] ? colW[k] + 'px' : '';
  }
}
function bindColResize() {
  const cols = $$('.twrap colgroup col'), ths = $$('.twrap thead th');
  ths.forEach((th, i) => {
    const col = cols[i], k = col && [...col.classList].find((c) => c.startsWith('k-'));
    if (!k || ['k-flag', 'k-lock', 'k-act'].includes(k) || !th.textContent.trim()) return; // narrow icon columns stay as they are
    th.style.position = 'sticky';
    const grip = h('span', { class: 'rz', title: 'Drag to resize this column. Double-click to reset it. (Temporary: not saved.)' });
    th.append(grip);
    grip.addEventListener('dblclick', (e) => { e.stopPropagation(); delete colW[k]; applyColWidths(); });
    grip.addEventListener('click', (e) => e.stopPropagation()); // a header click must not sort or select
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX, w0 = th.getBoundingClientRect().width;
      grip.classList.add('on');
      const move = (ev) => { colW[k] = Math.max(COL_MIN, Math.round(w0 + ev.clientX - x0)); colEl(k).style.width = colW[k] + 'px'; };
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); grip.classList.remove('on'); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    });
  });
  applyColWidths();
}

/* ----- several rows selected: act on all of them ----- */
function renderBulk() {
  const bar = $('#bulkbar');
  const ids = multiOn() ? selIds() : [];
  if (ids.length < 2 || S.readonly || !S.work || S.view === 'exec') { bar.hidden = true; bar.textContent = ''; return; }
  bar.hidden = false;
  bar.textContent = '';
  const aud = h('select', { 'aria-label': 'Set audience for the selected activities', title: 'Set audience' }, h('option', { value: '', text: 'Audience…' }), LEVELS.map((k) => h('option', { value: k, text: LEVEL_INFO[k].label })));
  aud.addEventListener('change', () => { const v = aud.value; if (LEVELS.includes(v)) edit(() => { for (const id of ids) taskById(id).lvl = v; }); });
  const tasks = () => ids.map(taskById).filter(Boolean);
  const btn = (label, title, run, cls) => h('button', { class: 'btn sm' + (cls ? ' ' + cls : ''), type: 'button', text: label, title, onclick: run });
  bar.append(...[h('strong', { text: ids.length + ' selected' }),
    btn('Link in order', 'Each selected activity starts when the one above it finishes (finish-to-start). Existing links stay.', () => linkInOrder(ids)),
    S.detail ? aud : null,
    S.work.execOn ? btn('Exec on', 'Show the selected Client-level activities in the executive overview', () => edit(() => { for (const t of tasks()) if ((t.lvl || 'client') === 'client') t.exec = true; })) : null,
    btn(tasks().every((t) => t.locked) ? 'Unlock' : 'Lock', 'Lock or unlock the dates of the selected activities', () => {
      const all = tasks().every((t) => t.locked);
      edit(() => { for (const t of tasks()) { const r = S.res.get(t.id); if (all) t.locked = false; else if (!t.locked) { t.start = fmtISO(r.start); t.locked = true; t.notBefore = null; } } });
    }),
    h('span', { class: 'vsep' }),
    btn('Delete', 'Delete the selected activities. Undo brings them back.', () => { const n = ids.length; edit(() => { const set = new Set(ids); S.work.tasks = S.work.tasks.filter((t) => !set.has(t.id)); for (const x of S.work.tasks) x.deps = (x.deps || []).filter((d) => !set.has(d.id)); }); S.multi = new Set(); S.sel = null; renderAll(); toast('Deleted ' + n + ' activities.', { label: 'Undo', run: undo }); }, 'danger'),
    h('button', { class: 'btn sm icon', type: 'button', title: 'Clear the selection', 'aria-label': 'Clear the selection', html: ICON.x, onclick: () => { S.multi = new Set(); markSel(); if (S.view !== 'table') renderAll(); } })].filter(Boolean));
}
function linkInOrder(ids) {
  const order = S.work.tasks.filter((t) => ids.includes(t.id));
  let added = 0, skipped = 0;
  edit(() => {
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1], b = taskById(order[i].id);
      if ((b.deps || []).some((d) => d.id === a.id)) continue;
      if (wouldCycle(S.work.tasks, b.id, [a.id])) { skipped++; continue; }
      (b.deps = b.deps || []).push({ id: a.id, type: 'FS', lag: 0 }); added++;
      if (b.locked) continue;
      b.notBefore = null;
    }
  });
  toast(added ? 'Linked ' + added + ' activit' + (added === 1 ? 'y' : 'ies') + ' in order.' + (skipped ? ' ' + skipped + ' skipped to avoid a loop.' : '') : 'They were already linked.', added ? { label: 'Undo', run: undo } : null);
}

/* ----- change impact: a short card after an edit, details on request ----- */
let impactTimer = null;
function showImpact() {
  const box = $('#impact');
  clearTimeout(impactTimer);
  const imp = S.impact;
  if (!imp || !S.work || $('#pageEditor').hidden) { box.hidden = true; box.textContent = ''; return; }
  const lines = impactLines(imp, fmtShortNoDow);
  if (!lines.length) { box.hidden = true; return; }
  box.hidden = false;
  box.className = 'impact' + (imp.severity === 'crit' ? ' crit' : imp.severity === 'warn' ? ' warn' : '');
  box.textContent = '';
  const ul = h('ul');
  for (const l of lines) ul.append(h('li', { class: l.cls || '', text: l.text }));
  const canUndo = S.undo.length === imp.undoDepth && !S.readonly;
  box.append(
    h('h3', null, 'Schedule updated', h('button', { class: 'ib x', type: 'button', 'aria-label': 'Dismiss', title: 'Dismiss', html: ICON.x, onclick: () => { S.impact = null; showImpact(); } })),
    ul,
    h('div', { class: 'row' },
      canUndo ? h('button', { class: 'btn sm', type: 'button', text: 'Undo', onclick: () => { undo(); } }) : null,
      imp.moved.length + imp.changed.length ? h('button', { class: 'btn sm quiet', type: 'button', text: 'Show what moved (' + (imp.moved.length + imp.changed.length) + ')', onclick: () => openImpactDetail(imp) }) : null));
  const stay = imp.severity !== 'info';
  const arm = () => { clearTimeout(impactTimer); if (!stay) impactTimer = setTimeout(() => { if (S.impact === imp) { S.impact = null; showImpact(); } }, 9000); };
  box.onmouseenter = () => clearTimeout(impactTimer);
  box.onmouseleave = arm;
  arm();
}
function openImpactDetail(imp) {
  const rows = imp.changed.concat(imp.moved).sort((a, b) => a.row - b.row);
  const d = (n) => h('td', { class: 'num d' + (n > 0 ? ' late' : n < 0 ? ' early' : ''), text: n ? (n > 0 ? '+' : '−') + Math.abs(n) : '0' });
  const tbl = h('table', { class: 'imp-table' },
    h('thead', null, h('tr', null, h('th', { text: '#' }), h('th', { text: 'Activity' }), h('th', { text: 'Was' }), h('th', { text: 'Now' }), h('th', { class: 'num', text: 'Days' }))),
    h('tbody', null, rows.map((x) => h('tr', null,
      h('td', { class: 'num', text: x.row }),
      h('td', null, x.name, imp.changed.includes(x) ? h('span', { class: 'chip blue', text: 'edited', style: 'margin-left:6px' }) : null),
      h('td', { class: 'num old', text: x.kind === 'milestone' ? fmtShortNoDow(x.oldStart) : fmtShortNoDow(x.oldStart) + ' – ' + fmtShortNoDow(x.oldFinish) }),
      h('td', { class: 'num', text: x.kind === 'milestone' ? fmtShortNoDow(x.newStart) : fmtShortNoDow(x.newStart) + ' – ' + fmtShortNoDow(x.newFinish) }),
      d(x.dFinish)))));
  const extra = [];
  for (const c of imp.commits) extra.push(h('p', { class: 'td-flag' + (c.after.status === 'late' ? ' error' : ''), text: 'Commitment “' + c.name + '”: ' + COMMIT_WORD[c.after.status].toLowerCase() + ' (' + commitText(c.after) + '). Committed ' + fmtShortNoDow(parseDate(c.after.date)) + ', forecast ' + fmtShortNoDow(c.after.forecast) + '.' }));
  for (const i of imp.newIssues) extra.push(h('p', { class: 'td-flag' + (i.level === 'error' ? ' error' : ''), text: 'New issue on “' + i.name + '”: ' + i.text }));
  openDialog({
    title: 'What moved', wide: true,
    body: h('div', { class: 'form' }, h('p', { class: 'muted', text: 'Every date this edit changed. Nothing is saved until you click Save; Undo puts it all back.' }), extra.length ? h('div', { class: 'form' }, extra) : null, tbl),
    actions: [S.undo.length === imp.undoDepth && !S.readonly ? { label: 'Undo the edit', run: () => { undo(); } } : null, { label: 'Close', primary: true }].filter(Boolean),
  });
}

/* ----- settings ----- */
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
      }, { title: 'Color for ' + LEVEL_INFO[k].label + ' activities', noDefault: true }));
      box.append(h('div', { class: 'lv-row' }, h('div', null, h('strong', { text: LEVEL_INFO[k].label }), h('small', { text: LEVEL_INFO[k].hint })), btn));
    }
    const isBrand = LEVELS.every((k) => cols[k] === BRAND_AUDIENCE[k]);
    if (!isBrand && !S.readonly) box.append(h('div', null, h('button', { type: 'button', class: 'btn sm', text: 'Use the Arch Nexus colors', title: 'Nexus Blue for Client, a deeper shade for Design team, Blue Gray for Internal', onclick: () => { edit(() => { S.work.colors = Object.assign({}, BRAND_AUDIENCE); }); paint(); } })));
  };
  paint();
  return box;
}
function askReplaceBaseline(done) {
  const bl = S.work.baseline;
  openDialog({
    title: 'Replace the baseline?',
    body: h('div', { class: 'form' }, h('p', { text: 'Today’s dates become the new baseline, so every activity’s slip starts again from zero.' }),
      h('p', { class: 'muted', text: 'The current baseline (set ' + whenText(bl.at) + ') is replaced. If it was already saved, it stays in Version history.' })),
    actions: [{ label: 'Cancel', run: () => { setTimeout(() => openSettings(), 0); } }, { label: 'Replace baseline', primary: true, run: () => { setBaseline(); toast('Baseline replaced. Save to keep it.'); setTimeout(() => openSettings(), 0); } }],
  });
}
function openSettings() {
  if (!S.work) return;
  const ro = S.readonly;
  const box = h('div', { class: 'ps' });
  let api = null, advOpen = false;
  const sw = (id, on, label, onchange) => {
    const cb = h('input', { type: 'checkbox', id, checked: on ? 'checked' : null, disabled: ro, onchange });
    return h('label', { class: 'chk', for: id }, cb, ' ' + label);
  };
  const paint = () => {
    box.textContent = '';
    const sc = scaleOf(), n = S.work.holidays.length;
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Time scale' }, Object.keys(SCALES).map((k) =>
      h('button', { type: 'button', class: sc === k ? 'on' : '', 'aria-pressed': String(sc === k), disabled: ro, 'data-scale': k, text: SCALES[k].label,
        onclick: () => { if (sc !== k) { edit(() => { S.work.scale = k; }); paint(); } } })));
    const proj = S.projects.get(S.meta.projectId);
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
    const warnIn = h('input', { type: 'text', inputmode: 'numeric', class: 'txt sm', id: 'psWarn', value: String(S.work.commitWarn || 0), disabled: ro, style: 'width:64px;text-align:right', 'aria-label': 'Days of margin' });
    warnIn.addEventListener('change', () => { const v = normCommitWarn(warnIn.value); edit(() => { S.work.commitWarn = v; }); warnIn.value = String(v); });
    const projSel = h('select', { class: 'txt', id: 'psProject', disabled: ro, 'aria-label': 'Project' },
      S.meta.projectId ? null : h('option', { value: '', text: 'Not in a project (unassigned)' }),
      [...S.projects.values()].filter((p) => canWriteProject(p) || p.id === S.meta.projectId).sort((a, b) => (a.number || a.name).localeCompare(b.number || b.name)).map((p) => h('option', { value: p.id, text: projLabel(p) })));
    projSel.value = S.meta.projectId || '';
    projSel.addEventListener('change', async () => {
      const pid = projSel.value || null;
      if (!pid) return;
      if (await assignSchedule(S.cur, pid)) {
        const p = S.projects.get(pid);
        if (p) edit(() => { S.work.info = normInfo(Object.assign({}, S.work.info, { number: p.number, client: p.client })); });
        toast(p ? 'Moved to ' + projLabel(p) + '.' : 'Moved to Unassigned.');
        renderSheet(); paint();
      }
    });
    box.append(
      h('fieldset', null, h('legend', { text: 'Project' }),
        h('div', { class: 'ps-field' }, h('label', { for: 'psProject', text: 'Belongs to' }), projSel),
        infoIn('number', 'Project number', 'e.g. 2026-014'), infoIn('client', 'Client', 'e.g. Hill AFB'),
        infoIn('issue', 'Issue note', 'e.g. Issued for owner review, rev 2'),
        h('p', { class: 'ps-note', text: proj ? 'Number and client fill in from the project. ' + PROJECT_SOURCE.note : 'Shown under the title on exports.' })),
      h('fieldset', null, h('legend', { text: 'Calendar' }),
        h('p', { class: 'ps-hol' + (S.work.hset ? '' : ' warn'), text: S.work.hset ? n + (n === 1 ? ' holiday' : ' holidays') + ' set for this schedule.' : 'Holidays: Not customized yet. Weekends are flagged, but holiday dates are not.' }),
        h('button', { class: 'btn', type: 'button', text: ro ? 'View holidays' : 'Edit holidays…', onclick: () => { api.close(); openHolidays(); } }),
        h('div', { class: 'field', style: 'width:100%' }, h('span', { class: 'lbl', text: 'Default time scale' }), seg,
          h('p', { class: 'ps-note', text: 'Used when the timeline opens and for PDF and image exports. Zooming the timeline changes only your view.' }))),
      h('fieldset', null, h('legend', { text: 'Views and tracking' }),
        sw('psExec', S.work.execOn, 'Executive overview', (ev) => { const on = ev.target.checked; edit(() => { S.work.execOn = on; }); paint(); }),
        h('p', { class: 'ps-note', text: 'Adds an Exec checkbox to each activity, an Executive view and an Executive export. Only Client-level activities you check appear in it.' }),
        sw('psBase', S.work.baselineOn, 'Track slip against a baseline', (ev) => { const on = ev.target.checked; edit(() => { S.work.baselineOn = on; }); paint(); }),
        h('p', { class: 'ps-note', text: 'Keep a snapshot of every activity’s dates, then see how far each has moved since. Adds a Slip column and a thin bar under each activity in the timeline. Each export can leave it out.' }),
        ...(S.work.baselineOn ? [
          h('p', { class: 'ps-hol' + (S.work.baseline ? '' : ' warn'), text: S.work.baseline
            ? 'Baseline set ' + whenText(S.work.baseline.at) + (S.work.baseline.by ? ' by ' + nameOf(S.work.baseline.by) : '') + ', ' + Object.keys(S.work.baseline.tasks).length + ' activities.'
            : 'No baseline yet. Set one to start tracking slip.' }),
          ro ? null : h('div', { class: 'ps-btns' },
            h('button', { class: 'btn' + (S.work.baseline ? '' : ' primary'), type: 'button', text: S.work.baseline ? 'Replace baseline…' : 'Set baseline from today’s dates',
              onclick: () => { if (!S.work.baseline) { setBaseline(); toast('Baseline set. Save to keep it.'); paint(); } else askReplaceBaseline(paint); } }),
            S.work.baseline ? h('button', { class: 'btn', type: 'button', text: 'Clear baseline', onclick: () => { clearBaseline(); paint(); } }) : null)] : []),
        h('div', { class: 'ps-field' }, h('label', { for: 'psWarn', text: 'Commitment margin' }),
          h('span', { class: 'grp', style: 'display:flex;align-items:center;gap:8px' }, warnIn, h('span', { class: 'ps-note', text: 'days. A commitment with less margin than this is flagged at risk. 0 turns that off.' })))),
      h('fieldset', null, h('legend', { text: 'Audience colors' }),
        h('p', { class: 'ps-note', text: 'Shown in the Detailed view and in Design team and Internal exports.' }), colorRows()),
      h('details', { class: 'ps-adv', open: advOpen ? 'open' : null, ontoggle: (ev) => { advOpen = ev.target.open; } },
        h('summary', { text: 'Advanced' + (custom ? ' · working days customized' : '') }),
        h('fieldset', null, h('legend', { text: 'Working days' }),
          h('div', { class: 'ps-days' }, dayBoxes),
          h('p', { class: 'ps-note', text: 'Checked days are working days. Unchecked days are flagged like weekends and shaded in the timeline and exports. Durations and links still count calendar days, so this never moves a date by itself.' }),
          custom && !ro ? h('button', { class: 'btn sm', type: 'button', text: 'Back to Monday to Friday', onclick: () => { edit(() => { S.work.offDays = [0, 6]; }); paint(); } }) : null)));
  };
  paint();
  api = openDialog({ title: 'Schedule settings', body: h('div', null, h('p', { class: 'muted', style: 'margin-bottom:6px', text: S.work.name + '. Saved with this schedule; other schedules in the project keep their own.' }), box), actions: [{ label: 'Done', primary: true }], wide: true });
}

/* ----- version history: who, when, what changed, what restoring would do ----- */
async function openHistory() {
  if (!S.work || !S.db) return;
  const body = h('div', { class: 'hist' }, h('p', { class: 'muted', text: 'Loading earlier versions…' }));
  const api = openDialog({ title: 'Version history', body, actions: [{ label: 'Close', primary: true }], wide: true });
  let list = [];
  try { list = await loadHistory(); } catch (e) { body.textContent = ''; body.append(h('p', { class: 'muted', text: 'Could not load the history. Check your connection and try again.' })); return; }
  await refreshNames(list.map((v) => v.by).filter(Boolean));
  body.textContent = '';
  if (!list.length) {
    body.append(h('p', { text: 'No earlier versions yet.' }), h('p', { class: 'muted', text: 'Each time anyone saves, the saved version is kept here. Saves by one person within ten minutes are combined. The newest 40 are kept.' }));
    return;
  }
  body.append(h('p', { class: 'muted', text: 'Every save is kept here, newest first. Restoring puts that version on screen as an unsaved change. Look it over, then Save, or Undo to go back. Nobody’s work is overwritten until you save.' }));
  const ul = h('div', { class: 'hist-list' });
  list.forEach((v, i) => {
    const d = historyDiff(v.tasks, S.work.tasks);
    const bits = [];
    if (d.moved) bits.push(d.moved + (d.moved === 1 ? ' activity with different dates' : ' activities with different dates'));
    if (d.add) bits.push(d.add + ' activit' + (d.add === 1 ? 'y' : 'ies') + ' would come back');
    if (d.gone) bits.push(d.gone + ' activit' + (d.gone === 1 ? 'y' : 'ies') + ' added since would go');
    if (d.renamed) bits.push(d.renamed + ' renamed');
    // what this save changed compared with the one before it
    const prev = list[i + 1];
    const det = prev ? historyChanges(prev.tasks, v.tasks) : [];
    ul.append(h('div', { class: 'hist-row' },
      h('div', null,
        h('div', { class: 'hw' }, h('strong', { text: whenText(v.at) }), h('span', { text: (v.by ? nameOf(v.by) : 'Someone') + (i === 0 ? ' · latest save' : '') })),
        h('small', { text: (v.tasks || []).length + ' activities. ' + (d.same ? 'Same as what is on screen now.' : 'Restoring it: ' + bits.join('; ') + '.') }),
        det.length ? h('details', null, h('summary', { text: 'What this save changed (' + det.length + ')' }), h('ul', null, det.slice(0, 30).map((x) => h('li', { text: x })))) : null),
      S.readonly || d.same ? null : h('button', { type: 'button', class: 'btn sm', text: 'Restore', title: 'Put this version on screen as an unsaved change', onclick: () => { api.close(); restoreVersion(v); } })));
  });
  body.append(ul);
}
/* a short list of what changed between two saved versions */
function historyChanges(oldTasks, newTasks) {
  const o = new Map((oldTasks || []).map((t) => [String(t.id), t])), out = [];
  for (const t of newTasks || []) {
    const p = o.get(String(t.id)), nm = '“' + (t.name || 'Untitled') + '”';
    if (!p) { out.push('Added ' + nm); continue; }
    if ((p.name || '') !== (t.name || '')) out.push('Renamed “' + (p.name || 'Untitled') + '” to ' + nm);
    if ((+p.duration || 0) !== (+t.duration || 0) && t.kind !== 'milestone') out.push(nm + ': ' + p.duration + ' → ' + t.duration + ' days');
    else if (p.start !== t.start && (!(t.deps || []).length || t.locked)) out.push(nm + ' moved to ' + (isNaN(parseDate(t.start)) ? t.start : fmtShortNoDow(parseDate(t.start))));
    if (JSON.stringify(p.deps || []) !== JSON.stringify(t.deps || [])) out.push(nm + ': links changed');
    if (!!p.locked !== !!t.locked) out.push(nm + (t.locked ? ' locked' : ' unlocked'));
    if (JSON.stringify(p.commit || null) !== JSON.stringify(t.commit || null)) out.push(nm + ': commitment ' + (t.commit ? 'set to ' + t.commit.date : 'removed'));
  }
  const n = new Set((newTasks || []).map((t) => String(t.id)));
  for (const [id, t] of o) if (!n.has(id)) out.push('Deleted “' + (t.name || 'Untitled') + '”');
  return out;
}

/* ----- Executive view: bar colors ----- */
function exSwatch(t) {
  const own = isColor(t.exColor) ? normColor(t.exColor) : null;
  const sw = h('span', { class: 'exc', role: 'button', tabindex: S.readonly ? '-1' : '0', 'aria-label': 'Bar color for ' + (t.name || 'activity'),
    title: S.readonly ? 'Bar color (view-only)' : own ? 'Bar color: ' + colorLabel(own) + '. Click to change.' : 'Uses the default color. Click to give this activity its own.' });
  sw.style.background = colorCss(execKey(t, S.work.execColor));
  if (own) sw.classList.add('own');
  const open = (ev) => { ev.stopPropagation(); if (S.readonly) return; openColorPick(sw, own, (k) => setExColor(t.id, k), { title: 'Bar color for this activity' }); };
  sw.addEventListener('click', open);
  sw.addEventListener('pointerdown', (ev) => ev.stopPropagation());
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
    body: h('div', { class: 'form' }, h('p', { text: 'Make ' + colorLabel(key) + ' the default for every activity you haven’t colored yourself and for new ones. ' + own + (own === 1 ? ' activity has its own color.' : ' activities have their own colors.') }),
      h('p', { class: 'muted', text: 'Choose “All activities” to also recolor those, so every bar becomes ' + colorLabel(key) + '.' })),
    actions: [
      { label: 'Cancel' },
      { label: 'Default only', title: 'Keep the colors activities already have', run: () => { setExDefault(key, false); } },
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
    h('span', { text: 'Used for every activity you haven’t colored, and for new ones. Use the squares by each activity to give it its own.' }),
    S.readonly ? null : h('button', { class: 'btn sm', type: 'button', text: 'Shade by phase', title: 'Color the executive activities from light to dark Nexus Blue in schedule order, like the brand guide’s example schedule', onclick: shadeByPhase }));
}
/* page 11 of the brand guide: phases step from light to dark Nexus Blue */
function shadeByPhase() {
  const list = S.work.tasks.filter((t) => isExecTask(t) && t.kind !== 'milestone');
  if (!list.length) { toast('Mark some Client-level activities for the executive overview first.'); return; }
  edit(() => { list.forEach((t, i) => { const k = Math.round(i * (PHASE_SHADES.length - 1) / Math.max(1, list.length - 1)); taskById(t.id).exColor = PHASE_SHADES[k]; }); });
  toast('Shaded ' + list.length + ' phases from light to dark.', { label: 'Undo', run: undo });
}

/* ----- keyboard shortcuts ----- */
function openShortcuts() {
  const k = (...keys) => h('span', null, keys.map((x) => h('kbd', { text: x })));
  openDialog({
    title: 'Keyboard shortcuts', wide: true,
    body: h('div', { class: 'keys' },
      k('Ctrl', 'S'), h('span', { text: 'Save' }),
      k('Ctrl', 'Z'), h('span', { text: 'Undo (outside a text field)' }),
      k('Ctrl', 'Enter'), h('span', { text: 'Add an activity below the selected row' }),
      k('Enter'), h('span', { text: 'Commit the cell and move down' }),
      k('Shift', 'Enter'), h('span', { text: 'Commit and move up' }),
      k('↑', '↓'), h('span', { text: 'Move between rows in the same column' }),
      k('Esc'), h('span', { text: 'Cancel an edit, close a panel or a menu' }),
      k('Shift', 'click'), h('span', { text: 'Select a range of rows (by row number)' }),
      k('Ctrl', 'click'), h('span', { text: 'Add a row to the selection' }),
      k('?'), h('span', { text: 'This list' })),
    actions: [{ label: 'Close', primary: true }],
  });
}

/* ----- orchestration ----- */
function applyAudienceStyle() {
  document.body.classList.toggle('detail', !!S.detail);
  document.body.classList.toggle('base-on', baseActive());
  document.body.classList.toggle('exec-on', !!(S.work && S.work.execOn));
  document.body.classList.toggle('ro', !!S.readonly);
  const cols = normColors(S.work && S.work.colors);
  for (const k of LEVELS) document.documentElement.style.setProperty('--lv-' + k, colorCss(cols[k]));
}
function renderAll() {
  if (S.view === 'exec' && !(S.work && S.work.execOn)) S.view = 'gantt';
  if (!S.route || S.route.page !== 'editor') { if (S.route && S.route.page !== 'editor') return; }
  applyAudienceStyle();
  renderSheet();
  renderBanners();
  renderToolbar();
  const has = !!S.work;
  $('#tableView').hidden = !has || S.view !== 'table';
  $('#ganttView').hidden = !has || (S.view !== 'gantt' && S.view !== 'exec');
  if (!has) { $('#issues').hidden = true; closeInspector(); return; }
  renderIssues();
  if (S.view === 'table') renderTable(); else renderGantt();
  if (S.inspect) renderInspector();
  renderBulk();
}

/* ----- static bindings ----- */
function bindStatic() {
  $('#btnHomeNew').addEventListener('click', () => openNewSchedule(null));
  $('#schedSel').addEventListener('change', (e) => switchTo(e.target.value));
  $('#btnBack').addEventListener('click', () => go(S.tpl ? '#/scheduler/templates' : S.meta.projectId ? '#/scheduler/p/' + S.meta.projectId : '#/scheduler/p/unassigned'));
  $('#edProj').addEventListener('click', (e) => { e.preventDefault(); if (!S.tpl && !S.meta.projectId && !S.readonly) openAssign(S.cur); else $('#btnBack').click(); });
  $('#btnNew').addEventListener('click', () => { closeMenus(); openNew(); });
  $('#btnRename').addEventListener('click', () => { closeMenus(); if (S.tpl) openTemplateSettings(); else openRename(); });
  $('#btnDelete').addEventListener('click', () => { closeMenus(); openDelete(); });
  $('#btnDup').addEventListener('click', () => { closeMenus(); openDuplicate(S.cur); });
  $('#btnShortcuts').addEventListener('click', () => { closeMenus(); openShortcuts(); });
  $('#vTable').addEventListener('click', () => { S.view = 'table'; renderAll(); });
  $('#vGantt').addEventListener('click', () => { S.view = 'gantt'; renderAll(); });
  $('#vExec').addEventListener('click', () => { S.view = 'exec'; renderAll(); });
  const addAt = () => (S.sel ? S.work.tasks.findIndex((t) => t.id === S.sel) : -1);
  $('#btnAdd').addEventListener('click', () => addTask(addAt()));
  $('#btnAddMs').addEventListener('click', () => addTask(addAt(), 'milestone'));
  $('#btnUndo').addEventListener('click', undo);
  $('#btnHistory').addEventListener('click', openHistory);
  $('#btnSave').addEventListener('click', save);
  $('#btnIssues').addEventListener('click', () => { S.issuesOpen = !issuesShown(counts()); renderToolbar(); renderIssues(); });
  $('#btnSettings').addEventListener('click', () => (S.tpl ? openTemplateSettings() : openSettings()));
  bindTemplates();
  $('#onlyIssues').addEventListener('change', (e) => { S.onlyIssues = e.target.checked; renderTable(); });
  $('#btnAddEmpty').addEventListener('click', () => addTask(-1));
  S.detail = pref('sched.detail') === '1';
  $('#btnDetail').addEventListener('click', () => {
    S.detail = !S.detail;
    pref('sched.detail', S.detail ? '1' : '0');
    renderAll();
  });
  $('#btnZoomIn').addEventListener('click', () => zoomBy(1.4));
  $('#btnZoomOut').addEventListener('click', () => zoomBy(1 / 1.4));
  $('#btnFit').addEventListener('click', fitTimeline);
  $('#btnToday').addEventListener('click', scrollToToday);

  const menus = [['#btnScale', '#scaleMenu'], ['#btnSchedMenu', '#schedMenu']];
  for (const [b, m] of menus) {
    $(b).addEventListener('click', (e) => { e.stopPropagation(); const open = $(m).hidden; closeMenus(); $(m).hidden = !open; $(b).setAttribute('aria-expanded', open); });
  }
  const smenu = $('#scaleMenu');
  smenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('[data-scale]');
    if (!b) return;
    closeMenus();
    if (S.readonly || !S.work || scaleOf() === b.dataset.scale) return;
    S.zoomF = 1;
    edit(() => { S.work.scale = b.dataset.scale; });
  });
  docOn(document, 'click', closeMenus);
  docOn(document, 'keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
  $('#btnExport').addEventListener('click', (e) => { e.stopPropagation(); closeMenus(); runExport(); });

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
    const tr = el.closest('tr');
    const moveRow = (dir) => {
      const rows = $$('#tbody tr').filter((x) => !x.hidden);
      const j = rows.indexOf(tr) + dir;
      if (j < 0 || j >= rows.length) return false;
      const next = $('[data-f=' + el.dataset.f + ']', rows[j]);
      if (!next || next.disabled) { const n2 = $('[data-f=name]', rows[j]); if (n2) n2.focus(); return true; }
      next.focus(); if (next.select) next.select();
      return true;
    };
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); el.blur(); addTask(S.work.tasks.findIndex((t) => t.id === tr.dataset.id)); return; }
    if (e.key === 'Enter' && el.tagName === 'INPUT') { e.preventDefault(); const f = el.dataset.f; el.blur(); if (f !== 'preds') moveRow(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { el.dataset.cancel = '1'; el.blur(); delete el.dataset.cancel; renderAll(); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && el.tagName === 'INPUT' && el.type === 'text' && !e.altKey) { if (moveRow(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault(); }
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
  tbody.addEventListener('dblclick', (e) => { const tr = e.target.closest('tr'); if (tr && !e.target.closest('input,select,button')) openTask(tr.dataset.id); });
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
      case 'info': openTask(id); break;
      case 'commit': openTask(id, { focus: 'commit' }); break;
      case 'up': moveTask(id, -1); break;
      case 'down': moveTask(id, 1); break;
      case 'add': addTask(i); break;
      case 'splice': spliceTask(i); break;
      case 'del': deleteTask(id); break;
      case 'lock': toggleLock(id); break;
      case 'release': edit(() => { taskById(id).notBefore = null; }); break;
    }
  });
  docOn(document, 'keydown', (e) => {
    if ($('#pageEditor').hidden) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''));
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); }
    else if (e.key === '?' && !typing && !$('#modalRoot').children.length) { e.preventDefault(); openShortcuts(); }
    else if (e.key === 'Escape' && S.inspect && !$('#modalRoot').children.length && !$('.cpick')) closeInspector();
  });
  bindColResize();
  let rz = null;
  docOn(window, 'resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.work && S.view !== 'table' && !$('#pageEditor').hidden) renderGantt(); }, 150); });
}
function closeMenus() {
  for (const [b, m] of [['#btnScale', '#scaleMenu'], ['#btnSchedMenu', '#schedMenu']]) { $(m).hidden = true; $(b).setAttribute('aria-expanded', 'false'); }
}

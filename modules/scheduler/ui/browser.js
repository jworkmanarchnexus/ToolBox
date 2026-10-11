/* ===== Scheduler home (find a project) and the project page (its schedules) =====
   Plus the dialogs that create things: a project, a schedule from a template, a duplicate. */
S.home = { q: '', scope: 'all', filter: 'all', sort: 'updated' };
const saveHome = () => { pref('sched.home', JSON.stringify({ scope: S.home.scope, filter: S.home.filter, sort: S.home.sort })); };

const lastUpdate = (list) => list.reduce((m, d) => ((d.updatedAt || 0) > (m ? m.updatedAt || 0 : -1) ? d : m), null);
const whenShort = (ms) => {
  if (!ms) return '';
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  if (d < 14) return d + ' days ago';
  return fmtMed(dayNum(new Date(ms).getFullYear(), new Date(ms).getMonth(), new Date(ms).getDate()));
};
/* the date span of a stored schedule, computed with the engine so it is never stale */
function schedSpan(doc) {
  try {
    const tasks = normalizeTasks(doc.tasks || []);
    if (!tasks.length) return null;
    const res = schedule(tasks, makeCalendar(validHol(doc.holidays), doc.offDays));
    const rs = [...res.values()];
    return { start: Math.min(...rs.map((r) => r.start)), end: Math.max(...rs.map((r) => (r.kind === 'milestone' ? r.start : r.finish))), tasks, res, n: tasks.length };
  } catch (e) { return null; }
}
/* a small strip of the schedule: the executive activities if there are any, otherwise all activities */
function miniStrip(doc, span) {
  const box = h('div', { class: 'mini', 'aria-hidden': 'true' });
  if (!span) return box;
  const len = Math.max(1, span.end - span.start + 1);
  const pick = span.tasks.some((t) => t.exec) ? span.tasks.filter((t) => t.exec) : span.tasks;
  for (const t of pick.slice(0, 60)) {
    const r = span.res.get(t.id);
    const el = h('span', { class: r.kind === 'milestone' ? 'ms' : '' });
    el.style.left = ((r.start - span.start) / len * 100).toFixed(2) + '%';
    if (r.kind !== 'milestone') el.style.width = Math.max(0.6, r.dur / len * 100).toFixed(2) + '%';
    if (t.exColor && r.kind !== 'milestone') el.style.background = colorCss(t.exColor);
    box.append(el);
  }
  return box;
}

/* ----- home ----- */
function renderHome() {
  renderEmpty();
  const body = $('#homeBody');
  let main = $('#homeMain');
  if (!main) { main = h('div', { id: 'homeMain' }); body.append(main); }
  const activeEl = document.activeElement && document.activeElement.id;
  main.textContent = '';
  $('#btnHomeNew').disabled = !canCreateAnywhere();
  if (!S.schedLoaded && !S.noStore) { main.append(h('p', { class: 'muted', text: 'Loading…' })); return; }
  if (!S.schedules.size && !S.projects.size) return; // the first-run state in #empty covers it
  if (S.work && S.dirty) {
    main.append(h('div', { class: 'banner warn', style: 'margin-bottom:16px' }, h('span', { class: 'bmsg', html: ICON.warn }, h('span', { text: 'Unsaved changes in “' + S.work.name + '”.' })),
      h('span', { class: 'bact' }, h('button', { class: 'btn sm', type: 'button', text: 'Go back to it', onclick: () => go('#/scheduler/s/' + S.cur) }))));
  }

  /* tools */
  const q = h('input', { type: 'search', class: 'txt', id: 'projSearch', placeholder: 'Search projects by number, name or client', value: S.home.q, autocomplete: 'off', 'aria-label': 'Search projects' });
  q.addEventListener('input', () => { S.home.q = q.value; renderHome(); });
  const segBtn = (val, label, title) => h('button', { type: 'button', 'aria-pressed': String(S.home.scope === val), title, text: label, onclick: () => { S.home.scope = val; saveHome(); renderHome(); } });
  const filt = h('select', { class: 'txt sm', 'aria-label': 'Filter projects' }, [['all', 'All projects'], ['with', 'With a schedule'], ['without', 'No schedule yet']].map(([v, t]) => h('option', { value: v, text: t })));
  filt.value = S.home.filter;
  filt.addEventListener('change', () => { S.home.filter = filt.value; saveHome(); renderHome(); });
  const sb = h('div', { class: 'searchbox' }, h('span', { html: icon('search', 16) }).firstChild, q);
  main.append(h('div', { class: 'home-tools' }, sb,
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Which projects' }, segBtn('mine', 'My projects', 'Projects you added, saved a schedule in, or opened recently. With Vantagepoint, the projects you are assigned to.'), segBtn('all', 'All projects', 'Every project in the list')),
    filt, h('span', { class: 'grow' })));

  /* recent */
  const recent = recentProjects().filter((p) => p.status === 'active').slice(0, 4);
  if (recent.length && !S.home.q) {
    main.append(h('div', { class: 'section-h' }, h('h2', { text: 'Recent' })));
    const row = h('div', { class: 'recent' });
    for (const p of recent) {
      const list = schedulesOf(p.id), last = lastUpdate(list);
      row.append(h('a', { class: 'rcard', href: '#/scheduler/p/' + p.id, onclick: (e) => { e.preventDefault(); go('#/scheduler/p/' + p.id); } },
        h('span', { class: 'pn', text: p.number || 'No number' }), h('span', { class: 'pt', text: p.name }),
        h('span', { class: 'pm', text: list.length ? list.length + (list.length === 1 ? ' schedule' : ' schedules') + (last ? ' · ' + whenShort(last.updatedAt) : '') : 'No schedule exists yet' })));
    }
    main.append(row);
  }

  /* the list */
  const needle = S.home.q.trim().toLowerCase();
  const match = (p) => !needle || [p.number, p.name, p.client].some((x) => (x || '').toLowerCase().includes(needle));
  const rows = [...S.projects.values()].filter((p) => p.status === 'active' && match(p) && (S.home.scope === 'all' || isMine(p))).map((p) => {
    const list = schedulesOf(p.id);
    return { p, list, last: lastUpdate(list) };
  }).filter((x) => S.home.filter === 'all' || (S.home.filter === 'with' ? x.list.length : !x.list.length));
  const sorters = {
    updated: (a, b) => ((b.last ? b.last.updatedAt : b.p.updatedAt) || 0) - ((a.last ? a.last.updatedAt : a.p.updatedAt) || 0),
    number: (a, b) => (a.p.number || '~').localeCompare(b.p.number || '~', undefined, { numeric: true }),
    name: (a, b) => a.p.name.localeCompare(b.p.name),
    client: (a, b) => (a.p.client || '~').localeCompare(b.p.client || '~'),
  };
  rows.sort(sorters[S.home.sort] || sorters.updated);
  const th = (key, label, cls) => h('th', { class: cls || '', 'aria-sort': S.home.sort === key ? (key === 'updated' ? 'descending' : 'ascending') : null },
    h('button', { type: 'button', text: label, title: 'Sort by ' + label.toLowerCase(), onclick: () => { S.home.sort = key; saveHome(); renderHome(); } }));
  main.append(h('div', { class: 'section-h' }, h('h2', { text: 'Active projects' }), h('span', { class: 'muted', text: rows.length + (rows.length === 1 ? ' project' : ' projects') })));
  if (!rows.length) {
    main.append(h('div', { class: 'empty-note' }, h('p', { text: S.projects.size ? 'No projects match.' : 'No projects to show.' }),
      S.projects.size ? null : h('p', { class: 'muted', text: 'Projects come from the nightly Vantagepoint copy. You see the ones you are on the team of, plus any you were given access to.' })));
  } else {
    const tb = h('tbody');
    for (const { p, list, last } of rows) {
      const prim = S.schedules.get(primaryOf(p.id));
      const tr = h('tr', { tabindex: '0', 'data-id': p.id, onclick: (e) => { if (!e.target.closest('button')) go('#/scheduler/p/' + p.id); }, onkeydown: (e) => { if (e.key === 'Enter' && e.target === tr) go('#/scheduler/p/' + p.id); } },
        h('td', { class: 'pn', text: p.number || '—' }),
        h('td', null, h('span', { class: 'pt', text: p.name })),
        h('td', { class: 'd-client muted', text: p.client || '' }),
        h('td', null, list.length ? h('span', null, h('span', { text: prim ? prim.name : list[0].name }), list.length > 1 ? h('span', { class: 'muted', text: ' +' + (list.length - 1) + ' more' }) : null) : h('span', { class: 'nosched', text: 'No schedule exists' })),
        h('td', { class: 'd-upd when', text: last ? whenShort(last.updatedAt) + (last.updatedBy ? ' · ' + nameOf(last.updatedBy) : '') : '' }),
        h('td', { class: 'd-act acts' }, list.length
          ? h('button', { class: 'btn sm', type: 'button', text: 'Open schedule', onclick: () => go('#/scheduler/s/' + (prim ? prim.id : list[0].id)) })
          : !canWriteProject(p) ? null : h('button', { class: 'btn sm', type: 'button', text: 'New schedule', onclick: () => openNewSchedule(p.id) })));
      tb.append(tr);
    }
    main.append(h('table', { class: 'plist' },
      h('colgroup', null, h('col', { class: 'c-num' }), h('col'), h('col', { class: 'c-client' }), h('col', { class: 'c-sch' }), h('col', { class: 'c-upd' }), h('col', { class: 'c-act' })),
      h('thead', null, h('tr', null, th('number', 'Number'), th('name', 'Project'), th('client', 'Client', 'h-client'), h('th', { text: 'Schedule' }), th('updated', 'Last updated', 'h-upd'), h('th', { class: 'h-act' }))),
      tb));
  }

  /* schedules made before projects existed */
  const loose = schedulesOf(null).filter((d) => !needle || (d.name || '').toLowerCase().includes(needle));
  if (loose.length) {
    main.append(h('div', { class: 'section-h' }, h('h2', { text: 'Unassigned schedules' }), h('span', { class: 'muted', text: 'Not in a project yet. Open one and choose its project, or use Move.' })));
    main.append(schedList(loose, null));
  }

  /* archived: collapsed, and only projects that have schedules */
  const arch = [...S.projects.values()].filter((p) => p.status === 'archived' && match(p) && schedulesOf(p.id).length);
  if (arch.length) {
    const det = h('details', { class: 'archived', open: S.home.archOpen ? 'open' : null, ontoggle: (e) => { S.home.archOpen = e.target.open; } },
      h('summary', null, h('span', { html: icon('chevron-right', 14) }).firstChild, 'Archived projects', h('span', { class: 'muted', style: 'text-transform:none;letter-spacing:0;font-weight:400', text: '  ' + arch.length + ' with schedules, view only' })));
    const tb = h('tbody');
    for (const p of arch.sort((a, b) => (a.number || '').localeCompare(b.number || ''))) {
      const list = schedulesOf(p.id), last = lastUpdate(list);
      tb.append(h('tr', { tabindex: '0', onclick: () => go('#/scheduler/p/' + p.id) },
        h('td', { class: 'pn', text: p.number || '—' }), h('td', null, h('span', { class: 'pt', text: p.name })), h('td', { class: 'd-client muted', text: p.client || '' }),
        h('td', { text: list.length + (list.length === 1 ? ' schedule' : ' schedules') }), h('td', { class: 'd-upd when', text: last ? whenShort(last.updatedAt) : '' }), h('td', { class: 'd-act' })));
    }
    det.append(h('table', { class: 'plist' }, h('colgroup', null, h('col', { class: 'c-num' }), h('col'), h('col', { class: 'c-client' }), h('col', { class: 'c-sch' }), h('col', { class: 'c-upd' }), h('col', { class: 'c-act' })), tb));
    main.append(det);
  }
  main.append(h('p', { class: 'srcnote' }, h('span', { html: ICON.info }).firstChild, h('span', { text: PROJECT_SOURCE.note })));
  if (activeEl === 'projSearch') { const el = $('#projSearch'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}
/* first run: nothing at all yet */
function renderEmpty() {
  const box = $('#empty');
  box.textContent = '';
  if (S.noStore) { box.append(h('div', { class: 'empty-note' }, h('h2', { text: 'Schedules can’t load here' }), h('p', { text: 'The Toolbox server is not reachable.' }))); return; }
  if (!S.schedLoaded) { box.append(h('div', { class: 'empty-note' }, h('h2', { text: 'Loading schedules…' }))); return; }
  box.append(h('div', { class: 'empty-note' },
    h('h2', { text: 'No schedules yet' }),
    h('p', { text: 'Pick a template, set the start date and the length of each phase, and the whole schedule is calculated for you. Change one date later and everything after it follows.' }),
    !canCreateAnywhere() ? h('p', { class: 'muted', text: 'You have view-only access to your projects, so you can’t create schedules.' }) :
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', text: 'New schedule from a template', onclick: () => openNewSchedule(null) }))));
}

/* ----- a list of schedules (project page, unassigned) ----- */
function schedList(list, projectId) {
  const box = h('div', { class: 'slist' });
  const p = projectId ? S.projects.get(projectId) : null;
  const prim = projectId ? primaryOf(projectId) : null;
  const ro = !!p && !canWriteProject(p);
  const sorted = list.slice().sort((a, b) => (b.id === prim) - (a.id === prim) || (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const d of sorted) {
    const span = schedSpan(d);
    const isPrim = d.id === prim;
    const star = projectId ? h('button', { class: 'ib star' + (isPrim ? ' on' : ''), type: 'button', disabled: ro || isPrim, title: isPrim ? 'Primary schedule: the one the team should look at first' : 'Make this the primary schedule', 'aria-label': isPrim ? 'Primary schedule' : 'Make primary', html: icon('star', 16),
      onclick: async (e) => { e.stopPropagation(); if (await setPrimary(projectId, d.id)) { toast('“' + d.name + '” is now the primary schedule.'); routeRender(); } } }) : h('span', { html: icon('file-text', 16), class: 'muted' });
    box.append(h('div', { class: 'srow', 'data-id': d.id },
      star,
      h('div', { style: 'min-width:0' },
        h('div', { class: 'sn' }, h('a', { href: '#/scheduler/s/' + d.id, text: d.name || 'Untitled schedule', style: 'color:inherit', onclick: (e) => { e.preventDefault(); go('#/scheduler/s/' + d.id); } }), isPrim ? h('span', { class: 'badge-primary', text: 'Primary' }) : null),
        h('div', { class: 'sm', text: (span ? span.n + ' activities · ' + fmtMed(span.start) + ' – ' + fmtMed(span.end) : 'No activities yet') })),
      miniStrip(d, span),
      h('div', { class: 'sm sm2', text: d.updatedAt ? 'Saved ' + whenShort(d.updatedAt) + (d.updatedBy ? ' by ' + nameOf(d.updatedBy) : '') : '' }),
      h('div', { class: 'acts' },
        h('button', { class: 'btn sm', type: 'button', text: ro ? 'View' : 'Open', onclick: () => go('#/scheduler/s/' + d.id) }),
        S.db ? h('button', { class: 'btn sm quiet', type: 'button', title: 'Copy this schedule into a project you can edit', html: icon('copy', 14) + '<span class="lbl-hide">Duplicate</span>', onclick: () => openDuplicate(d.id) }) : null,
        !S.readonly && !projectId ? h('button', { class: 'btn sm quiet', type: 'button', text: 'Move…', title: 'Put this schedule in a project', onclick: () => openAssign(d.id) }) : null)));
  }
  return box;
}

/* ----- project page ----- */
function renderProject(id) {
  const head = $('#projHead'), body = $('#projBody');
  head.textContent = ''; body.textContent = '';
  const unassigned = id === 'unassigned';
  const p = unassigned ? null : S.projects.get(id);
  if (!unassigned && !p) {
    if (S.projLoaded) { head.append(h('div', { class: 'ptitle' }, h('h1', { text: 'Project not found' }))); body.append(h('p', { class: 'muted' }, 'It may have been removed. ', h('a', { href: '#/scheduler', text: 'Back to Scheduler' }))); }
    else body.append(h('p', { class: 'muted', text: 'Loading…' }));
    return;
  }
  if (p) noteRecent(p.id);
  const list = schedulesOf(unassigned ? null : id);
  const archived = p && p.status === 'archived';
  const ro = !unassigned && !canWriteProject(p);
  head.append(
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/scheduler', text: 'Scheduler', onclick: (e) => { e.preventDefault(); go('#/scheduler'); } }), h('span', { html: icon('chevron-right', 12) }).firstChild, h('span', { text: p ? (p.number || p.name) : 'Unassigned' })),
    h('div', { class: 'ptitle' },
      h('div', null, p && p.number ? h('div', { class: 'eyebrow', style: 'margin-bottom:6px', text: 'Project ' + p.number }) : null, h('h1', { text: p ? p.name : 'Unassigned schedules' })),
      h('span', { class: 'grow' }),
      p ? h('button', { class: 'btn quiet', type: 'button', html: icon('users', 16) + 'Access', title: 'Who can see and edit these schedules', onclick: () => openAccess(p) }) : null,
      !ro ? h('button', { class: 'btn primary', type: 'button', html: icon('file-plus-2', 16) + 'New schedule', onclick: () => openNewSchedule(p ? p.id : null) }) : null),
    p ? h('div', { class: 'proj-meta' },
      p.client ? h('span', null, 'Client ', h('strong', { text: p.client })) : null,
      h('span', null, 'Status ', h('strong', { text: archived ? 'Archived' : 'Active' })),
      h('span', { class: 'chip', title: PROJECT_SOURCE.note, text: PROJECT_SOURCE.label })) : null);
  if (archived) body.append(h('div', { class: 'banner', style: 'margin-bottom:14px' }, h('span', { class: 'bmsg', html: ICON.info }, h('span', { text: 'This project is archived, so its schedules are view-only. Duplicate one into an active project to reuse it.' }))));
  body.append(h('div', { class: 'section-h' }, h('h2', { text: 'Schedules' }), h('span', { class: 'muted', text: list.length ? list.length + (list.length === 1 ? ' schedule' : ' schedules') : '' })));
  if (!list.length) {
    body.append(h('div', { class: 'empty-note' }, h('h2', { text: unassigned ? 'Nothing unassigned' : 'No schedule exists for this project yet' }),
      unassigned ? h('p', { text: 'Every schedule is in a project.' }) : h('p', { text: 'Start from a template: choose the start date and phase lengths and the rest is calculated.' }),
      !ro && !unassigned ? h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', text: 'New schedule', onclick: () => openNewSchedule(p.id) })) : null));
  } else body.append(schedList(list, unassigned ? null : id));
}

/* ----- dialogs ----- */
function openAccess(p) {
  const body = h('div', { class: 'form' }, h('p', { text: 'Access comes from Vantagepoint: everyone assigned to ' + projLabel(p) + ' can view its schedules, and its PIC, PM and PA can edit them and manage access. A project admin can add people Vantagepoint doesn’t list, or remove someone it does.' }),
    h('p', { class: 'muted', text: 'Your access: ' + ({ admin: 'project admin', write: 'can edit', read: 'view only' }[p.access] || p.access) + '.' }));
  openDialog({ title: 'Who can see and edit', wide: true, body, actions: [{ label: 'Close', primary: true }] });
  P.Directory.team(p.id).then((team) => {
    const ul = h('div', { class: 'mgr-list' }, team.map((m) => h('div', { class: 'mgr-row' }, h('span', { class: 'avatar', text: initials(m.name) }), h('span', { text: m.name }), h('span', { class: 'grow' }), h('span', { class: 'chip' + (m.role === 'team' ? '' : ' blue'), text: { pic: 'PIC', pm: 'PM', pa: 'PA', team: 'Team' }[m.role] || m.role }))));
    body.append(h('h3', { text: 'Project team' }), ul);
    if (p.access !== 'admin') return;
    return P.Directory.accessOverrides(p.id).then((ov) => {
      body.append(h('h3', { text: 'Manual changes' }), ov.length ? h('div', { class: 'mgr-list' }, ov.map((o) => h('div', { class: 'mgr-row' }, h('span', { class: 'avatar', text: initials(o.name) }), h('span', { text: o.name }), h('span', { class: 'grow' }), h('span', { class: 'chip', text: { deny: 'Removed', grant_viewer: 'Can view', grant_editor: 'Can edit' }[o.kind] || o.kind })))) : h('p', { class: 'muted', text: 'None. Everyone’s access comes from the Vantagepoint team.' }));
    });
  }).catch(() => {});
}
function openAssign(schedId) {
  const d = S.schedules.get(schedId);
  if (!d) return;
  const sel = h('select', { class: 'txt', id: 'asProj' }, h('option', { value: '', text: 'Choose a project…' }),
    writableProjects().map((p) => h('option', { value: p.id, text: projLabel(p) })));
  sel.value = d.projectId || '';
  const doIt = async (pid) => {
    if (await assignSchedule(schedId, pid)) {
      const p = S.projects.get(pid);
      if (S.cur === schedId && p && S.work) edit(() => { S.work.info = normInfo(Object.assign({}, S.work.info, { number: p.number, client: p.client })); });
      if (p && schedulesOf(pid).length === 1) setPrimary(pid, schedId);
      toast('Moved “' + d.name + '” to ' + projLabel(p) + '.');
      routeRender();
    }
  };
  openDialog({ title: 'Put “' + (d.name || 'schedule') + '” in a project', body: h('div', { class: 'form' }, h('div', { class: 'field' }, h('label', { for: 'asProj', text: 'Project' }), sel),
    h('p', { class: 'muted', text: 'Only the project link changes. The schedule’s dates and history stay as they are.' })),
  actions: [{ label: 'Cancel' }, { label: 'Move', primary: true, run: () => {
    if (!sel.value) { sel.focus(); return false; }
    doIt(sel.value);
  } }] });
}

/* new schedule: choose a template, the start date and the phase lengths; see the result before creating it */
function openNewSchedule(projectId, key) {
  const last = pref('lastTpl') || '';
  let tpl = tplByKey(key) || tplByKey(last.includes(':') ? last : 'company:' + last) || companyTemplates()[0] || TEMPLATES[0];
  let startDay = S.cal.next(todayDay() + ((8 - dowOf(todayDay())) % 7 || 7)); // next Monday
  let weeks = {};
  let nameTouched = false;
  const listBox = h('div', { class: 'wiz-list', role: 'listbox', 'aria-label': 'Templates' });
  const cfg = h('div', { class: 'wiz-cfg' });
  const projSel = h('select', { class: 'txt', id: 'nsProj', 'aria-label': 'Project' }, h('option', { value: '', text: 'Choose a project…' }),
    writableProjects().map((p) => h('option', { value: p.id, text: projLabel(p) })));
  projSel.value = projectId && canWriteProject(S.projects.get(projectId)) ? projectId : '';
  const nameIn = h('input', { type: 'text', class: 'txt', id: 'newName', autocomplete: 'off', placeholder: 'Schedule name' });
  nameIn.addEventListener('input', () => { nameTouched = true; });
  const startIn = h('input', { type: 'text', class: 'txt mono', id: 'nsStart', autocomplete: 'off', value: fmtMed(startDay), 'aria-label': 'Start date' });
  startIn.addEventListener('change', () => { const n = parseTyped(startIn.value, startDay, todayDay()); if (isNaN(n)) { toast(BAD_DATE); } else { startDay = S.cal.next(n); if (startDay !== n) toast('That’s a non-working day, so the schedule starts ' + fmtShort(startDay) + '.'); } startIn.value = fmtMed(startDay); paintCfg(); });
  const build = () => instantiateTemplate(tpl, { start: startDay, weeks, newId, schedule, cal: S.cal });
  const paintList = () => {
    listBox.textContent = '';
    const same = (a, b) => a && b && a.id === b.id && (a.scope === 'mine') === (b.scope === 'mine');
    const item = (t) => {
      const n = t.tasks.length;
      listBox.append(h('button', { type: 'button', class: 'tpl', role: 'option', 'aria-pressed': String(same(t, tpl)), 'aria-selected': String(same(t, tpl)), 'data-tpl': t.scope === 'mine' ? 'mine:' + t.id : t.id, onclick: () => { tpl = t; weeks = {}; paintList(); paintCfg(); } },
        h('strong', { text: t.name }), t.description ? h('small', { text: t.description }) : null, h('span', { class: 'tmeta', text: [t.category, n ? n + ' activities' : ''].filter(Boolean).join(' · ') })));
    };
    item(tplById('blank'));
    listBox.append(h('div', { class: 'wiz-grp', text: 'Company templates' }));
    companyTemplates().forEach(item);
    const mine = myTemplates();
    if (mine.length) { listBox.append(h('div', { class: 'wiz-grp', text: 'My templates' })); mine.forEach(item); }
    listBox.append(h('a', { class: 'wiz-manage', href: '#/scheduler/templates', text: 'Manage templates', onclick: (e) => { e.preventDefault(); $('#modalRoot').textContent = ''; go('#/scheduler/templates'); } }));
  };
  const paintCfg = () => {
    cfg.textContent = '';
    if (!nameTouched) nameIn.value = tpl.id === 'blank' ? '' : tpl.name;
    cfg.append(h('div', { class: 'wiz-row' }, h('div', { class: 'field' }, h('label', { for: 'newName', text: 'Schedule name' }), nameIn), h('div', { class: 'field' }, h('label', { for: 'nsStart', text: 'Start date' }), startIn)),
      h('div', { class: 'field' }, h('label', { for: 'nsProj', text: 'Project' }), projSel));
    const tasks = build();
    if (!tasks.length) { cfg.append(h('p', { class: 'muted', text: 'An empty schedule. You’ll add activities and milestones yourself; link them to have dates follow each other.' })); return; }
    const res = schedule(tasks, S.cal);
    const rs = [...res.values()];
    const lo = Math.min(...rs.map((r) => r.start)), hi = Math.max(...rs.map((r) => (r.kind === 'milestone' ? r.start : r.finish)));
    const phases = tplPhases(tpl);
    const box = h('div', { class: 'phases' });
    for (const ph of phases) {
      const tk = tasks[tpl.tasks.findIndex((x) => x.k === ph.k)], r = res.get(tk.id);
      const wk = weeks[ph.k] != null ? weeks[ph.k] : ph.weeks;
      const inp = h('input', { type: 'text', inputmode: 'numeric', class: 'txt', value: String(wk), 'aria-label': ph.name + ' in weeks', 'data-ph': ph.k, title: 'Whole weeks. A phase runs Monday to Friday; the next one starts the Monday after.' });
      inp.addEventListener('change', () => { const v = Math.round(parseFloat(inp.value)); if (v >= 1 && v < 260) { weeks[ph.k] = v; } paintCfg(); const el = cfg.querySelector('[data-ph="' + ph.k + '"]'); if (el) el.focus(); });
      const sw = h('span', { class: 'sw' });
      sw.style.background = tk.exColor ? colorCss(tk.exColor) : 'var(--line-strong)';
      box.append(h('div', { class: 'phase' }, sw, h('span', { text: ph.name }), h('span', { class: 'phwk' }, inp, h('span', { class: 'muted', text: 'wk' })), h('span', { class: 'dt', text: fmtShortNoDow(r.start) + ' – ' + fmtShortNoDow(r.finish) })));
    }
    cfg.append(h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Phase lengths' }), h('p', { class: 'hint', text: 'Typical starting points, not firm standards. Change any of them and everything after it moves. Phases run Monday to Friday.' }), box));
    cfg.append(h('div', { class: 'wiz-sum' },
      h('div', null, h('strong', { text: fmtMed(hi) }), h('span', { class: 'muted', text: 'Last date' })),
      h('div', null, h('strong', { text: Math.round((hi - lo + 1) / 7) + ' weeks' }), h('span', { class: 'muted', text: 'Overall' })),
      h('div', null, h('strong', { text: String(tasks.length) }), h('span', { class: 'muted', text: tasks.filter((t) => t.kind === 'milestone').length + ' milestones' }))));
  };
  paintList(); paintCfg();
  openDialog({ title: 'New schedule', wide: 'x', body: h('div', { class: 'wiz' }, listBox, cfg), actions: [{ label: 'Cancel' }, { label: 'Create schedule', primary: true, run: () => {
    const n = nameIn.value.trim() || (tpl.id === 'blank' ? '' : tpl.name);
    if (!n) { nameIn.focus(); return false; }
    if (!projSel.value) { projSel.focus(); toast('Choose a project for the new schedule.'); return false; }
    pref('lastTpl', tpl.id === 'blank' ? 'blank' : (tpl.scope === 'mine' ? 'mine:' : 'company:') + tpl.id);
    const tasks = build();
    createSchedule(n, { projectId: projSel.value || null, tasks, execOn: !!tpl.execOn, scale: tpl.scale || 'weeks' });
  } }] });
}

/* duplicate: into any project you can edit, keeping the dates or starting on a new date */
function openDuplicate(schedId) {
  const src = schedId === S.cur && S.work ? Object.assign({}, S.schedules.get(schedId) || {}, { id: schedId, name: S.work.name, tasks: S.work.tasks, holidays: S.work.holidays, offDays: S.work.offDays }) : S.schedules.get(schedId);
  if (!src) return;
  const span = schedSpan(src);
  const projSel = h('select', { class: 'txt', id: 'dpProj', 'aria-label': 'Copy into' }, h('option', { value: '', text: 'Choose a project…' }),
    writableProjects().map((p) => h('option', { value: p.id, text: projLabel(p) })));
  projSel.value = canWriteProject(S.projects.get(src.projectId)) ? src.projectId : '';
  const nameIn = h('input', { type: 'text', class: 'txt', id: 'dpName', value: 'Copy of ' + (src.name || 'schedule'), autocomplete: 'off' });
  const keep = h('input', { type: 'radio', name: 'dpDates', value: 'keep', id: 'dpKeep', checked: 'checked' });
  const shift = h('input', { type: 'radio', name: 'dpDates', value: 'shift', id: 'dpShift' });
  let startDay = span ? span.start : todayDay();
  const startIn = h('input', { type: 'text', class: 'txt mono sm', id: 'dpStart', value: fmtMed(startDay), style: 'width:150px', 'aria-label': 'New start date' });
  const note = h('p', { class: 'muted' });
  const paint = () => {
    const d = span ? startDay - span.start : 0;
    startIn.disabled = keep.checked;
    const same = (projSel.value || null) === (src.projectId || null);
    note.textContent = (keep.checked || !d ? 'Dates stay exactly as they are.' : 'Every date moves ' + Math.abs(d) + ' days ' + (d > 0 ? 'later' : 'earlier') + ', so links, locks and holds keep their meaning.') +
      ' Version history and baseline data are not copied.' + (same ? '' : ' Commitments stay with the original project.');
  };
  startIn.addEventListener('change', () => { const n = parseTyped(startIn.value, startDay, todayDay()); if (!isNaN(n)) startDay = n; startIn.value = fmtMed(startDay); paint(); });
  for (const el of [keep, shift, projSel]) el.addEventListener('change', paint);
  paint();
  openDialog({ title: 'Duplicate “' + (src.name || 'schedule') + '”', wide: true, body: h('div', { class: 'form' },
    h('div', { class: 'field' }, h('label', { for: 'dpProj', text: 'Copy into' }), projSel, h('span', { class: 'hint', text: 'Only projects you can edit are listed.' })),
    h('div', { class: 'field' }, h('label', { for: 'dpName', text: 'Name' }), nameIn),
    h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Dates' }),
      h('label', { class: 'chk', for: 'dpKeep' }, keep, ' Keep the dates exactly as they are'),
      h('label', { class: 'chk', for: 'dpShift' }, shift, ' Start on a new date: ', startIn)),
    note),
  actions: [{ label: 'Cancel' }, { label: 'Duplicate', primary: true, run: () => {
    const n = nameIn.value.trim(); if (!n) { nameIn.focus(); return false; }
    if (!projSel.value) { projSel.focus(); toast('Choose a project to copy into.'); return false; }
    const pid = projSel.value, p = S.projects.get(pid);
    const delta = shift.checked && span ? startDay - span.start : 0;
    const doc = duplicateDoc(Object.assign({}, S.schedules.get(schedId) || {}, src, { tasks: src.tasks }), { name: n, projectId: pid, delta, info: p ? { number: p.number, client: p.client } : null });
    createSchedule(n, { projectId: pid, tasks: normalizeTasks(doc.tasks), execOn: !!doc.execOn, scale: doc.scale, info: doc.info, raw: doc });
  } }] });
}

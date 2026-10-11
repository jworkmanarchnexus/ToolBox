/* ===== Templates: the library page, the dialogs that make templates, and the editor's template mode =====
   A template opens in the same editor as a schedule (activities, milestones, links, audiences,
   executive flags), laid out from a sample start date. Saving writes the template, not a schedule. */
S.tpl = null; // { scope, id, starter } while a template is open in the editor
S.tplTab = null;

const tplRoute = (t) => '#/scheduler/t/' + (t.scope === 'mine' ? 'mine' : 'company') + '/' + encodeURIComponent(t.id);
const sampleStart = () => { const c = S.cal || makeCalendar([]); const td = todayDay(); return c.next(td + ((8 - dowOf(td)) % 7 || 7)); };
const tplWeeks = (t) => { try { const sp = tplSpan(t, schedule, makeCalendar([])); return sp ? Math.max(1, Math.round(sp.days / 7)) : 0; } catch (e) { return 0; } };
const tplCounts = (t) => { const n = t.tasks.length, ms = t.tasks.filter((x) => x.ms).length, ph = t.tasks.filter((x) => x.phase && !x.ms).length; return { n, ms, ph }; };

/* ----- the library page ----- */
function renderTemplates() {
  const head = $('#tplHead'), body = $('#tplBody');
  if (!head || !body) return;
  const mgr = isTplManager();
  head.textContent = '';
  head.append(h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('span', { text: 'Toolbox' }), h('span', { html: icon('chevron-right', 12) }).firstChild,
    h('a', { href: '#/scheduler', text: 'Scheduler', onclick: (e) => { e.preventDefault(); go('#/scheduler'); } }), h('span', { html: icon('chevron-right', 12) }).firstChild, h('span', { text: 'Templates' })));
  head.append(h('div', { class: 'ptitle' }, h('h1', { class: 'brand', text: 'Templates' }),
    h('span', { class: 'sub', text: 'Starting points for new schedules.' }), h('span', { class: 'grow' }),
    S.isOwner ? h('button', { class: 'btn', type: 'button', id: 'btnTplMgrs', html: icon('users', 16) + 'Template managers', onclick: openTplManagers }) : null,
    h('button', { class: 'btn primary', type: 'button', id: 'btnTplNew', html: icon('file-plus-2', 16) + 'New template', disabled: canMine() ? null : '', title: canMine() ? 'Make a template of your own' : 'Sign in to make templates', onclick: () => openNewTemplate() })));
  body.textContent = '';
  if (!S.db) { body.append(h('p', { class: 'muted', text: S.noStore ? 'This page needs to be opened from Claude to load templates.' : 'Loading…' })); return; }

  const comp = companyTemplates(), mine = myTemplates();
  const tab = S.tplTab || (mine.length && !mgr ? 'company' : 'company');
  const tabs = h('div', { class: 'seg tpl-tabs', role: 'tablist', 'aria-label': 'Template library' },
    h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === 'company'), 'aria-pressed': String(tab === 'company'), 'data-tab': 'company', onclick: () => { S.tplTab = 'company'; renderTemplates(); } }, 'Company templates ', h('span', { class: 'cnt ok', text: String(comp.length) })),
    h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === 'mine'), 'aria-pressed': String(tab === 'mine'), 'data-tab': 'mine', onclick: () => { S.tplTab = 'mine'; renderTemplates(); } }, 'My templates ', h('span', { class: 'cnt ok', text: String(mine.length) })));
  body.append(h('div', { class: 'tpl-tools' }, tabs, h('span', { class: 'grow' }),
    h('span', { class: 'muted tpl-role', text: tab === 'company' ? (mgr ? 'You are a template manager: you can edit, add and remove company templates.' : 'Maintained by the template managers. Duplicate one to My templates to make your own version.') : 'Only you see these. Save any schedule as a template from its ⋯ menu.' })));

  if (tab === 'company') {
    const cats = new Map();
    for (const t of comp) { const c = t.category || 'Other'; if (!cats.has(c)) cats.set(c, []); cats.get(c).push(t); }
    for (const [c, list] of cats) { body.append(h('h2', { class: 'tpl-cat', text: c })); body.append(h('div', { class: 'tcards' }, list.map((t) => tplCard(t, false)))); }
    const hid = hiddenStarters();
    if (mgr && hid.length) {
      body.append(h('details', { class: 'archived tpl-hidden' }, h('summary', null, 'Removed starter templates (' + hid.length + ')'),
        h('ul', null, hid.map((t) => h('li', null, h('span', { text: t.name + ' ' }), h('button', { class: 'btn sm quiet', type: 'button', text: 'Restore', onclick: () => restoreStarter(t.id) }))))));
    }
  } else {
    if (!S.meId) body.append(h('p', { class: 'muted', text: 'Sign in to keep templates of your own.' }));
    else if (!mine.length) {
      body.append(h('div', { class: 'empty-note' }, h('p', { text: 'No templates of your own yet.' }),
        h('p', { class: 'muted', text: 'Start one from scratch, from a company template, or from a schedule. You can also open any schedule and choose Save as template from its ⋯ menu.' }),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', text: 'New template', onclick: () => openNewTemplate() }))));
    } else body.append(h('div', { class: 'tcards' }, mine.map((t) => tplCard(t, true))));
  }
  body.append(h('p', { class: 'srcnote' }, h('span', { html: ICON.info }).firstChild,
    h('span', { text: 'A schedule made from a template is a separate copy: editing or removing a template later never changes schedules already made from it.' })));
}
function tplCard(t, showCat) {
  const { n, ms, ph } = tplCounts(t), wk = tplWeeks(t);
  const editable = canEditTpl(t);
  let strip = h('div', { class: 'mini', 'aria-hidden': 'true' });
  try { const sp = tplSpan(t, schedule, makeCalendar([])); if (sp) strip = miniStrip({}, { start: sp.lo, end: sp.hi, tasks: sp.tasks, res: sp.res }); } catch (e) { /* no strip */ }
  const meta = [n + (n === 1 ? ' activity' : ' activities'), ms ? ms + (ms === 1 ? ' milestone' : ' milestones') : null, wk ? 'about ' + wk + ' weeks' : null].filter(Boolean).join(' · ');
  const who = t.starter ? 'Starter template' : t.updatedAt ? 'Edited ' + whenShort(t.updatedAt) + (t.updatedBy ? ' by ' + nameOf(t.updatedBy) : '') : '';
  const acts = h('div', { class: 'tc-acts' },
    h('button', { class: 'btn sm primary', type: 'button', text: 'Use', title: 'Make a new schedule from this template', onclick: () => openNewSchedule(null, tplKey(t)) }),
    h('button', { class: 'btn sm', type: 'button', text: editable ? 'Edit' : 'View', onclick: () => go(tplRoute(t)) }));
  const more = [];
  if (canMine()) more.push(['copy', 'Duplicate', 'Duplicate to My templates', () => openDupTemplate(t)]);
  if (t.scope === 'mine' && isTplManager()) more.push(['arrow-right', 'Move to Company', 'Move to Company templates', () => confirmMoveToCompany(t)]);
  if (editable) more.push(['trash-2', t.scope === 'mine' ? 'Delete' : 'Remove', t.scope === 'mine' ? 'Delete this template' : 'Remove from company templates', () => confirmDeleteTemplate(t)]);
  for (const [ic, label, title, run] of more) acts.append(h('button', { class: 'btn sm quiet icon-l', type: 'button', title, 'aria-label': title, html: icon(ic, 14) + '<span>' + label + '</span>', onclick: run }));
  return h('article', { class: 'tcard', 'data-tpl': tplKey(t) },
    h('div', { class: 'tc-top' }, h('h3', { text: t.name }), showCat && t.category ? h('span', { class: 'chip', text: t.category }) : null),
    t.description ? h('p', { class: 'tc-desc', text: t.description }) : null,
    strip,
    h('p', { class: 'tc-meta' }, h('span', { text: meta }), ph ? h('span', { class: 'muted', text: ' · asks for ' + ph + (ph === 1 ? ' phase' : ' phases') }) : null),
    who ? h('p', { class: 'tc-who muted', text: who }) : null,
    acts);
}

/* ----- dialogs ----- */
const tplFields = (init) => {
  const name = h('input', { type: 'text', class: 'txt', id: 'tplName', maxlength: String(TPL_NAME_MAX), autocomplete: 'off', value: init.name || '', placeholder: 'e.g. Clinic tenant improvement' });
  const cat = h('input', { type: 'text', class: 'txt', id: 'tplCat', maxlength: String(TPL_CAT_MAX), autocomplete: 'off', value: init.category || '', placeholder: 'e.g. Healthcare', list: 'tplCats' });
  const cats = h('datalist', { id: 'tplCats' }, [...new Set(companyTemplates().concat(myTemplates()).map((t) => t.category).filter(Boolean))].map((c) => h('option', { value: c })));
  const desc = h('textarea', { class: 'txt', id: 'tplDesc', rows: '3', maxlength: String(TPL_DESC_MAX), placeholder: 'When to use it, what it assumes' });
  desc.value = init.description || '';
  const el = h('div', { class: 'form' },
    h('div', { class: 'field' }, h('label', { for: 'tplName', text: 'Name' }), name),
    h('div', { class: 'field' }, h('label', { for: 'tplCat', text: 'Category' }), cat, cats),
    h('div', { class: 'field' }, h('label', { for: 'tplDesc', text: 'Description' }), desc));
  return { el, name, cat, desc, read: () => ({ name: tplClean(name.value, TPL_NAME_MAX), category: tplClean(cat.value, TPL_CAT_MAX), description: tplClean(desc.value, TPL_DESC_MAX) }) };
};
/* a new template: blank, from a template, or from a schedule. Always lands in My templates. */
function openNewTemplate(preset) {
  if (!canMine()) { toast('Sign in to make templates.'); return; }
  let from = (preset && preset.from) || 'blank';
  const f = tplFields({});
  const tSel = h('select', { class: 'txt', id: 'ntTpl', 'aria-label': 'Template to start from' },
    h('optgroup', { label: 'Company templates' }, companyTemplates().map((t) => h('option', { value: tplKey(t), text: t.name }))),
    myTemplates().length ? h('optgroup', { label: 'My templates' }, myTemplates().map((t) => h('option', { value: tplKey(t), text: t.name }))) : null);
  if (preset && preset.tplKey) tSel.value = preset.tplKey;
  const scheds = [...S.schedules.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const sSel = h('select', { class: 'txt', id: 'ntSched', 'aria-label': 'Schedule to start from' }, scheds.map((d) => { const p = projectOf(d); return h('option', { value: d.id, text: (d.name || 'Untitled schedule') + (p ? ' (' + projLabel(p) + ')' : '') }); }));
  const radio = (v, label, extra) => {
    const r = h('input', { type: 'radio', name: 'ntFrom', value: v, id: 'ntFrom_' + v });
    r.checked = from === v;
    r.addEventListener('change', () => { from = v; paint(); });
    return h('div', { class: 'nt-opt' }, h('label', { class: 'chk', for: 'ntFrom_' + v }, r, ' ' + label), extra);
  };
  const box = h('div');
  const paint = () => {
    tSel.disabled = from !== 'tpl'; sSel.disabled = from !== 'sched';
    if (from === 'tpl' && !f.name.value) { const t = tplByKey(tSel.value); if (t) f.name.value = 'Copy of ' + t.name; }
  };
  tSel.addEventListener('change', () => { const t = tplByKey(tSel.value); if (t && (!f.name.value || /^Copy of /.test(f.name.value))) f.name.value = 'Copy of ' + t.name; if (t && !f.cat.value) f.cat.value = t.category || ''; });
  box.append(h('fieldset', { class: 'nt-from' }, h('legend', { text: 'Start from' }),
    radio('blank', 'A blank template'),
    radio('tpl', 'An existing template', tSel),
    scheds.length ? radio('sched', 'A schedule', sSel) : null,
    h('p', { class: 'muted xo-note', text: 'From a schedule: activities keep their lengths, links, audiences and executive flags. Dates, locks, holds and commitments are not copied.' })), f.el);
  paint();
  openDialog({ title: 'New template', wide: true, body: box, actions: [{ label: 'Cancel' }, { label: 'Create and edit', primary: true, run: () => {
    const v = f.read();
    let base = { tasks: [], scale: 'weeks', execOn: true, basedOn: null };
    if (from === 'tpl') { const t = tplByKey(tSel.value); if (!t) return false; base = { tasks: t.tasks, scale: t.scale, execOn: !!t.execOn, basedOn: t.name, category: t.category, description: t.description }; }
    if (from === 'sched') { const d = S.schedules.get(sSel.value); if (!d) return false; base = templateFromDoc(d); }
    if (!v.name) { f.name.focus(); return false; }
    createMyTemplate(Object.assign({}, base, { name: v.name, category: v.category || base.category || '', description: v.description || base.description || '' })).then((id) => {
      if (!id) return;
      S.tplTab = 'mine';
      toast('Created “' + v.name + '” in My templates.');
      go('#/scheduler/t/mine/' + id);
    });
  } }] });
  f.name.focus();
}
/* a stored schedule document as template content */
function templateFromDoc(d) {
  const cal = makeCalendar(validHol(d.holidays || S.holidays), d.offDays);
  const tasks = normalizeTasks(d.tasks || []);
  const res = schedule(tasks, cal);
  return { tasks: scheduleToTemplate(tasks, res), scale: ['days', 'weeks', 'months', 'quarters'].includes(d.scale) ? d.scale : 'weeks', execOn: d.execOn === true, basedOn: d.name || null };
}
/* the open schedule as a template: from the ⋯ menu */
function openSaveAsTemplate() {
  if (!S.work || S.tpl) return;
  if (!canMine()) { toast('Sign in to save templates.'); return; }
  const f = tplFields({ name: S.work.name });
  const n = S.work.tasks.length;
  const body = h('div', null,
    h('p', { class: 'muted', text: 'Saves a copy of this schedule’s ' + n + (n === 1 ? ' activity' : ' activities') + ' to My templates. Lengths, links, audiences and executive flags are kept. Dates become a starting point; locks, holds and commitments are not copied. This schedule doesn’t change.' }),
    f.el);
  openDialog({ title: 'Save as template', wide: true, body, actions: [{ label: 'Cancel' }, { label: 'Save to My templates', primary: true, run: () => {
    const v = f.read();
    if (!v.name) { f.name.focus(); return false; }
    const t = { tasks: scheduleToTemplate(S.work.tasks, S.res), scale: S.work.scale, execOn: !!S.work.execOn, basedOn: S.work.name, name: v.name, category: v.category, description: v.description };
    createMyTemplate(t).then((id) => { if (id) toast('Saved “' + v.name + '” to My templates.', { label: 'Open it', run: () => go('#/scheduler/t/mine/' + id) }); });
  } }] });
  f.name.focus(); f.name.select();
}
function openDupTemplate(t) {
  if (!canMine()) return;
  const f = tplFields({ name: 'Copy of ' + t.name, category: t.category, description: t.description });
  openDialog({ title: 'Duplicate to My templates', wide: true, body: h('div', null, h('p', { class: 'muted', text: 'Makes your own copy to change as you like. “' + t.name + '” stays as it is.' }), f.el),
    actions: [{ label: 'Cancel' }, { label: 'Duplicate', primary: true, run: () => {
      const v = f.read();
      if (!v.name) { f.name.focus(); return false; }
      createMyTemplate({ tasks: t.tasks, scale: t.scale, execOn: !!t.execOn, basedOn: t.name, name: v.name, category: v.category, description: v.description }).then((id) => {
        if (!id) return;
        S.tplTab = 'mine';
        toast('Duplicated to My templates.', { label: 'Edit it', run: () => go('#/scheduler/t/mine/' + id) });
        if (S.route.page === 'templates') renderTemplates();
      });
    } }] });
  f.name.focus(); f.name.select();
}
function confirmMoveToCompany(t, after) {
  openDialog({ title: 'Move to Company templates?', body: h('div', null,
    h('p', { text: '“' + t.name + '” leaves My templates and becomes a company template that everyone can use when they make a schedule.' }),
    h('p', { class: 'muted', text: 'After the move, any template manager can edit or remove it. To keep a personal version, duplicate it first.' })),
  actions: [{ label: 'Cancel' }, { label: 'Move to Company templates', primary: true, run: () => {
    moveToCompany(t).then((id) => {
      if (!id) return;
      toast('“' + t.name + '” is now a company template.');
      S.tplTab = 'company';
      if (after) after(id); else if (S.route.page === 'templates') renderTemplates();
    });
  } }] });
}
function confirmDeleteTemplate(t, after) {
  const company = t.scope !== 'mine';
  openDialog({ title: company ? 'Remove from Company templates?' : 'Delete this template?', body: h('div', null,
    h('p', { text: company ? '“' + t.name + '” will no longer be offered to anyone when they make a schedule.' : '“' + t.name + '” will be deleted from My templates.' }),
    h('p', { class: 'muted', text: 'Schedules already made from it are not affected.' + (company && STARTER_IDS.has(t.id) ? ' A starter template can be restored later from the bottom of Company templates.' : '') })),
  actions: [{ label: 'Cancel' }, { label: company ? 'Remove' : 'Delete', danger: true, run: () => {
    deleteTemplate(t).then((ok) => { if (!ok) return; toast(company ? 'Removed “' + t.name + '”.' : 'Deleted “' + t.name + '”.'); if (after) after(); else if (S.route.page === 'templates') renderTemplates(); });
  } }] });
}
/* the page owner picks who manages company templates */
function openTplManagers() {
  if (!S.isOwner) return;
  let ids = S.tplManagers.slice();
  const list = h('div', { class: 'mgr-list' });
  const results = h('div', { class: 'mgr-results' });
  const q = h('input', { type: 'search', class: 'txt', id: 'mgrSearch', placeholder: 'Search people by name', autocomplete: 'off', 'aria-label': 'Search people' });
  const paintList = () => {
    list.textContent = '';
    list.append(h('div', { class: 'mgr-row' }, h('span', { class: 'avatar', text: initials(nameOf(S.meId)) }), h('span', { text: (S.names[S.meId] || 'You') + ' (page owner, always a manager)' })));
    for (const id of ids) {
      list.append(h('div', { class: 'mgr-row' }, h('span', { class: 'avatar', text: initials(nameOf(id)) }), h('span', { text: S.names[id] || 'Someone' }), h('span', { class: 'grow' }),
        h('button', { class: 'btn sm quiet', type: 'button', text: 'Remove', onclick: () => { ids = ids.filter((x) => x !== id); paintList(); } })));
    }
  };
  let tok = 0;
  const search = async () => {
    const my = ++tok;
    results.textContent = '';
    if (!S.user || !S.user.search) { results.append(h('p', { class: 'muted', text: 'Searching for people isn’t available here.' })); return; }
    let hits = [];
    try { hits = await S.user.search(q.value.trim()); } catch (e) { hits = []; }
    if (my !== tok) return;
    hits = hits.filter((p) => p.id && p.id !== S.meId && !ids.includes(p.id)).slice(0, 8);
    if (!hits.length) { results.append(h('p', { class: 'muted', text: q.value.trim() ? 'No one found.' : 'Type a name to search.' })); return; }
    for (const p of hits) {
      S.names[p.id] = p.name || S.names[p.id] || '';
      results.append(h('button', { class: 'mgr-hit', type: 'button', onclick: () => { ids.push(p.id); q.value = ''; paintList(); search(); } },
        h('span', { class: 'avatar', text: initials(p.name || '?') }), h('span', { text: p.name || 'Someone' }), h('span', { class: 'grow' }), h('span', { class: 'muted', text: 'Add' })));
    }
  };
  q.addEventListener('input', search);
  q.addEventListener('focus', search);
  paintList();
  openDialog({ title: 'Template managers', wide: true, body: h('div', { class: 'form' },
    h('p', { class: 'muted', text: 'Template managers edit, add and remove company templates, and move their own templates into the company list. Everyone else uses company templates and keeps their own in My templates.' }),
    list, h('div', { class: 'field' }, h('label', { for: 'mgrSearch', text: 'Add a manager' }), q), results,
    h('p', { class: 'muted xo-note', text: 'In Toolbox this becomes a firm-wide role managed with the other roles.' })),
  actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, run: () => { setTplManagers(ids).then((ok) => { if (ok) { S.tplManagers = ids; toast('Template managers updated.'); renderTemplates(); } }); } }] });
}

/* ----- the editor in template mode ----- */
function loadTemplateIntoEditor(t) {
  S.tpl = { scope: t.scope === 'mine' ? 'mine' : 'company', id: t.id, starter: !!t.starter };
  S.cur = 'tpl:' + S.tpl.scope + ':' + t.id;
  S.cal = makeCalendar(validHol(S.holidays), [0, 6]);
  const tasks = normalizeTasks(instantiateTemplate(t, { start: sampleStart(), keepIds: true }));
  S.work = {
    offDays: [0, 6], info: normInfo(null), exportDefaults: {}, name: t.name, tasks, scale: t.scale || 'weeks', colors: normColors(null), execOn: !!t.execOn, execColor: 'nexus', commitWarn: 0,
    customColors: [], baselineOn: false, baseline: null, holidays: validHol(S.holidays), hset: true, holShared: false,
    tplMeta: { category: t.category || '', description: t.description || '', basedOn: t.basedOn || null, createdBy: t.createdBy || null, createdAt: t.createdAt || 0 },
    tplPhases: t.tasks.filter((x) => x.phase && !x.ms).map((x) => x.k),
  };
  S.base = { sid: null, by: t.updatedBy || null, at: t.updatedAt || 0 };
  S.dirty = false; S.remote = null; S.undo = []; S.sel = null; S.multi = new Set(); S.impact = null; S.zoomF = 1;
  S.meta = { projectId: null };
  S.readonly = !canEditTpl(t);
  recalc();
  S.baseWork = JSON.parse(JSON.stringify(S.work));
  refreshNames([t.updatedBy]);
}
function leaveTemplate() {
  if (!S.tpl) return;
  S.tpl = null; S.cur = null; S.work = null; S.res = new Map(); S.dirty = false; S.undo = []; S.impact = null;
  S.readonly = !!S.platformRO;
  document.body.classList.remove('tpl-mode');
  closeInspector();
  showImpact();
  updatePresence();
}
function currentTemplate() {
  if (!S.tpl) return null;
  return S.tpl.scope === 'mine' ? S.tplMine.get(S.tpl.id) || null : companyTemplates().find((t) => t.id === S.tpl.id) || null;
}
/* what the editor holds, as a template */
function workAsTemplate() {
  const m = S.work.tplMeta || {};
  const phases = new Set((S.work.tplPhases || []).filter((id) => S.work.tasks.some((t) => t.id === id && t.kind !== 'milestone')));
  return { id: S.tpl.id, scope: S.tpl.scope, name: tplClean(S.work.name, TPL_NAME_MAX) || 'Untitled template', category: m.category || '', description: m.description || '', scale: S.work.scale, execOn: !!S.work.execOn, basedOn: m.basedOn || null, createdBy: m.createdBy, createdAt: m.createdAt, tasks: scheduleToTemplate(S.work.tasks, S.res, phases) };
}
async function saveTemplateEdit() {
  if (!S.dirty || S.saving || S.readonly || !S.tpl) return;
  S.saving = true; renderSheet(); renderToolbar();
  const t = workAsTemplate();
  const ok = await writeTemplate(t);
  S.saving = false;
  if (ok) {
    S.dirty = false; S.tpl.starter = false;
    S.base = { sid: null, by: S.meId || null, at: Date.now() };
    S.baseWork = JSON.parse(JSON.stringify(S.work));
    toast(t.scope === 'mine' ? 'Template saved.' : 'Company template saved. New schedules use it from now on.');
  }
  updatePresence();
  renderAll();
}
const tplPhaseOn = (id) => !!(S.work && (S.work.tplPhases || []).includes(id));
function setTplPhase(id, on) {
  edit(() => {
    const s = new Set(S.work.tplPhases || []);
    if (on) s.add(id); else s.delete(id);
    S.work.tplPhases = [...s];
  });
}
function openTemplateSettings() {
  if (!S.work || !S.tpl) return;
  const ro = S.readonly, m = S.work.tplMeta || {};
  const f = tplFields({ name: S.work.name, category: m.category, description: m.description });
  [f.name, f.cat, f.desc].forEach((el) => { el.disabled = ro; });
  const ex = h('input', { type: 'checkbox', id: 'tsExec', disabled: ro });
  ex.checked = !!S.work.execOn;
  const phases = new Set(S.work.tplPhases || []);
  const acts = S.work.tasks.filter((t) => t.kind !== 'milestone');
  const plist = h('div', { class: 'ts-phases' }, acts.map((t) => {
    const c = h('input', { type: 'checkbox', disabled: ro, 'data-ph': t.id });
    c.checked = phases.has(t.id);
    c.addEventListener('change', () => { if (c.checked) phases.add(t.id); else phases.delete(t.id); });
    return h('label', { class: 'chk' }, c, ' ' + (t.name || 'Untitled') + ' ', h('span', { class: 'muted', text: '(' + Math.round(t.duration / 7 * 10) / 10 + ' wk)' }));
  }));
  const body = h('div', { class: 'ps' },
    h('fieldset', null, h('legend', { text: 'Template details' }), f.el),
    h('fieldset', null, h('legend', { text: 'New-schedule wizard' }),
      h('p', { class: 'ps-note muted', text: 'Checked activities are listed with their length in weeks when someone makes a schedule from this template, so they can adjust them before it’s created. Everything linked after moves with them.' }),
      acts.length ? plist : h('p', { class: 'muted', text: 'Add activities first.' })),
    h('fieldset', null, h('legend', { text: 'Executive overview' }), h('label', { class: 'chk' }, ex, ' Turn on the Executive view and export for schedules made from this template')),
    h('p', { class: 'muted xo-note', text: 'The time scale comes from the scale menu in the Timeline. Holidays and working days belong to each project, not the template.' }));
  openDialog({ title: 'Template settings', wide: true, body, actions: ro ? [{ label: 'Close' }] : [{ label: 'Cancel' }, { label: 'Apply', primary: true, run: () => {
    const v = f.read();
    if (!v.name) { f.name.focus(); return false; }
    edit(() => {
      S.work.name = v.name;
      S.work.tplMeta = Object.assign({}, S.work.tplMeta, { category: v.category, description: v.description });
      S.work.execOn = ex.checked;
      S.work.tplPhases = [...phases];
    });
  } }] });
}
/* the context bar, menu and buttons while a template is open */
function applyTplMode() {
  const on = !!S.tpl;
  document.body.classList.toggle('tpl-mode', on);
  const ep = $('#edProj');
  $('#schedSel').hidden = on;
  $('#edTplName').hidden = !on;
  ['btnNew', 'btnDup', 'btnSaveTpl'].forEach((k) => { const el = $('#' + k); if (el) el.hidden = on; });
  ['btnTplDup', 'btnTplMove', 'btnTplDelete'].forEach((k) => { const el = $('#' + k); if (el) el.hidden = !on; });
  $('#btnDelete').hidden = on;
  if (!on) { $('#btnSaveTpl').disabled = !S.work || !canMine(); $('#btnHistory').hidden = false; $('#btnExport').hidden = false; return; }
  const t = currentTemplate() || { scope: S.tpl.scope, id: S.tpl.id, name: S.work.name };
  ep.textContent = S.tpl.scope === 'mine' ? 'My templates' : 'Company templates' + (S.readonly ? ' · view only' : '');
  ep.href = '#/scheduler/templates';
  ep.classList.remove('none');
  ep.title = 'Back to the template library';
  $('#edTplName').textContent = S.work.name;
  $('#btnRename').disabled = S.readonly;
  $('#btnTplDup').disabled = !canMine();
  $('#btnTplMove').hidden = !(S.tpl.scope === 'mine' && isTplManager());
  $('#btnTplDelete').disabled = !canEditTpl(t);
  $('#btnTplDelete').lastChild.textContent = S.tpl.scope === 'mine' ? 'Delete template…' : 'Remove from company templates…';
  $('#btnHistory').hidden = true;
  $('#btnExport').hidden = true;
  if (!S.base.at) $('#savedBy').textContent = S.tpl.starter ? 'Starter template' : 'Not saved yet';
}
function tplBanner(box) {
  if (!S.tpl || !S.work) return;
  const s = fmtShort(S.work.tasks.length ? Math.min(...[...S.res.values()].map((r) => r.start)) : sampleStart());
  if (S.readonly) {
    box.append(banner('info', [h('strong', { text: 'Company template, view only. ' }), 'Template managers maintain these. Duplicate it to My templates to make your own version.'],
      canMine() ? [{ label: 'Duplicate to My templates', run: () => { const t = currentTemplate(); if (t) openDupTemplate(t); } }] : []));
  } else {
    box.append(banner('info', [h('strong', { text: (S.tpl.scope === 'mine' ? 'Editing your template. ' : 'Editing a company template. ') }),
      'Dates are laid out from a sample start (' + s + '); each new schedule picks its own start. Locks, holds and commitments aren’t part of a template.'],
    [{ label: 'Template settings…', run: openTemplateSettings }]));
  }
}
function bindTemplates() {
  $('#btnHomeTpl').addEventListener('click', () => go('#/scheduler/templates'));
  $('#btnSaveTpl').addEventListener('click', () => { closeMenus(); openSaveAsTemplate(); });
  $('#btnTplDup').addEventListener('click', () => { closeMenus(); const t = currentTemplate(); if (t) openDupTemplate(S.dirty ? Object.assign({}, t, workAsTemplate(), { scope: t.scope }) : t); });
  $('#btnTplMove').addEventListener('click', () => {
    closeMenus();
    const t = currentTemplate(); if (!t) return;
    if (S.dirty) { toast('Save your changes first, then move the template.'); return; }
    confirmMoveToCompany(t, (id) => go('#/scheduler/t/company/' + id, { replace: true }));
  });
  $('#btnTplDelete').addEventListener('click', () => { closeMenus(); const t = currentTemplate(); if (t) confirmDeleteTemplate(t, () => { S.dirty = false; leaveTemplate(); go('#/scheduler/templates'); }); });
}

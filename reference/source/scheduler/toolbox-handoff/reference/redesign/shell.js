/* ===== Toolbox shell: module registry, navigation, routing, personal display settings =====
   Modules register here; the side bar and the router read the registry, so a second tool is
   one entry plus its pages. Nothing in the shell knows what a schedule is. */
const TOOLBOX_MODULES = [
  { id: 'scheduler', name: 'Scheduler', icon: 'chart-gantt', path: '#/scheduler', blurb: 'Project schedules that recalculate themselves' },
];
const DEFAULT_ROUTE = '#/scheduler';

/* fill <i data-i="name"> placeholders in static markup with line icons */
function hydrateIcons(root) {
  for (const el of (root || document).querySelectorAll('i[data-i]')) {
    const wrap = document.createElement('span');
    wrap.innerHTML = icon(el.dataset.i, +el.dataset.s || 16);
    el.replaceWith(wrap.firstChild);
  }
}

/* ----- routing: #/scheduler, #/scheduler/p/<projectId>, #/scheduler/s/<scheduleId> ----- */
function parseRoute(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { module: 'scheduler', page: 'home' };
  const module = parts[0];
  if (module !== 'scheduler') return { module: 'scheduler', page: 'home' };
  if (parts[1] === 'p' && parts[2]) return { module, page: 'project', id: parts[2] };
  if (parts[1] === 's' && parts[2]) return { module, page: 'editor', id: parts[2] };
  if (parts[1] === 'templates') return { module, page: 'templates' };
  if (parts[1] === 't' && (parts[2] === 'mine' || parts[2] === 'company') && parts[3]) return { module, page: 'editor', tpl: { scope: parts[2], id: parts[3] } };
  return { module, page: 'home' };
}
function go(path, opts) {
  const r = parseRoute(path);
  if (guardTemplateLeave(r)) return;
  S.route = r;
  if (location.hash !== path) {
    if (opts && opts.replace) { try { history.replaceState(null, '', path); } catch (e) { location.hash = path; } }
    else location.hash = path;
  }
  closeSide();
  routeRender();
}
const routeOf = (r) => (r.page === 'project' ? '#/scheduler/p/' + encodeURIComponent(r.id) : r.page === 'editor' && r.tpl ? '#/scheduler/t/' + r.tpl.scope + '/' + encodeURIComponent(r.tpl.id) : r.page === 'editor' ? '#/scheduler/s/' + encodeURIComponent(r.id) : r.page === 'templates' ? '#/scheduler/templates' : '#/scheduler');
/* leaving a template with unsaved changes asks first, like switching schedules does */
function guardTemplateLeave(r) {
  if (!S.tpl || !S.dirty || S.readonly) return false;
  const here = '#/scheduler/t/' + S.tpl.scope + '/' + encodeURIComponent(S.tpl.id);
  if (routeOf(r) === here) return false;
  try { history.replaceState(null, '', here); } catch (e) { /* ignore */ }
  S.route = parseRoute(here);
  openDialog({ title: 'Discard unsaved changes?', body: h('p', { text: 'You have unsaved changes to the template “' + S.work.name + '”.' }), actions: [
    { label: 'Stay here' },
    { label: 'Save and leave', run: () => { saveTemplateEdit().then(() => { if (!S.dirty) { leaveTemplate(); go(routeOf(r)); } }); } },
    { label: 'Discard', danger: true, run: () => { S.dirty = false; leaveTemplate(); go(routeOf(r)); } },
  ] });
  return true;
}
function onHash() {
  const r = parseRoute(location.hash);
  if (S.route && routeOf(S.route) === routeOf(r)) return;
  if (guardTemplateLeave(r)) return;
  if (r.page === 'editor' && !r.tpl && !S.tpl && S.dirty && S.cur && r.id !== S.cur) {
    // leaving one schedule for another with unsaved edits: ask, the same as the switcher does
    const back = routeOf(S.route || { page: 'editor', id: S.cur });
    try { history.replaceState(null, '', back); } catch (e) { /* ignore */ }
    switchTo(r.id);
    return;
  }
  S.route = r;
  routeRender();
}

/* show the page for the current route and make sure its data is in place */
function routeRender() {
  const r = S.route || (S.route = parseRoute(location.hash));
  const pages = { home: $('#pageHome'), project: $('#pageProject'), editor: $('#pageEditor'), templates: $('#pageTemplates') };
  if (S.tpl && !(r.page === 'editor' && r.tpl && r.tpl.scope === S.tpl.scope && r.tpl.id === S.tpl.id)) leaveTemplate();
  if (r.page === 'editor' && r.tpl) {
    if (!S.tpl || S.tpl.id !== r.tpl.id || S.tpl.scope !== r.tpl.scope) {
      const t = r.tpl.scope === 'mine' ? S.tplMine.get(r.tpl.id) : companyTemplates().find((x) => x.id === r.tpl.id);
      if (t) loadTemplateIntoEditor(t);
      else if (S.tplLoaded && (r.tpl.scope === 'company' || S.tplMineLoaded)) { toast('That template no longer exists.'); go('#/scheduler/templates', { replace: true }); return; }
      else { for (const [k, el] of Object.entries(pages)) el.hidden = k !== 'templates'; $('#tplBody').textContent = 'Loading…'; return; }
    }
  } else if (r.page === 'editor') {
    const d = S.schedules.get(r.id);
    if (S.cur !== r.id) {
      if (d) { loadDoc(d); }
      else if (S.schedLoaded && !S.creating) { toast('That schedule no longer exists.'); go(DEFAULT_ROUTE, { replace: true }); return; }
    }
  }
  for (const [k, el] of Object.entries(pages)) el.hidden = k !== r.page;
  document.body.dataset.page = r.page;
  renderNav();
  if (r.page === 'home') { renderHome(); $('#empty').hidden = !(S.schedLoaded || S.noStore) || S.schedules.size > 0 || S.projects.size > 0; }
  else $('#empty').hidden = true;
  if (r.page === 'project') renderProject(r.id);
  if (r.page === 'templates') renderTemplates();
  if (r.page === 'editor') { if (S.work && !S.tpl) noteRecent(S.meta.projectId); renderAll(); }
  const crumb = r.page === 'editor' && S.work ? S.work.name : r.page === 'project' ? projLabel(S.projects.get(r.id)) : r.page === 'templates' ? 'Templates' : 'Scheduler';
  $('#mCrumb').textContent = crumb;
  document.title = (r.page === 'templates' ? 'Templates · ' : r.page === 'editor' && S.work ? S.work.name + (S.tpl ? ' (template)' : '') + ' · ' : r.page === 'project' && S.projects.get(r.id) ? projLabel(S.projects.get(r.id)) + ' · ' : '') + 'Toolbox Scheduler';
}

/* ----- side navigation ----- */
function renderNav() {
  const nav = $('#sideNav');
  nav.textContent = '';
  nav.append(h('div', { class: 'navh', text: 'Tools' }));
  const cur = (S.route && S.route.module) || 'scheduler';
  for (const m of TOOLBOX_MODULES) {
    const a = h('a', { class: 'nav-item' + (m.id === cur ? ' on' : ''), href: m.path, title: m.name + ': ' + m.blurb, 'aria-current': m.id === cur ? 'page' : null, onclick: (e) => { e.preventDefault(); go(m.path); } });
    a.innerHTML = icon(m.icon, 18);
    a.append(h('span', { text: m.name }));
    nav.append(a);
    if (m.id === 'scheduler') { // the Scheduler's own pages
      const onT = S.route && (S.route.page === 'templates' || (S.route.page === 'editor' && S.route.tpl));
      const t = h('a', { class: 'nav-item nav-sub' + (onT ? ' on' : ''), href: '#/scheduler/templates', id: 'navTemplates', 'aria-current': onT ? 'page' : null, title: 'Company templates and your own', onclick: (e) => { e.preventDefault(); go('#/scheduler/templates'); } });
      t.innerHTML = icon('layout-template', 16);
      t.append(h('span', { text: 'Templates' }));
      if (onT) a.classList.remove('on');
      nav.append(t);
    }
  }
}
function renderMe() {
  const nm = S.meId ? (S.names[S.meId] || '') : '';
  $('#meName').textContent = nm || (S.meId ? 'Signed in' : 'Not signed in');
  $('#meAvatar').textContent = initials(nm || '?');
}
const initials = (n) => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '·';
function openSide() { document.body.classList.add('side-open'); if (!$('.side-scrim')) document.body.append(h('div', { class: 'side-scrim', onclick: closeSide })); }
function closeSide() { document.body.classList.remove('side-open'); const s = $('.side-scrim'); if (s) s.remove(); }

/* ----- personal display settings (this device) ----- */
const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem('toolbox:' + k); localStorage.setItem('toolbox:' + k, v); } catch (e) { return null; } return v; };
function applyTheme() {
  const t = pref('theme') || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  const b = $('#btnTheme');
  b.innerHTML = icon(t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'circle-dot', 16);
  b.title = 'Theme: ' + (t === 'auto' ? 'follows your system' : t) + '. Click to change.';
}
function cycleTheme() { const t = pref('theme') || 'auto'; pref('theme', t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto'); applyTheme(); if (S.work && !$('#pageEditor').hidden) renderAll(); }
function applyCollapse() {
  const c = pref('side') === 'collapsed';
  document.body.classList.toggle('side-collapsed', c);
  const b = $('#btnCollapse');
  b.innerHTML = icon(c ? 'panel-left-open' : 'panel-left-close', 16);
  b.title = c ? 'Expand the side bar' : 'Collapse the side bar';
  b.setAttribute('aria-label', b.title);
}
function applyDensity() {
  const d = pref('density') === 'compact';
  document.body.classList.toggle('dense', d);
  const b = $('#btnDensity');
  b.setAttribute('aria-pressed', String(d));
  b.title = d ? 'Rows: compact. Click for comfortable rows.' : 'Rows: comfortable. Click for compact rows that show more at once.';
}

function bindShell() {
  hydrateIcons();
  $('#sideLogo').src = LOGO.src;
  $('#btnMenu').addEventListener('click', openSide);
  $('#btnTheme').addEventListener('click', cycleTheme);
  $('#btnCollapse').addEventListener('click', () => { pref('side', pref('side') === 'collapsed' ? 'open' : 'collapsed'); applyCollapse(); if (S.work && S.view !== 'table') renderAll(); });
  $('#btnDensity').addEventListener('click', () => { pref('density', pref('density') === 'compact' ? 'comfortable' : 'compact'); applyDensity(); if (S.work) renderAll(); });
  if (!pref('side') && window.innerWidth < 1440) pref('side', 'collapsed');
  applyTheme(); applyCollapse(); applyDensity();
  window.addEventListener('hashchange', onHash);
  window.addEventListener('beforeunload', (e) => { if (S.dirty && !S.readonly) { e.preventDefault(); e.returnValue = ''; } });
  S.route = parseRoute(location.hash);
  if (!location.hash) { try { history.replaceState(null, '', DEFAULT_ROUTE); } catch (e) { /* ignore */ } }
}

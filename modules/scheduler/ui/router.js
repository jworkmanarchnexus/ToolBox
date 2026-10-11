/* ===== Routing inside the Scheduler: #/scheduler, #/scheduler/p/<projectId>, #/scheduler/s/<scheduleId>, #/scheduler/templates =====
   The Toolbox shell owns the side bar, the frame, theme and density; it hands the Scheduler a hash and the Scheduler draws
   the matching page. Nothing here knows about the side bar. */
const DEFAULT_ROUTE = '#/scheduler';
const pref = (k, v) => P.pref(k, v);
const initials = (n) => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '·';

/* fill <i data-i="name"> placeholders in static markup with line icons */
function hydrateIcons(root) {
  for (const el of (root || document).querySelectorAll('i[data-i]')) {
    const wrap = document.createElement('span');
    wrap.innerHTML = icon(el.dataset.i, +el.dataset.s || 16);
    el.replaceWith(wrap.firstChild);
  }
}

/* document and window listeners belong to the page, not to a mounted element, so they only act while the Scheduler is on screen */
function docOn(target, type, fn, opts) {
  target.addEventListener(type, (e) => { if (S.mounted) fn(e); }, opts);
}

function parseRoute(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const module = 'scheduler';
  if (parts[0] !== 'scheduler') return { module, page: 'home' };
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
/* the shell calls this on every hash change that stays inside the Scheduler */
function onHash(hash) {
  const r = parseRoute(hash);
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
  if (!S.mounted && !S.route) return;
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
  if (r.page === 'home') { renderHome(); $('#empty').hidden = !(S.schedLoaded || S.noStore) || S.schedules.size > 0 || S.projects.size > 0; }
  else $('#empty').hidden = true;
  if (r.page === 'project') renderProject(r.id);
  if (r.page === 'templates') renderTemplates();
  if (r.page === 'editor') { if (S.work && !S.tpl) noteRecent(S.meta.projectId); renderAll(); }
  const crumb = r.page === 'editor' && S.work ? S.work.name : r.page === 'project' ? projLabel(S.projects.get(r.id)) : r.page === 'templates' ? 'Templates' : 'Scheduler';
  const mc = $('#mCrumb');
  if (mc) mc.textContent = crumb;
  if (S.mounted) document.title = (r.page === 'templates' ? 'Templates · ' : r.page === 'editor' && S.work ? S.work.name + (S.tpl ? ' (template)' : '') + ' · ' : r.page === 'project' && S.projects.get(r.id) ? projLabel(S.projects.get(r.id)) + ' · ' : '') + 'Toolbox Scheduler';
}

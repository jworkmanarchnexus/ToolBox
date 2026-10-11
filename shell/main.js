/* The Toolbox shell: sign-in-as picker, side bar, hash routing (#/scheduler/...), theme and density.
   It reaches the server only through shared/platform (CLAUDE.md rule 1). */
import * as platform from '/shared/platform/index.js';
import { projectPicker } from '/shared/ui/project-picker.js';

const { configure, Session, Directory, ApiError } = platform;
const T = window.Toolbox;
const h = T.h;
configure({ pref: T.pref });

const root = document.getElementById('app');

/* ---------- tools in the side bar. Each module registers here when it is ported. ---------- */
const TOOLS = [
  { id: 'scheduler', name: 'Scheduler', icon: 'chart-gantt', module: true, blurb: 'Project schedules, with dependencies and live editing.',
    sub: [{ label: 'Templates', href: '#/scheduler/templates', icon: 'layout-template', match: /^#\/scheduler\/(templates|t\/)/ }] },
  { id: 'fee-builder', name: 'Fee Builder', icon: 'sheet', module: true, blurb: 'Fee proposals and scenarios.' },
  { id: 'minutes', name: 'Minutes', icon: 'file-text', phase: 4, blurb: 'Meeting agendas, minutes and action items.' },
];

const displayChanged = () => window.dispatchEvent(new Event('toolbox:display'));
const initials = name => name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const accessChip = level => h('span', { class: 'chip' + (level === 'admin' ? ' blue' : level === 'write' ? ' ok' : ''), text: { admin: 'Project admin', write: 'Can edit', read: 'View only' }[level] || level });
const roleLabel = r => ({ pic: 'PIC', pm: 'PM', pa: 'PA', team: 'Team' }[r] || r);
const icon = (name, size) => h('span', { html: T.icon(name, size || 16) });

function mount(...nodes) { root.textContent = ''; root.append(...nodes); T.hydrateIcons(root); }

/* ---------- sign in as ---------- */
async function showSignIn(message) {
  const users = await Session.devUsers();
  const cards = users.map(u => h('button', {
    class: 'rcard', type: 'button',
    onclick: async () => { await Session.signInAs(u.id); location.hash = '#/'; location.reload(); },
  },
  h('span', { class: 'pn', text: u.title || 'Staff' }),
  h('span', { class: 'pt', text: u.name }),
  h('span', { class: 'chips' }, u.firmRole ? h('span', { class: 'chip ' + (u.firmRole === 'admin' ? 'blue' : ''), text: u.firmRole === 'admin' ? 'Firm admin' : 'Firm viewer' }) : null)));
  mount(h('main', { class: 'signin' },
    h('img', { class: 'side-logo', alt: 'Arch Nexus', src: '/shared/design-system/arch-nexus-logo.png' }),
    h('h1', { text: 'Toolbox' }),
    message ? h('div', { class: 'banner warn', style: 'margin-top:16px' }, h('span', { class: 'bmsg' }, icon('triangle-alert'), h('span', { text: message }))) : null,
    h('p', { class: 'hint', text: 'Choose who to sign in as. These are made-up test people; the real Toolbox will use your network username and password.' }),
    h('div', { class: 'recent' }, ...cards),
    h('p', { class: 'dev-note', text: 'Local test mode: this computer only.' })));
}

/* ---------- frame ---------- */
function frame(routeKey, crumbs, content) {
  const me = Session.me();
  const themeBtn = h('button', { class: 'ib', type: 'button', 'aria-label': 'Theme' });
  const collapseBtn = h('button', { class: 'ib side-collapse', type: 'button' });
  const densityBtn = h('button', { class: 'ib', type: 'button', title: 'Compact rows', 'aria-label': 'Compact rows', 'aria-pressed': 'false' }, icon('rows-3'));
  themeBtn.addEventListener('click', () => { T.cycleTheme(themeBtn); displayChanged(); });
  collapseBtn.addEventListener('click', () => { T.toggleCollapse(collapseBtn); displayChanged(); });
  densityBtn.addEventListener('click', () => { T.pref('density', T.pref('density') === 'compact' ? 'comfortable' : 'compact'); T.applyDensity(densityBtn); displayChanged(); });

  const nav = [
    h('div', { class: 'navh', text: 'Toolbox' }),
    navItem('#/', 'house', 'Home', routeKey === 'home'),
    navItem('#/projects', 'folder', 'Projects', routeKey === 'projects'),
    h('div', { class: 'navh', text: 'Tools' }),
    ...TOOLS.flatMap(t => {
      const here = location.hash || '#/';
      const subOn = (t.sub || []).some(x => x.match.test(here));
      return [navItem('#/' + t.id, t.icon, t.name, routeKey === t.id && !subOn)].concat((t.sub || []).map(x => navItem(x.href, x.icon, x.label, x.match.test(here), 'nav-sub')));
    }),
  ];
  const side = h('aside', { class: 'side' },
    h('div', { class: 'side-brand' },
      h('img', { class: 'side-logo', alt: 'Arch Nexus', src: '/shared/design-system/arch-nexus-logo.png' }),
      h('div', { class: 'side-product' }, h('strong', { text: 'Toolbox' }), h('span', { text: 'Arch Nexus' }))),
    h('nav', { class: 'side-nav', 'aria-label': 'Tools' }, ...nav),
    h('div', { class: 'side-foot' },
      h('div', { class: 'side-user', title: me.name }, h('span', { class: 'avatar', text: initials(me.name) }), h('span', { class: 'nm', text: me.name })),
      h('button', { class: 'ib', type: 'button', title: 'Switch user', 'aria-label': 'Switch user', onclick: () => { Session.signOut(); location.hash = '#/'; location.reload(); } }, icon('arrow-right-left')),
      densityBtn, themeBtn, collapseBtn));
  const scrim = h('div', { class: 'side-scrim', onclick: () => document.body.classList.remove('side-open') });
  const mtop = h('div', { class: 'mtop' },
    h('button', { class: 'ib', type: 'button', 'aria-label': 'Open the menu', onclick: () => document.body.classList.add('side-open') }, icon('menu')),
    h('strong', { text: 'Toolbox' }), h('span', { class: 'crumb', id: 'mCrumb' }));
  const mainwrap = h('div', { class: 'mainwrap' }, mtop);
  const page = content ? h('div', { class: 'page' }, h('div', { class: 'phead' }, h('div', { class: 'crumbs' }, ...crumbs)), content) : null;
  if (page) mainwrap.append(page);
  mount(h('div', { class: 'shell' }, side, mainwrap), scrim);
  T.applyTheme(themeBtn); T.applyCollapse(collapseBtn); T.applyDensity(densityBtn);
  document.body.classList.remove('side-open');
  return page || mainwrap;
}
function navItem(href, ic, label, on, extra) {
  return h('a', { class: 'nav-item' + (extra ? ' ' + extra : '') + (on ? ' on' : ''), href, 'aria-current': on ? 'page' : null }, icon(ic, extra ? 16 : 18), h('span', { text: label }));
}
/* inside a module the frame stays; only the side bar highlight follows the hash */
function refreshNav(hash) {
  for (const t of TOOLS) {
    const subHit = (t.sub || []).find(x => x.match.test(hash));
    for (const a of document.querySelectorAll('.side-nav .nav-item')) {
      const href = a.getAttribute('href');
      const own = href === '#/' + t.id;
      const sub = (t.sub || []).find(x => x.href === href);
      if (!own && !sub) continue;
      const on = own ? (hash.startsWith('#/' + t.id) && !subHit) : !!sub && sub.match.test(hash);
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
  }
}
const crumb = (label, href) => href ? h('a', { href, text: label }) : h('span', { text: label });
const sep = () => icon('chevron-right', 14);

function title(text, sub) {
  const phead = document.querySelector('.phead');
  phead.append(h('div', { class: 'ptitle' }, h('h1', { text }), sub ? h('span', { class: 'sub', text: sub }) : null));
}

/* ---------- pages ---------- */
async function pageHome() {
  const me = Session.me();
  const page = frame('home', [crumb('Home')], h('div', { class: 'pbody stack' }));
  title(`Hello, ${me.name.split(' ')[0]}`, me.firmRole === 'admin' ? 'Firm admin' : me.firmRole === 'viewer' ? 'Firm viewer' : me.title || '');
  const body = page.querySelector('.pbody');
  body.append(
    h('div', { class: 'section-h' }, h('h2', { text: 'Tools' })),
    h('div', { class: 'recent' }, ...TOOLS.map(t => h('a', { class: 'rcard', href: '#/' + t.id }, h('span', { class: 'pn', text: t.module ? 'Ready' : `Arrives in phase ${t.phase}` }), h('span', { class: 'pt', text: t.name }), h('span', { class: 'pm', text: t.blurb })))));
  const mine = await Directory.projects({ scope: 'mine' });
  body.append(
    h('div', { class: 'section-h' }, h('h2', { text: 'Your projects' }), h('span', { class: 'muted', text: `${mine.length} where you are on the team` })),
    mine.length
      ? h('div', { class: 'recent' }, ...mine.map(p => h('a', { class: 'rcard', href: '#/projects/' + p.id }, h('span', { class: 'pn', text: p.number }), h('span', { class: 'pt', text: p.name }), h('span', { class: 'pm', text: p.client || '' }))))
      : h('div', { class: 'empty-note', text: 'You are not on any project team.' }));
}

async function pageProjects() {
  const scope = ['all', 'mine', 'archived'].includes(new URLSearchParams(location.hash.split('?')[1] || '').get('scope')) ? new URLSearchParams(location.hash.split('?')[1]).get('scope') : 'all';
  const page = frame('projects', [crumb('Home', '#/'), sep(), crumb('Projects')], h('div', { class: 'pbody stack' }));
  title('Projects', 'From the Vantagepoint copy; read-only here');
  const body = page.querySelector('.pbody');
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Which projects' },
    ...[['all', 'Active'], ['mine', 'Mine'], ['archived', 'Archived']].map(([k, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(k === scope), text: label, onclick: () => { location.hash = '#/projects?scope=' + k; } })));
  const projects = await Directory.projects({ scope });
  const table = projects.length
    ? h('table', { class: 'plist' },
      h('colgroup', {}, h('col', { class: 'c-num' }), h('col', {}), h('col', {}), h('col', { class: 'c-access' })),
      h('thead', {}, h('tr', {}, ...['No.', 'Project', 'Client', 'Your access'].map(x => h('th', {}, h('button', { type: 'button', text: x }))))),
      h('tbody', {}, ...projects.map(p => {
        const open = () => { location.hash = '#/projects/' + p.id; };
        return h('tr', { tabindex: '0', onclick: open, onkeydown: e => { if (e.key === 'Enter') open(); } },
          h('td', { class: 'pn', text: p.number }), h('td', { class: 'pt', text: p.name }), h('td', { text: p.client || '' }), h('td', {}, accessChip(p.access)));
      })))
    : h('div', { class: 'empty-note', text: scope === 'mine' ? 'You are not on any project team.' : 'No projects to show.' });
  body.append(seg, table);
}

async function pageProject(id) {
  let project;
  try { project = await Directory.project(id); } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      const page = frame('projects', [crumb('Home', '#/'), sep(), crumb('Projects', '#/projects')], h('div', { class: 'pbody' }));
      title('Project not found');
      page.querySelector('.pbody').append(h('div', { class: 'empty-note', text: 'This project does not exist, or you do not have access to it.' }));
      return;
    }
    throw e;
  }
  const page = frame('projects', [crumb('Home', '#/'), sep(), crumb('Projects', '#/projects'), sep(), crumb(project.number)], h('div', { class: 'pbody stack' }));
  title(project.name, project.number);
  const body = page.querySelector('.pbody');
  if (project.status === 'archived') body.append(h('div', { class: 'banner' }, h('span', { class: 'bmsg' }, icon('archive'), h('span', { text: 'This project is archived and read-only.' }))));
  else if (project.access === 'read') body.append(h('div', { class: 'banner' }, h('span', { class: 'bmsg' }, icon('eye'), h('span', { text: 'You have view access to this project.' }))));
  body.append(h('dl', { class: 'facts' },
    h('dt', { text: 'Client' }), h('dd', { text: project.client || 'Not recorded' }),
    h('dt', { text: 'Status' }), h('dd', {}, h('span', { class: 'chip' + (project.status === 'active' ? ' ok' : ''), text: project.status === 'active' ? 'Active' : 'Archived' })),
    h('dt', { text: 'Your access' }), h('dd', {}, accessChip(project.access)),
    h('dt', { text: 'Vantagepoint' }), h('dd', { text: project.vp.projectId ? `Project ${project.vp.projectId}, number ${project.vp.number}` : `Number ${project.vp.number || project.number} (not linked yet)` })));
  const team = await Directory.team(id);
  body.append(
    h('div', { class: 'section-h' }, h('h2', { text: 'Project team' }), h('span', { class: 'muted', text: `${team.length} people` })),
    h('table', { class: 'plist' },
      h('colgroup', {}, h('col', {}), h('col', { class: 'c-role' })),
      h('thead', {}, h('tr', {}, h('th', {}, h('button', { type: 'button', text: 'Name' })), h('th', {}, h('button', { type: 'button', text: 'Role' })))),
      h('tbody', {}, ...team.map(m => h('tr', {}, h('td', { class: 'pt', text: m.name }), h('td', {}, h('span', { class: 'chip' + (m.role === 'team' ? '' : ' blue'), text: roleLabel(m.role) })))))));
  if (project.access === 'admin') {
    const overrides = await Directory.accessOverrides(id);
    body.append(
      h('div', { class: 'section-h' }, h('h2', { text: 'Manual access changes' }), h('span', { class: 'muted', text: 'Set by project admins' })),
      overrides.length
        ? h('table', { class: 'plist' }, h('colgroup', {}, h('col', {}), h('col', { class: 'c-role' }), h('col', {})),
          h('thead', {}, h('tr', {}, ...['Name', 'Change', 'Reason'].map(x => h('th', {}, h('button', { type: 'button', text: x }))))),
          h('tbody', {}, ...overrides.map(o => h('tr', {}, h('td', { class: 'pt', text: o.name }), h('td', { text: { deny: 'Removed', grant_viewer: 'Can view', grant_editor: 'Can edit' }[o.kind] }), h('td', { text: o.reason || '' })))))
        : h('div', { class: 'empty-note', text: 'No manual changes. Access comes from the Vantagepoint team.' }));
  }
}

/* ---------- modules: a bundle built by tools/build.js, mounted into the frame ---------- */
const loaded = new Map();
function loadModule(tool) {
  if (!loaded.has(tool.id)) {
    loaded.set(tool.id, new Promise((resolve, reject) => {
      const css = h('link', { rel: 'stylesheet', href: `/modules/${tool.id}/dist/${tool.id}.css` });
      document.head.append(css);
      const js = h('script', { src: `/modules/${tool.id}/dist/${tool.id}.js` });
      js.onload = () => (window.ToolboxModules && window.ToolboxModules[tool.id] ? resolve(window.ToolboxModules[tool.id]) : reject(new Error('module did not register')));
      js.onerror = () => { loaded.delete(tool.id); reject(new Error('could not load the module')); };
      document.head.append(js);
    }));
  }
  return loaded.get(tool.id);
}
let active = null; // { id, api, mainwrap }
const inModule = (hash, id) => new RegExp('^#/' + id + '(/|$|\\?)').test(hash);
function leaveActive() { if (active) { active.api.unmount(); active = null; } }

async function pageModule(tool, hash) {
  const api = await loadModule(tool);
  if (active && active.id === tool.id && active.mainwrap.isConnected) { api.route(hash); refreshNav(hash); return; }
  leaveActive();
  const mainwrap = frame(tool.id, null, null);
  await api.mount({ container: mainwrap, platform, hash });
  active = { id: tool.id, api, mainwrap };
}

async function pageTool(tool) {
  const page = frame(tool.id, [crumb('Home', '#/'), sep(), crumb(tool.name)], h('div', { class: 'pbody stack' }));
  title(tool.name);
  const body = page.querySelector('.pbody');
  body.append(h('div', { class: 'banner' }, h('span', { class: 'bmsg' }, icon('info'), h('span', { text: `${tool.name} arrives in phase ${tool.phase}. The shared project picker below is what it will use.` }))));
  const holder = h('div', { class: 'stack picker-row' });
  body.append(holder);
  const detail = h('div', {});
  const show = p => {
    detail.textContent = '';
    if (!p) return;
    detail.append(h('div', { class: 'facts' }, h('dt', { text: 'Project' }), h('dd', { text: `${p.number}  ${p.name}` }), h('dt', { text: 'Your access' }), h('dd', {}, accessChip(p.access))));
  };
  const picker = await projectPicker({ onChange: show });
  holder.append(picker.el, detail);
  show(picker.current());
}

/* ---------- routing ---------- */
const routes = [
  [/^#\/?$/, () => pageHome()],
  [/^#\/projects\/([^/?]+)$/, id => pageProject(decodeURIComponent(id))],
  [/^#\/projects(\?.*)?$/, () => pageProjects()],
  [/^#\/(scheduler|fee-builder|minutes)\b/, id => { const t = TOOLS.find(x => x.id === id); return t.module ? pageModule(t, location.hash) : pageTool(t); }],
];

let navToken = 0;
async function route() {
  const token = ++navToken;
  const hash = location.hash || '#/';
  if (active && !inModule(hash, active.id)) leaveActive();
  for (const [re, fn] of routes) {
    const m = re.exec(hash);
    if (m) {
      try { await fn(m[1]); } catch (e) {
        if (token !== navToken) return;
        if (e instanceof ApiError && e.status === 401) return boot('Your sign-in is no longer valid. Choose who to sign in as.');
        console.error(e);
        const page = frame('', [crumb('Home', '#/')], h('div', { class: 'pbody' }));
        page.querySelector('.pbody').append(h('div', { class: 'banner err' }, h('span', { class: 'bmsg' }, icon('circle-alert'), h('span', { text: 'Something went wrong loading this page. Nothing was changed.' }))));
      }
      return;
    }
  }
  location.hash = '#/';
}

async function boot(message) {
  T.applyTheme(); T.applyDensity();
  let me = null;
  try { me = await Session.load(); } catch (e) { message = 'The Toolbox server is not reachable.'; }
  if (!me) return showSignIn(message);
  route();
}

let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  const dest = location.hash;
  // leaving a module with unsaved edits: stay, and ask
  if (active && !inModule(dest, active.id) && active.api.isDirty()) {
    try { history.replaceState(null, '', lastHash); } catch (e) { /* ignore */ }
    active.api.confirmLeave(() => { location.hash = dest; });
    return;
  }
  lastHash = dest;
  if (Session.me()) route();
});
boot();

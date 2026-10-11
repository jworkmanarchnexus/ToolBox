/* ===== What the Toolbox shell sees of the Scheduler =====
   window.ToolboxModules.scheduler = { mount, route, unmount, isDirty, confirmLeave }.
   mount() puts the pages into the shell's main area; the shell hands over the platform adapters (shared/platform). */
let started = false;

const API = {
  id: 'scheduler',
  async mount({ container, platform, hash }) {
    P = platform;
    if (!started) {
      started = true;
      VIEW.innerHTML = PAGES_HTML;
      hydrateIcons(VIEW);
      try { Object.assign(S.home, JSON.parse(pref('sched.home') || '{}'), { q: '' }); } catch (e) { /* optional */ }
      bindStatic();
      window.addEventListener('beforeunload', (e) => { if (S.mounted && S.dirty && !S.readonly) { e.preventDefault(); e.returnValue = ''; } });
      window.addEventListener('toolbox:display', () => { if (S.mounted && S.work && !$('#pageEditor').hidden) renderAll(); });
    }
    container.append(VIEW);
    S.mounted = true;
    S.route = parseRoute(hash);
    startData();
    routeRender();
  },
  /* a hash change that stays inside the Scheduler */
  route(hash) { onHash(hash); },
  unmount() {
    S.mounted = false;
    closeMenus();
    stopData();
    updatePresence();
    VIEW.remove();
  },
  /* unsaved edits? the shell asks before leaving */
  isDirty() { return !!(S.dirty && !S.readonly); },
  confirmLeave(proceed) {
    openDialog({
      title: 'Discard unsaved changes?',
      body: h('p', { text: 'You have unsaved changes to “' + (S.work ? S.work.name : 'this schedule') + '”. Leaving the Scheduler will discard them.' }),
      actions: [{ label: 'Stay here' }, { label: 'Discard and leave', danger: true, run: () => { S.dirty = false; if (S.tpl) leaveTemplate(); proceed(); } }],
    });
  },
};

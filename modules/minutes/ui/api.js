/* ===== What the Toolbox shell sees of Minutes =====
   window.ToolboxModules.minutes = { mount, route, unmount, isDirty, confirmLeave }.
   Minutes keeps its state (open project and meeting, unsent changes) while another Toolbox page is showing.
   Inside Minutes, moving between home, project, series and meeting is internal, as before. */
let instance = null;
const ROOT = document.createElement('div');
ROOT.id = 'minutesRoot';
ROOT.style.display = 'contents';

const API = {
  id: 'minutes',
  async mount({ container, platform }) {
    container.append(ROOT);
    if (instance) { instance.show(); return; }
    instance = startMinutes(ROOT, platform);
  },
  route() { /* one entry point */ },
  unmount() { if (instance) instance.hide(); ROOT.remove(); },
  destroy() { if (instance) { instance.stop(); instance = null; } ROOT.remove(); },
  isDirty() { return false; /* unsent changes are kept on this computer and sent when possible, so leaving never loses work */ },
  confirmLeave(proceed) { proceed(); },
};

/* ===== What the Toolbox shell sees of Fee Builder =====
   window.ToolboxModules['fee-builder'] = { mount, route, unmount, isDirty, confirmLeave }.
   Fee Builder keeps its state (open proposal, view, undo) while another Toolbox page is showing. */
let instance = null;
const ROOT = document.createElement('div');
ROOT.id = 'feeBuilderRoot';
ROOT.style.display = 'contents';

const API = {
  id: 'fee-builder',
  async mount({ container, platform }) {
    container.append(ROOT);
    if (instance) { instance.show(); return; }
    instance = FB.app.start(ROOT, platform);
  },
  route() { /* Fee Builder has one page; its views are inside it */ },
  unmount() { if (instance) instance.hide(); ROOT.remove(); },
  /* stop polling and timers for good (the shell never needs this; tests do) */
  destroy() { if (instance) { instance.stop(); instance = null; } ROOT.remove(); },
  isDirty() { return !!(instance && instance.isDirty()); },
  confirmLeave(proceed) {
    // edits are saved a moment after they are made, and a draft is kept on this device; only ask while a save is still in flight
    if (window.confirm('Fee Builder is still saving your last change. Leave anyway? Your work is kept as a draft on this computer.')) proceed();
  },
};

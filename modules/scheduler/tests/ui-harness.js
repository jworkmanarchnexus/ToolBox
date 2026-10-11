'use strict';
/* Runs the real Scheduler bundle (modules/scheduler/dist) in jsdom, wired to the real shared/platform and a real
   server on a random local port. Gives tests a window to click through and the server to check what was stored. */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const serverHelpers = require('../../../server/tests/helpers');

const REPO = path.resolve(__dirname, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');

const until = async (cond, what, ms = 4000) => {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = cond(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('Timed out waiting for ' + what);
    await new Promise(r => setTimeout(r, 25));
  }
};

async function start() {
  require('../../../tools/build').buildModule('scheduler');
  const platform = await import('../../../shared/platform/index.js');
  const t = await serverHelpers.start();
  platform.configure({ baseUrl: t.base, pollMs: 300 });

  const opened = [];
  async function open(username, hash) {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
    vc.on('error', (...a) => errors.push(a.join(' ')));
    const dom = new JSDOM('<!doctype html><html><body><div class="mainwrap"></div><div id="modalRoot"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
    const w = dom.window;
    w.eval(read('shared', 'design-system', 'bundle.js'));
    w.eval(read('modules', 'scheduler', 'dist', 'scheduler.js'));
    platform.configure({ pref: w.Toolbox.pref });
    platform.Session.signOut();
    await platform.Session.signInAs(t.person(username).id);
    const api = w.ToolboxModules.scheduler;
    const container = w.document.querySelector('.mainwrap');
    await api.mount({ container, platform, hash: hash || '#/scheduler' });
    const ui = {
      w, api, errors, doc: w.document, container,
      $: (s) => w.document.querySelector(s),
      $$: (s) => [...w.document.querySelectorAll(s)],
      until,
      goto(h) { w.location.hash = h; api.route(h); },
      click(el) { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); },
      change(el, value) { if (value !== undefined) el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); },
      button(text, root) { return [...(root || w.document).querySelectorAll('button')].find(b => b.textContent.trim().includes(text)); },
      dialogButton(text) { return ui.button(text, w.document.querySelector('#modalRoot')); },
      close() { try { api.unmount(); } catch (e) { /* ignore */ } w.close(); },
    };
    opened.push(ui);
    return ui;
  }
  return { t, platform, open, until, close: async () => { opened.forEach(u => u.close()); platform.Session.signOut(); await t.close(); } };
}

module.exports = { start, until };

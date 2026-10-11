/* ===== Gantt link dragging and the task details popup ===== */

const LINK_NAME = { FS: 'finish-to-start', SS: 'start-to-start' };
const taskLabel = (t, i) => (i + 1) + '. ' + (t.name || 'Untitled');

/* Can `succ` be made to follow `pred`? Returns {ok, why}. */
function canLink(predId, succId) {
  if (predId === succId) return { ok: false, why: 'A task can’t follow itself' };
  const succ = taskById(succId);
  if (!succ) return { ok: false, why: '' };
  if (wouldCycle(S.work.tasks, succId, [predId])) return { ok: false, why: 'That would create a loop' };
  return { ok: true, why: '' };
}

/* Create (or retype) the link pred -> succ. Returns a short result string. */
function linkTasks(predId, succId, type) {
  const chk = canLink(predId, succId);
  if (!chk.ok) { toast(chk.why + '.'); return false; }
  const succ = taskById(succId), pred = taskById(predId);
  const had = (succ.deps || []).find((d) => d.id === predId);
  if (had && had.type === type) { toast('Those two are already linked that way.'); return false; }
  edit(() => {
    if (had) had.type = type;
    else (succ.deps = succ.deps || []).push({ id: predId, type, lag: 0 });
  });
  S.sel = succId;
  renderAll();
  const nm = (t) => '“' + (t.name || 'Untitled') + '”';
  toast((had ? 'Changed the link: ' : 'Linked: ') + nm(succ) + ' ' + (type === 'FS' ? 'starts after ' + nm(pred) + ' finishes.' : 'starts when ' + nm(pred) + ' starts.'), { label: 'Undo', run: undo });
  return true;
}

/* ----- drag a node from one bar onto another task ----- */
function startLinkDrag(e, src) {
  if (S.readonly || (e.button != null && e.button > 0)) return;
  e.preventDefault();
  e.stopPropagation();
  const { gin, tasks, rows } = src;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'dragsvg');
  svg.setAttribute('width', gin.style.width); svg.setAttribute('height', gin.style.height);
  const line = document.createElementNS(NS, 'path');
  line.setAttribute('class', 'dragline');
  svg.append(line);
  const band = h('div', { class: 'dropband' });
  band.style.display = 'none';
  const tip = h('div', { class: 'dragtip' });
  tip.style.display = 'none';
  gin.append(band, svg, tip);
  const wrap = gin.querySelector('.bw[data-id="' + src.id + '"]');
  if (wrap) wrap.classList.add('dragsrc');
  document.body.classList.add('linking');
  const srcTask = taskById(src.id);
  const nm = (t) => '“' + (t.name || 'Untitled') + '”';
  let target = null;

  const pos = (ev) => { const b = gin.getBoundingClientRect(); return { x: ev.clientX - b.left, y: ev.clientY - b.top }; };
  const targetAt = (y) => {
    const i = Math.floor((y - GH) / GROW);
    return i >= 0 && i < tasks.length ? tasks[i] : null;
  };
  const move = (ev) => {
    const p = pos(ev);
    line.setAttribute('d', 'M' + src.x + ' ' + src.y + 'L' + p.x.toFixed(1) + ' ' + p.y.toFixed(1));
    const t = targetAt(p.y);
    target = null;
    if (!t || t.id === src.id) { band.style.display = 'none'; tip.style.display = 'none'; return; }
    const chk = canLink(src.id, t.id);
    const existing = (t.deps || []).find((d) => d.id === src.id);
    const type = src.end === 'finish' ? 'FS' : 'SS';
    const same = existing && existing.type === type;
    const ok = chk.ok && !same;
    if (ok) target = t;
    const ti = tasks.indexOf(t);
    band.style.display = 'block';
    band.style.top = GH + ti * GROW + 'px';
    band.className = 'dropband ' + (ok ? 'ok' : 'bad');
    tip.style.display = 'block';
    tip.className = 'dragtip ' + (ok ? 'ok' : 'bad');
    tip.textContent = !chk.ok ? chk.why : same ? 'Already linked this way'
      : nm(t) + (type === 'FS' ? ' will start after ' + nm(srcTask) + ' finishes' : ' will start when ' + nm(srcTask) + ' starts');
    tip.style.left = Math.min(p.x + 14, parseFloat(gin.style.width) - 200) + 'px';
    tip.style.top = p.y + 14 + 'px';
  };
  const done = (commit) => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel);
    document.removeEventListener('keydown', key);
    document.body.classList.remove('linking');
    band.remove(); svg.remove(); tip.remove();
    if (wrap) wrap.classList.remove('dragsrc');
    if (commit && target) linkTasks(src.id, target.id, src.end === 'finish' ? 'FS' : 'SS');
  };
  const up = (ev) => { move(ev); done(true); };
  const cancel = () => done(false);
  const key = (ev) => { if (ev.key === 'Escape') done(false); };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
  document.addEventListener('keydown', key);
  move(e);
}

/* ----- task details popup ----- */
function openTask(id) {
  if (!taskById(id)) return;
  S.sel = id;
  renderAll();
  let pending = false; // an empty predecessor row waiting for a choice
  const box = h('div', { class: 'td' });
  const ro = S.readonly;

  const fld = (label, ...kids) => h('div', { class: 'td-f' }, h('label', { text: label }), ...kids);
  const input = (k, value, extra) => {
    const el = h('input', Object.assign({ type: 'text', class: 'txt', 'data-k': k, value, autocomplete: 'off', spellcheck: 'false' }, extra || {}));
    return el;
  };

  function paint() {
    const t = taskById(id), r = S.res.get(id);
    if (!t || !r) { dlgApi.close(); return; }
    const act = document.activeElement && box.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    const tasks = S.work.tasks;
    const idx = tasks.findIndex((x) => x.id === id);
    const ms = t.kind === 'milestone';
    const locked = !!t.locked;
    box.textContent = '';

    const commit = (f) => (ev) => { onField(id, f, { value: ev.target.value, dataset: {} }); paint(); };

    /* name + kind */
    const name = input('name', t.name || '', { placeholder: 'Task name' });
    name.disabled = ro;
    name.addEventListener('change', commit('name'));
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Task type' },
      h('button', { type: 'button', title: 'An activity has a start, a duration and a finish.', class: ms ? '' : 'on', 'aria-pressed': String(!ms), disabled: ro, 'data-k': 'k-task', text: 'Activity', onclick: () => { if (ms) { onField(id, 'kind', { value: 'task' }); paint(); } } }),
      h('button', { type: 'button', title: 'A milestone is a single date with no duration, shown as a diamond.', class: ms ? 'on' : '', 'aria-pressed': String(ms), disabled: ro, 'data-k': 'k-ms', text: 'Milestone ◇', onclick: () => { if (!ms) { onField(id, 'kind', { value: 'milestone' }); paint(); } } }));
    const aud = h('select', { class: 'txt', disabled: ro, 'data-k': 'lvl', 'aria-label': 'Audience', title: 'Who sees this task in exports. Everyone sees every task while editing.' });
    for (const k of LEVELS) aud.append(h('option', { value: k, text: LEVEL_INFO[k].label + ' \u2014 ' + LEVEL_INFO[k].hint.toLowerCase() }));
    aud.value = t.lvl || 'client';
    aud.addEventListener('change', commit('lvl'));
    box.append(fld('Name', name), fld('Type', seg), fld('Audience', aud));
    if (S.work.execOn) {
      const clientLv = (t.lvl || 'client') === 'client';
      const ex = h('input', { type: 'checkbox', 'data-k': 'exec', disabled: ro || !clientLv, title: 'Include this task in the Executive view and export' });
      ex.checked = !!t.exec;
      ex.addEventListener('change', () => { onField(id, 'exec', { checked: ex.checked, value: '' }); paint(); });
      box.append(fld('Executive summary', h('label', { class: 'chk' }, ex, ' Show in the executive summary'),
        clientLv ? null : h('p', { class: 'muted td-note', text: 'Only Client-level tasks can appear in the executive summary.' })));
    }

    /* dates */
    const canStart = !ro && !locked && r.anchored;
    const dateRow = (k, val, enabled, label) => {
      const txt = input(k, fmtMed(val), { placeholder: 'e.g. 10/15', disabled: !enabled });
      txt.addEventListener('change', commit(k));
      const pick = h('input', { type: 'date', class: 'pickin', value: fmtISO(val), disabled: !enabled, tabindex: '-1', 'aria-label': label + ' from a calendar' });
      pick.addEventListener('change', (ev) => { if (ev.target.value) { onField(id, k, { value: ev.target.value, dataset: {} }); paint(); } });
      return h('div', { class: 'td-date' }, txt, h('span', { class: 'pick', title: 'Pick from a calendar', html: ICON.cal }, pick));
    };
    const startF = fld(ms ? 'Date' : 'Start', dateRow('start', r.start, canStart, 'Choose the start date'));
    box.append(startF);
    if (!canStart) {
      const why = locked ? 'Locked. Unlock it below to change the date.'
        : !r.anchored ? 'Set by predecessors. To control it, change a link or lag below.' : '';
      if (why) startF.append(h('p', { class: 'muted td-note', text: why }));
    }
    if (!ms) {
      const dur = input('dur', String(r.dur), { type: 'number', min: '1', disabled: ro || locked, title: 'Length in calendar days. Changing it moves the finish date and anything that follows.' });
      dur.classList.add('sm');
      dur.addEventListener('change', commit('dur'));
      box.append(
        h('div', { class: 'td-two' },
          fld('Duration (days)', dur),
          fld('Finish', dateRow('finish', r.finish, !ro && !locked, 'Choose the finish date'))));
    }
    if (r.held && !ro) {
      box.append(h('p', { class: 'td-note' }, 'Held: this task starts later than its predecessors require. ',
        h('button', { type: 'button', class: 'linkbtn', text: 'Release hold', onclick: () => { edit(() => { taskById(id).notBefore = null; }); paint(); } })));
    }
    for (const fl of r.flags) {
      box.append(h('p', { class: 'td-flag ' + fl.level, text: fl.text }));
    }

    /* lock */
    const lockBtn = h('button', { type: 'button', class: 'btn' + (locked ? ' on' : ''), 'aria-pressed': String(locked), disabled: ro, 'data-k': 'lock', title: locked ? 'Click to unlock this date so predecessors can move it again.' : 'Click to lock this date. Predecessors won\u2019t move it; a conflict is flagged instead.', onclick: () => { toggleLock(id); paint(); } },
      h('span', { html: ICON.lock }), ' ' + (locked ? 'Locked' : 'Lock date'));
    box.append(h('div', { class: 'td-f' }, h('label', { text: 'Date lock' }),
      h('div', { class: 'td-lock' }, lockBtn,
        h('span', { class: 'muted', text: locked ? 'This date won’t move when predecessors change; a conflict is flagged instead.' : 'Pin the date so predecessors can’t move it.' }))));

    /* predecessors */
    const succIds = new Set(tasks.filter((x) => (x.deps || []).some((d) => d.id === id)).map((x) => x.id));
    const used = new Set((t.deps || []).map((d) => d.id));
    const optsFor = (keep) => tasks.map((x, i) => ({ x, i })).filter(({ x }) =>
      x.id !== id && (x.id === keep || (!used.has(x.id) && !wouldCycle(tasks, id, [x.id]))));
    const dep = h('div');
    const depHead = h('div', { class: 'td-h' }, h('span', { text: 'Predecessors' }),
      h('button', { type: 'button', class: 'ib add', title: 'Add a predecessor', 'aria-label': 'Add a predecessor', disabled: ro || pending || !optsFor(null).length, 'data-k': 'add', html: ICON.plus, onclick: () => { pending = true; paint(); } }));
    dep.append(depHead);
    const list = h('div', { class: 'td-deps' });
    const typeSel = (cur, onchg) => {
      const s = h('select', { class: 'txt', disabled: ro, 'aria-label': 'Link type', title: 'Finish \u2192 start: begins after the predecessor finishes. Start \u2192 start: begins when it starts.' },
        h('option', { value: 'FS', text: 'Finish → start' }), h('option', { value: 'SS', text: 'Start → start' }));
      s.value = cur; s.addEventListener('change', onchg); return s;
    };
    (t.deps || []).forEach((d, di) => {
      const sel = h('select', { class: 'txt', disabled: ro, 'aria-label': 'Predecessor task', title: 'The task this one waits on', 'data-k': 'dep-' + di });
      for (const { x, i } of optsFor(d.id)) sel.append(h('option', { value: x.id, text: taskLabel(x, i) }));
      sel.value = d.id;
      sel.addEventListener('change', (ev) => { edit(() => { taskById(id).deps[di].id = ev.target.value; }); paint(); });
      const ts = typeSel(d.type, (ev) => { edit(() => { taskById(id).deps[di].type = ev.target.value; }); paint(); });
      const lag = h('input', { type: 'number', class: 'txt lag', value: d.lag || 0, disabled: ro, 'aria-label': 'Lag in days', title: 'Lag in days (negative = overlap)', 'data-k': 'lag-' + di });
      lag.addEventListener('change', (ev) => { const v = parseInt(ev.target.value, 10); edit(() => { taskById(id).deps[di].lag = isNaN(v) ? 0 : v; }); paint(); });
      const del = h('button', { type: 'button', class: 'ib del', title: 'Remove this predecessor', 'aria-label': 'Remove this predecessor', disabled: ro, html: ICON.minus,
        onclick: () => { edit(() => { taskById(id).deps.splice(di, 1); }); paint(); } });
      list.append(h('div', { class: 'td-dep' }, sel, ts, h('span', { class: 'lagw' }, lag, h('small', { text: 'd' })), del));
    });
    if (pending) {
      const sel = h('select', { class: 'txt', 'aria-label': 'Choose a predecessor', 'data-k': 'dep-new' }, h('option', { value: '', text: 'Choose a task…' }));
      for (const { x, i } of optsFor(null)) sel.append(h('option', { value: x.id, text: taskLabel(x, i) }));
      sel.addEventListener('change', (ev) => {
        if (!ev.target.value) return;
        const pid = ev.target.value;
        pending = false;
        edit(() => { (taskById(id).deps = taskById(id).deps || []).push({ id: pid, type: 'FS', lag: 0 }); });
        paint();
      });
      const cancel = h('button', { type: 'button', class: 'ib del', title: 'Cancel', 'aria-label': 'Cancel adding a predecessor', html: ICON.minus, onclick: () => { pending = false; paint(); } });
      list.append(h('div', { class: 'td-dep' }, sel, cancel));
    }
    if (!(t.deps || []).length && !pending) list.append(h('p', { class: 'muted td-note', text: 'None. This task starts on the date above.' }));
    dep.append(list);

    /* successors */
    if (succIds.size) {
      dep.append(h('div', { class: 'td-h' }, h('span', { text: 'Followed by' })));
      const sl = h('div', { class: 'td-deps' });
      tasks.forEach((x, i) => {
        const d = (x.deps || []).find((q) => q.id === id);
        if (!d) return;
        sl.append(h('div', { class: 'td-succ' },
          h('button', { type: 'button', class: 'linkbtn', title: 'Open this task', text: taskLabel(x, i), onclick: () => { dlgApi.close(); openTask(x.id); } }),
          h('span', { class: 'muted', text: (d.type === 'SS' ? 'start → start' : 'finish → start') + (d.lag ? ' ' + (d.lag > 0 ? '+' : '') + d.lag + 'd' : '') }),
          h('button', { type: 'button', class: 'ib del', title: 'Remove this link', 'aria-label': 'Remove the link to ' + (x.name || 'task'), disabled: ro, html: ICON.minus,
            onclick: () => { edit(() => { const y = taskById(x.id); y.deps = y.deps.filter((q) => q.id !== id); }); paint(); } })));
      });
      dep.append(sl);
    }
    if (S.detail) box.append(dep);
    else if ((t.deps || []).length) {
      const names = t.deps.map((d) => { const k = tasks.findIndex((x) => x.id === d.id); return k < 0 ? null : taskLabel(tasks[k], k); }).filter(Boolean);
      box.append(h('p', { class: 'muted td-note', text: 'Starts after: ' + names.join('; ') + '. Switch to Detailed view to change links.' }));
    }
    if (ro) box.append(h('p', { class: 'muted td-note', text: 'View-only: you can look but not change anything.' }));

    if (act) { const el = box.querySelector('[data-k="' + act + '"]'); if (el && !el.disabled) el.focus(); }
  }

  const actions = [];
  if (!ro) actions.push({ label: 'Delete task', title: 'Delete this task. Undo brings it back.', danger: true, run: () => { deleteTask(id); } });
  actions.push({ label: 'Done', title: 'Close. Changes are already applied.', primary: true });
  const dlgApi = openDialog({ title: 'Task details', body: box, actions, wide: true });
  paint();
}

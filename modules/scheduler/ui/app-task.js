/* ===== Timeline link dragging and the activity inspector ===== */

const LINK_NAME = { FS: 'finish-to-start', SS: 'start-to-start' };
const taskLabel = (t, i) => (i + 1) + '. ' + (t.name || 'Untitled');

/* Can `succ` be made to follow `pred`? Returns {ok, why}. */
function canLink(predId, succId) {
  if (predId === succId) return { ok: false, why: 'An activity can\u2019t follow itself' };
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
    const i = Math.floor(y / GROW);
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
    band.style.top = ti * GROW + 'px';
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


/* ----- the activity inspector: a panel beside the table or timeline that follows the selection ----- */
S.inspect = null;
S.inspectFocus = null;
S.pendingLink = false;
function openTask(id, opts) {
  if (!taskById(id)) return;
  opts = opts || {};
  const switching = S.inspect !== id;
  S.inspect = id;
  if (!opts.keep) { S.sel = id; S.multi = new Set(); }
  if (opts.focus) S.inspectFocus = opts.focus;
  if (switching) S.pendingLink = false;
  $('#inspector').hidden = false;
  renderAll();
}
function closeInspector() {
  if (!S.inspect && $('#inspector').hidden) return;
  S.inspect = null; S.pendingLink = false;
  const box = $('#inspector');
  box.hidden = true; box.textContent = ''; box.classList.remove('td');
  if (S.work && S.view !== 'table' && !$('#pageEditor').hidden) renderGantt();
}
function renderInspector() {
  const id = S.inspect, box = $('#inspector');
  const t = taskById(id), r = t && S.res.get(id);
  if (!t || !r) { closeInspector(); return; }
  const act = document.activeElement && box.contains(document.activeElement) ? document.activeElement.dataset.k : null;
  const ro = S.readonly;
  const tasks = S.work.tasks;
  const idx = tasks.findIndex((x) => x.id === id);
  const ms = t.kind === 'milestone', locked = !!t.locked;
  const commit = (f) => (ev) => { onField(id, f, { value: ev.target.value, dataset: {} }); };
  const input = (k, value, extra) => h('input', Object.assign({ type: 'text', class: 'txt', 'data-k': k, value, autocomplete: 'off', spellcheck: 'false' }, extra || {}));
  const fld = (label, ...kids) => h('div', { class: 'field' }, h('label', { text: label }), ...kids);
  const sec = (title, ...kids) => h('section', { class: 'dr-sec' }, h('h3', null, title), ...kids);
  box.textContent = '';

  /* head: number, name, close */
  const name = input('name', t.name || '', { placeholder: 'Activity name', disabled: ro, 'aria-label': 'Activity name' });
  name.addEventListener('change', commit('name'));
  box.append(h('div', { class: 'dr-head' }, h('span', { class: 'rn', text: '#' + (idx + 1) }), h('h2', null, name),
    h('button', { class: 'ib', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close details', html: ICON.x, onclick: closeInspector })));
  box.classList.add('td');
  const body = h('div', { class: 'dr-body' });

  /* type */
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Type' },
    h('button', { type: 'button', title: 'An activity has a start, a duration and a finish.', class: ms ? '' : 'on', 'aria-pressed': String(!ms), disabled: ro, 'data-k': 'k-task', text: 'Activity', onclick: () => { if (ms) onField(id, 'kind', { value: 'task' }); } }),
    h('button', { type: 'button', title: 'A milestone is a single date with no duration, shown as a diamond.', class: ms ? 'on' : '', 'aria-pressed': String(ms), disabled: ro, 'data-k': 'k-ms', html: icon('diamond', 13) + 'Milestone', onclick: () => { if (!ms) onField(id, 'kind', { value: 'milestone' }); } }));
  body.append(h('section', { class: 'dr-sec' }, seg));

  /* dates */
  const canStart = !ro && !locked && r.anchored;
  const dateRow = (k, val, enabled, label) => {
    const txt = input(k, fmtMed(val), { placeholder: 'e.g. 10/15', disabled: !enabled, 'aria-label': label });
    txt.addEventListener('change', commit(k));
    const pick = h('input', { type: 'date', class: 'pickin', value: fmtISO(val), disabled: !enabled, tabindex: '-1', 'aria-label': label + ' from a calendar' });
    pick.addEventListener('change', (ev) => { if (ev.target.value) onField(id, k, { value: ev.target.value, dataset: {} }); });
    return h('div', { class: 'td-date' }, txt, h('span', { class: 'pick', title: 'Pick from a calendar', html: ICON.cal }, pick));
  };
  const dates = sec('Dates');
  if (ms) dates.append(fld('Date', dateRow('start', r.start, canStart, 'Date')));
  else {
    const dur = input('dur', String(r.dur), { inputmode: 'numeric', disabled: ro || locked, title: 'Length in calendar days. Changing it moves the finish date and anything that follows.', 'aria-label': 'Duration in days', style: 'text-align:right;font-family:var(--f-cond);font-size:14.5px' });
    dur.addEventListener('change', commit('dur'));
    const weeks = r.dur % 7 === 0 ? ' (' + r.dur / 7 + ' wk)' : '';
    dates.append(h('div', { class: 'td-three' },
      fld('Start', dateRow('start', r.start, canStart, 'Start date')),
      fld('Days' + weeks, dur),
      fld('Finish', dateRow('finish', r.finish, !ro && !locked, 'Finish date'))));
  }
  if (!canStart && !ro) {
    const why = locked ? 'Locked. Unlock it below to change the date.' : !r.anchored ? 'The start follows its links (below). Type a later date in the Table to hold it.' : '';
    if (why) dates.append(h('p', { class: 'td-note', text: why }));
  }
  if (r.held && !ro) {
    dates.append(h('p', { class: 'td-note' }, 'Held: starts later than its links require (' + fmtShort(r.driven) + '). ',
      h('button', { type: 'button', class: 'linkbtn', text: 'Release the hold', onclick: () => { edit(() => { taskById(id).notBefore = null; }); } })));
  }
  for (const fl of r.flags) {
    dates.append(h('div', { class: 'td-flag ' + fl.level }, fl.text,
      fl.fix && !ro ? h('div', null, h('button', { class: 'btn sm', type: 'button', text: fl.fix.label, onclick: () => applyFix(id, fl.fix) })) : null));
  }
  body.append(dates);

  /* links, in plain words */
  const links = sec('Starts when');
  const succ = tasks.map((x, i) => ({ x, i, d: (x.deps || []).find((q) => q.id === id) })).filter((o) => o.d);
  const used = new Set((t.deps || []).map((d) => d.id));
  const optsFor = (keep) => tasks.map((x, i) => ({ x, i })).filter(({ x }) => x.id !== id && (x.id === keep || (!used.has(x.id) && !wouldCycle(tasks, id, [x.id]))));
  if (S.detail) {
    if (!ro) links.querySelector('h3').append(h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn sm quiet', title: 'Make this activity wait for another one', 'aria-label': 'Add a link', disabled: S.pendingLink || !optsFor(null).length, 'data-k': 'add', html: icon('plus', 14) + 'Add a link', onclick: () => { S.pendingLink = true; renderInspector(); } }));
    const list = h('div', { class: 'td-deps', style: 'display:flex;flex-direction:column;gap:6px' });
    (t.deps || []).forEach((d, di) => {
      const sel = h('select', { class: 'txt', disabled: ro, 'aria-label': 'Activity this one waits on', 'data-k': 'dep-' + di });
      for (const { x, i } of optsFor(d.id)) sel.append(h('option', { value: x.id, text: taskLabel(x, i) }));
      sel.value = d.id;
      sel.addEventListener('change', (ev) => { edit(() => { taskById(id).deps[di].id = ev.target.value; }); });
      const ts = h('select', { class: 'txt', disabled: ro, 'aria-label': 'Finishes or starts', title: 'finishes: this activity starts after it finishes. starts: this activity starts when it starts.' },
        h('option', { value: 'FS', text: 'finishes' }), h('option', { value: 'SS', text: 'starts' }));
      ts.value = d.type;
      ts.addEventListener('change', (ev) => { edit(() => { taskById(id).deps[di].type = ev.target.value; }); });
      const lag = h('input', { type: 'text', inputmode: 'numeric', class: 'txt lag lagin', value: d.lag || 0, disabled: ro, 'aria-label': 'Days to wait (negative to overlap)', title: 'Days to wait after that. Use a negative number to overlap.', 'data-k': 'lag-' + di });
      lag.addEventListener('change', (ev) => { const v = parseInt(ev.target.value, 10); edit(() => { taskById(id).deps[di].lag = isNaN(v) ? 0 : v; }); });
      const del = h('button', { type: 'button', class: 'ib del', title: 'Remove this link', 'aria-label': 'Remove this link', disabled: ro, html: ICON.minus,
        onclick: () => { edit(() => { taskById(id).deps.splice(di, 1); }); } });
      list.append(h('div', { class: 'td-dep rel' }, h('span', { text: 'After' }), sel, ts, h('span', { text: '+' }), lag, h('span', { text: 'days' }), del));
    });
    if (S.pendingLink) {
      const sel = h('select', { class: 'txt', 'aria-label': 'Choose the activity this one waits on', 'data-k': 'dep-new' }, h('option', { value: '', text: 'Choose an activity…' }));
      for (const { x, i } of optsFor(null)) sel.append(h('option', { value: x.id, text: taskLabel(x, i) }));
      sel.addEventListener('change', (ev) => {
        if (!ev.target.value) return;
        const pid = ev.target.value;
        S.pendingLink = false;
        edit(() => { (taskById(id).deps = taskById(id).deps || []).push({ id: pid, type: 'FS', lag: 0 }); });
      });
      const cancel = h('button', { type: 'button', class: 'ib del', title: 'Cancel', 'aria-label': 'Cancel adding a link', html: ICON.minus, onclick: () => { S.pendingLink = false; renderInspector(); } });
      list.append(h('div', { class: 'td-dep rel new' }, h('span', { text: 'Start this activity when' }), sel, h('span', { text: 'finishes' }), cancel));
    }
    if (!(t.deps || []).length && !S.pendingLink) list.append(h('p', { class: 'td-note', text: 'On the date above. It doesn’t wait for anything. Add a link to make it start when another activity finishes, for example “start this when Schematic Design finishes”.' }));
    links.append(list);
    if (succ.length) {
      links.append(h('h3', { style: 'margin-top:6px', text: 'Followed by' }));
      for (const { x, i, d } of succ) {
        links.append(h('div', { class: 'succ' },
          h('button', { type: 'button', class: 'linkbtn', title: 'Open this activity', text: taskLabel(x, i), onclick: () => openTask(x.id) }),
          h('span', { class: 'muted', text: (d.type === 'SS' ? 'starts when this starts' : 'starts after this finishes') + (d.lag ? ' ' + (d.lag > 0 ? '+' : '') + d.lag + 'd' : '') }),
          h('button', { type: 'button', class: 'ib del', title: 'Remove this link', 'aria-label': 'Remove the link to ' + (x.name || 'activity'), disabled: ro, html: ICON.minus,
            onclick: () => { edit(() => { const y = taskById(x.id); y.deps = y.deps.filter((q) => q.id !== id); }); } })));
      }
    }
  } else {
    const names = (t.deps || []).map((d) => { const k = tasks.findIndex((x) => x.id === d.id); return k < 0 ? null : taskLabel(tasks[k], k) + (d.type === 'SS' ? ' (starts)' : ''); }).filter(Boolean);
    links.append(h('p', { class: 'td-note', text: names.length ? 'Starts after: ' + names.join('; ') + '. Switch to Detailed view to change links.' : 'On the date above. It doesn’t wait for anything. Switch to Detailed view to link it to another activity.' }));
    if (!ro) links.append(h('div', null, h('button', { class: 'btn sm', type: 'button', html: icon('link', 14) + 'Show link tools', title: 'Turn on Detailed view: link handles in the timeline and plain-language links here', onclick: () => { S.detail = true; pref('sched.detail', '1'); renderAll(); } })));
  }
  body.append(links);

  /* templates have no commitments or locks: instead, whether the new-schedule wizard asks for this length */
  if (S.tpl) {
    if (!ms) {
      const ph = h('input', { type: 'checkbox', 'data-k': 'tplphase', disabled: ro });
      ph.checked = tplPhaseOn(id);
      ph.addEventListener('change', () => setTplPhase(id, ph.checked));
      body.append(sec('New-schedule wizard', h('label', { class: 'chk' }, ph, ' Ask for this length, in weeks, when someone makes a schedule from this template'),
        h('p', { class: 'td-note', text: 'Use it for the main phases people usually adjust. Everything linked after it moves with it.' })));
    }
  }
  /* commitment */
  const cm = sec('Commitment');
  const cs = commitStatus(t, r, S.work.commitWarn);
  const setCommit = (c) => edit(() => { taskById(id).commit = normCommit(c); });
  if (!t.commit && S.inspectFocus !== 'commit') {
    cm.append(h('p', { class: 'td-note', text: 'A date the team has promised: a contract, owner or agency date. It never moves the schedule; the forecast is compared with it.' }));
    if (!ro) cm.append(h('div', null, h('button', { class: 'btn sm', type: 'button', 'data-k': 'cmt-add', html: icon('flag', 14) + 'Add a committed date', onclick: () => { S.inspectFocus = 'commit'; renderInspector(); } })));
  } else {
    const cdate = input('cmt-date', t.commit ? fmtMed(parseDate(t.commit.date)) : '', { placeholder: 'e.g. 12/15/27', disabled: ro, 'aria-label': 'Committed date' });
    cdate.addEventListener('change', () => {
      if (!cdate.value.trim()) { setCommit(null); return; }
      const n = parseTyped(cdate.value, t.commit ? parseDate(t.commit.date) : (ms ? r.start : r.finish), todayDay());
      if (isNaN(n)) { toast(BAD_DATE); renderInspector(); return; }
      setCommit({ date: fmtISO(n), note: t.commit ? t.commit.note : '' });
    });
    const cnote = input('cmt-note', t.commit ? t.commit.note : '', { placeholder: 'e.g. Contract substantial completion', disabled: ro || !t.commit, maxlength: '80', 'aria-label': 'What the commitment is' });
    cnote.addEventListener('change', () => { if (t.commit) setCommit({ date: t.commit.date, note: cnote.value }); });
    cm.append(h('div', { class: 'td-two' }, fld(ms ? 'Committed date' : 'Finish by', cdate), fld('What it is', cnote)));
    if (cs) {
      cm.append(h('div', { class: 'cm-status ' + cs.status }, h('strong', { text: COMMIT_WORD[cs.status] }),
        h('span', { text: commitText(cs) + '. Forecast ' + fmtShort(cs.forecast) + ', committed ' + fmtShort(parseDate(cs.date)) + '.' })));
      if (S.work.commitWarn) cm.append(h('p', { class: 'td-note', text: 'At risk means less than ' + S.work.commitWarn + ' days of margin (Settings).' }));
      if (!ro) cm.append(h('div', null, h('button', { class: 'btn sm quiet', type: 'button', text: 'Remove the commitment', onclick: () => { S.inspectFocus = null; setCommit(null); } })));
    } else cm.append(h('p', { class: 'td-note', text: 'Type the date to protect. Leave it empty to cancel.' }));
  }
  if (!S.tpl) body.append(cm);

  /* who sees it */
  const vis = sec('Who sees it');
  const aud = h('select', { class: 'txt', disabled: ro, 'data-k': 'lvl', 'aria-label': 'Audience', title: 'Who sees this activity in exports. Everyone sees everything while editing.' });
  for (const k of LEVELS) aud.append(h('option', { value: k, text: LEVEL_INFO[k].label + ' — ' + LEVEL_INFO[k].hint.toLowerCase() }));
  aud.value = t.lvl || 'client';
  aud.addEventListener('change', commit('lvl'));
  vis.append(fld('Audience', aud));
  if (S.work.execOn) {
    const clientLv = (t.lvl || 'client') === 'client';
    const ex = h('input', { type: 'checkbox', 'data-k': 'exec', disabled: ro || !clientLv, title: 'Include this activity in the Executive view and export' });
    ex.checked = !!t.exec;
    ex.addEventListener('change', () => { onField(id, 'exec', { checked: ex.checked, value: '' }); });
    vis.append(h('label', { class: 'chk' }, ex, ' Show in the executive overview'),
      clientLv ? null : h('p', { class: 'td-note', text: 'Only Client-level activities can appear in the executive overview.' }));
  }
  body.append(vis);

  /* lock */
  const lk = sec('Date lock');
  const lockBtn = h('button', { type: 'button', class: 'btn sm' + (locked ? ' on' : ''), 'aria-pressed': String(locked), disabled: ro, 'data-k': 'lock', title: locked ? 'Click to unlock this date so its links can move it again.' : 'Click to lock this date. Its links won’t move it; a conflict is flagged instead.', onclick: () => { toggleLock(id); } },
    h('span', { html: icon(locked ? 'lock' : 'lock-open', 14) }), locked ? 'Locked' : 'Lock date');
  lk.append(h('div', { class: 'td-lock' }, lockBtn, h('span', { class: 'td-note', text: locked ? 'This date won’t move when its links change. If they need a later date, an issue is flagged instead.' : 'Pin the date, for example an owner meeting that can’t move.' })));
  if (!S.tpl) body.append(lk);
  if (ro) body.append(h('p', { class: 'td-note', style: 'padding-top:12px', text: 'View only: you can look but not change anything.' }));
  box.append(body);

  const foot = h('div', { class: 'dr-foot' });
  if (!ro) foot.append(h('button', { class: 'btn sm quiet', type: 'button', html: ICON.del + 'Delete activity', title: 'Delete this activity. Undo brings it back.', onclick: () => { closeInspector(); deleteTask(id); } }));
  foot.append(h('span', { class: 'grow' }), h('button', { class: 'btn sm primary', type: 'button', text: 'Done', title: 'Close. Changes are already applied; Save keeps them.', onclick: closeInspector }));
  box.append(foot);

  const want = act || (S.inspectFocus === 'commit' ? 'cmt-date' : null);
  if (S.inspectFocus === 'commit' && !act) S.inspectFocus = t.commit ? null : 'commit';
  if (want) { const el = box.querySelector('[data-k="' + want + '"]'); if (el && !el.disabled) el.focus(); }
}

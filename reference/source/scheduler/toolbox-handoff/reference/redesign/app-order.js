/* ===== Multi-select and drag to reorder rows ===== */

S.multi = new Set();
S.anchor = null;
const multiOn = () => S.multi.size > 1 && S.sel != null && S.multi.has(S.sel);
function selIds() {
  if (!S.work) return [];
  const live = new Set(S.work.tasks.map((t) => t.id));
  const ids = multiOn() ? S.work.tasks.filter((t) => S.multi.has(t.id)).map((t) => t.id) : S.sel ? [S.sel] : [];
  return ids.filter((id) => live.has(id));
}
const isSel = (id) => selIds().includes(id);

/* Click selection. Shift = range from the last plain click, Ctrl/Cmd = add or remove one. */
function clickSelect(id, e, opts) {
  const tasks = S.work.tasks;
  const mod = e && (e.ctrlKey || e.metaKey), shift = e && e.shiftKey;
  if (shift && S.anchor && tasks.some((t) => t.id === S.anchor)) {
    const a = tasks.findIndex((t) => t.id === S.anchor), b = tasks.findIndex((t) => t.id === id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    S.multi = new Set(tasks.slice(lo, hi + 1).map((t) => t.id));
    S.sel = id;
  } else if (mod) {
    const cur = new Set(selIds());
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    S.multi = cur;
    S.sel = cur.has(id) ? id : [...cur].pop() || null;
    S.anchor = id;
  } else {
    const was = !multiOn() && S.sel === id;
    S.multi = new Set();
    S.sel = opts && opts.toggle && was ? null : id;
    S.anchor = id;
  }
}

/* Move the given tasks, in their current order, to sit just before `beforeId` (null = the end). */
function moveTasksBefore(ids, beforeId) {
  const set = new Set(ids);
  const tasks = S.work.tasks;
  const moving = tasks.filter((t) => set.has(t.id));
  const rest = tasks.filter((t) => !set.has(t.id));
  let at = beforeId ? rest.findIndex((t) => t.id === beforeId) : rest.length;
  if (at < 0) at = rest.length;
  const next = rest.slice(0, at).concat(moving, rest.slice(at));
  if (next.every((t, i) => t === tasks[i])) return false;
  edit(() => { S.work.tasks = next; });
  return true;
}

/* Drag rows by their number (table) or label (Gantt). `rowsOf()` gives the visible rows in order. */
function startRowDrag(e, id, rowsOf) {
  if (S.readonly || !S.work || (e.pointerType && e.pointerType !== 'mouse') || (e.button != null && e.button > 0)) return;
  if (e.shiftKey || e.ctrlKey || e.metaKey) return; // those are selection clicks
  const x0 = e.clientX, y0 = e.clientY;
  let started = false, ids = null, line = null, lastY = y0, raf = 0, before = null;
  const begin = () => {
    started = true;
    if (!isSel(id)) { clickSelect(id, null); markSel(); }
    ids = selIds();
    line = h('div', { class: 'rowdrop' });
    document.body.append(line);
    document.body.classList.add('row-dragging');
    for (const r of rowsOf()) if (ids.includes(r.id)) r.el.classList.add('dragging');
    const tick = () => {
      if (!started) return;
      if (lastY < 56) window.scrollBy(0, -14); else if (lastY > window.innerHeight - 56) window.scrollBy(0, 14);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  const place = (y) => {
    const rows = rowsOf().filter((r) => !ids.includes(r.id));
    if (!rows.length) { line.style.display = 'none'; before = undefined; return; }
    let target = null;
    for (const r of rows) { const b = r.el.getBoundingClientRect(); if (y < b.top + b.height / 2) { target = r; break; } }
    const ref = target ? target.el.getBoundingClientRect() : rows[rows.length - 1].el.getBoundingClientRect();
    const box = rows[0].el.closest('table, .tl-list').getBoundingClientRect();
    line.style.display = 'block';
    line.style.left = box.left + 'px'; line.style.width = box.width + 'px';
    line.style.top = (target ? ref.top : ref.bottom) - 1 + 'px';
    before = target ? target.id : null;
  };
  const move = (ev) => {
    lastY = ev.clientY;
    if (!started) { if (Math.abs(ev.clientY - y0) < 5 && Math.abs(ev.clientX - x0) < 5) return; begin(); }
    place(ev.clientY);
  };
  const end = (commit) => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel);
    document.removeEventListener('keydown', key);
    cancelAnimationFrame(raf);
    if (!started) return;
    document.body.classList.remove('row-dragging');
    if (line) line.remove();
    for (const r of rowsOf()) r.el.classList.remove('dragging');
    S.suppressClick = true; setTimeout(() => { S.suppressClick = false; }, 0); // the release is not a click
    if (commit && before !== undefined) { if (!moveTasksBefore(ids, before)) renderAll(); } else renderAll();
  };
  const up = (ev) => { if (started) place(ev.clientY); end(true); };
  const cancel = () => end(false);
  const key = (ev) => { if (ev.key === 'Escape') end(false); };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
  document.addEventListener('keydown', key);
}
const tableRowsOf = () => $$('#tbody tr').filter((tr) => !tr.hidden).map((tr) => ({ id: tr.dataset.id, el: tr }));
const labelRowsOf = () => $$('.grl').map((el) => ({ id: el.dataset.id, el }));

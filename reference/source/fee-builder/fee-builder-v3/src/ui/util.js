/* Fee Builder UI helpers: escaping, formatting, icons, and id-based paths into a proposal. */
(function (root) {
  'use strict';
  const FB = root.FB || (root.FB = {});
  const { num, has, parse } = FB.money;

  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function money(v, opts) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    const d = opts && opts.dec ? opts.dec : 0;
    const a = Math.abs(v);
    const s = a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    const sign = v < 0 && Math.round(a * Math.pow(10, d)) !== 0 ? '−' : '';
    return sign + '$' + s;
  }
  function moneyShort(v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    const a = Math.abs(v), sign = v < 0 ? '−' : '';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e4) return sign + '$' + Math.round(a / 1e3) + 'k';
    return money(v);
  }
  function pct(v, d) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return (Math.round(v * Math.pow(10, d === undefined ? 2 : d)) / Math.pow(10, d === undefined ? 2 : d)).toFixed(d === undefined ? 2 : d) + '%';
  }
  function numf(v, d) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d === undefined ? 1 : d });
  }
  function signed(v, fmt) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    if (Math.abs(v) < 0.5 && fmt === money) return '$0';
    return (v > 0 ? '+' : '') + (fmt || money)(v).replace(/^−/, '−');
  }
  /** Display text for a stored editable value. */
  function fieldText(v, kind) {
    if (!has(v)) return '';
    const n = num(v);
    if (kind === 'money') return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (kind === 'int') return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (kind === 'dec2') return String(Math.round(n * 100) / 100);
    return String(Math.round(n * 1e6) / 1e6);
  }

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    starFill: '<path fill="currentColor" d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    table: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M10 10v9"/>',
    balance: '<path d="M12 4v16M6 8h12M4 14l2-6 2 6a2 2 0 0 1-4 0zM16 14l2-6 2 6a2 2 0 0 1-4 0z"/>',
    flask: '<path d="M9 3h6M10 3v6L4.5 18a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9V3"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".5"/>',
    snap: '<path d="M5 4h14v16l-7-4-7 4z"/>',
    file: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z"/><path d="M14 3v4h4"/>'
  };
  const icon = (name, cls) => `<svg class="i ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  /*
   * Paths address values inside a proposal by id, so they stay valid when arrays reorder:
   *   "name"                                   proposal.name
   *   "packages#k1.cost"                       proposal.packages[id=k1].cost
   *   "scenarios#s1.pkgs.k1.components#c1.pct" nested by id and by object key
   */
  function walk(obj, path, create) {
    const segs = path.split('.');
    let o = obj;
    for (let i = 0; i < segs.length - 1; i++) {
      o = step(o, segs[i], create);
      if (o === undefined || o === null) return null;
    }
    return { parent: o, key: segs[segs.length - 1] };
  }
  function step(o, seg, create) {
    const h = seg.indexOf('#');
    if (h < 0) {
      if (o[seg] === undefined && create) o[seg] = {};
      return o[seg];
    }
    const name = seg.slice(0, h), id = seg.slice(h + 1);
    const arr = name ? o[name] : o;
    if (!Array.isArray(arr)) return undefined;
    return arr.find(x => x && x.id === id);
  }
  function getAt(obj, path) {
    const w = walk(obj, path);
    if (!w) return undefined;
    const last = w.key;
    if (last.indexOf('#') >= 0) return step(w.parent, last);
    return w.parent[last];
  }
  function setAt(obj, path, value) {
    const w = walk(obj, path, true);
    if (!w) return false;
    w.parent[w.key] = value;
    return true;
  }

  /** Parse what the user typed into an editable field. */
  function readInput(el) {
    const t = el.dataset.t;
    if (t === 'bool') return el.type === 'checkbox' ? el.checked : el.value === 'true';
    if (t === 'text' || t === 'sel') return el.value;
    if (t === 'month') return el.value;
    if (t === 'covers') return el.value;
    return parse(el.value);
  }

  FB.ui = FB.ui || {};
  Object.assign(FB.ui, { esc, money, moneyShort, pct, numf, signed, fieldText, icon, getAt, setAt, readInput });
})(typeof globalThis !== 'undefined' ? globalThis : this);

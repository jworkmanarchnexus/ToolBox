/*
 * Fee Builder views. Each function returns HTML for one region from a context:
 *   ctx = { st, S, p, sc, res, settings, O }
 * O is the flat table of calculated outputs (key -> display text). Calculated cells are
 * <span data-o="key">, so typing only repaints numbers and never re-renders inputs.
 * No calculations happen here: every number comes from the engine result.
 */
(function (root) {
  'use strict';
  const FB = root.FB || (root.FB = {});
  const U = FB.ui;
  const { esc, money, pct, numf, icon, fieldText, signed } = U;
  const { num, has } = FB.money;

  /* ================================================================ field helpers */

  const fid = path => 'f_' + path.replace(/[^a-zA-Z0-9]/g, '_');
  function nf(path, value, o) {
    o = o || {};
    const kind = o.kind || 'num';
    const ph = o.ph === undefined ? '' : o.ph;
    const unit = o.unit ? `<span class="u">${esc(o.unit)}</span>` : '';
    const pre = o.pre ? `<span class="u">${esc(o.pre)}</span>` : '';
    const grid = o.grid ? ` data-g="${esc(o.grid)}"` : '';
    const input = `<input class="f n ${o.cls || ''}" type="text" inputmode="decimal" id="${fid(path)}" data-f="${esc(path)}" data-t="num" data-k="${kind}" value="${esc(fieldText(value, kind))}" placeholder="${esc(ph)}" aria-label="${esc(o.aria || '')}" autocomplete="off"${grid}${o.r ? ' data-r="1"' : ''}>`;
    return pre || unit ? `<span class="wrap-unit">${pre}${input}${unit}</span>` : input;
  }
  function tf(path, value, o) {
    o = o || {};
    return `<input class="f t ${o.cls || ''}" type="text" id="${fid(path)}" data-f="${esc(path)}" data-t="text" value="${esc(value)}" placeholder="${esc(o.ph || '')}" aria-label="${esc(o.aria || '')}" autocomplete="off"${o.r ? ' data-r="1"' : ''}>`;
  }
  function sel(path, value, options, o) {
    o = o || {};
    return `<select id="${fid(path)}" data-f="${esc(path)}" data-t="sel" data-r="1" aria-label="${esc(o.aria || '')}"${o.cls ? ` class="${o.cls}"` : ''}>${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  }
  function chk(path, value, label, o) {
    o = o || {};
    return `<label class="chk"><input type="checkbox" id="${fid(path)}" data-f="${esc(path)}" data-t="bool" data-r="1"${value ? ' checked' : ''} aria-label="${esc(o.aria || label)}">${label ? `<span>${esc(label)}</span>` : ''}</label>`;
  }
  const out = (ctx, key, cls) => `<span class="calc ${cls || ''}" data-o="${esc(key)}">${esc(ctx.O[key] === undefined ? '—' : ctx.O[key])}</span>`;
  const sec = (title, body, o) => {
    o = o || {};
    return `<section class="sec" ${o.id ? `id="${o.id}"` : ''}><header><h2>${esc(title)}</h2>${o.right || ''}</header>${o.hint ? `<p class="lead">${o.hint}</p>` : ''}${body}</section>`;
  };
  const scopeShared = '<span class="scope">Shared by all scenarios</span>';
  const scopeScen = ctx => `<span class="scope sc">Scenario: ${esc(ctx.sc.name)}</span>`;
  const btn = (act, label, o) => {
    o = o || {};
    const data = Object.entries(o.data || {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
    return `<button class="btn ${o.cls || ''}" data-a="${act}"${data}${o.disabled ? ' disabled' : ''}${o.title ? ` title="${esc(o.title)}"` : ''}>${o.icon ? icon(o.icon) : ''}${esc(label)}</button>`;
  };
  const ibtn = (act, ic, label, o) => {
    o = o || {};
    const data = Object.entries(o.data || {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
    return `<button class="ib ${o.cls || ''}" data-a="${act}"${data} aria-label="${esc(label)}" title="${esc(label)}"${o.disabled ? ' disabled' : ''}>${icon(ic)}</button>`;
  };
  const scPath = ctx => 'scenarios#' + ctx.sc.id;
  const pkPath = (ctx, k) => scPath(ctx) + '.pkgs.' + k;

  const METHOD_LABEL = { pctCost: '% of construction cost', fixed: 'Lump sum', area: 'Area × rate', unit: 'Units × rate', labor: 'Labor hours × rates' };
  const CONS_TYPE = [['fixed', 'Fixed $ in fee'], ['quote', 'Consultant quote (cost)'], ['pctCost', '% of construction cost'], ['pctFee', '% of design fee']];
  const TREAT = [['included', 'Included in design fee'], ['additional', 'Additional to design fee']];
  const ITEM_KINDS = [['service', 'Service'], ['reimbursable', 'Reimbursable'], ['contingency', 'Contingency'], ['adjustment', 'Adjustment'], ['expense', 'Expense']];
  const ITEM_METHODS = [['fixed', 'Fixed amount'], ['hours', 'Hours × rate'], ['pctFee', '% of fee'], ['pctCost', '% of construction'], ['area', 'Area × rate'], ['unit', 'Units × rate']];

  /* ================================================================ outputs table */

  function buildOutputs(p, sc, res, S) {
    const O = {};
    if (!res) return O;
    const P = res.present;
    const m = v => money(v);
    O['sum.fee'] = m(P.clientFee);
    O['sum.feeExact'] = m(res.clientFee);
    O['sum.pctCost'] = res.feePctOfCost === null ? 'No construction cost' : pct(res.feePctOfCost) + ' of construction';
    O['sum.psf'] = res.feePerSf === null ? '' : money(res.feePerSf, { dec: 2 }) + ' / SF';
    O['sum.design'] = m(P.design); O['sum.arch'] = m(P.arch); O['sum.cons'] = m(res.consultantClient);
    O['sum.basic'] = m(P.basic); O['sum.items'] = m(P.itemsClient);
    O['sum.net'] = m(res.netRevenue); O['sum.tp'] = m(res.targetProfit); O['sum.allow'] = m(res.effortAllowance);
    O['sum.plan'] = res.hasPlan ? m(res.plannedEffort) : 'No plan';
    O['sum.headroom'] = res.hasPlan ? signed(res.effortHeadroom) : '—';
    O['sum.margin'] = res.detailed ? pct(res.detailed.margin * 100, 1) : 'Not set up';
    O['sum.consShare'] = res.consultantSharePct === null ? '—' : pct(res.consultantSharePct, 1);
    O['sum.designPct'] = res.designPctOfCost === null ? '—' : pct(res.designPctOfCost);
    O['sum.hours'] = res.hasPlan ? numf(res.plannedHours, 0) + ' h' : '—';
    O['sum.fteMonths'] = res.effortFteMonths === null ? '—' : numf(res.effortFteMonths, 1);
    res.pkgs.forEach((k, i) => {
      const pk = P.packages[i];
      const b = 'k.' + k.pkgId + '.';
      O[b + 'design'] = m(pk.design); O[b + 'arch'] = m(pk.arch); O[b + 'incl'] = m(pk.included); O[b + 'add'] = m(pk.additional); O[b + 'basic'] = m(pk.basic);
      O[b + 'cost'] = m(k.metrics.cost); O[b + 'area'] = numf(k.metrics.area, 0) + ' SF'; O[b + 'units'] = numf(k.metrics.units, 0);
      O[b + 'designPct'] = k.metrics.cost > 0 ? pct(k.design / k.metrics.cost * 100) : '—';
      O[b + 'archShare'] = k.design ? pct(k.arch / k.design * 100, 1) : '—';
      k.comps.forEach(c => { O[b + 'comp.' + c.id] = m(c.amount); });
      k.cons.forEach(c => {
        O[b + 'cons.' + c.id + '.client'] = m(pk.col(c.id));
        O[b + 'cons.' + c.id + '.cost'] = m(c.cost);
        O[b + 'cons.' + c.id + '.markup'] = m(c.client - c.cost);
        O[b + 'cons.' + c.id + '.share'] = k.design ? pct(c.client / k.design * 100, 1) : '—';
      });
      // allocation editor
      const pctTotal = k.pctSum;
      O[b + 'allocPct'] = pctTotal === null ? 'Mixed' : pct(pctTotal, 2);
      O[b + 'unalloc'] = m(k.compUnalloc);
      O[b + 'allocated'] = m(k.allocatedComp);
      p.phases.forEach((ph, j) => {
        O[b + 'ph.' + ph.id + '.fee'] = m(pk.rowTotals[j]);
        O[b + 'ph.' + ph.id + '.design'] = m(k.designByPhase[ph.id]);
        O[b + 'ph.' + ph.id + '.comp'] = m(k.compByPhase[ph.id]);
      });
      // labor
      const L = k.labor;
      O[b + 'lab.hours'] = numf(L.hours, 0); O[b + 'lab.value'] = m(L.value);
      L.rows.forEach(r => { O[b + 'lab.r.' + r.id + '.hours'] = numf(r.hours, 1); O[b + 'lab.r.' + r.id + '.value'] = m(r.value); O[b + 'lab.r.' + r.id + '.rate'] = r.billRate ? money(r.billRate) + '/h' : 'No rate'; });
      p.phases.forEach(ph => {
        const bp = L.byPhase[ph.id];
        const months = res.schedule.byId[ph.id].months;
        O[b + 'lab.ph.' + ph.id + '.hours'] = numf(bp.hours, 0);
        O[b + 'lab.ph.' + ph.id + '.value'] = m(bp.value);
        O[b + 'lab.ph.' + ph.id + '.fte'] = months > 0 ? numf(bp.hours / (months * (res.settingsUsed.hoursPerFteMonth || 173.33)), 2) : '—';
      });
      // matrix (package)
      matrixOutputs(O, 'm.' + k.pkgId, pk.rows.map(r => r.key), pk.cols.map(c => c.key), pk.cells, pk.rowTotals, pk.colTotals, pk.total, S.matrixMode);
    });
    const PP = P.project;
    matrixOutputs(O, 'm.all', PP.rowKeys, PP.colKeys, PP.cells, PP.rowTotals, PP.colTotals, PP.total, S.matrixMode);
    res.items.forEach((r, i) => {
      const pi = P.items[i];
      O['it.' + r.id + '.client'] = r.treatment === 'add' ? signed(pi.client) : (r.treatment === 'included' ? 'In fee' : 'Internal');
      O['it.' + r.id + '.amount'] = m(pi.amount);
    });
    // phases (finance)
    res.phases.forEach(x => {
      const b = 'ph.' + x.phaseId + '.';
      O[b + 'months'] = x.months ? numf(x.months, 2) : '—';
      O[b + 'net'] = m(x.netRevenue); O[b + 'allow'] = x.allowance === null ? '—' : m(x.allowance);
      O[b + 'ftem'] = x.allowanceFteMonths === null ? '—' : numf(x.allowanceFteMonths, 2);
      O[b + 'fte'] = x.allowanceFte === null ? '—' : numf(x.allowanceFte, 2);
      O[b + 'plan'] = res.hasPlan ? m(x.laborValue) : '—';
      O[b + 'pfte'] = x.plannedFte === null || !res.hasPlan ? '—' : numf(x.plannedFte, 2);
      O[b + 'head'] = res.hasPlan && x.headroom !== null ? signed(x.headroom) : '—';
      O[b + 'basic'] = m(x.basic);
    });
    O['fin.consCost'] = m(res.consultantCost); O['fin.pass'] = m(res.passCost); O['fin.held'] = m(res.heldContingency); O['fin.reserves'] = m(res.reserves);
    O['fin.tpLabel'] = res.targetProfitPct + '% of ' + (res.targetProfitBasis === 'netRevenue' ? 'net revenue' : 'client fee');
    O['fin.vpf'] = money(res.settingsUsed.valuePerFteMonth);
    return O;
  }

  function matrixOutputs(O, base, rowKeys, colKeys, cells, rowTotals, colTotals, total, mode) {
    const f = (v, rt, ct) => {
      if (mode === 'col') return ct ? pct(v / ct * 100, 1) : '—';
      if (mode === 'row') return rt ? pct(v / rt * 100, 1) : '—';
      return money(v);
    };
    rowKeys.forEach((rk, i) => {
      colKeys.forEach((ck, j) => { O[base + '.' + rk + '.' + ck] = f(cells[i][j], rowTotals[i], colTotals[j]); O[base + '.$.' + rk + '.' + ck] = money(cells[i][j]); });
      O[base + '.rt.' + rk] = mode === 'col' ? (total ? pct(rowTotals[i] / total * 100, 1) : '—') : mode === 'row' ? '100.0%' : money(rowTotals[i]);
    });
    colKeys.forEach((ck, j) => { O[base + '.ct.' + ck] = mode === 'col' ? '100.0%' : mode === 'row' ? (total ? pct(colTotals[j] / total * 100, 1) : '—') : money(colTotals[j]); });
    O[base + '.total'] = mode ? '100.0%' : money(total);
    if (!mode || mode === '$') O[base + '.total'] = money(total);
  }

  /* ================================================================ app shell */

  /* The Toolbox navigation registry. One entry per tool; the shell reads it. Fee Builder is the current tool.
     Other tools are separate pages, so they open in a new tab. Replace the hrefs with the Toolbox routes when
     the tools move behind toolbox.archnexus.com. */
  const TOOLBOX_TOOLS = [
    { id: 'fees', name: 'Fee Builder', icon: 'calc', blurb: 'Develop, test, and finalize proposal fees', current: true },
    { id: 'scheduler', name: 'Scheduler', icon: 'gantt', blurb: 'Project schedules that recalculate themselves', href: 'https://claude.ai/artifact/WC4qkhRUTpP2QRB6JanJjY' },
    { id: 'minutes', name: 'Minutes', icon: 'minutes', blurb: 'Agendas, minutes, and action items', href: 'https://claude.ai/artifact/EwFx6QfBsG7gSYsmR2c3Eq' }
  ];
  const TB_ICONS = {
    calc: '<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
    gantt: '<path d="M10 6h8"/><path d="M12 16h6"/><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 11h7"/>',
    minutes: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
    menu: '<path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/>',
    close: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>',
    open: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>',
    ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    chev: '<path d="m9 18 6-6-6-6"/>'
  };
  const tbIcon = (n, size) => `<svg class="ico-svg" viewBox="0 0 24 24" width="${size || 16}" height="${size || 16}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TB_ICONS[n] || ''}</svg>`;

  function sideBar(ctx) {
    const S = ctx.S;
    const items = TOOLBOX_TOOLS.map(t => t.current
      ? `<a class="nav-item on" href="#" data-a="home" aria-current="page" title="${esc(t.name + ': ' + t.blurb)}">${tbIcon(t.icon, 18)}<span>${esc(t.name)}</span></a>`
      : `<a class="nav-item" href="${esc(t.href)}" target="_blank" rel="noopener" title="${esc(t.name + ': ' + t.blurb + ' (opens in a new tab)')}">${tbIcon(t.icon, 18)}<span>${esc(t.name)}</span></a>`).join('');
    const themeIcon = S.theme === 'dark' ? 'moon' : 'sun';
    const themeName = S.theme === 'dark' ? 'Dark' : S.theme === 'light' ? 'Light' : 'follows your system';
    return `<aside class="side" id="side" aria-label="Toolbox navigation">
      <div class="side-brand"><img class="side-logo" id="sideLogo" alt="Arch Nexus" width="96" height="96" src="${FB.assets.logo}"><div class="side-product"><strong>Toolbox</strong></div></div>
      <nav class="side-nav" aria-label="Tools"><div class="navh">Tools</div>${items}</nav>
      <div class="side-foot"><span class="grow"></span>
        <button class="ib" type="button" data-a="theme-cycle" title="Theme: ${themeName}. Click for ${S.theme === 'dark' ? 'match system' : S.theme === 'light' ? 'dark' : 'light'}." aria-label="Change theme">${tbIcon(themeIcon)}</button>
        <button class="ib side-collapse" type="button" data-a="side-collapse" title="Collapse the side bar" aria-label="Collapse the side bar">${tbIcon('close')}</button>
      </div></aside>`;
  }

  function header(ctx) {
    const { S, st, p } = ctx;
    const props = st.list();
    const opts = props.map(q => `<option value="${esc(q.id)}"${q.id === S.currentId ? ' selected' : ''}>${esc(q.name || 'Untitled proposal')}</option>`).join('')
      + `<option value="example"${S.currentId === 'example' ? ' selected' : ''}>Example proposal (sandbox)</option>`
      + (S.currentId ? '' : '<option value="" selected>Choose a proposal</option>');
    const open = !!p && !S.ui.newFee;
    const crumbTail = S.ui.newFee ? 'New fee' : (open ? (p.name || 'Untitled proposal') : '');
    const crumbs = `<nav class="crumbs" aria-label="Breadcrumb"><span>Toolbox</span>${tbIcon('chev', 12)}${S.ui.newFee ? `<a href="#" data-a="home">Fee Builder</a>${tbIcon('chev', 12)}<span>${esc(crumbTail)}</span>` : open ? `<span>Fee Builder</span>${tbIcon('chev', 12)}<span>${esc(crumbTail)}</span>` : '<span>Fee Builder</span>'}</nav>`;
    const titleBlock = open
      ? `<h1>${tf('name', p.name, { cls: 'title', ph: 'Project name', aria: 'Project name' })}</h1>${tf('client', p.client, { cls: 'sub', ph: 'Client', aria: 'Client' })}`
      : `<h1 class="brand">Fee Builder</h1><span class="sub">Develop, test, and finalize proposal fees</span>`;
    return `<div class="shell" id="shell">${sideBar(ctx)}<div class="mainwrap">
      <div class="mtop"><button class="ib" type="button" data-a="side-open" aria-label="Open navigation">${tbIcon('menu', 18)}</button><strong>Toolbox</strong><span class="crumb">Fee Builder${open ? ' · ' + esc(p.name || 'Untitled proposal') : ''}</span></div>
      <div class="page"><div class="phead">${crumbs}
      <div class="ptitle">${titleBlock}<span class="grow"></span>
        <div class="tools">
          <button class="save" id="save-chip" data-a="retry" data-s="${esc(S.save)}"><span class="dot"></span><span class="stxt">${esc(saveText(S))}</span></button>
          ${ibtn('undo', 'undo', 'Undo (Ctrl+Z)', { disabled: !st.canUndo() })}
          ${ibtn('redo', 'redo', 'Redo (Ctrl+Shift+Z)', { disabled: !st.canRedo() })}
          ${ibtn('settings', 'gear', 'Settings')}
          <label class="sr" for="prop-pick">Proposal</label>
          <select class="prop" id="prop-pick" data-change="open">${opts}</select>
          ${btn('newfee', 'New fee', { cls: 'primary', icon: 'plus' })}
        </div></div></div>
      ${open ? strip(ctx) : ''}`;
  }

  function saveText(S) {
    return ({ idle: '', saving: 'Saving', saved: 'Saved', local: 'Saved in this browser', error: 'Not saved', conflict: 'Edit conflict', sandbox: 'Example, not saved', readonly: 'View only' })[S.save] || '';
  }

  function banners(ctx) {
    const { S, p } = ctx;
    const out = [];
    if (S.conflict) out.push(note('err', 'warn', `<b>This proposal was changed in another window or by someone else while you had unsaved edits.</b> Choose which version to keep. The other version is discarded.`, [btn('conflict-mine', 'Keep my version', { cls: 'sm' }), btn('conflict-theirs', 'Load the other version', { cls: 'sm' })]));
    if (S.draftOffer && S.draftOffer.id === S.currentId) out.push(note('info', 'info', `Unsaved changes from ${esc(new Date(S.draftOffer.draft.at).toLocaleString())} were found for this proposal.`, [btn('draft-restore', 'Restore them', { cls: 'sm' }), btn('draft-discard', 'Discard', { cls: 'sm ghost' })]));
    if (S.save === 'error') out.push(note('err', 'warn', `${esc(S.saveError || 'Your changes are not saved.')} Your work is kept as a draft in this browser.`, [btn('retry', 'Try again', { cls: 'sm' }), btn('export-json', 'Download a backup', { cls: 'sm ghost' })]));
    if (p && S.loadIssues[p.id] && S.loadIssues[p.id].length) out.push(note('info', 'info', esc(S.loadIssues[p.id].join(' ')) + (p.legacyOriginal ? ' The original is kept with the proposal.' : ''), [btn('dismiss-issues', 'Dismiss', { cls: 'sm ghost' })]));
    if (p && p.example) out.push(note('info', 'info', '<b>Example proposal.</b> Illustrative numbers and example billing rates. Nothing here is saved.', [btn('save-example', 'Save a copy to work on', { cls: 'sm' })]));
    if (S.readOnly && p && !p.example) out.push(note('', 'info', 'You can view this proposal but not change it.'));
    return out.length ? `<div class="notices">${out.join('')}</div>` : '';
  }

  function note(kind, ic, html, acts) {
    return `<div class="note ${kind}">${icon(ic)}<div><div>${html}</div>${acts && acts.length ? `<div class="acts">${acts.join('')}</div>` : ''}</div></div>`;
  }

  function strip(ctx) {
    const { p, sc, S } = ctx;
    const chips = p.scenarios.map(s => `<button class="scn" data-a="pick-scen" data-id="${esc(s.id)}" aria-pressed="${s.id === sc.id}">${s.id === p.preferredId ? `<span class="star" title="Preferred">${icon('starFill')}</span>` : ''}<span>${esc(s.name || 'Untitled')}</span></button>`).join('');
    const steps = [['establish', 'Establish'], ['develop', 'Develop'], ['analyze', 'Analyze'], ['finalize', 'Finalize']];
    return `<section class="pbar">
      <nav class="seg flow" aria-label="Workflow">${steps.map(([k, l]) => `<button data-a="view" data-v="${k}" aria-current="${S.view === k}">${l}</button>`).join('')}</nav>
      <div class="scen" role="group" aria-label="Scenarios"><span class="lbl">Scenarios</span>${chips}
        <button class="scn add" data-a="dup-scen" title="Duplicate the current scenario">${icon('copy')}<span>Duplicate</span></button>
        <button class="scn add" data-a="new-scen" title="New scenario with the same structure and a blank fee">${icon('plus')}<span>New</span></button>
      </div></section>`;
  }

  function rail(ctx) {
    const { res, p, sc } = ctx;
    const P = res.present;
    const total = Math.max(1, Math.abs(P.arch) + Math.abs(res.consultantClient) + Math.abs(P.itemsClient));
    const seg = (v, c) => `<i style="width:${Math.max(0, v / total * 100).toFixed(2)}%;background:${c}"></i>`;
    const W = res.warnings.filter(w => w.severity !== 'info');
    const errs = W.filter(w => w.severity === 'error');
    return `<aside class="rail" aria-label="Financial summary">
      <div class="stack" style="gap:6px">
        <h2><span>Client fee</span>${sc.id === p.preferredId ? '<span class="tag blue">Preferred</span>' : ''}</h2>
        <div class="big" data-o="sum.fee">${esc(ctx.O['sum.fee'])}</div>
        <div class="bigsub"><span data-o="sum.pctCost">${esc(ctx.O['sum.pctCost'])}</span>${res.feePerSf !== null ? ` · <span data-o="sum.psf">${esc(ctx.O['sum.psf'])}</span>` : ''}</div>
        <div class="bar2" data-chart="railbar" aria-hidden="true">${seg(P.arch, 'var(--blue)')}${seg(res.consultantClient, 'var(--cons-1)')}${seg(Math.max(0, P.itemsClient), 'var(--blue-soft)')}</div>
        <div class="legend"><span><i style="background:var(--blue)"></i>Arch Nexus</span><span><i style="background:var(--cons-1)"></i>Consultants</span><span><i style="background:var(--blue-soft)"></i>Services and other</span></div>
      </div>
      <dl class="kv">
        <dt>Design fee</dt><dd data-o="sum.design">${esc(ctx.O['sum.design'])}</dd>
        <dt>Arch Nexus fee</dt><dd data-o="sum.arch">${esc(ctx.O['sum.arch'])}</dd>
        <dt>Consultants in fee</dt><dd data-o="sum.cons">${esc(ctx.O['sum.cons'])}</dd>
        <dt>Services and other</dt><dd data-o="sum.items">${esc(ctx.O['sum.items'])}</dd>
        <div class="sep"></div>
        <dt title="Client fee minus consultant and pass-through costs">Net revenue</dt><dd data-o="sum.net">${esc(ctx.O['sum.net'])}</dd>
        <dt title="Net revenue minus reserves and target profit">Effort allowance</dt><dd data-o="sum.allow">${esc(ctx.O['sum.allow'])}</dd>
        <dt>Planned effort</dt><dd data-o="sum.plan">${esc(ctx.O['sum.plan'])}</dd>
        <dt>Headroom</dt><dd data-o="sum.headroom">${esc(ctx.O['sum.headroom'])}</dd>
        ${res.detailed ? `<dt>Projected margin</dt><dd data-o="sum.margin">${esc(ctx.O['sum.margin'])}</dd>` : ''}
      </dl>
      <div class="warns" data-warn="rail">${railWarnings(W, errs)}</div>
    </aside>`;
  }

  function railWarnings(W, errs) {
    if (!W.length) return `<div class="note ok">${icon('check')}<div>No issues found.</div></div>`;
    const top = W.slice(0, 3).map(w => `<div class="note ${w.severity === 'error' ? 'err' : 'warn'}">${icon('warn')}<div>${esc(w.message)}</div></div>`).join('');
    return top + (W.length > 3 ? `<button class="link small" data-a="show-warnings">${W.length - 3} more ${W.length - 3 === 1 ? 'issue' : 'issues'}</button>` : '') + (errs.length ? '' : '');
  }

  /* ================================================================ new fee (fast start) */

  function newFee(ctx) {
    const { S } = ctx;
    const d = S.nf;
    const tplOpts = S.settings.templates.map(t => [t.id, t.name]);
    const methodLabel = { pctCost: 'Fee %', fixed: 'Lump sum', area: 'Rate per SF', labor: '' }[d.method];
    const r = ctx.nfPreview;
    return `<div class="layout" style="grid-template-columns:minmax(0,1fr)"><div class="work"><div class="newfee">
      <h2>New fee</h2>
      <p class="lead">Four inputs get you a first number. Phases, consultants, staffing, and everything else can be added after.</p>
      <div class="grid-fields">
        <div class="field"><label class="lbl" for="nf_name">Project name</label><input class="f t" id="nf_name" data-nf="name" type="text" value="${esc(d.name)}" placeholder="Project name" autocomplete="off"></div>
        <div class="field"><label class="lbl" for="nf_client">Client <span class="opt">(optional)</span></label><input class="f t" id="nf_client" data-nf="client" type="text" value="${esc(d.client)}" autocomplete="off"></div>
        <div class="field"><label class="lbl" for="nf_cost">Construction cost</label><input class="f n" id="nf_cost" data-nf="cost" data-k="money" type="text" inputmode="decimal" value="${esc(fieldText(d.cost, 'money'))}" placeholder="e.g. 15m" autocomplete="off"></div>
        <div class="field"><label class="lbl" for="nf_method">Calculate the fee as</label><select id="nf_method" data-nf="method">${[['pctCost', '% of construction cost'], ['fixed', 'Lump sum'], ['area', '$ per square foot'], ['labor', 'Staffing hours (set up next)']].map(([v, l]) => `<option value="${v}"${d.method === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        ${d.method === 'area' ? `<div class="field"><label class="lbl" for="nf_area">Gross area (SF)</label><input class="f n" id="nf_area" data-nf="area" data-k="int" type="text" inputmode="decimal" value="${esc(fieldText(d.area, 'int'))}" autocomplete="off"></div>` : ''}
        ${d.method !== 'labor' ? `<div class="field"><label class="lbl" for="nf_value">${methodLabel}</label><input class="f n" id="nf_value" data-nf="value" data-k="${d.method === 'pctCost' ? 'num' : 'money'}" type="text" inputmode="decimal" value="${esc(fieldText(d.value, d.method === 'pctCost' ? 'num' : 'money'))}" placeholder="${d.method === 'pctCost' ? 'e.g. 5' : ''}" autocomplete="off"></div>` : ''}
        <div class="field"><label class="lbl" for="nf_tpl">Phases</label><select id="nf_tpl" data-nf="templateId">${tplOpts.map(([v, l]) => `<option value="${esc(v)}"${d.templateId === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      </div>
      <div class="result"><div><div class="lbl">First fee</div><div class="big" id="nf_result">${esc(r)}</div></div><div class="muted small" id="nf_resultsub">${esc(ctx.nfPreviewSub || '')}</div></div>
      <div class="row">${btn('nf-create', 'Create fee', { cls: 'primary', icon: 'check' })}${ctx.st.list().length || ctx.S.example ? btn('nf-cancel', 'Cancel', { cls: 'ghost' }) : btn('open-example', 'Open the example instead', { cls: 'ghost' })}</div>
    </div></div></div>`;
  }

  /* ================================================================ establish */

  function establish(ctx) {
    const { p, S } = ctx;
    const projectFields = `<div class="grid-fields">
      <div class="field"><span class="lbl">Project name</span>${tf('name', p.name, { aria: 'Project name' })}</div>
      <div class="field"><span class="lbl">Client</span>${tf('client', p.client, { aria: 'Client' })}</div>
      <div class="field"><span class="lbl">Project number <span class="opt">(optional)</span></span>${tf('number', p.number, { aria: 'Project number' })}</div>
      <div class="field"><label class="lbl" for="f_startMonth">Start month <span class="opt">(for schedules)</span></label><input type="month" id="f_startMonth" data-f="startMonth" data-t="month" data-r="1" value="${esc(p.startMonth)}"></div>
      <div class="field"><span class="lbl">Round presented figures to</span>${sel('roundingInc', p.roundingInc || 1, [[1, 'Nearest $1'], [10, 'Nearest $10'], [100, 'Nearest $100'], [1000, 'Nearest $1,000']], { aria: 'Rounding' })}</div>
    </div>
    <div class="field"><span class="lbl">Notes</span><textarea data-f="notes" data-t="text" id="f_notes" aria-label="Notes">${esc(p.notes)}</textarea></div>`;

    const multi = p.packages.length > 1;
    const pkgRows = p.packages.map(k => `<tr>
      <td>${tf('packages#' + k.id + '.name', k.name, { aria: 'Package name' })}</td>
      <td class="w-money">${nf('packages#' + k.id + '.cost', k.cost, { kind: 'money', aria: 'Construction cost', pre: '$' })}</td>
      <td class="w-money">${nf('packages#' + k.id + '.area', k.area, { kind: 'int', aria: 'Gross area', unit: 'SF' })}</td>
      <td class="w-money">${nf('packages#' + k.id + '.units', k.units, { kind: 'int', aria: 'Unit count' })}</td>
      <td style="width:110px">${tf('packages#' + k.id + '.unitLabel', k.unitLabel, { aria: 'Unit label', ph: 'beds, keys…' })}</td>
      <td class="tight">${multi ? ibtn('del-pkg', 'trash', 'Remove ' + (k.name || 'package'), { data: { id: k.id } }) : ''}</td></tr>`).join('');
    const pkgs = `<div class="tw"><table class="t"><thead><tr><th>Work package</th><th class="r">Construction cost</th><th class="r">Gross area</th><th class="r">Units</th><th>Unit label</th><th></th></tr></thead><tbody>${pkgRows}</tbody></table></div>
      <div class="row">${btn('add-pkg', 'Add work package', { cls: 'sm', icon: 'plus' })}<span class="muted small">Each package can be priced its own way in every scenario and rolls into the project total.</span></div>`;

    const phRows = p.phases.map((ph, i) => `<tr><td class="ix tight">${i + 1}</td><td>${tf('phases#' + ph.id + '.name', ph.name, { aria: 'Phase name' })}</td>
      <td class="tight">${ibtn('ph-up', 'up', 'Move up', { data: { id: ph.id }, disabled: i === 0 })}${ibtn('ph-down', 'down', 'Move down', { data: { id: ph.id }, disabled: i === p.phases.length - 1 })}${p.phases.length > 1 ? ibtn('del-phase', 'trash', 'Remove phase', { data: { id: ph.id } }) : ''}</td></tr>`).join('');
    const tplOpts = S.settings.templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    const phases = `<div class="cols2"><div class="stack"><div class="tw"><table class="t"><thead><tr><th></th><th>Phase or milestone</th><th></th></tr></thead><tbody>${phRows}</tbody></table></div>
      <div class="row">${btn('add-phase', 'Add phase', { cls: 'sm', icon: 'plus' })}${btn('save-template', 'Save as a template', { cls: 'sm ghost' })}</div></div>
      <div class="stack"><div class="field"><label class="lbl" for="tpl-pick">Start from a template</label><div class="row"><select id="tpl-pick">${tplOpts}</select>${btn('apply-template', 'Replace phases', { cls: 'sm' })}</div>
      <span class="muted small">Replacing phases resets every scenario's phase percentages to the template's. Undo is available.</span></div>
      <p class="muted small">Phase percentages, durations, and consultant splits are set per scenario under Analyze.</p></div></div>`;

    const lib = S.settings.consultantLibrary.filter(n => !p.roster.some(r => r.name.toLowerCase() === n.toLowerCase()));
    const conRows = p.roster.map(c => `<tr><td>${tf('roster#' + c.id + '.name', c.name, { aria: 'Consultant name', r: false })}</td><td>${tf('roster#' + c.id + '.discipline', c.discipline, { aria: 'Discipline', ph: 'Discipline' })}</td><td class="tight">${ibtn('del-con', 'trash', 'Remove ' + c.name, { data: { id: c.id } })}</td></tr>`).join('');
    const cons = `${p.roster.length ? `<div class="tw"><table class="t"><thead><tr><th>Consultant</th><th>Discipline</th><th></th></tr></thead><tbody>${conRows}</tbody></table></div>` : '<p class="muted">No consultants yet. Add only the disciplines this project needs.</p>'}
      <div class="addbar"><span class="lab">Add</span>${lib.map(n => `<button class="pill" data-a="add-con" data-name="${esc(n)}">+ ${esc(n)}</button>`).join('')}
      <span class="row" style="gap:6px"><input type="text" id="new-con" placeholder="Other consultant" aria-label="Other consultant" style="width:170px"><button class="btn sm" data-a="add-con-custom">Add</button></span></div>`;

    const roleRows = p.roles.map(r => `<tr><td>${tf('roles#' + r.id + '.name', r.name, { aria: 'Role' })}</td>
      <td class="w-money">${nf('roles#' + r.id + '.billRate', r.billRate, { kind: 'money', aria: 'Billing rate', pre: '$', unit: '/h' })}</td>
      <td class="w-money">${nf('roles#' + r.id + '.costRate', r.costRate, { kind: 'money', aria: 'Cost rate', pre: '$', unit: '/h', ph: 'optional' })}</td>
      <td class="tight">${p.roles.length > 1 ? ibtn('del-role', 'trash', 'Remove role', { data: { id: r.id } }) : ''}</td></tr>`).join('');
    const rates = `<div class="tw"><table class="t"><thead><tr><th>Role</th><th class="r">Billing rate</th><th class="r">Direct labor cost rate</th><th></th></tr></thead><tbody>${roleRows}</tbody></table></div>
      <div class="row">${btn('add-role', 'Add role', { cls: 'sm', icon: 'plus' })}${btn('load-rates', 'Reset to my default rates', { cls: 'sm ghost' })}</div>
      <p class="muted small">Billing rates price labor-based fees and value planned effort. Cost rates are optional and only feed the detailed profitability model.${p.example ? ' The example uses illustrative rates.' : ''}</p>`;

    return sec('Project', projectFields, { right: scopeShared })
      + sec('Work packages', pkgs, { right: scopeShared, hint: 'A simple project needs only one. Use more for separate buildings, site work, or scopes priced differently.' })
      + sec('Phases', phases, { right: scopeShared })
      + sec('Consultants', cons, { right: scopeShared, hint: 'The roster is shared. Each scenario decides whether a consultant participates in each package and how they are priced.' })
      + sec('Roles and rates', rates, { right: scopeShared });
  }

  /* ================================================================ develop */

  function develop(ctx) {
    const { p, sc, res, S } = ctx;
    const multi = p.packages.length > 1;
    const pkgId = multi && S.devPkg && p.packages.some(k => k.id === S.devPkg) ? S.devPkg : p.packages[0].id;
    const head = `<div class="row" style="justify-content:space-between;align-items:flex-end">
      <div class="field" style="flex:1 1 260px"><span class="lbl">Scenario name</span>${tf(scPath(ctx) + '.name', sc.name, { aria: 'Scenario name', r: false })}</div>
      <div class="row">${sc.id === p.preferredId ? '<span class="tag blue">Preferred</span>' : btn('prefer', 'Mark preferred', { cls: 'sm', icon: 'star', data: { id: sc.id } })}
      ${p.scenarios.length > 1 ? (S.confirm === 'del-scen' ? `<span class="row small">Delete this scenario? ${btn('del-scen', 'Delete', { cls: 'sm dtext' })}${btn('cancel', 'Keep', { cls: 'sm ghost' })}</span>` : btn('ask', 'Delete scenario', { cls: 'sm ghost dtext', data: { k: 'del-scen' } })) : ''}</div></div>
      <details class="more"${sc.notes ? ' open' : ''}><summary>${icon('chev')}Scenario notes</summary><div class="inner"><textarea data-f="${scPath(ctx)}.notes" data-t="text" id="${fid(scPath(ctx) + '.notes')}" aria-label="Scenario notes" placeholder="Why this scenario exists, what was assumed">${esc(sc.notes)}</textarea></div></details>`;

    let pk = '';
    if (multi) {
      pk = `<div class="pills" role="group" aria-label="Work package">${p.packages.map((k, i) => `<button class="pill" data-a="dev-pkg" data-id="${esc(k.id)}" aria-pressed="${k.id === pkgId}">${esc(k.name || 'Package ' + (i + 1))} · <span data-o="k.${k.id}.basic">${esc(ctx.O['k.' + k.id + '.basic'])}</span></button>`).join('')}</div>`;
    }
    const k = p.packages.find(x => x.id === pkgId);
    const kr = res.pkgs.find(x => x.pkgId === pkgId);
    return sec(multi ? 'Fee development' : 'Fee development', head + pk, { right: scopeScen(ctx) })
      + feeSection(ctx, k, kr)
      + consultantSection(ctx, k, kr)
      + laborSection(ctx, k, kr)
      + itemsSection(ctx);
  }

  function feeSection(ctx, k, kr) {
    const { p, sc } = ctx;
    const calc = sc.pkgs[k.id];
    const base = pkPath(ctx, k.id);
    const basisSeg = `<div class="seg" role="group" aria-label="What the fee components add up to">
      <button data-a="basis" data-v="design" aria-pressed="${calc.basis === 'design'}">Total design fee</button>
      <button data-a="basis" data-v="arch" aria-pressed="${calc.basis === 'arch'}">Arch Nexus share only</button></div>`;
    const basisHelp = calc.basis === 'design'
      ? 'Components add up to the whole design fee. Consultants marked "included" are paid out of it.'
      : 'Components add up to the Arch Nexus share. Included consultants are added on top to reach the design fee (bottom-up).';
    const costPh = money(num(k.cost));
    const metrics = `<div class="grid-fields" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
      <div class="field"><span class="lbl">Construction cost <span class="opt">(this scenario)</span></span>${nf(base + '.costOverride', calc.costOverride, { kind: 'money', ph: costPh + ' (project)', aria: 'Construction cost for this scenario', pre: '$' })}</div>
      <div class="field"><span class="lbl">Gross area <span class="opt">(this scenario)</span></span>${nf(base + '.areaOverride', calc.areaOverride, { kind: 'int', ph: numf(num(k.area), 0) + ' (project)', aria: 'Area for this scenario', unit: 'SF' })}</div>
      ${has(k.units) || has(calc.unitsOverride) ? `<div class="field"><span class="lbl">${esc(k.unitLabel || 'Units')} <span class="opt">(this scenario)</span></span>${nf(base + '.unitsOverride', calc.unitsOverride, { kind: 'int', ph: numf(num(k.units), 0), aria: 'Units for this scenario' })}</div>` : ''}
    </div>`;
    const rows = calc.components.map((c, i) => {
      const cp = base + '.components#' + c.id;
      let inputs = '';
      if (c.method === 'pctCost') inputs = `<span class="wrap-unit">${nf(cp + '.pct', c.pct, { aria: 'Fee percent', unit: '%', cls: 'w-pct' })}<span class="u">of ${esc(money(kr.metrics.cost))}</span></span>`;
      else if (c.method === 'fixed') inputs = nf(cp + '.amount', c.amount, { kind: 'money', aria: 'Amount', pre: '$' });
      else if (c.method === 'area') inputs = `<span class="wrap-unit">${nf(cp + '.rate', c.rate, { kind: 'money', aria: 'Rate per SF', pre: '$', unit: '/SF' })}<span class="u">×</span>${nf(cp + '.qty', c.qty, { kind: 'int', aria: 'Area override', ph: numf(kr.metrics.area, 0), unit: 'SF' })}</span>`;
      else if (c.method === 'unit') inputs = `<span class="wrap-unit">${nf(cp + '.rate', c.rate, { kind: 'money', aria: 'Rate per unit', pre: '$' })}<span class="u">×</span>${nf(cp + '.qty', c.qty, { kind: 'int', aria: 'Unit count override', ph: numf(kr.metrics.units, 0), unit: k.unitLabel || 'units' })}</span>`;
      else inputs = `<span class="muted small">From the labor plan below${Array.isArray(c.covers) ? ' (covered phases only)' : ''}</span>`;
      return `<tr>
        <td>${tf(cp + '.label', c.label, { aria: 'Component label', ph: METHOD_LABEL[c.method] })}</td>
        <td>${sel(cp + '.method', c.method, Object.entries(METHOD_LABEL), { aria: 'Method' })}</td>
        <td>${inputs}</td>
        <td>${coversPicker(ctx, cp, c)}</td>
        <td class="r">${out(ctx, 'k.' + k.id + '.comp.' + c.id)}</td>
        <td class="tight">${ibtn('del-comp', 'trash', 'Remove component', { data: { id: c.id, pkg: k.id } })}</td></tr>`;
    }).join('');
    const formula = calc.basis === 'design'
      ? `Design fee ${out(ctx, 'k.' + k.id + '.design')} − included consultants ${out(ctx, 'k.' + k.id + '.incl')} = Arch Nexus ${out(ctx, 'k.' + k.id + '.arch')}`
      : `Arch Nexus ${out(ctx, 'k.' + k.id + '.arch')} + included consultants ${out(ctx, 'k.' + k.id + '.incl')} = design fee ${out(ctx, 'k.' + k.id + '.design')}`;
    const body = `<div class="row" style="justify-content:space-between">${basisSeg}<span class="muted small" style="max-width:56ch">${basisHelp}</span></div>
      ${metrics}
      <div class="tw"><table class="t"><thead><tr><th>Component</th><th>Method</th><th>Inputs</th><th>Covers</th><th class="r">Amount</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="6" class="muted">No fee components yet.</td></tr>`}</tbody></table></div>
      <div class="addbar"><span class="lab">Add</span>${Object.entries(METHOD_LABEL).map(([m, l]) => `<button class="pill" data-a="add-comp" data-m="${m}" data-pkg="${k.id}">+ ${esc(l)}</button>`).join('')}</div>
      <div class="note info">${icon('info')}<div>${formula}. Design fee is <span data-o="k.${k.id}.designPct">${esc(ctx.O['k.' + k.id + '.designPct'])}</span> of construction.</div></div>
      ${calc.components.length > 1 ? '<p class="muted small">Components add together. Use "Covers" so a component priced for some phases (for example CA by hours) does not overlap another.</p>' : ''}`;
    return sec(p.packages.length > 1 ? 'Fee: ' + (k.name || 'Package') : 'Fee', body);
  }

  function coversPicker(ctx, cp, c) {
    const { p } = ctx;
    const all = !Array.isArray(c.covers);
    const set = new Set(all ? [] : c.covers);
    const label = all ? 'All phases' : (c.covers.length === 1 ? (p.phases.find(x => x.id === c.covers[0]) || {}).name : c.covers.length + ' phases');
    return `<details class="covers"><summary>${esc(label)} ${icon('down')}</summary><div class="menu">
      <label class="chk"><input type="checkbox" data-a-change="covers-all" data-path="${esc(cp)}"${all ? ' checked' : ''}> All phases</label>
      ${p.phases.map(ph => `<label class="chk"><input type="checkbox" data-a-change="covers-one" data-path="${esc(cp)}" data-ph="${esc(ph.id)}"${!all && set.has(ph.id) ? ' checked' : ''}> ${esc(ph.name)}</label>`).join('')}
    </div></details>`;
  }

  function consultantSection(ctx, k, kr) {
    const { p, sc, S } = ctx;
    const calc = sc.pkgs[k.id];
    const base = pkPath(ctx, k.id);
    const showMk = S.settings.showMarkup || Object.values(calc.cons).some(c => c.on && (has(c.markup) || has(c.cost)));
    const rows = p.roster.map(r => {
      const c = calc.cons[r.id];
      const cp = base + '.cons.' + r.id;
      const isPct = c.type === 'pctCost' || c.type === 'pctFee';
      const val = isPct ? nf(cp + '.value', c.value, { aria: r.name + ' percent', unit: '%' }) : nf(cp + '.value', c.value, { kind: 'money', aria: r.name + ' amount', pre: '$' });
      return `<tr class="${c.on ? '' : 'off'}">
        <td class="tight">${chk(cp + '.on', c.on, '', { aria: 'Include ' + r.name + ' in ' + (k.name || 'this package') })}</td>
        <td><b>${esc(r.name || 'Unnamed')}</b>${c.on ? `<div style="margin-top:3px">${tf(cp + '.note', c.note, { aria: r.name + ' scope notes', ph: 'Scope notes or exclusions', cls: 'small' })}</div>` : ''}</td>
        <td>${c.on ? sel(cp + '.type', c.type, CONS_TYPE, { aria: 'Pricing' }) : ''}</td>
        <td class="w-money">${c.on ? val : ''}</td>
        <td>${c.on ? sel(cp + '.treatment', c.treatment, TREAT, { aria: 'Treatment', cls: 'treat' }) : '<span class="muted small">Not in this package</span>'}</td>
        ${showMk ? `<td class="w-pct">${c.on ? nf(cp + '.markup', c.markup, { aria: 'Markup', unit: '%', ph: '0' }) : ''}</td><td class="w-money">${c.on && c.type !== 'quote' ? nf(cp + '.cost', c.cost, { kind: 'money', aria: 'Expected cost', pre: '$', ph: 'same' }) : ''}</td>` : ''}
        <td class="r">${c.on ? out(ctx, 'k.' + k.id + '.cons.' + r.id + '.client') : ''}</td>
        <td class="r">${c.on ? out(ctx, 'k.' + k.id + '.cons.' + r.id + '.share', 'muted') : ''}</td>
        <td>${c.on ? sel(cp + '.split', c.split, [['follow', 'Follows the fee'], ['custom', 'Custom']], { aria: 'Phase split' }) : ''}</td></tr>`;
    }).join('');
    const lib = S.settings.consultantLibrary.filter(n => !p.roster.some(r => r.name.toLowerCase() === n.toLowerCase())).slice(0, 8);
    const body = p.roster.length ? `<div class="tw"><table class="t"><thead><tr><th></th><th>Consultant</th><th>Priced as</th><th class="r">Value</th><th>Treatment</th>${showMk ? '<th class="r">Markup</th><th class="r">Expected cost</th>' : ''}<th class="r">In fee</th><th class="r">% of design fee</th><th>Phase split</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="row" style="justify-content:space-between"><div class="addbar"><span class="lab">Add to roster</span>${lib.map(n => `<button class="pill" data-a="add-con" data-name="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div>
      <label class="chk small"><input type="checkbox" data-a-change="toggle-markup"${S.settings.showMarkup ? ' checked' : ''}> Show markup and expected cost</label></div>
      <p class="muted small"><b>Included in design fee:</b> paid out of the design fee, so it reduces the Arch Nexus share. <b>Additional to design fee:</b> added on top, so the client fee goes up. A consultant quote is their cost to Arch Nexus; any markup is added for the client. Custom phase splits are edited in the matrix under Analyze.</p>`
      : `<p class="muted">No consultants on this project yet.</p><div class="addbar"><span class="lab">Add</span>${lib.map(n => `<button class="pill" data-a="add-con" data-name="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div>`;
    return sec('Consultants' + (p.packages.length > 1 ? ': ' + (k.name || '') : ''), body);
  }

  function laborSection(ctx, k, kr) {
    const { p, sc } = ctx;
    const calc = sc.pkgs[k.id];
    const base = pkPath(ctx, k.id);
    const usesLabor = calc.components.some(c => c.method === 'labor');
    const L = calc.labor;
    const staffing = L.mode === 'staffing';
    const head = `<tr><th>Role</th><th class="r">Rate</th>${p.phases.map(ph => `<th class="r" title="${esc(ph.name)}">${esc(short(ph.name))}</th>`).join('')}<th class="r">Hours</th><th class="r">Value</th><th></th></tr>`;
    const rows = L.rows.map((r, ri) => `<tr>
      <td>${sel(base + '.labor.rows#' + r.id + '.roleId', r.roleId, p.roles.map(x => [x.id, x.name || 'Unnamed role']), { aria: 'Role', cls: 'role' })}</td>
      <td class="r">${out(ctx, 'k.' + k.id + '.lab.r.' + r.id + '.rate', 'muted small')}</td>
      ${p.phases.map((ph, ci) => `<td style="min-width:76px">${nf(base + '.labor.rows#' + r.id + '.cells.' + ph.id, r.cells[ph.id], { aria: (staffing ? 'FTE' : 'Hours') + ' ' + ph.name, ph: staffing ? 'FTE' : 'h', grid: 'lab:' + ri + ':' + ci })}</td>`).join('')}
      <td class="r">${out(ctx, 'k.' + k.id + '.lab.r.' + r.id + '.hours')}</td>
      <td class="r">${out(ctx, 'k.' + k.id + '.lab.r.' + r.id + '.value')}</td>
      <td class="tight">${ibtn('del-labrow', 'trash', 'Remove role', { data: { id: r.id, pkg: k.id } })}</td></tr>`).join('');
    const foot = L.rows.length ? `<tfoot>
      <tr class="sub"><td>Hours</td><td></td>${p.phases.map(ph => `<td class="r">${out(ctx, 'k.' + k.id + '.lab.ph.' + ph.id + '.hours')}</td>`).join('')}<td class="r">${out(ctx, 'k.' + k.id + '.lab.hours')}</td><td class="r">${out(ctx, 'k.' + k.id + '.lab.value')}</td><td></td></tr>
      <tr><td class="muted">Value</td><td></td>${p.phases.map(ph => `<td class="r muted">${out(ctx, 'k.' + k.id + '.lab.ph.' + ph.id + '.value')}</td>`).join('')}<td></td><td></td><td></td></tr>
      <tr><td class="muted">Avg FTE</td><td></td>${p.phases.map(ph => `<td class="r muted">${out(ctx, 'k.' + k.id + '.lab.ph.' + ph.id + '.fte')}</td>`).join('')}<td></td><td></td><td></td></tr></tfoot>` : '';
    const months = `<tr><td class="muted small" colspan="2">Phase months</td>${p.phases.map(ph => `<td>${nf(scPath(ctx) + '.schedule.' + ph.id + '.months', sc.schedule[ph.id].months, { aria: 'Months ' + ph.name, ph: 'mo' })}</td>`).join('')}<td colspan="3"></td></tr>`;
    const body = `<div class="row" style="justify-content:space-between"><div class="seg" role="group" aria-label="Plan by">
        <button data-a="labor-mode" data-pkg="${k.id}" data-v="hours" aria-pressed="${!staffing}">Hours</button>
        <button data-a="labor-mode" data-pkg="${k.id}" data-v="staffing" aria-pressed="${staffing}">Staffing (FTE × months)</button></div>
        <span class="muted small" style="max-width:60ch">${usesLabor ? 'This plan prices the labor component of the fee.' : 'This plan is planned effort only. It is compared with the effort allowance under Analyze but does not change the fee.'}</span></div>
      <div class="tw"><table class="t">
        <thead>${head}</thead><tbody>${staffing ? months : ''}${rows || `<tr><td colspan="${p.phases.length + 5}" class="muted">No roles in this plan yet.</td></tr>`}</tbody>${foot}</table></div>
      <div class="addbar"><span class="lab">Add role</span>${p.roles.map(r => `<button class="pill" data-a="add-labrow" data-pkg="${k.id}" data-role="${esc(r.id)}">+ ${esc(r.name)}</button>`).join('')}</div>
      <p class="muted small">Planned effort is valued at billing rates, not payroll cost. ${staffing ? 'Hours = FTE × phase months × ' + numf(ctx.res.settingsUsed.hoursPerFteMonth, 1) + ' hours per month.' : ''} Copy a plan from another scenario: ${ctx.p.scenarios.filter(s => s.id !== sc.id).map(s => `<button class="link" data-a="copy-labor" data-from="${esc(s.id)}" data-pkg="${k.id}">${esc(s.name)}</button>`).join(', ') || 'none yet'}.</p>`;
    const open = usesLabor || L.rows.length;
    return `<section class="sec"><header><h2>Labor plan${p.packages.length > 1 ? ': ' + esc(k.name) : ''}</h2></header><details class="more"${open ? ' open' : ''}><summary>${icon('chev')}${open ? 'Labor plan' : 'Add a staffing plan by role and phase'}</summary><div class="inner">${body}</div></details></section>`;
  }

  function short(name) {
    const map = { 'Schematic Design': 'SD', 'Design Development': 'DD', 'Construction Documents': 'CD', 'Bidding / Permitting': 'Bid/Permit', 'Construction Administration': 'CA', 'Programming': 'Prog', 'Project Closeout': 'Closeout', 'Construction Phase Services': 'CA' };
    return map[name] || (name.length > 14 ? name.slice(0, 13) + '…' : name);
  }

  function itemsSection(ctx) {
    const { p, sc, S } = ctx;
    const multi = p.packages.length > 1;
    const rows = sc.items.map(it => {
      const ip = scPath(ctx) + '.items#' + it.id;
      let inputs;
      switch (it.method) {
        case 'fixed': inputs = nf(ip + '.amount', it.amount, { kind: 'money', aria: 'Amount', pre: '$', ph: it.kind === 'adjustment' ? '-20,000' : '' }); break;
        case 'hours': inputs = `<span class="wrap-unit">${nf(ip + '.hours', it.hours, { aria: 'Hours', unit: 'h' })}<span class="u">×</span>${sel(ip + '.roleId', it.roleId, [['', 'Rate…']].concat(p.roles.map(r => [r.id, r.name])), { aria: 'Role rate' })}</span>`; break;
        case 'pctFee': inputs = `<span class="wrap-unit">${nf(ip + '.pct', it.pct, { aria: 'Percent', unit: '%' })}<span class="u">of</span>${sel(ip + '.basis', it.basis, (it.kind === 'contingency' || it.kind === 'adjustment') ? [['subtotal', 'basic + services'], ['design', 'design fee'], ['basic', 'basic services']] : [['design', 'design fee'], ['basic', 'basic services']], { aria: 'Basis' })}</span>`; break;
        case 'pctCost': inputs = nf(ip + '.pct', it.pct, { aria: 'Percent of construction', unit: '%' }); break;
        case 'area': inputs = `<span class="wrap-unit">${nf(ip + '.rate', it.rate, { kind: 'money', pre: '$', unit: '/SF', aria: 'Rate' })}<span class="u">×</span>${nf(ip + '.qty', it.qty, { kind: 'int', aria: 'Area', ph: 'project', unit: 'SF' })}</span>`; break;
        case 'unit': inputs = `<span class="wrap-unit">${nf(ip + '.qty', it.qty, { aria: 'Quantity' })}<span class="u">×</span>${nf(ip + '.rate', it.rate, { kind: 'money', pre: '$', aria: 'Unit rate' })}</span>`; break;
        default: inputs = '';
      }
      const extra = [];
      if (it.kind === 'service') extra.push(sel(ip + '.provider', it.provider, [['an', 'By Arch Nexus'], ['pass', 'By a subconsultant']], { aria: 'Provided by' }));
      if ((it.kind === 'service' && it.provider === 'pass') || it.kind === 'reimbursable') extra.push(`<span class="wrap-unit"><span class="u">markup</span>${nf(ip + '.markup', it.markup, { aria: 'Markup', unit: '%', ph: '0', cls: 'w-pct' })}</span>`);
      if (multi && (it.method === 'pctCost' || it.method === 'pctFee' || it.method === 'area')) extra.push(sel(ip + '.pkgId', it.pkgId, [['', 'All packages']].concat(p.packages.map(k => [k.id, k.name])), { aria: 'Package' }));
      const treat = it.kind === 'expense' ? '<span class="muted small">Internal only</span>' : it.kind === 'adjustment' ? '<span class="muted small">Client fee</span>'
        : sel(ip + '.treatment', it.treatment, [['add', 'Added to client fee'], ['included', 'Included in existing fee'], ['internal', 'Internal planning only']], { aria: 'How it applies', cls: 'treat' });
      return `<tr>
        <td>${sel(ip + '.kind', it.kind, ITEM_KINDS, { aria: 'Type', cls: 'kind' })}</td>
        <td>${tf(ip + '.label', it.label, { aria: 'Description', ph: FB.calc.kindLabel(it.kind) })}</td>
        <td>${sel(ip + '.method', it.method, ITEM_METHODS, { aria: 'Pricing' })}</td>
        <td><div class="stack" style="gap:4px">${inputs}${extra.length ? `<div class="row" style="gap:6px">${extra.join('')}</div>` : ''}</div></td>
        <td>${treat}</td>
        <td class="r">${out(ctx, 'it.' + it.id + '.client')}</td>
        <td class="tight">${ibtn('del-item', 'trash', 'Remove', { data: { id: it.id } })}</td></tr>`;
    }).join('');
    const lib = S.settings.serviceLibrary.filter(n => !sc.items.some(i => i.label === n)).slice(0, 7);
    const body = `<div class="tw"><table class="t"><thead><tr><th>Type</th><th>Description</th><th>Pricing</th><th>Inputs</th><th>Applies to</th><th class="r">Fee effect</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="7" class="muted">None in this scenario.</td></tr>`}</tbody></table></div>
      <div class="addbar"><span class="lab">Add</span>
        <button class="pill" data-a="add-item" data-kind="service">+ Service</button>
        <button class="pill" data-a="add-item" data-kind="reimbursable">+ Reimbursable</button>
        <button class="pill" data-a="add-item" data-kind="contingency">+ Contingency</button>
        <button class="pill" data-a="add-item" data-kind="adjustment" data-label="Discount">+ Discount</button>
        <button class="pill" data-a="add-item" data-kind="expense">+ Internal expense</button>
        ${lib.map(n => `<button class="pill" data-a="add-item" data-kind="service" data-label="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div>
      <p class="muted small"><b>Added to client fee</b> raises the total. <b>Included in existing fee</b> documents scope already covered; a subconsultant's cost still comes out of revenue. <b>Internal planning only</b> never reaches the client and is held back from the effort allowance. Enter discounts as negative amounts.</p>`;
    return sec('Services, reimbursables, and adjustments', body, { right: scopeScen(ctx) });
  }

  /* ================================================================ analyze */

  function analyze(ctx) {
    const { S } = ctx;
    const tabs = [['phases', 'Phases and disciplines'], ['finance', 'Financials'], ['stress', 'Stress test and solve'], ['compare', 'Compare scenarios']];
    const nav = `<div class="pills" role="tablist" aria-label="Analysis">${tabs.map(([k, l]) => `<button role="tab" class="pill" data-a="atab" data-v="${k}" aria-pressed="${S.analyzeTab === k}">${l}</button>`).join('')}</div>`;
    const body = { phases: phasesTab, finance: financeTab, stress: stressTab, compare: compareTab }[S.analyzeTab] || phasesTab;
    return nav + body(ctx);
  }

  function phasesTab(ctx) {
    const { p, sc, res, S } = ctx;
    const multi = p.packages.length > 1;
    const filter = multi ? (S.pkgFilter === 'all' || !p.packages.some(k => k.id === S.pkgFilter) ? 'all' : S.pkgFilter) : p.packages[0].id;
    const pills = multi ? `<div class="pills" role="group" aria-label="Work package">${[['all', 'All packages']].concat(p.packages.map(k => [k.id, k.name || 'Package'])).map(([v, l]) => `<button class="pill" data-a="pkg-filter" data-v="${esc(v)}" aria-pressed="${filter === v}">${esc(l)}</button>`).join('')}</div>` : '';
    let alloc = '';
    if (filter !== 'all') alloc = allocEditor(ctx, filter);
    else alloc = sec('Phase allocation', `<p class="muted">Pick a work package above to set its phase percentages. The matrix below adds every package together.</p>`, { right: scopeScen(ctx) });
    const mode = S.matrixMode || '$';
    const modeSeg = `<div class="seg" role="group" aria-label="Show"><button data-a="mmode" data-v="$" aria-pressed="${mode === '$'}">Dollars</button><button data-a="mmode" data-v="col" aria-pressed="${mode === 'col'}">% of each discipline</button><button data-a="mmode" data-v="row" aria-pressed="${mode === 'row'}">% of each phase</button></div>`;
    const matrix = matrixTable(ctx, filter);
    const chart = `<div class="chart" data-chart="phasebars">${phaseBarsSvg(ctx, filter)}</div>`;
    const sched = scheduleBlock(ctx);
    return pills + alloc
      + sec('Phase by discipline', `<div class="row" style="justify-content:space-between">${modeSeg}${btn('go-export', 'Export matrix', { cls: 'sm ghost', icon: 'download', data: { which: 'matrix' } })}</div><div class="tw">${matrix}</div>${chart}`, { right: scopeScen(ctx), hint: filter === 'all' ? 'All packages combined. Pick a package to edit consultant splits in place.' : 'In columns with a custom split, type each phase\'s share of that consultant\'s fee directly in the cell.' })
      + sched;
  }

  function allocEditor(ctx, pkgId) {
    const { p, sc, res } = ctx;
    const calc = sc.pkgs[pkgId];
    const kr = res.pkgs.find(k => k.pkgId === pkgId);
    const base = pkPath(ctx, pkgId);
    const subset = kr.anySubset;
    const rows = p.phases.map((ph, i) => {
      const e = calc.alloc[ph.id];
      const ap = base + '.alloc.' + ph.id;
      return `<tr>
        <td><b>${esc(ph.name)}</b></td>
        <td class="w-pct">${nf(ap + '.pct', e.pct, { aria: ph.name + ' percent', unit: '%', grid: 'alloc:' + i + ':0', ph: has(e.amt) ? '' : '0' })}</td>
        <td class="w-money">${nf(ap + '.amt', e.amt, { kind: 'money', aria: ph.name + ' dollar amount', pre: '$', ph: 'or $', grid: 'alloc:' + i + ':1' })}</td>
        <td class="tight">${ibtn('lock', e.lock ? 'lock' : 'unlock', e.lock ? 'Unlock ' + ph.name : 'Lock ' + ph.name, { data: { pkg: pkgId, ph: ph.id }, cls: e.lock ? 'on' : '' })}</td>
        <td class="r">${out(ctx, 'k.' + pkgId + '.ph.' + ph.id + '.comp')}</td>
        <td class="w-pct">${nf(scPath(ctx) + '.schedule.' + ph.id + '.months', sc.schedule[ph.id].months, { aria: ph.name + ' months', unit: 'mo', grid: 'alloc:' + i + ':2' })}</td></tr>`;
    }).join('');
    const unal = kr.compUnalloc;
    const status = Math.abs(unal) <= 0.5 ? '<span class="tag ok">Fully allocated</span>' : unal < 0 ? '<span class="tag err">Over-allocated</span>' : calc.allowUnallocated ? '<span class="tag">Left unallocated on purpose</span>' : '<span class="tag warn">Not fully allocated</span>';
    const body = `<div class="tw"><table class="t"><thead><tr><th>Phase</th><th class="r">Share</th><th class="r">or amount</th><th></th><th class="r">${kr.basis === 'arch' ? 'Arch Nexus fee' : 'Design fee'}</th><th class="r">Duration</th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr class="total"><td>Total</td><td class="r">${out(ctx, 'k.' + pkgId + '.allocPct')}</td><td></td><td></td><td class="r">${out(ctx, 'k.' + pkgId + '.allocated')}</td><td></td></tr>
      <tr><td colspan="4">${status}</td><td class="r">Unallocated ${out(ctx, 'k.' + pkgId + '.unalloc')}</td><td></td></tr></tfoot></table></div>
      <div class="row">${btn('balance', 'Balance to 100%', { cls: 'sm', icon: 'balance', data: { pkg: pkgId } })}
        ${chk(base + '.allowUnallocated', calc.allowUnallocated, 'Leave any balance unallocated on purpose')}
        ${p.packages.length > 1 ? btn('copy-alloc', 'Use this split for every package', { cls: 'sm ghost', data: { pkg: pkgId } }) : ''}</div>
      <p class="muted small">Type a percentage or a dollar amount per phase. Balance scales the unlocked percentages so the total is exactly 100%; locked phases and dollar amounts stay put. Labor-priced components follow their own hours by phase.${subset ? ' Components limited to certain phases are spread over those phases in proportion to these percentages.' : ''}</p>`;
    return sec('Phase allocation' + (p.packages.length > 1 ? ': ' + (p.packages.find(k => k.id === pkgId) || {}).name : ''), body, { right: scopeScen(ctx) });
  }

  function matrixTable(ctx, filter) {
    const { p, sc, res } = ctx;
    const P = res.present;
    const isAll = filter === 'all';
    const src = isAll ? { rows: P.project.rowKeys.map((k, i) => ({ key: k, label: P.project.rowLabels[i] })), cols: P.project.colKeys.map((k, j) => ({ key: k, label: P.project.colLabels[j], kind: P.project.colKinds[j] })) }
      : (() => { const k = P.packages.find(x => x.pkgId === filter); return { rows: k.rows, cols: k.cols }; })();
    const base = 'm.' + (isAll ? 'all' : filter);
    const kr = isAll ? null : res.pkgs.find(x => x.pkgId === filter);
    const calc = isAll ? null : sc.pkgs[filter];
    const kindLabel = kind => (kind === 'arch' ? 'Our fee' : kind === 'included' ? 'In design fee' : kind === 'additional' ? 'Additional' : 'Mixed');
    const th = src.cols.map(c => {
      let ctl = '';
      if (!isAll && c.key !== 'arch') {
        const pr = calc.cons[c.key];
        ctl = sel(pkPath(ctx, filter) + '.cons.' + c.key + '.split', pr.split, [['follow', 'Follows fee'], ['custom', 'Custom split']], { aria: c.label + ' phase split' });
      }
      return `<th class="r"><div class="colhead"><span>${esc(c.label)}</span><span class="kind">${kindLabel(c.kind)}</span>${ctl}</div></th>`;
    }).join('');
    const body = src.rows.map((r, i) => `<tr class="${r.key === '_unalloc' ? 'unalloc' : ''}"><td>${esc(r.label)}</td>${src.cols.map((c, j) => {
      const key = base + '.' + r.key + '.' + c.key;
      if (!isAll && c.key !== 'arch' && r.key !== '_unalloc' && calc.cons[c.key].split === 'custom') {
        const e = calc.cons[c.key].alloc[r.key] || {};
        const ap = pkPath(ctx, filter) + '.cons.' + c.key + '.alloc.' + r.key;
        return `<td class="r"><div class="cellpct">${nf(ap + '.pct', e.pct, { aria: c.label + ' share of ' + r.label, unit: '%', grid: 'mx:' + i + ':' + j })}</div><span class="cellsub" data-o="${esc(base + '.$.' + r.key + '.' + c.key)}">${esc(ctx.O[base + '.$.' + r.key + '.' + c.key])}</span></td>`;
      }
      return `<td class="r">${out(ctx, key)}</td>`;
    }).join('')}<td class="r"><b>${out(ctx, base + '.rt.' + r.key)}</b></td></tr>`).join('');
    const foot = `<tr class="total"><td>Total</td>${src.cols.map(c => `<td class="r">${out(ctx, base + '.ct.' + c.key)}</td>`).join('')}<td class="r">${out(ctx, base + '.total')}</td></tr>`;
    void kr;
    return `<table class="t t-matrix"><thead><tr><th>Phase</th>${th}<th class="r">Total</th></tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
  }

  function phaseBarsSvg(ctx, filter) {
    const { res } = ctx;
    const P = res.present;
    const src = filter === 'all' ? { labels: P.project.rowLabels, keys: P.project.rowKeys, cells: P.project.cells, totals: P.project.rowTotals, cols: P.project.colKeys }
      : (() => { const k = P.packages.find(x => x.pkgId === filter); return { labels: k.rows.map(r => r.label), keys: k.rows.map(r => r.key), cells: k.cells, totals: k.rowTotals, cols: k.cols.map(c => c.key) }; })();
    const rows = src.keys.map((k, i) => ({ k, label: src.labels[i], arch: src.cells[i][0], cons: src.cells[i].slice(1).reduce((a, b) => a + b, 0), total: src.totals[i] })).filter(r => r.k !== '_unalloc');
    const max = Math.max(1, ...rows.map(r => Math.max(0, r.arch) + Math.max(0, r.cons)));
    const W = 640, L = 170, R = 86, rowH = 26, H = rows.length * rowH + 30;
    const x = v => L + (Math.max(0, v) / max) * (W - L - R);
    const bars = rows.map((r, i) => {
      const y = 8 + i * rowH;
      return `<text x="${L - 8}" y="${y + 14}" text-anchor="end" class="lab">${esc(short(r.label))}</text>
        <rect x="${L}" y="${y + 3}" width="${Math.max(0, x(r.arch) - L)}" height="15" fill="var(--blue)"/>
        <rect x="${x(r.arch)}" y="${y + 3}" width="${Math.max(0, x(Math.max(0, r.arch) + Math.max(0, r.cons)) - x(r.arch))}" height="15" fill="var(--cons-1)"/>
        <text x="${x(Math.max(0, r.arch) + Math.max(0, r.cons)) + 6}" y="${y + 14}">${esc(U.moneyShort(r.total))}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fee by phase, Arch Nexus and consultants"><line x1="${L}" x2="${L}" y1="4" y2="${H - 22}" class="zero"/>${bars}
      <g transform="translate(${L},${H - 8})"><rect width="10" height="10" y="-9" fill="var(--blue)"/><text x="14">Arch Nexus</text><rect x="90" width="10" height="10" y="-9" fill="var(--cons-1)"/><text x="104">Consultants</text></g></svg>`;
  }

  function scheduleBlock(ctx) {
    const { p, res } = ctx;
    const cl = FB.calc.costLoaded(p, res);
    if (!cl.months) return sec('Cost-loaded schedule', `<p class="muted">Set phase durations above to spread the fee across months.${p.startMonth ? '' : ' Set a start month under Establish to label months with dates.'}</p>`);
    const multi = res.present.packages.length > 1;
    const show = cl.rows.filter(r => !r.noDuration);
    const head = cl.labels.map(l => `<th class="r">${esc(l)}</th>`).join('');
    const body = show.map(r => `<tr><td>${esc((multi ? r.pkgName + ': ' : '') + short(r.phaseName))}</td>${r.months.map(v => `<td class="r">${v ? esc(money(v)) : ''}</td>`).join('')}<td class="r"><b>${esc(money(r.total))}</b></td></tr>`).join('');
    const foot = `<tr class="total"><td>Total</td>${cl.monthTotals.map(v => `<td class="r">${esc(money(v))}</td>`).join('')}<td class="r">${esc(money(show.reduce((a, r) => a + r.total, 0)))}</td></tr>`;
    return sec('Cost-loaded schedule', `<div class="tw"><table class="t t-matrix"><thead><tr><th>Phase</th>${head}<th class="r">Total</th></tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>
      <div class="row">${btn('go-export', 'Export schedule', { cls: 'sm ghost', icon: 'download', data: { which: 'schedule' } })}<span class="muted small">Each phase is spread evenly over its months. ${p.startMonth ? '' : 'Set a start month under Establish to label months with dates.'}</span></div>`, { hint: 'Phases run back to back by default. Durations are edited in the allocation table.' });
  }

  function financeTab(ctx) {
    const { p, sc, res, S } = ctx;
    const R = res;
    const tpField = nf(scPath(ctx) + '.finance.targetProfitPct', sc.finance.targetProfitPct, { aria: 'Target profit percent for this scenario', unit: '%', ph: String(S.settings.targetProfitPct), cls: 'w-pct' });
    const line = (label, key, cls, sign) => `<tr class="${cls || ''}"><td>${label}</td><td class="r">${sign ? '<span class="muted">' + sign + '</span> ' : ''}${out(ctx, key)}</td></tr>`;
    const water = `<div class="tw"><table class="t" style="max-width:640px"><tbody>
      ${line('Client fee (proposed billing)', 'sum.fee', 'sub')}
      ${line('Consultant costs to Arch Nexus', 'fin.consCost', '', '−')}
      ${line('Pass-through costs (reimbursables, subconsulted services)', 'fin.pass', '', '−')}
      ${line('Arch Nexus net revenue', 'sum.net', 'sub', '=')}
      ${line('Contingency held in the fee', 'fin.held', '', '−')}
      ${line('Internal reserves and expenses', 'fin.reserves', '', '−')}
      <tr><td>Target profit, <span data-o="fin.tpLabel">${esc(ctx.O['fin.tpLabel'])}</span><div class="row small" style="margin-top:4px"><span class="muted">This scenario:</span>${tpField}</div></td><td class="r"><span class="muted">−</span> ${out(ctx, 'sum.tp')}</td></tr>
      ${line('Effort allowance at billing rates', 'sum.allow', 'total', '=')}
      </tbody></table></div>
      <p class="muted small" style="max-width:76ch">This is the EAC planning method: the most effort, valued at billing rates, that leaves the target profit. It is a planning figure, not an accounting profit. At ${esc(ctx.O['fin.vpf'])} per FTE-month it supports about <b data-o="sum.fteMonths">${esc(ctx.O['sum.fteMonths'])}</b> FTE-months. The target-profit basis and FTE-month value are in Settings.</p>`;
    const ph = `<div class="tw"><table class="t"><thead><tr><th>Phase</th><th class="r">Months</th><th class="r">Net revenue</th><th class="r">Effort allowance</th><th class="r">FTE-months</th><th class="r">Avg FTE</th><th class="r">Planned effort</th><th class="r">Planned FTE</th><th class="r">Headroom</th></tr></thead><tbody>
      ${R.phases.map(x => `<tr><td>${esc(x.name)}</td>${['months', 'net', 'allow', 'ftem', 'fte', 'plan', 'pfte', 'head'].map(k => `<td class="r">${out(ctx, 'ph.' + x.phaseId + '.' + k)}</td>`).join('')}</tr>`).join('')}
      </tbody><tfoot><tr class="total"><td>Total</td><td></td><td class="r">${out(ctx, 'sum.net')}</td><td class="r">${out(ctx, 'sum.allow')}</td><td class="r">${out(ctx, 'sum.fteMonths')}</td><td></td><td class="r">${out(ctx, 'sum.plan')}</td><td></td><td class="r">${out(ctx, 'sum.headroom')}</td></tr></tfoot></table></div>
      <div class="chart" data-chart="effort">${effortSvg(ctx)}</div>
      ${R.hasPlan ? '' : '<p class="muted small">Add a labor plan under Develop to compare planned effort with the allowance.</p>'}`;
    let detailed;
    if (R.detailed) {
      const D = R.detailed;
      detailed = `<dl class="kv" style="max-width:520px">
        <dt>Earned revenue (net revenue less held contingency)</dt><dd>${esc(money(D.earnedRevenue))}</dd>
        <dt>Direct labor cost (hours × cost rates)</dt><dd>${esc(money(D.laborCost))}</dd>
        <dt>Overhead (${esc(numf(num(S.settings.overheadRate) * 100, 1))}% of direct labor)</dt><dd>${esc(money(D.overhead))}</dd>
        <dt>Internal reserves and expenses</dt><dd>${esc(money(R.reserves))}</dd>
        <div class="sep"></div>
        <dt><b>Projected profit</b></dt><dd>${esc(money(D.projectedProfit))}</dd>
        <dt>Margin (profit ÷ earned revenue)</dt><dd>${esc(D.margin === null ? '—' : pct(D.margin * 100, 1))}</dd>
        <dt>Effective multiplier (earned revenue ÷ direct labor)</dt><dd>${esc(D.multiplier === null ? '—' : numf(D.multiplier, 2) + '×')}</dd>
        <dt>Break-even multiplier (1 + overhead)</dt><dd>${esc(numf(D.breakEvenMultiplier, 2) + '×')}</dd></dl>`;
    } else {
      detailed = `<div class="note">${icon('info')}<div><b>Not available yet.</b> ${esc(R.detailedUnavailable.join(' '))}<div class="acts">${btn('settings', 'Open Settings', { cls: 'sm' })}${btn('view', 'Enter cost rates', { cls: 'sm ghost', data: { v: 'establish' } })}</div></div></div>`;
    }
    const consRows = [].concat(...R.pkgs.map(k => k.cons.map(c => `<tr><td>${esc(c.name)}</td>${p.packages.length > 1 ? `<td>${esc(k.name)}</td>` : ''}<td>${c.treatment === 'included' ? 'Included' : 'Additional'}</td><td class="r">${esc(money(c.client))}</td><td class="r">${esc(money(c.cost))}</td><td class="r">${esc(money(c.client - c.cost))}</td><td class="r">${esc(k.design ? pct(c.client / k.design * 100, 1) : '—')}</td></tr>`)));
    const cons = consRows.length ? `<div class="tw"><table class="t"><thead><tr><th>Consultant</th>${p.packages.length > 1 ? '<th>Package</th>' : ''}<th>Treatment</th><th class="r">In fee</th><th class="r">Cost to Arch Nexus</th><th class="r">Markup</th><th class="r">% of design fee</th></tr></thead><tbody>${consRows.join('')}</tbody>
      <tfoot><tr class="total"><td colspan="${p.packages.length > 1 ? 3 : 2}">Total</td><td class="r">${esc(money(R.consultantClient))}</td><td class="r">${esc(money(R.consultantCost))}</td><td class="r">${esc(money(R.consultantClient - R.consultantCost))}</td><td class="r">${esc(ctx.O['sum.consShare'])} of basic</td></tr></tfoot></table></div>` : '<p class="muted">No consultants in this scenario.</p>';
    const T = FB.analysis.thresholds(p, sc, S.settings);
    const tl = [];
    if (T.feeForPlan !== undefined) {
      tl.push(['Client fee that supports the labor plan at target profit', T.feeForPlan === null ? '—' : money(T.feeForPlan)]);
      tl.push(['Fee headroom over that amount', T.feeHeadroom === null ? '—' : signed(T.feeHeadroom)]);
      tl.push(['Hours that could be added before the allowance is used up', T.hoursHeadroom === null ? '—' : numf(T.hoursHeadroom, 0) + ' h']);
      tl.push(['Extra consultant cost that could be absorbed', T.consultantAbsorb === null ? '—' : signed(T.consultantAbsorb)]);
    }
    if (T.breakEvenFee !== undefined) {
      tl.push(['Break-even client fee (detailed model)', T.breakEvenFee === null ? '—' : money(T.breakEvenFee)]);
      tl.push(['Client fee for target profit (detailed model)', T.feeForTarget === null ? '—' : money(T.feeForTarget)]);
    }
    const thr = `${tl.length ? `<dl class="kv" style="max-width:640px">${tl.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>` : ''}
      ${T.notes.map(n => `<p class="muted small">${esc(n)}</p>`).join('')}
      <p class="muted small">Fee thresholds assume the change is negotiated with consultants unchanged. Reaching a threshold does not guarantee profit.</p>`;
    return sec('Revenue and effort allowance', water, { right: scopeScen(ctx) })
      + sec('By phase', ph)
      + sec('Detailed profitability', detailed, { hint: 'Uses cost rates and an overhead rate instead of the target-profit shortcut. Shown only when those inputs exist.' })
      + sec('Consultant economics', cons)
      + sec('Thresholds', thr);
  }

  function effortSvg(ctx) {
    const { res } = ctx;
    const rows = res.phases;
    if (!rows.length) return '';
    const vals = rows.map(x => [x.allowance || 0, res.hasPlan ? x.laborValue : 0]);
    const max = Math.max(1, ...vals.map(v => Math.max(v[0], v[1])));
    const W = 640, L = 170, R = 80, rowH = 32, H = rows.length * rowH + 30;
    const x = v => L + Math.max(0, v) / max * (W - L - R);
    const g = rows.map((r, i) => {
      const y = 8 + i * rowH;
      const [a, pl] = vals[i];
      return `<text x="${L - 8}" y="${y + 15}" text-anchor="end" class="lab">${esc(short(r.name))}</text>
        <rect x="${L}" y="${y + 2}" width="${Math.max(0, x(a) - L)}" height="11" fill="var(--blue-soft)"/>
        <text x="${x(a) + 6}" y="${y + 11}">${esc(U.moneyShort(a))}</text>
        ${res.hasPlan ? `<rect x="${L}" y="${y + 15}" width="${Math.max(0, x(pl) - L)}" height="11" fill="${pl > a + 0.5 ? 'var(--warn-mark)' : 'var(--blue)'}"/><text x="${x(pl) + 6}" y="${y + 24}">${esc(U.moneyShort(pl))}</text>` : ''}`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Effort allowance and planned effort by phase"><line x1="${L}" x2="${L}" y1="4" y2="${H - 22}" class="zero"/>${g}
      <g transform="translate(${L},${H - 8})"><rect width="10" height="10" y="-9" fill="var(--blue-soft)"/><text x="14">Effort allowance</text>${res.hasPlan ? '<rect x="120" width="10" height="10" y="-9" fill="var(--blue)"/><text x="134">Planned effort</text><rect x="230" width="10" height="10" y="-9" fill="var(--warn-mark)"/><text x="244">Over allowance</text>' : ''}</g></svg>`;
  }

  function stressTab(ctx) {
    const { p, sc, S } = ctx;
    const st = S.stress;
    const slider = (key, label, min, max, stepV, unit) => `<div class="slider"><label class="lbl" for="st_${key}">${esc(label)}</label>
      <input type="range" id="st_${key}" data-st="${key}" min="${min}" max="${max}" step="${stepV}" value="${num(st[key])}">
      <span class="calc" id="st_${key}_v">${(num(st[key]) > 0 ? '+' : '') + num(st[key]) + unit}</span></div>`;
    const phOpts = p.phases.map(ph => `<option value="${esc(ph.id)}"${st.phaseId === ph.id ? ' selected' : ''}>${esc(ph.name)}</option>`).join('');
    const controls = `<div class="stack">
      ${slider('cost', 'Construction cost', -30, 30, 1, '%')}
      ${slider('consultant', 'Consultant costs', -20, 50, 1, '%')}
      ${slider('hours', 'Planned labor hours', -30, 50, 1, '%')}
      ${slider('rates', 'Billing rates', -20, 20, 1, '%')}
      ${slider('fee', 'Client fee (negotiated change)', -30, 30, 1, '%')}
      ${slider('targetProfit', 'Target profit', -10, 10, 1, ' pts')}
      <div class="slider"><label class="lbl" for="st_phase">Change a phase duration</label><select id="st_phase" data-st-phase="1">${phOpts}</select><span></span></div>
      <div class="slider"><label class="lbl" for="st_months">Months added</label><input type="range" id="st_months" data-st="months" min="-6" max="18" step="1" value="${num(st.months)}"><span class="calc" id="st_months_v">${(num(st.months) > 0 ? '+' : '') + num(st.months)} mo</span></div>
    </div>
    <div class="row">${btn('stress-reset', 'Reset', { cls: 'sm ghost' })}${btn('stress-promote', 'Save as a new scenario', { cls: 'sm primary', icon: 'copy' })}<span class="muted small">Stress tests never change the scenario itself.</span></div>`;
    const table = `<div id="stress-out">${stressTable(ctx)}</div>`;
    const sens = sensitivityBlock(ctx);
    return sec('Stress test', `<div class="cols2"><div class="stack">${controls}</div><div class="stack">${table}</div></div>`, { right: scopeScen(ctx), hint: 'Move a slider to see the effect at once. Staffing-mode labor plans scale with phase duration; hours-mode plans keep their hours.' })
      + sens + solveBlock(ctx);
  }

  function stressSpec(ctx) {
    const st = ctx.S.stress;
    const spec = { cost: num(st.cost), consultant: num(st.consultant), hours: num(st.hours), rates: num(st.rates), fee: num(st.fee), targetProfit: num(st.targetProfit) };
    if (num(st.months) && st.phaseId) spec.phaseMonths = { [st.phaseId]: num(st.months) };
    return spec;
  }

  function stressTable(ctx) {
    const { p, sc, res, S } = ctx;
    const r2 = FB.analysis.stressResult(p, sc, S.settings, stressSpec(ctx)).result;
    const rows = [
      ['Client fee', res.clientFee, r2.clientFee, money],
      ['Fee as % of construction', res.feePctOfCost, r2.feePctOfCost, v => pct(v)],
      ['Arch Nexus net revenue', res.netRevenue, r2.netRevenue, money],
      ['Consultant costs', res.consultantCost, r2.consultantCost, money],
      ['Effort allowance', res.effortAllowance, r2.effortAllowance, money],
      ['Planned effort', res.hasPlan ? res.plannedEffort : null, r2.hasPlan ? r2.plannedEffort : null, money],
      ['Effort headroom', res.effortHeadroom, r2.effortHeadroom, money],
      ['Projected profit (detailed)', res.detailed ? res.detailed.projectedProfit : null, r2.detailed ? r2.detailed.projectedProfit : null, money]
    ].filter(r => r[1] !== null || r[2] !== null);
    const d = (a, b, f) => {
      if (a === null || b === null || a === undefined || b === undefined) return '—';
      const diff = b - a;
      if (Math.abs(diff) < 0.5) return '<span class="muted">no change</span>';
      const cls = diff > 0 ? 'delta-up' : 'delta-down';
      return `<span class="${cls}">${esc(f === money ? signed(diff) : (diff > 0 ? '+' : '') + f(diff))}</span>`;
    };
    const w = r2.warnings.filter(x => x.severity !== 'info' && !res.warnings.some(y => y.message === x.message));
    return `<div class="tw"><table class="t"><thead><tr><th>Measure</th><th class="r">Now</th><th class="r">Stress test</th><th class="r">Change</th></tr></thead><tbody>
      ${rows.map(([l, a, b, f]) => `<tr><td>${esc(l)}</td><td class="r">${esc(a === null ? '—' : f(a))}</td><td class="r"><b>${esc(b === null ? '—' : f(b))}</b></td><td class="r">${d(a, b, f)}</td></tr>`).join('')}
      </tbody></table></div>${w.map(x => `<div class="note warn">${icon('warn')}<div>${esc(x.message)}</div></div>`).join('')}`;
  }

  function sensitivityBlock(ctx) {
    const { S } = ctx;
    const vars = [['cost', 'Construction cost'], ['consultant', 'Consultant costs'], ['hours', 'Labor hours'], ['rates', 'Billing rates'], ['fee', 'Client fee']];
    const mets = [['clientFee', 'Client fee'], ['netRevenue', 'Net revenue'], ['effortAllowance', 'Effort allowance'], ['effortHeadroom', 'Effort headroom'], ['projectedProfit', 'Projected profit']];
    const sv = S.sens;
    return sec('Sensitivity', `<div class="row"><label class="lbl" for="sens_var">Vary</label><select id="sens_var" data-sens="var">${vars.map(([v, l]) => `<option value="${v}"${sv.var === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <label class="lbl" for="sens_met">and watch</label><select id="sens_met" data-sens="metric">${mets.map(([v, l]) => `<option value="${v}"${sv.metric === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="chart" data-chart="sens">${sensSvg(ctx)}</div>`, { hint: 'From 30% lower to 30% higher, everything else held as it is.' });
  }

  function sensSvg(ctx) {
    const { p, sc, S } = ctx;
    const xs = [-30, -20, -10, 0, 10, 20, 30];
    const pts = FB.analysis.sensitivity(p, sc, S.settings, S.sens.var, xs, S.sens.metric);
    if (pts.some(pt => pt.y === null)) return `<p class="muted small">That measure is not available for this scenario${S.sens.metric === 'projectedProfit' ? ' (needs cost rates and an overhead rate)' : S.sens.metric === 'effortHeadroom' ? ' (needs a labor plan)' : ''}.</p>`;
    const ys = pts.map(pt => pt.y);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (Math.abs(hi - lo) < 1) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
    const W = 640, H = 220, L = 70, R = 20, T = 14, B = 34;
    const X = v => L + (v + 30) / 60 * (W - L - R);
    const Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
    const zeroLine = lo < 0 && hi > 0 ? `<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" class="zero"/>` : '';
    const path = pts.map((pt, i) => (i ? 'L' : 'M') + X(pt.x).toFixed(1) + ' ' + Y(pt.y).toFixed(1)).join(' ');
    const area = path + ` L${X(30)} ${H - B} L${X(-30)} ${H - B} Z`;
    const cur = pts.find(pt => pt.x === 0);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sensitivity curve">
      ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${L - 6}" y="${Y(t) + 4}" text-anchor="end">${esc(U.moneyShort(t))}</text>`).join('')}
      ${zeroLine}
      ${xs.map(v => `<text x="${X(v)}" y="${H - 14}" text-anchor="middle">${v > 0 ? '+' : ''}${v}%</text>`).join('')}
      <path d="${area}" fill="var(--blue)" opacity=".08"/>
      <path d="${path}" fill="none" stroke="var(--blue)" stroke-width="2"/>
      ${pts.map(pt => `<circle cx="${X(pt.x)}" cy="${Y(pt.y)}" r="${pt.x === 0 ? 4.5 : 2.5}" fill="${pt.x === 0 ? 'var(--blue-ink)' : 'var(--blue)'}"/>`).join('')}
      <text x="${X(0) + 8}" y="${Y(cur.y) - 8}" class="lab">${esc(money(cur.y))} now</text></svg>`;
  }

  function solveBlock(ctx) {
    const { p, sc, S } = ctx;
    const vars = FB.analysis.listVariables(p, sc);
    const mets = Object.entries(FB.analysis.METRICS).filter(([k]) => k !== 'profitVsTarget');
    const sv = S.solve;
    if (!vars.some(v => v.key === sv.varKey)) sv.varKey = vars[0] ? vars[0].key : 'flat';
    const r = S.solveResult;
    let result = '';
    if (r) {
      if (!r.ok) result = `<div class="note warn">${icon('warn')}<div>${esc(r.reason)}</div></div>`;
      else {
        const v = r.unit === 'pct' ? pct(r.value, 3) : r.unit === 'factor' ? numf(r.value, 3) + '×' : money(r.value, { dec: 0 });
        const R2 = r.result;
        result = `<div class="note info">${icon('target')}<div><b>${esc(r.varLabel)}: ${esc(v)}</b>. That gives a client fee of ${esc(money(R2.clientFee))}, net revenue of ${esc(money(R2.netRevenue))}, and an effort allowance of ${esc(money(R2.effortAllowance))}.${r.warning ? ' ' + esc(r.warning) : ''}
          <div class="acts">${btn('solve-apply', 'Apply to this scenario', { cls: 'sm' })}${btn('solve-new', 'Save as a new scenario', { cls: 'sm ghost' })}</div></div></div>`;
      }
    }
    const presets = `<div class="addbar"><span class="lab">Common questions</span>
      <button class="pill" data-a="solve-preset" data-m="clientFee" data-var="flat">The client will pay at most…</button>
      <button class="pill" data-a="solve-preset" data-m="netRevenue">We need this much net revenue…</button>
      <button class="pill" data-a="solve-preset" data-m="effortHeadroom" data-var="flat" data-t="0">What fee supports our labor plan?</button></div>`;
    return sec('Solve backward', `${presets}<div class="row">
      <span class="lbl">Make</span><select id="solve_metric" data-solve="metric">${mets.map(([k, m]) => `<option value="${k}"${sv.metric === k ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
      <span class="lbl">equal</span><input class="f n" style="width:140px" id="solve_target" data-solve="target" type="text" inputmode="decimal" value="${esc(fieldText(sv.target, 'money'))}" placeholder="$ target" aria-label="Target value">
      <span class="lbl">by changing</span><select id="solve_var" data-solve="varKey">${vars.map(v => `<option value="${esc(v.key)}"${sv.varKey === v.key ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
      ${btn('solve', 'Solve', { cls: 'primary sm', icon: 'target' })}</div>${result}`, { hint: 'You choose what moves; nothing else changes. A negotiated adjustment changes the client fee without touching consultants.' });
  }

  function compareTab(ctx) {
    const { p, S } = ctx;
    const ref = p.scenarios.some(s => s.id === S.compareRef) ? S.compareRef : (p.preferredId || p.scenarios[0].id);
    const c = FB.analysis.compare(p, S.settings, ref);
    const fmt = (unit, v) => v === null || v === undefined ? '—' : unit === 'money' ? money(v) : unit === 'money2' ? money(v, { dec: 2 }) : unit === 'pct' ? pct(v) : unit === 'hours' ? numf(v, 0) : numf(v);
    const head = c.scenarios.map(s => `<th class="r"><div class="colhead"><span>${s.id === p.preferredId ? icon('starFill') + ' ' : ''}${esc(s.name)}</span>${s.id === ref ? '<span class="kind">Reference</span>' : `<button class="link small" data-a="cmp-ref" data-id="${esc(s.id)}">Use as reference</button>`}</div></th>`).join('');
    const rows = c.rows.filter(r => r.values.some(v => v !== null && v !== 0)).map(r => `<tr><td>${esc(r.label)}</td>${r.values.map((v, i) => {
      const d = r.deltas[i], dp = r.deltaPct[i];
      const show = c.scenarios[i].id !== ref && d !== null && Math.abs(d) >= 0.5;
      return `<td class="r"><b>${esc(fmt(r.unit, v))}</b>${show ? `<span class="cellsub ${d > 0 ? 'delta-up' : 'delta-down'}">${esc((d > 0 ? '+' : '−') + fmt(r.unit, Math.abs(d)))}${dp !== null && r.unit !== 'pct' ? ' (' + (dp > 0 ? '+' : '') + numf(dp, 1) + '%)' : ''}</span>` : ''}</td>`;
    }).join('')}</tr>`).join('');
    const phRows = c.phaseRows.map(r => `<tr><td>${esc(r.label)}</td>${r.values.map(v => `<td class="r">${esc(money(v))}</td>`).join('')}</tr>`).join('');
    const acts = `<tr><td></td>${c.scenarios.map(s => `<td class="r">${s.id === p.preferredId ? '<span class="tag blue">Preferred</span>' : btn('prefer', 'Prefer', { cls: 'sm', data: { id: s.id } })} ${btn('pick-scen', 'Open', { cls: 'sm ghost', data: { id: s.id } })}</td>`).join('')}</tr>`;
    return sec('Compare scenarios', `<div class="tw"><table class="t t-matrix"><thead><tr><th>Measure</th>${head}</tr></thead><tbody>${rows}<tr class="sect"><td colspan="${c.scenarios.length + 1}">Basic services by phase</td></tr>${phRows}${acts}</tbody></table></div>
      <div class="chart">${compareSvg(c)}</div>`, { hint: 'Changes are shown against the reference scenario. Every scenario is measured the same way, whatever method built it.' });
  }

  function compareSvg(c) {
    const items = c.scenarios.map(s => ({ name: s.name, arch: s.result.present.arch, cons: s.result.consultantClient, other: s.result.present.itemsClient }));
    const max = Math.max(1, ...items.map(i => Math.max(0, i.arch) + Math.max(0, i.cons) + Math.max(0, i.other)));
    const W = 640, L = 170, R = 86, rowH = 28, H = items.length * rowH + 30;
    const x = v => (Math.max(0, v) / max) * (W - L - R);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Client fee by scenario">${items.map((it, i) => {
      const y = 8 + i * rowH;
      const a = x(it.arch), b = x(it.cons), o = x(it.other);
      return `<text x="${L - 8}" y="${y + 15}" text-anchor="end" class="lab">${esc(it.name.length > 24 ? it.name.slice(0, 23) + '…' : it.name)}</text>
      <rect x="${L}" y="${y + 3}" width="${a}" height="16" fill="var(--blue)"/><rect x="${L + a}" y="${y + 3}" width="${b}" height="16" fill="var(--cons-1)"/><rect x="${L + a + b}" y="${y + 3}" width="${o}" height="16" fill="var(--blue-soft)"/>
      <text x="${L + a + b + o + 6}" y="${y + 15}">${esc(U.moneyShort(it.arch + it.cons + it.other))}</text>`;
    }).join('')}<line x1="${L}" x2="${L}" y1="4" y2="${H - 22}" class="zero"/>
    <g transform="translate(${L},${H - 8})"><rect width="10" height="10" y="-9" fill="var(--blue)"/><text x="14">Arch Nexus</text><rect x="90" width="10" height="10" y="-9" fill="var(--cons-1)"/><text x="104">Consultants</text><rect x="190" width="10" height="10" y="-9" fill="var(--blue-soft)"/><text x="204">Services and other</text></g></svg>`;
  }

  /* ================================================================ finalize */

  function finalize(ctx) {
    const { p, sc, res, S } = ctx;
    const pref = p.scenarios.find(s => s.id === p.preferredId);
    const v = FB.exporter.validate(res);
    const prefLine = `<div class="row">${p.scenarios.map(s => `<button class="scn" data-a="prefer" data-id="${esc(s.id)}" aria-pressed="${s.id === p.preferredId}">${s.id === p.preferredId ? icon('starFill') : icon('star')}<span>${esc(s.name)}</span></button>`).join('')}</div>
      ${pref && pref.id !== sc.id ? `<div class="note info">${icon('info')}<div>Exports and snapshots use the scenario you are viewing (${esc(sc.name)}). ${btn('pick-scen', 'View the preferred scenario', { cls: 'sm', data: { id: pref.id } })}</div></div>` : ''}
      ${!pref ? '<p class="muted">Mark the scenario you intend to propose.</p>' : ''}`;
    const val = validationBlock(v);
    const exp = exportBlock(ctx, v);
    const snaps = snapshotBlock(ctx);
    const contract = p.contract ? contractBlock(ctx) : '';
    const backup = `<div class="row">${btn('export-json', 'Download proposal (JSON)', { cls: 'sm', icon: 'download' })}<label class="btn sm ghost" for="import-json">${icon('upload')}Import a JSON file</label><input type="file" id="import-json" accept="application/json,.json" class="sr" data-change="import"></div>
      <p class="muted small">A portable backup of this proposal, including scenarios and snapshots. Importing creates a separate proposal.</p>`;
    return sec('Preferred scenario', prefLine, { right: scopeScen(ctx) }) + sec('Check before exporting', val) + exp + snaps + contract + sec('Backup', backup);
  }

  function validationBlock(v) {
    if (v.ok && !v.review.length) return `<div class="note ok">${icon('check')}<div>Everything reconciles. Phase, discipline, package, and project totals agree at the presented rounding.</div></div>`;
    const items = [];
    v.reconcile.forEach(m => items.push(`<div class="note err">${icon('warn')}<div>${esc(m)}</div></div>`));
    v.blocking.forEach(w => items.push(`<div class="note err">${icon('warn')}<div>${esc(w.message)}</div></div>`));
    v.review.forEach(w => items.push(`<div class="note warn">${icon('warn')}<div>${esc(w.message)}</div></div>`));
    return items.join('');
  }

  function exportBlock(ctx, v) {
    const { p, S, res } = ctx;
    const ex = FB.exporter.EXPORTS;
    const pick = S.exportPick || 'summary';
    const blocked = !v.ok && !S.exportAck;
    const row = e => `<tr><td><button class="link" data-a="exp-pick" data-id="${e.id}">${esc(e.label)}</button></td>
      <td class="r">${btn('exp-copy', 'Copy for Word', { cls: 'sm', icon: 'copy', data: { id: e.id }, disabled: blocked })} ${btn('exp-csv', 'CSV', { cls: 'sm ghost', data: { id: e.id }, disabled: blocked })}</td></tr>`;
    const client = ex.filter(e => e.audience === 'client').map(row).join('');
    const internal = ex.filter(e => e.audience === 'internal').map(row).join('');
    const pkgSel = p.packages.length > 1 ? `<label class="lbl" for="exp_pkg">Matrix for</label><select id="exp_pkg" data-change="exp-pkg"><option value="">All packages</option>${p.packages.map(k => `<option value="${esc(k.id)}"${S.exportPkg === k.id ? ' selected' : ''}>${esc(k.name)}</option>`).join('')}</select>` : '';
    const t = FB.exporter.tables(p, ctx.sc, res, pick, { pkgId: S.exportPkg || '' });
    const preview = `<div class="panel stack" style="padding:14px"><div class="row" style="justify-content:space-between"><h3>${esc(t.title)}</h3><span class="tag ${t.audience === 'internal' ? 'warn' : 'blue'}">${t.audience === 'internal' ? 'Internal only' : 'Client-facing'}</span></div><div class="tw">${previewTable(t)}</div>${(t.extra || []).map(x => `<h3>${esc(x.title)}</h3><div class="tw">${previewTable(x.table)}</div>`).join('')}${(t.notes || []).map(n => `<p class="muted small">${esc(n)}</p>`).join('')}</div>`;
    return sec('Export', `${!v.ok ? `<label class="chk"><input type="checkbox" data-a-change="exp-ack"${S.exportAck ? ' checked' : ''}> Export anyway with the issues listed above</label>` : ''}
      <div class="cols2"><div class="stack"><h3>Client-facing</h3><div class="tw"><table class="t"><tbody>${client}</tbody></table></div>
      <div class="row">${btn('exp-xlsx', 'Excel workbook (client-facing)', { cls: 'sm', icon: 'download', data: { aud: 'client' }, disabled: blocked })}${pkgSel}</div></div>
      <div class="stack"><h3>Internal</h3><div class="tw"><table class="t"><tbody>${internal}</tbody></table></div>
      <div class="row">${btn('exp-xlsx', 'Excel workbook (everything)', { cls: 'sm', icon: 'download', data: { aud: 'all' }, disabled: blocked })}</div>
      <p class="muted small">Client-facing tables never include costs, markups, internal items, labor plans, or profit.</p></div></div>
      ${preview}`, { hint: 'Copy for Word pastes a formatted table. CSV and Excel keep numbers as numbers.' });
  }

  function previewTable(t) {
    const fmt = FB.exporter.fmtCell;
    return `<table class="t"><thead><tr>${t.columns.map((c, j) => `<th class="${j ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r => `<tr class="${r.kind || ''}">${r.cells.map((v, j) => `<td class="${j ? 'r' : ''}">${esc(fmt(v, t.columns[j] ? t.columns[j].type : 'text'))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function snapshotBlock(ctx) {
    const { p, S } = ctx;
    const kinds = { decision: ['Decision point', ''], approved: ['Approved internal fee', 'blue'], contract: ['Executed contract', 'ok'] };
    const rows = [...p.snapshots].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(s => {
      const re = FB.analysis.recomputeSnapshot(s);
      const verified = re && Math.abs(re.present.clientFee - s.summary.presentedClientFee) < 0.5;
      const k = kinds[s.kind] || kinds.decision;
      return `<tr><td><b>${esc(s.name)}</b>${s.note ? `<div class="muted small">${esc(s.note)}</div>` : ''}</td><td><span class="tag ${k[1]}">${k[0]}</span></td><td>${esc(s.date)}</td><td>${esc(s.scenarioName)}</td>
        <td class="r">${esc(money(has(s.legacyValue) ? num(s.legacyValue) : s.summary.presentedClientFee))}</td>
        <td>${s.frozen ? (verified ? '<span class="tag ok">Reproduces</span>' : '<span class="tag err">Differs</span>') : '<span class="tag">Value only</span>'}</td>
        <td class="r tight">${s.frozen ? btn('snap-restore', 'Open as scenario', { cls: 'sm ghost', data: { id: s.id } }) : ''}${S.confirm === 'del-snap:' + s.id ? ` ${btn('snap-del', 'Delete', { cls: 'sm dtext', data: { id: s.id } })}${btn('cancel', 'Keep', { cls: 'sm ghost' })}` : ibtn('ask', 'trash', 'Delete snapshot', { data: { k: 'del-snap:' + s.id } })}</td></tr>`;
    }).join('');
    const body = `<p class="lead">A scenario is a working draft. A snapshot freezes one scenario and the project facts it used, so its numbers can always be reproduced. An approved internal fee is a decision; an executed contract is what was signed.</p>
      <div class="row"><input type="text" id="snap-note" placeholder="Note (optional)" aria-label="Snapshot note" style="flex:1 1 220px">
        ${btn('snap', 'Save approved internal fee', { cls: 'sm', icon: 'snap', data: { kind: 'approved' } })}
        ${btn('snap', 'Save executed contract', { cls: 'sm', icon: 'snap', data: { kind: 'contract' } })}
        ${btn('snap', 'Save decision point', { cls: 'sm ghost', data: { kind: 'decision' } })}</div>
      ${rows ? `<div class="tw"><table class="t"><thead><tr><th>Snapshot</th><th>Kind</th><th>Date</th><th>Scenario</th><th class="r">Client fee</th><th>Check</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted small">No snapshots yet.</p>'}`;
    return sec('Snapshots', body);
  }

  function contractBlock(ctx) {
    const { p, S } = ctx;
    const cs = FB.analysis.contractStatus(p);
    if (!cs) return '';
    const st = [['proposed', 'Proposed'], ['accepted', 'Accepted'], ['rejected', 'Rejected']];
    const rows = p.changes.map(ch => `<tr class="${ch.status === 'rejected' ? 'off' : ''}"><td>${tf('changes#' + ch.id + '.label', ch.label, { aria: 'Change description', ph: 'Additional scope' })}</td>
      <td class="w-money">${nf('changes#' + ch.id + '.amount', ch.amount, { kind: 'money', pre: '$', aria: 'Amount' })}</td>
      <td>${sel('changes#' + ch.id + '.status', ch.status, st, { aria: 'Status' })}</td><td class="muted small">${esc(ch.added || '')}</td>
      <td class="tight">${ibtn('del-change', 'trash', 'Remove', { data: { id: ch.id } })}</td></tr>`).join('');
    return sec('Contract and additional scopes', `<dl class="kv" style="max-width:520px">
        <dt>Original contract (${esc(cs.snapshot.name)}, ${esc(cs.snapshot.date)})</dt><dd>${esc(money(cs.original))}</dd>
        <dt>Accepted additional scopes</dt><dd>${esc(signed(cs.accepted))}</dd>
        <div class="sep"></div><dt><b>Current contract value</b></dt><dd>${esc(money(cs.current))}</dd>
        <dt>Pending (proposed)</dt><dd>${esc(signed(cs.pending))}</dd><dt>If pending are accepted</dt><dd>${esc(money(cs.ifAccepted))}</dd></dl>
      <div class="tw"><table class="t"><thead><tr><th>Additional scope</th><th class="r">Amount</th><th>Status</th><th>Added</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">None yet.</td></tr>'}</tbody></table></div>
      <div class="row">${btn('add-change', 'Add additional scope', { cls: 'sm', icon: 'plus' })}${btn('copy-changes', 'Copy contract summary for Word', { cls: 'sm ghost', icon: 'copy' })}</div>
      <p class="muted small">Rejected scopes stay here for the record and never count or export. This is a light record, not contract administration; Vantagepoint remains the system of record.</p>`);
  }

  /* ================================================================ settings */

  function settingsSheet(ctx) {
    const { S } = ctx;
    const s = S.settings;
    const sf = (path, v, o) => nf('$settings.' + path, v, o);
    const tpl = s.templates.map(t => `<details class="more"><summary>${icon('chev')}${esc(t.name)}${t.id === s.defaultTemplateId ? ' <span class="tag blue">Default</span>' : ''}</summary><div class="inner">
      <div class="row">${tf('$settings.templates#' + t.id + '.name', t.name, { aria: 'Template name' })}${t.id !== s.defaultTemplateId ? btn('tpl-default', 'Make default', { cls: 'sm ghost', data: { id: t.id } }) : ''}${s.templates.length > 1 ? btn('tpl-del', 'Delete', { cls: 'sm ghost dtext', data: { id: t.id } }) : ''}</div>
      ${t.source ? `<p class="muted small">${esc(t.source)}</p>` : ''}
      <div class="tw"><table class="t"><thead><tr><th>Phase</th><th class="r">Default share</th><th class="r">Months</th><th></th></tr></thead><tbody>
      ${t.phases.map((ph, i) => `<tr><td>${tf('$settings.templates#' + t.id + '.phases.' + i + '.name', ph.name, { aria: 'Phase' })}</td><td class="w-pct">${nf('$settings.templates#' + t.id + '.phases.' + i + '.pct', ph.pct, { unit: '%', aria: 'Default share' })}</td><td class="w-pct">${nf('$settings.templates#' + t.id + '.phases.' + i + '.months', ph.months, { unit: 'mo', aria: 'Months' })}</td><td class="tight">${ibtn('tpl-ph-del', 'trash', 'Remove', { data: { id: t.id, i } })}</td></tr>`).join('')}
      </tbody></table></div>${btn('tpl-ph-add', 'Add phase', { cls: 'sm', icon: 'plus', data: { id: t.id } })}</div></details>`).join('');
    const roles = s.roles.map(r => `<tr><td>${tf('$settings.roles#' + r.id + '.name', r.name, { aria: 'Role' })}</td><td class="w-money">${sf('roles#' + r.id + '.billRate', r.billRate, { kind: 'money', pre: '$', unit: '/h', aria: 'Billing rate' })}</td><td class="w-money">${sf('roles#' + r.id + '.costRate', r.costRate, { kind: 'money', pre: '$', unit: '/h', aria: 'Cost rate', ph: 'optional' })}</td><td class="tight">${ibtn('set-role-del', 'trash', 'Remove', { data: { id: r.id } })}</td></tr>`).join('');
    const body = `
      <div class="note info">${icon('info')}<div>These defaults are stored for you only${ctx.st.S.mode === 'db' ? ' (your account, inside this tool)' : ' (this browser)'}. They are not firm-wide policy. New proposals copy them; existing proposals keep their own values.</div></div>
      ${sec('Target-profit planning', `<div class="grid-fields">
        <div class="field"><span class="lbl">Default target profit</span>${sf('targetProfitPct', s.targetProfitPct, { unit: '%', aria: 'Target profit percent' })}</div>
        <div class="field"><span class="lbl">Measured as a share of</span>${sel('$settings.targetProfitBasis', s.targetProfitBasis, [['clientFee', 'Client fee (EAC method)'], ['netRevenue', 'Net revenue']], { aria: 'Target profit basis' })}</div>
        <div class="field"><span class="lbl">Effort value per FTE-month</span>${sf('valuePerFteMonth', s.valuePerFteMonth, { kind: 'money', pre: '$', aria: 'Value per FTE-month' })}</div>
        <div class="field"><span class="lbl">Hours per FTE-month</span>${sf('hoursPerFteMonth', s.hoursPerFteMonth, { kind: 'dec2', aria: 'Hours per FTE month' })}</div></div>
        <p class="muted small">15% of the client fee and $16,000 per FTE-month are the values in the EAC Plan calculator. That workbook labels $16,000 as an average cost per FTE-month but divides billing-rate effort by it; adjust if your planning convention differs.</p>`)}
      ${sec('Detailed profitability', `<div class="grid-fields"><div class="field"><span class="lbl">Overhead as % of direct labor</span>${sf('overheadRate', has(s.overheadRate) ? num(s.overheadRate) * 100 : '', { unit: '%', aria: 'Overhead rate', ph: 'not set' })}</div></div>
        <p class="muted small">Leave blank until Arch Nexus has an agreed figure. Detailed profit and margins show as unavailable until this and role cost rates are set.</p>`)}
      ${sec('Default roles and rates', `<div class="tw"><table class="t"><thead><tr><th>Role</th><th class="r">Billing rate</th><th class="r">Cost rate</th><th></th></tr></thead><tbody>${roles}</tbody></table></div>
        <div class="row">${btn('set-role-add', 'Add role', { cls: 'sm', icon: 'plus' })}${btn('set-rates-example', 'Fill blank rates with example values', { cls: 'sm ghost' })}</div><p class="muted small">No firm rates were provided, so defaults start blank.</p>`)}
      ${sec('Phase templates', tpl + `<div class="row">${btn('tpl-add', 'New template', { cls: 'sm', icon: 'plus' })}</div>`)}
      ${sec('Presentation and warnings', `<div class="grid-fields">
        <div class="field"><span class="lbl">Default rounding for new proposals</span>${sel('$settings.roundingInc', s.roundingInc, [[1, 'Nearest $1'], [10, 'Nearest $10'], [100, 'Nearest $100'], [1000, 'Nearest $1,000']], { aria: 'Rounding' })}</div>
        <div class="field"><span class="lbl">Warn when consultants exceed</span>${sf('consultantShareWarnPct', s.consultantShareWarnPct, { unit: '% of basic', aria: 'Consultant share warning' })}</div>
        <div class="field"><span class="lbl">Warn when a phase needs more than</span>${sf('maxFtePerPhase', s.maxFtePerPhase, { unit: 'FTE', aria: 'FTE warning' })}</div></div>`)}
      ${sec('Libraries', `<div class="field"><span class="lbl">Consultant disciplines (one per line)</span><textarea id="lib-cons" data-lib="consultantLibrary">${esc(s.consultantLibrary.join('\n'))}</textarea></div>
        <div class="field"><span class="lbl">Additional services (one per line)</span><textarea id="lib-svc" data-lib="serviceLibrary">${esc(s.serviceLibrary.join('\n'))}</textarea></div>`)}
      ${sec('Theme', `<div class="seg" role="group" aria-label="Theme">${[['', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button data-a="theme" data-v="${v}" aria-pressed="${(S.theme || '') === v}">${l}</button>`).join('')}</div>`)}`;
    return `<div class="sheet-back" data-a="settings-close"></div><aside class="sheet" role="dialog" aria-modal="true" aria-label="Settings"><header><h2>Settings</h2>${ibtn('settings-close', 'x', 'Close settings')}</header><div class="body">${body}</div></aside>`;
  }

  /* ================================================================ empty */

  function empty(ctx) {
    return `<div class="pbody"><div class="empty-note"><h2>Start with a fee</h2><p>Percentage, staffing, area, or lump sum, across work packages, phases, and consultants.</p>
      <div class="row">${btn('newfee', 'Start a new fee', { cls: 'primary', icon: 'plus' })}${btn('open-example', 'Open the example', { cls: '' })}</div></div></div>`;
  }

  FB.views = {
    buildOutputs, header, banners, strip, rail, railWarnings, newFee, establish, develop, analyze, finalize, settingsSheet, empty,
    stressTable, stressSpec, sensSvg, phaseBarsSvg, effortSvg, short
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

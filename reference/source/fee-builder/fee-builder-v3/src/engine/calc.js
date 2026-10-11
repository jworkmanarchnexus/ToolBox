/*
 * Fee Builder engine: scenario calculation.
 *
 * compute(proposal, scenario, settings) -> result
 *
 * Pure and deterministic: the same inputs always give the same result. Nothing here
 * touches the DOM. All money is full precision; `present()` produces the rounded
 * figures every screen and export uses, so displayed numbers always reconcile.
 *
 * Vocabulary (docs/CALCULATIONS.md):
 *  Design fee          the package fee for basic services, including consultants marked
 *                      "Included in design fee".
 *  Arch Nexus fee      design fee minus included consultants.
 *  Basic services      design fee plus consultants marked "Additional to design fee".
 *  Client fee          basic services plus client-facing services, reimbursables,
 *                      contingency, and adjustments.
 *  Net revenue         client fee minus consultant costs and pass-through costs.
 *  Effort allowance    net revenue minus held contingency, internal reserves, and the
 *                      target-profit amount (the EAC "max amount to plan effort to").
 */
(function (root) {
  'use strict';
  const FB = root.FB || (root.FB = {});
  const { num, has, sum, controlledRound, roundTo } = FB.money;
  const HALF = 0.5; // dollars; tolerance for "is this balance meaningfully non-zero"

  /* ------------------------------------------------------------------ schedule */

  function schedule(p, sc) {
    let cursor = 0;
    const rows = p.phases.map(ph => {
      const s = (sc.schedule && sc.schedule[ph.id]) || {};
      const months = Math.max(0, num(s.months));
      const start = has(s.start) ? Math.max(0, num(s.start)) : cursor;
      const end = start + months;
      cursor = Math.max(cursor, end);
      return { phaseId: ph.id, months, start, end, explicitStart: has(s.start) };
    });
    const byId = {};
    rows.forEach(r => { byId[r.phaseId] = r; });
    return { rows, byId, totalMonths: rows.reduce((m, r) => Math.max(m, r.end), 0) };
  }

  /* ------------------------------------------------------------------ labor */

  function laborPlan(p, sc, calc, settings, sched) {
    const rf = num(sc.finance && sc.finance.rateFactor) || 1;
    const hpm = num(settings.hoursPerFteMonth) || 2080 / 12;
    const roles = {};
    p.roles.forEach(r => { roles[r.id] = r; });
    const byPhase = {};
    p.phases.forEach(ph => { byPhase[ph.id] = { hours: 0, value: 0, cost: 0, costKnown: true }; });
    const missingRate = [];
    const missingCost = new Set();
    const rows = (calc.labor && calc.labor.rows || []).map(row => {
      const role = roles[row.roleId] || { name: 'Unknown role', billRate: '', costRate: '' };
      const bill = num(role.billRate) * rf;
      const costRate = has(role.costRate) ? num(role.costRate) : null;
      const cells = {};
      let hours = 0, value = 0;
      p.phases.forEach(ph => {
        const raw = row.cells ? row.cells[ph.id] : '';
        let h;
        if (calc.labor.mode === 'staffing') h = num(raw) * (sched.byId[ph.id] ? sched.byId[ph.id].months : 0) * hpm;
        else h = num(raw);
        const v = h * bill;
        cells[ph.id] = { hours: h, value: v, fte: calc.labor.mode === 'staffing' ? num(raw) : null };
        const bp = byPhase[ph.id];
        bp.hours += h; bp.value += v;
        if (h !== 0) {
          if (costRate === null) { bp.costKnown = false; missingCost.add(role.name); } else bp.cost += h * costRate;
        }
        hours += h; value += v;
      });
      if (hours !== 0 && !(num(role.billRate) > 0)) missingRate.push(role.name || 'Unnamed role');
      return { id: row.id, roleId: row.roleId, roleName: role.name, billRate: bill, costRate, cells, hours, value };
    });
    const hours = sum(rows, r => r.hours);
    const value = sum(rows, r => r.value);
    const costKnown = p.phases.every(ph => byPhase[ph.id].costKnown);
    const cost = costKnown ? sum(p.phases, ph => byPhase[ph.id].cost) : null;
    return { mode: calc.labor.mode, rows, byPhase, hours, value, cost, missingRate, missingCost: [...missingCost] };
  }

  /* ------------------------------------------------------------------ allocation */

  /**
   * Distribute `total` over phases by an allocation spec ({phaseId: {pct, amt}}).
   * Dollar entries take their amount; percent entries take total x pct. Whatever is
   * left is the unallocated balance (negative = over-allocated). Pure; no balancing.
   */
  function allocateBySpec(total, spec, phases) {
    const byPhase = {};
    let allocated = 0, pctSum = 0;
    phases.forEach(ph => {
      const e = spec[ph.id] || {};
      let v = 0;
      if (has(e.amt)) { v = num(e.amt); pctSum += total ? v / total * 100 : 0; }
      else if (has(e.pct)) { v = total * num(e.pct) / 100; pctSum += num(e.pct); }
      byPhase[ph.id] = v;
      allocated += v;
    });
    return { byPhase, allocated, unallocated: total - allocated, pctSum };
  }

  /**
   * Rebalance an allocation spec so the percentages total 100%. Locked rows and
   * dollar rows keep their values; unlocked percent rows are scaled in proportion
   * (or split evenly when they are all zero). Returns a NEW spec, or an error when
   * nothing can move. This is an explicit user action, never automatic.
   */
  function rebalance(spec, phases, total) {
    const out = {};
    phases.forEach(ph => { out[ph.id] = Object.assign({ pct: '', amt: '', lock: false }, spec[ph.id] || {}); });
    let fixedPct = 0;
    const free = [];
    phases.forEach(ph => {
      const e = out[ph.id];
      if (has(e.amt)) fixedPct += total ? num(e.amt) / total * 100 : 0;
      else if (e.lock) fixedPct += num(e.pct);
      else free.push(ph.id);
    });
    if (!free.length) return { ok: false, reason: 'Every phase is locked or entered in dollars. Unlock a phase to rebalance.' };
    const target = 100 - fixedPct;
    if (target < -1e-9) return { ok: false, reason: 'Locked phases already exceed 100%. Reduce a locked phase first.' };
    const cur = sum(free, id => num(out[id].pct));
    // Round to 2 decimals, putting the residue on the largest free row so the sum is exact.
    const vals = free.map(id => (cur > 0 ? num(out[id].pct) / cur * target : target / free.length));
    const rounded = vals.map(v => Math.round(v * 100) / 100);
    const resid = Math.round((target - sum(rounded)) * 100) / 100;
    let bi = 0;
    rounded.forEach((v, i) => { if (v > rounded[bi]) bi = i; });
    rounded[bi] = Math.round((rounded[bi] + resid) * 100) / 100;
    free.forEach((id, i) => { out[id].pct = rounded[i]; });
    return { ok: true, spec: out };
  }

  /* ------------------------------------------------------------------ package */

  function packageMetrics(pkg, calc) {
    return {
      cost: has(calc.costOverride) ? num(calc.costOverride) : num(pkg.cost),
      area: has(calc.areaOverride) ? num(calc.areaOverride) : num(pkg.area),
      units: has(calc.unitsOverride) ? num(calc.unitsOverride) : num(pkg.units),
      costOverridden: has(calc.costOverride)
    };
  }

  function componentAmount(c, m, labor, phases) {
    switch (c.method) {
      case 'pctCost': return m.cost * num(c.pct) / 100;
      case 'fixed': return num(c.amount);
      case 'area': return (has(c.qty) ? num(c.qty) : m.area) * num(c.rate);
      case 'unit': return (has(c.qty) ? num(c.qty) : m.units) * num(c.rate);
      case 'labor': return sum(coveredPhases(c, phases), ph => labor.byPhase[ph.id].value);
      default: return 0;
    }
  }

  function coveredPhases(c, phases) {
    if (!Array.isArray(c.covers)) return phases;
    const set = new Set(c.covers);
    return phases.filter(ph => set.has(ph.id));
  }

  function consultantBase(con, pricing, m) {
    // Returns {client, cost} for every type except pctFee (which needs the design fee).
    const mk = num(pricing.markup) / 100;
    const v = num(pricing.value);
    if (pricing.type === 'quote') return { client: v * (1 + mk), cost: v };
    if (pricing.type === 'fixed') return { client: v, cost: has(pricing.cost) ? num(pricing.cost) : v / (1 + mk) };
    if (pricing.type === 'pctCost') { const cl = m.cost * v / 100; return { client: cl, cost: has(pricing.cost) ? num(pricing.cost) : cl / (1 + mk) }; }
    return null;
  }

  function computePackage(p, sc, pkg, settings, sched, warn) {
    const calc = sc.pkgs[pkg.id];
    const phases = p.phases;
    const m = packageMetrics(pkg, calc);
    const labor = laborPlan(p, sc, calc, settings, sched);
    const where = { pkgId: pkg.id, pkgName: pkg.name };

    if (labor.missingRate.length) warn('warn', 'missingRate', where, { roles: labor.missingRate });

    // 1. Components
    const comps = calc.components.map(c => {
      const amount = componentAmount(c, m, labor, phases);
      if (c.method === 'pctCost' && num(c.pct) !== 0 && !(m.cost > 0)) warn('warn', 'missingCost', where, { label: c.label });
      if (c.method === 'area' && num(c.rate) !== 0 && !has(c.qty) && !(m.area > 0)) warn('warn', 'missingArea', where, { label: c.label });
      if (c.method === 'unit' && num(c.rate) !== 0 && !has(c.qty) && !(m.units > 0)) warn('warn', 'missingUnits', where, { label: c.label });
      if (c.method === 'labor' && !labor.rows.length) warn('info', 'emptyLabor', where, { label: c.label });
      return { id: c.id, label: c.label, method: c.method, amount, covers: c.covers, byPhase: {}, unallocated: 0 };
    });
    const compTotal = sum(comps, c => c.amount);

    // 2. Phase distribution of components
    const pool = comps.filter(c => c.method !== 'labor');
    const poolTotal = sum(pool, c => c.amount);
    const anySubset = pool.some(c => Array.isArray(c.covers));
    const spec = calc.alloc || {};
    const specAlloc = allocateBySpec(poolTotal, spec, phases);
    const pctEq = {};
    phases.forEach(ph => {
      const e = spec[ph.id] || {};
      pctEq[ph.id] = has(e.amt) ? (poolTotal ? num(e.amt) / poolTotal * 100 : 0) : num(e.pct);
    });
    if (anySubset && phases.some(ph => has((spec[ph.id] || {}).amt))) warn('warn', 'amtWithCoverage', where, {});
    pool.forEach(c => {
      if (!anySubset) {
        const share = poolTotal ? c.amount / poolTotal : 0;
        phases.forEach(ph => { c.byPhase[ph.id] = specAlloc.byPhase[ph.id] * share; });
        c.unallocated = c.amount - sum(phases, ph => c.byPhase[ph.id]);
      } else if (!Array.isArray(c.covers)) {
        phases.forEach(ph => { c.byPhase[ph.id] = c.amount * pctEq[ph.id] / 100; });
        c.unallocated = c.amount - sum(phases, ph => c.byPhase[ph.id]);
      } else {
        const cov = new Set(c.covers);
        const S = sum(phases.filter(ph => cov.has(ph.id)), ph => pctEq[ph.id]);
        phases.forEach(ph => {
          if (!cov.has(ph.id)) c.byPhase[ph.id] = 0;
          else c.byPhase[ph.id] = S > 0 ? c.amount * pctEq[ph.id] / S : c.amount / cov.size;
        });
        if (!(S > 0) && c.amount) warn('info', 'evenSplit', where, { label: c.label });
        c.unallocated = 0;
      }
    });
    comps.filter(c => c.method === 'labor').forEach(c => {
      const cov = new Set(coveredPhases(c, phases).map(ph => ph.id));
      phases.forEach(ph => { c.byPhase[ph.id] = cov.has(ph.id) ? labor.byPhase[ph.id].value : 0; });
      c.unallocated = 0;
    });
    const compByPhase = {};
    phases.forEach(ph => { compByPhase[ph.id] = sum(comps, c => c.byPhase[ph.id]); });
    const compUnalloc = sum(comps, c => c.unallocated);
    const allocatedComp = sum(phases, ph => compByPhase[ph.id]);
    const pctSum = anySubset ? null : specAlloc.pctSum;

    if (compUnalloc > HALF) warn(calc.allowUnallocated ? 'info' : 'warn', 'unallocated', where, { amount: compUnalloc, intentional: !!calc.allowUnallocated });
    if (compUnalloc < -HALF) warn('error', 'overAllocated', where, { amount: -compUnalloc });

    // 3. Consultants (client-facing amount and cost to Arch Nexus)
    const cons = [];
    p.roster.forEach(r => {
      const pr = calc.cons[r.id];
      if (!pr || !pr.on) return;
      const base = consultantBase(r, pr, m);
      cons.push({
        id: r.id, name: r.name, discipline: r.discipline, type: pr.type, value: pr.value,
        treatment: pr.treatment, markupPct: num(pr.markup), split: pr.split, alloc: pr.alloc,
        client: base ? base.client : 0, cost: base ? base.cost : 0, pctFee: !base, explicitCost: has(pr.cost), pricing: pr
      });
      if (pr.type === 'pctCost' && num(pr.value) !== 0 && !(m.cost > 0)) warn('warn', 'missingCost', where, { label: r.name });
    });
    const inc = cons.filter(c => c.treatment === 'included');
    const fixedIncluded = sum(inc.filter(c => !c.pctFee), c => c.client);
    const pIncluded = sum(inc.filter(c => c.pctFee), c => num(c.value) / 100);

    // 4. Design fee
    let design;
    if (calc.basis === 'arch') {
      if (pIncluded >= 1) { warn('error', 'pctOver', where, { pct: pIncluded * 100 }); design = compTotal + fixedIncluded; }
      else design = (compTotal + fixedIncluded) / (1 - pIncluded);
    } else design = compTotal;
    cons.forEach(c => {
      if (!c.pctFee) return;
      const mk = c.markupPct / 100;
      c.client = design * num(c.value) / 100;
      c.cost = c.explicitCost ? num(c.pricing.cost) : c.client / (1 + mk);
    });
    const includedTotal = sum(inc, c => c.client);
    const additionalTotal = sum(cons.filter(c => c.treatment === 'additional'), c => c.client);
    const arch = calc.basis === 'arch' ? compTotal : design - includedTotal;
    if (calc.basis === 'arch') design = arch + includedTotal; // exact identity after the solve

    // 5. Consultant phase split
    cons.forEach(c => {
      c.byPhase = {};
      if (c.split === 'custom') {
        const a = allocateBySpec(c.client, c.alloc || {}, phases);
        phases.forEach(ph => { c.byPhase[ph.id] = a.byPhase[ph.id]; });
        c.unallocated = a.unallocated;
        if (a.unallocated > HALF) warn('warn', 'consUnallocated', where, { name: c.name, amount: a.unallocated });
        if (a.unallocated < -HALF) warn('error', 'consOverAllocated', where, { name: c.name, amount: -a.unallocated });
      } else {
        if (allocatedComp !== 0) phases.forEach(ph => { c.byPhase[ph.id] = c.client * compByPhase[ph.id] / allocatedComp; });
        else phases.forEach(ph => { c.byPhase[ph.id] = 0; });
        c.unallocated = c.client - sum(phases, ph => c.byPhase[ph.id]);
        if (c.unallocated > HALF) warn('warn', 'consUnallocated', where, { name: c.name, amount: c.unallocated, follow: true });
      }
    });

    // 6. Arch Nexus fee by phase
    const archByPhase = {};
    let archUnalloc;
    if (calc.basis === 'arch') {
      phases.forEach(ph => { archByPhase[ph.id] = compByPhase[ph.id]; });
      archUnalloc = compUnalloc;
    } else {
      phases.forEach(ph => { archByPhase[ph.id] = compByPhase[ph.id] - sum(inc, c => c.byPhase[ph.id]); });
      archUnalloc = compUnalloc - sum(inc, c => c.unallocated);
    }
    const designByPhase = {};
    phases.forEach(ph => { designByPhase[ph.id] = archByPhase[ph.id] + sum(inc, c => c.byPhase[ph.id]); });

    if (arch < -HALF) warn('error', 'negArch', where, { arch, included: includedTotal, design });
    else phases.forEach(ph => { if (archByPhase[ph.id] < -HALF) warn('warn', 'negArchPhase', where, { phase: ph.name, amount: archByPhase[ph.id] }); });

    // 7. Matrix (exact): rows = phases [+ unallocated], cols = Arch Nexus + each consultant
    const cols = [{ key: 'arch', label: 'Arch Nexus', kind: 'arch' }].concat(cons.map(c => ({ key: c.id, label: c.name, kind: c.treatment })));
    const rows = phases.map(ph => ({ key: ph.id, label: ph.name }));
    const cells = phases.map(ph => [archByPhase[ph.id]].concat(cons.map(c => c.byPhase[ph.id])));
    const unallocRow = [archUnalloc].concat(cons.map(c => c.unallocated));
    const hasUnalloc = unallocRow.some(v => Math.abs(v) > 1e-6);
    if (hasUnalloc) { rows.push({ key: '_unalloc', label: 'Unallocated' }); cells.push(unallocRow); }

    return {
      pkgId: pkg.id, name: pkg.name, metrics: m, basis: calc.basis, labor, comps, compTotal,
      pctSum, allocatedComp, compUnalloc, anySubset,
      cons, includedTotal, additionalTotal, design, arch, basicTotal: design + additionalTotal,
      archByPhase, archUnalloc, designByPhase, compByPhase,
      consultantClient: includedTotal + additionalTotal,
      consultantCost: sum(cons, c => c.cost),
      matrix: { rows, cols, cells }
    };
  }

  /* ------------------------------------------------------------------ items */

  function itemAmount(it, ctx) {
    const pkgRes = it.pkgId ? ctx.pkgs.find(k => k.pkgId === it.pkgId) : null;
    switch (it.method) {
      case 'fixed': return num(it.amount);
      case 'pctCost': return (pkgRes ? pkgRes.metrics.cost : ctx.projectCost) * num(it.pct) / 100;
      case 'pctFee': {
        let base;
        if (it.basis === 'subtotal' && ctx.subtotal !== undefined) base = ctx.subtotal;
        else if (it.basis === 'basic') base = pkgRes ? pkgRes.basicTotal : ctx.basicTotal;
        else base = pkgRes ? pkgRes.design : ctx.designTotal;
        return base * num(it.pct) / 100;
      }
      case 'hours': return num(it.hours) * itemRate(it, ctx);
      case 'area': return (has(it.qty) ? num(it.qty) : (pkgRes ? pkgRes.metrics.area : ctx.projectArea)) * num(it.rate);
      case 'unit': return num(it.qty) * num(it.rate);
      default: return 0;
    }
  }

  function itemRate(it, ctx) {
    if (has(it.rate)) return num(it.rate);
    const role = ctx.roles[it.roleId];
    return role ? num(role.billRate) * ctx.rateFactor : 0;
  }

  function computeItems(p, sc, ctx, warn) {
    const out = [];
    const first = sc.items.filter(it => it.kind !== 'contingency' && it.kind !== 'adjustment');
    const second = sc.items.filter(it => it.kind === 'contingency' || it.kind === 'adjustment');
    const one = (it) => {
      const amt = itemAmount(it, ctx);
      const mk = num(it.markup) / 100;
      const treatment = it.kind === 'expense' ? 'internal' : (it.kind === 'adjustment' ? 'add' : it.treatment);
      let client = 0, cost = 0, reserve = 0, held = 0, hours = 0, effort = 0;
      if (it.kind === 'reimbursable') {
        cost = amt; client = amt * (1 + mk);
      } else if (it.kind === 'service') {
        client = amt;
        if (it.provider === 'pass') cost = has(it.cost) ? num(it.cost) : amt / (1 + mk);
        if (it.provider !== 'pass' && it.method === 'hours') { hours = num(it.hours); effort = amt; }
      } else if (it.kind === 'contingency') {
        client = amt;
      } else if (it.kind === 'adjustment') {
        client = amt;
      } else if (it.kind === 'expense') {
        cost = amt;
      }
      const r = { id: it.id, kind: it.kind, label: it.label, method: it.method, treatment, pkgId: it.pkgId, amount: amt, clientEffect: 0, cost: 0, reserve: 0, held: 0, hours, effort };
      if (treatment === 'add') {
        r.clientEffect = client;
        r.cost = cost;
        if (it.kind === 'contingency') r.held = client;
      } else if (treatment === 'included') {
        r.cost = cost; // covered inside the design fee, but a pass-through cost still comes out of revenue
      } else {
        // internal planning only
        if (it.kind === 'expense') r.reserve = cost;
        else r.reserve = it.kind === 'reimbursable' ? cost : amt;
        r.hours = 0; r.effort = 0;
      }
      if (it.kind === 'reimbursable' && treatment === 'add') r.cost = cost;
      if (it.method === 'pctCost' && num(it.pct) !== 0 && !((it.pkgId ? (ctx.pkgs.find(k => k.pkgId === it.pkgId) || { metrics: { cost: 0 } }).metrics.cost : ctx.projectCost) > 0)) warn('warn', 'missingCost', { itemId: it.id }, { label: it.label || kindLabel(it.kind) });
      if (it.method === 'hours' && num(it.hours) !== 0 && !(itemRate(it, ctx) > 0)) warn('warn', 'itemMissingRate', { itemId: it.id }, { label: it.label || kindLabel(it.kind) });
      void held; void reserve;
      return r;
    };
    first.forEach(it => out.push(one(it)));
    ctx.subtotal = ctx.basicTotal + sum(out.filter(r => r.kind === 'service'), r => r.clientEffect);
    second.forEach(it => out.push(one(it)));
    // Keep the user's order for display.
    const byId = {};
    out.forEach(r => { byId[r.id] = r; });
    return sc.items.map(it => byId[it.id]);
  }

  function kindLabel(k) {
    return { service: 'Additional service', reimbursable: 'Reimbursable', expense: 'Project expense', contingency: 'Contingency', adjustment: 'Adjustment' }[k] || 'Item';
  }

  /* ------------------------------------------------------------------ compute */

  function compute(p, sc, settings) {
    settings = FB.model.normalizeSettings(settings);
    const warnings = [];
    const warn = (severity, code, where, data) => warnings.push({ severity, code, where: where || {}, data: data || {}, message: message(code, data || {}, where || {}) });
    const sched = schedule(p, sc);
    const pkgs = p.packages.map(pkg => computePackage(p, sc, pkg, settings, sched, warn));
    const roles = {};
    p.roles.forEach(r => { roles[r.id] = r; });
    const rateFactor = num(sc.finance && sc.finance.rateFactor) || 1;

    const projectCost = sum(pkgs, k => k.metrics.cost);
    const projectArea = sum(pkgs, k => k.metrics.area);
    const designTotal = sum(pkgs, k => k.design);
    const basicTotal = sum(pkgs, k => k.basicTotal);
    const ctx = { pkgs, projectCost, projectArea, designTotal, basicTotal, roles, rateFactor };
    const items = computeItems(p, sc, ctx, warn);
    const subtotal = ctx.subtotal;

    const itemClient = sum(items, r => r.clientEffect);
    const clientFee = basicTotal + itemClient;
    const consultantClient = sum(pkgs, k => k.consultantClient);
    const consultantCost = sum(pkgs, k => k.consultantCost);
    const passCost = sum(items.filter(r => r.kind === 'service' || r.kind === 'reimbursable'), r => r.cost);
    const netRevenue = clientFee - consultantCost - passCost;
    const heldContingency = sum(items, r => r.held);
    const reserves = sum(items, r => r.reserve);

    // Target profit planning (EAC method, assumptions explicit).
    const tpPct = has(sc.finance && sc.finance.targetProfitPct) ? num(sc.finance.targetProfitPct) : num(settings.targetProfitPct);
    const tpBasis = settings.targetProfitBasis;
    const targetProfit = tpPct / 100 * (tpBasis === 'netRevenue' ? netRevenue : clientFee);
    const effortAllowance = netRevenue - heldContingency - reserves - targetProfit;

    // Phase view across packages.
    const phases = p.phases.map(ph => {
      const s = sched.byId[ph.id];
      const arch = sum(pkgs, k => k.archByPhase[ph.id]);
      const consClient = sum(pkgs, k => sum(k.cons, c => c.byPhase[ph.id]));
      const consMargin = sum(pkgs, k => sum(k.cons, c => (c.client ? c.byPhase[ph.id] * (c.client - c.cost) / c.client : 0)));
      const laborHours = sum(pkgs, k => k.labor.byPhase[ph.id].hours);
      const laborValue = sum(pkgs, k => k.labor.byPhase[ph.id].value);
      return { phaseId: ph.id, name: ph.name, months: s.months, start: s.start, end: s.end, arch, consClient, basic: arch + consClient, netRevenue: arch + consMargin, laborHours, laborValue };
    });
    const phaseRevTotal = sum(phases, x => x.netRevenue);
    const hpm = num(settings.hoursPerFteMonth) || 2080 / 12;
    const vpf = num(settings.valuePerFteMonth);
    phases.forEach(x => {
      x.allowance = phaseRevTotal > 0 ? effortAllowance * x.netRevenue / phaseRevTotal : null;
      x.allowanceFteMonths = x.allowance !== null && vpf > 0 ? x.allowance / vpf : null;
      x.allowanceFte = x.allowanceFteMonths !== null && x.months > 0 ? x.allowanceFteMonths / x.months : null;
      x.plannedFte = x.months > 0 ? x.laborHours / (x.months * hpm) : null;
      x.headroom = x.allowance !== null ? x.allowance - x.laborValue : null;
    });

    // Planned effort: every package's labor plan plus Arch Nexus services built from hours.
    const plannedHours = sum(pkgs, k => k.labor.hours) + sum(items, r => r.hours);
    const plannedEffort = sum(pkgs, k => k.labor.value) + sum(items, r => r.effort);
    const hasPlan = plannedHours > 0;
    const blendedRate = plannedHours > 0 ? plannedEffort / plannedHours : null;

    // Detailed (cost-based) profitability; only when the inputs exist.
    const laborCostParts = pkgs.map(k => k.labor.cost);
    const missingCostRoles = [...new Set([].concat(...pkgs.map(k => k.labor.missingCost)))];
    const unavailable = [];
    if (!hasPlan) unavailable.push('No labor plan has hours yet.');
    if (missingCostRoles.length) unavailable.push('Missing cost rates for: ' + missingCostRoles.join(', ') + '.');
    if (!has(settings.overheadRate)) unavailable.push('No overhead rate is set in Settings.');
    if (items.some(r => r.hours > 0)) {
      // Hours-based services have no role cost unless a role is chosen.
      const svcNoCost = sc.items.filter(it => it.kind === 'service' && it.method === 'hours' && it.provider !== 'pass' && it.treatment !== 'internal' && !(roles[it.roleId] && has(roles[it.roleId].costRate)));
      if (svcNoCost.length) unavailable.push('Hours-based services need a role with a cost rate.');
    }
    let detailed = null;
    if (!unavailable.length) {
      const svcCost = sum(sc.items.filter(it => it.kind === 'service' && it.method === 'hours' && it.provider !== 'pass' && it.treatment !== 'internal'), it => num(it.hours) * num(roles[it.roleId].costRate));
      const laborCost = sum(laborCostParts, x => x || 0) + svcCost;
      const overhead = laborCost * num(settings.overheadRate);
      const earned = netRevenue - heldContingency;
      const projectedProfit = earned - reserves - laborCost - overhead;
      detailed = {
        laborCost, overhead, burdenedCost: laborCost + overhead, earnedRevenue: earned,
        projectedProfit,
        margin: earned !== 0 ? projectedProfit / earned : null,
        multiplier: laborCost > 0 ? earned / laborCost : null,
        breakEvenMultiplier: 1 + num(settings.overheadRate)
      };
    }

    // Finance warnings
    if (hasPlan && plannedEffort > effortAllowance + HALF) warn('warn', 'effortOver', {}, { over: plannedEffort - effortAllowance });
    if (effortAllowance < -HALF) warn('error', 'negAllowance', {}, { amount: effortAllowance });
    if (detailed && detailed.projectedProfit < -HALF) warn('error', 'feeBelowCost', {}, { loss: -detailed.projectedProfit });
    else if (detailed && detailed.projectedProfit + HALF < targetProfit) warn('warn', 'belowTarget', {}, { profit: detailed.projectedProfit, target: targetProfit });
    const consultantSharePct = basicTotal > 0 ? consultantClient / basicTotal * 100 : null;
    if (consultantSharePct !== null && num(settings.consultantShareWarnPct) > 0 && consultantSharePct > num(settings.consultantShareWarnPct)) warn('warn', 'consultantShare', {}, { pct: consultantSharePct, limit: num(settings.consultantShareWarnPct) });
    const maxFte = num(settings.maxFtePerPhase);
    if (maxFte > 0) phases.forEach(x => {
      const f = Math.max(x.plannedFte || 0, x.allowanceFte || 0);
      if (f > maxFte) warn('warn', 'highFte', {}, { phase: x.name, fte: f, limit: maxFte });
    });
    if (rateFactor !== 1) warn('info', 'rateFactor', {}, { factor: rateFactor });

    const res = {
      scenarioId: sc.id, scenarioName: sc.name, schedule: sched, pkgs, items, phases,
      projectCost, projectArea, designTotal, basicTotal, subtotal, itemClient, clientFee,
      consultantClient, consultantCost, passCost, netRevenue, heldContingency, reserves,
      targetProfitPct: tpPct, targetProfitBasis: tpBasis, targetProfit, effortAllowance,
      effortFteMonths: vpf > 0 ? effortAllowance / vpf : null,
      plannedHours, plannedEffort, hasPlan, blendedRate,
      effortHeadroom: hasPlan ? effortAllowance - plannedEffort : null,
      detailed, detailedUnavailable: unavailable,
      archTotal: sum(pkgs, k => k.arch),
      feePctOfCost: projectCost > 0 ? clientFee / projectCost * 100 : null,
      designPctOfCost: projectCost > 0 ? designTotal / projectCost * 100 : null,
      feePerSf: projectArea > 0 ? clientFee / projectArea : null,
      netRevenuePerSf: projectArea > 0 ? netRevenue / projectArea : null,
      consultantSharePct,
      warnings,
      settingsUsed: { valuePerFteMonth: vpf, hoursPerFteMonth: hpm, overheadRate: settings.overheadRate, roundingInc: p.roundingInc || 1 }
    };
    res.present = present(p, res, p.roundingInc || 1);
    return res;
  }

  /* ------------------------------------------------------------------ presentation */

  /**
   * Rounded figures for display and export. Every package matrix is controlled-rounded
   * so rows, columns, and totals reconcile; the project matrix is the sum of package
   * matrices; the client fee is the sum of presented lines.
   */
  function present(p, res, inc) {
    const roster = p.roster;
    const pk = res.pkgs.map(k => {
      const r = controlledRound(k.matrix.cells, inc);
      const colIndex = {};
      k.matrix.cols.forEach((c, j) => { colIndex[c.key] = j; });
      const col = key => (colIndex[key] === undefined ? 0 : r.colTotals[colIndex[key]]);
      const included = k.cons.filter(c => c.treatment === 'included').map(c => col(c.id));
      const additional = k.cons.filter(c => c.treatment === 'additional').map(c => col(c.id));
      const arch = col('arch');
      const design = arch + sum(included);
      return {
        pkgId: k.pkgId, name: k.name, rows: k.matrix.rows, cols: k.matrix.cols, cells: r.cells,
        rowTotals: r.rowTotals, colTotals: r.colTotals, total: r.total, exactRows: r.exactRows,
        arch, design, additional: sum(additional), included: sum(included), basic: r.total, col
      };
    });
    // Project matrix: union of phase rows (+ unallocated) x [arch + roster order].
    const rowKeys = p.phases.map(ph => ph.id);
    const rowLabels = p.phases.map(ph => ph.name);
    if (pk.some(k => k.rows.some(r => r.key === '_unalloc'))) { rowKeys.push('_unalloc'); rowLabels.push('Unallocated'); }
    const used = roster.filter(c => res.pkgs.some(k => k.cons.some(x => x.id === c.id)));
    const colKeys = ['arch'].concat(used.map(c => c.id));
    const colLabels = ['Arch Nexus'].concat(used.map(c => c.name));
    const colKinds = ['arch'].concat(used.map(c => {
      const kinds = new Set(res.pkgs.map(k => (k.cons.find(x => x.id === c.id) || {}).treatment).filter(Boolean));
      return kinds.size === 1 ? [...kinds][0] : 'mixed';
    }));
    const cells = rowKeys.map(() => colKeys.map(() => 0));
    pk.forEach(k => {
      k.rows.forEach((row, i) => {
        const ri = rowKeys.indexOf(row.key);
        k.cols.forEach((c, j) => { const cj = colKeys.indexOf(c.key); if (ri >= 0 && cj >= 0) cells[ri][cj] += k.cells[i][j]; });
      });
    });
    const rowTotals = cells.map(r => sum(r));
    const colTotals = colKeys.map((_, j) => sum(cells, r => r[j]));
    const items = res.items.map(r => ({ id: r.id, kind: r.kind, label: r.label, treatment: r.treatment, client: roundTo(r.clientEffect, inc), amount: roundTo(r.amount, inc) }));
    const basic = sum(pk, k => k.basic);
    const itemsClient = sum(items, it => it.client);
    return {
      inc, packages: pk,
      project: { rowKeys, rowLabels, colKeys, colLabels, colKinds, cells, rowTotals, colTotals, total: sum(rowTotals) },
      items, basic, itemsClient, clientFee: basic + itemsClient,
      design: sum(pk, k => k.design), arch: sum(pk, k => k.arch), additional: sum(pk, k => k.additional), included: sum(pk, k => k.included)
    };
  }

  /* ------------------------------------------------------------------ cost-loaded schedule */

  /**
   * Spread each phase's presented fee evenly across the months the phase occupies
   * (fractional months are prorated). Rows are package x phase; row totals equal the
   * presented phase totals exactly. Months are numbered from the proposal start month.
   */
  function costLoaded(p, res) {
    const inc = res.present.inc;
    const sched = res.schedule;
    const N = Math.ceil(sched.totalMonths - 1e-9);
    const rows = [];
    res.present.packages.forEach(k => {
      p.phases.forEach((ph, i) => {
        const s = sched.byId[ph.id];
        const total = k.rowTotals[i];
        if (!total) return;
        const vals = new Array(N).fill(0);
        if (s.months > 0) {
          for (let mth = 0; mth < N; mth++) {
            const ov = Math.max(0, Math.min(s.end, mth + 1) - Math.max(s.start, mth));
            vals[mth] = total * ov / s.months;
          }
        }
        rows.push({ pkgId: k.pkgId, pkgName: k.name, phaseId: ph.id, phaseName: ph.name, total, exact: vals, noDuration: !(s.months > 0) });
      });
    });
    const scheduled = rows.filter(r => !r.noDuration);
    const cr = scheduled.length && N > 0 ? controlledRound(scheduled.map(r => r.exact), inc) : { cells: [], colTotals: new Array(N).fill(0) };
    scheduled.forEach((r, i) => { r.months = cr.cells[i]; });
    rows.filter(r => r.noDuration).forEach(r => { r.months = new Array(N).fill(0); });
    const labels = [];
    for (let i = 0; i < N; i++) labels.push(monthLabel(p.startMonth, i));
    return { months: N, labels, rows, monthTotals: cr.colTotals || [], unscheduled: rows.filter(r => r.noDuration) };
  }

  function monthLabel(start, i) {
    const m = /^(\d{4})-(\d{2})$/.exec(start || '');
    if (!m) return 'Month ' + (i + 1);
    const d = new Date(Date.UTC(+m[1], +m[2] - 1 + i, 1));
    return d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  /* ------------------------------------------------------------------ messages */

  const fmt$ = v => (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US');
  const fmtPct = v => (Math.round(v * 10) / 10) + '%';
  function message(code, d, w) {
    const at = w.pkgName ? ' in ' + (w.pkgName || 'this package') : '';
    switch (code) {
      case 'missingCost': return (d.label ? d.label + ' is' : 'A fee is') + ' priced as a % of construction cost, but the construction cost' + at + ' is blank.';
      case 'missingArea': return (d.label || 'A fee') + ' uses an area rate, but the area' + at + ' is blank.';
      case 'missingUnits': return (d.label || 'A fee') + ' uses a unit rate, but the unit count' + at + ' is blank.';
      case 'emptyLabor': return (d.label || 'A labor component') + at + ' has no staff in its labor plan yet.';
      case 'missingRate': return 'No billing rate for ' + d.roles.join(', ') + at + '. Their hours count as $0.';
      case 'itemMissingRate': return (d.label || 'An item') + ' is priced by hours but has no rate.';
      case 'amtWithCoverage': return 'Phase dollar amounts' + at + ' were converted to percentages because a fee component covers only some phases.';
      case 'evenSplit': return (d.label || 'A component') + at + ' covers phases with no percentages, so it is split evenly across them.';
      case 'unallocated': return d.intentional ? fmt$(d.amount) + at + ' is intentionally left unallocated to phases.' : fmt$(d.amount) + at + ' is not allocated to any phase. Adjust phase percentages, use Balance, or mark it as intentionally unallocated.';
      case 'overAllocated': return 'Phases' + at + ' are allocated ' + fmt$(d.amount) + ' more than the fee. Reduce a phase or use Balance.';
      case 'consUnallocated': return d.follow ? d.name + at + ' follows the fee split, but no fee is allocated to phases yet, so ' + fmt$(d.amount) + ' is unallocated.' : d.name + "'s phase split" + at + ' leaves ' + fmt$(d.amount) + ' unallocated.';
      case 'consOverAllocated': return d.name + "'s phase split" + at + ' allocates ' + fmt$(d.amount) + ' more than their fee.';
      case 'pctOver': return 'Consultants included as a % of the design fee' + at + ' add up to ' + fmtPct(d.pct) + '. That leaves no room for the Arch Nexus fee, so those percentages are ignored until they total less than 100%.';
      case 'negArch': return 'Included consultants' + at + ' (' + fmt$(d.included) + ') exceed the design fee (' + fmt$(d.design) + '). The Arch Nexus fee is negative.';
      case 'negArchPhase': return 'The Arch Nexus share of ' + d.phase + at + ' is negative (' + fmt$(d.amount) + '). Consultant phase splits take more than that phase\'s fee.';
      case 'effortOver': return 'The labor plan exceeds the effort allowance by ' + fmt$(d.over) + ' at billing rates.';
      case 'negAllowance': return 'After consultants, reserves, and target profit, the effort allowance is negative (' + fmt$(d.amount) + ').';
      case 'feeBelowCost': return 'Projected cost exceeds net revenue: an expected loss of ' + fmt$(d.loss) + ' on the detailed cost model.';
      case 'belowTarget': return 'Projected profit (' + fmt$(d.profit) + ') is below the target (' + fmt$(d.target) + ') on the detailed cost model.';
      case 'consultantShare': return 'Consultants are ' + fmtPct(d.pct) + ' of basic services, above your ' + fmtPct(d.limit) + ' warning threshold.';
      case 'highFte': return d.phase + ' implies about ' + (Math.round(d.fte * 10) / 10) + ' full-time staff, above your ' + d.limit + ' FTE warning threshold.';
      case 'rateFactor': return 'Billing rates in this scenario are scaled by ' + (Math.round(d.factor * 1000) / 10) + '%.';
      default: return code;
    }
  }

  FB.calc = { compute, present, costLoaded, schedule, laborPlan, allocateBySpec, rebalance, packageMetrics, message, kindLabel };
})(typeof globalThis !== 'undefined' ? globalThis : this);

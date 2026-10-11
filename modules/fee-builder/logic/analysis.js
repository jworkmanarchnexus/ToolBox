/*
 * Fee Builder engine: back-solving, stress tests, sensitivity, thresholds, snapshots,
 * and scenario comparison. All pure; inputs are never mutated.
 */
(function (root) {
  'use strict';
  const FB = root.FB || (root.FB = {});
  const { num, has, sum } = FB.money;
  const { clone, uid } = FB.model;
  const { compute } = FB.calc;

  /* ------------------------------------------------------------------ metrics */

  const METRICS = {
    clientFee: { label: 'Client fee', get: r => r.clientFee },
    designFee: { label: 'Design fee', get: r => r.designTotal },
    archFee: { label: 'Arch Nexus fee', get: r => r.archTotal },
    netRevenue: { label: 'Arch Nexus net revenue', get: r => r.netRevenue },
    effortAllowance: { label: 'Effort allowance', get: r => r.effortAllowance },
    effortHeadroom: { label: 'Effort headroom (allowance minus plan)', get: r => (r.hasPlan ? r.effortAllowance - r.plannedEffort : null) },
    projectedProfit: { label: 'Projected profit (detailed)', get: r => (r.detailed ? r.detailed.projectedProfit : null) },
    profitVsTarget: { label: 'Projected profit minus target', get: r => (r.detailed ? r.detailed.projectedProfit - r.targetProfit : null) }
  };

  /* ------------------------------------------------------------------ variables */

  /**
   * Numeric inputs a back-solve may change. Each has a stable `key`, a label, and
   * get/set functions on a (proposal, scenario) pair. Listed explicitly so the user
   * always chooses what moves; the solver never picks for them.
   */
  function listVariables(p, sc) {
    const vars = [];
    p.packages.forEach(pkg => {
      const calc = sc.pkgs[pkg.id];
      const pn = p.packages.length > 1 ? pkg.name + ': ' : '';
      calc.components.forEach(c => {
        const field = { pctCost: 'pct', fixed: 'amount', area: 'rate', unit: 'rate' }[c.method];
        if (field) vars.push({
          key: 'comp:' + pkg.id + ':' + c.id, unit: field === 'pct' ? 'pct' : 'money',
          label: pn + (c.label || methodLabel(c.method)) + ' ' + ({ pct: 'fee %', amount: 'amount', rate: 'rate' }[field]),
          get: (q, s) => num(s.pkgs[pkg.id].components.find(x => x.id === c.id)[field]),
          set: (q, s, v) => { s.pkgs[pkg.id].components.find(x => x.id === c.id)[field] = v; }
        });
        if (c.method === 'labor') vars.push({
          key: 'hours:' + pkg.id, unit: 'factor', label: pn + 'Labor plan scale (1 = as planned)',
          get: () => 1,
          set: (q, s, v) => scaleLabor(s.pkgs[pkg.id], v)
        });
      });
      p.roster.forEach(r => {
        const pr = calc.cons[r.id];
        if (!pr || !pr.on) return;
        vars.push({
          key: 'con:' + pkg.id + ':' + r.id, unit: pr.type === 'pctCost' || pr.type === 'pctFee' ? 'pct' : 'money',
          label: pn + r.name + ' ' + (pr.type === 'quote' ? 'quote' : pr.type === 'fixed' ? 'amount' : '%'),
          get: (q, s) => num(s.pkgs[pkg.id].cons[r.id].value),
          set: (q, s, v) => { s.pkgs[pkg.id].cons[r.id].value = v; }
        });
      });
    });
    vars.push({
      key: 'flat', unit: 'money', label: 'Negotiated adjustment (consultants unchanged)',
      get: (q, s) => num((s.items.find(i => i.id === '_solve_flat') || {}).amount),
      set: (q, s, v) => {
        let it = s.items.find(i => i.id === '_solve_flat');
        if (!it) { it = FB.model.makeItem('adjustment', { id: '_solve_flat', label: 'Negotiated adjustment', method: 'fixed' }); s.items.push(it); }
        it.amount = v;
      }
    });
    vars.push({
      key: 'tp', unit: 'pct', label: 'Target profit %',
      get: (q, s, settings) => (has(s.finance.targetProfitPct) ? num(s.finance.targetProfitPct) : num(settings.targetProfitPct)),
      set: (q, s, v) => { s.finance.targetProfitPct = v; }
    });
    return vars;
  }

  function methodLabel(m) {
    return { pctCost: '% of construction', fixed: 'Lump sum', area: 'Area rate', unit: 'Unit rate', labor: 'Labor buildup' }[m] || m;
  }

  function scaleLabor(calc, f) {
    calc.labor.rows.forEach(r => { Object.keys(r.cells).forEach(k => { if (has(r.cells[k])) r.cells[k] = num(r.cells[k]) * f; }); });
  }

  /**
   * Back-solve: find the value of `varKey` that makes `metric` equal `target`.
   * Every metric is affine in any single input in this engine, so two evaluations
   * give the answer; a few secant steps cover edge cases (clamps, warnings).
   * Returns {ok, value, achieved, before, scenario (solved copy)} or {ok:false, reason}.
   */
  function solve(p, sc, settings, metric, target, varKey) {
    const M = METRICS[metric];
    if (!M) return { ok: false, reason: 'Unknown target.' };
    const v = listVariables(p, sc).find(x => x.key === varKey);
    if (!v) return { ok: false, reason: 'Choose which input should change.' };
    const evalAt = x => {
      const s = clone(sc);
      if (varKey.startsWith('hours:')) v.set(p, s, x); else v.set(p, s, x);
      const r = compute(p, s, settings);
      return { s, r, y: M.get(r) };
    };
    const x0 = varKey.startsWith('hours:') ? 1 : v.get(p, sc, settings);
    const e0 = evalAt(x0);
    if (e0.y === null) return { ok: false, reason: M.label + ' is not available for this scenario.' };
    const step = Math.max(1, Math.abs(x0) * 0.1);
    let xa = x0, ya = e0.y, xb = x0 + step, eb = evalAt(xb), yb = eb.y;
    if (Math.abs(yb - ya) < 1e-9) return { ok: false, reason: 'Changing ' + v.label.toLowerCase() + ' does not affect ' + M.label.toLowerCase() + '.' };
    let best = null;
    for (let i = 0; i < 6; i++) {
      const x = xb + (target - yb) * (xb - xa) / (yb - ya);
      const e = evalAt(x);
      best = { x, e };
      if (Math.abs(e.y - target) < 0.005) break;
      xa = xb; ya = yb; xb = x; yb = e.y;
      if (Math.abs(yb - ya) < 1e-12) break;
    }
    const ok = Math.abs(best.e.y - target) < 0.5;
    const out = { ok, value: best.x, achieved: best.e.y, before: e0.y, metric, varKey, varLabel: v.label, unit: v.unit, scenario: best.e.s, result: best.e.r };
    if (!ok) out.reason = 'No value of ' + v.label.toLowerCase() + ' reaches that target.';
    if (ok && best.x < 0 && v.unit !== 'money') out.warning = 'The answer is negative, which is not a usable ' + v.label.toLowerCase() + '.';
    if (ok && best.x < 0 && varKey.startsWith('comp:')) out.warning = 'The answer is negative, which is not a usable ' + v.label.toLowerCase() + '.';
    return out;
  }

  /* ------------------------------------------------------------------ stress */

  /**
   * Apply stress-test changes to a COPY of the scenario. The original is untouched.
   * stress: { cost: %, consultant: %, hours: %, rates: %, fee: %, targetProfit: points,
   *           phaseMonths: {phaseId: +months} }
   * Consultant stress raises what consultants cost Arch Nexus. Quotes pass through with
   * markup; consultants priced as allocations keep their client amount, so Arch Nexus
   * absorbs the increase (that is the exposure being tested).
   */
  function applyStress(p, sc, settings, stress) {
    stress = stress || {};
    const s = clone(sc);
    const base = compute(p, sc, settings);
    const f = x => 1 + num(x) / 100;
    if (num(stress.cost)) p.packages.forEach(pkg => {
      const calc = s.pkgs[pkg.id];
      const m = FB.calc.packageMetrics(pkg, calc);
      calc.costOverride = m.cost * f(stress.cost);
    });
    if (num(stress.consultant)) p.packages.forEach(pkg => {
      const calc = s.pkgs[pkg.id];
      const pr = base.pkgs.find(k => k.pkgId === pkg.id);
      pr.cons.forEach(c => {
        const pc = calc.cons[c.id];
        if (pc.type === 'quote') pc.value = num(pc.value) * f(stress.consultant);
        else pc.cost = c.cost * f(stress.consultant);
      });
    });
    if (num(stress.hours)) Object.values(s.pkgs).forEach(calc => scaleLabor(calc, f(stress.hours)));
    if (num(stress.rates)) s.finance.rateFactor = (num(s.finance.rateFactor) || 1) * f(stress.rates);
    if (stress.phaseMonths) Object.keys(stress.phaseMonths).forEach(phId => {
      const d = num(stress.phaseMonths[phId]);
      if (!d || !s.schedule[phId]) return;
      s.schedule[phId].months = Math.max(0, num(s.schedule[phId].months) + d);
    });
    if (num(stress.fee)) {
      // A client-facing adjustment equal to the % change of the current client fee.
      s.items.push(FB.model.makeItem('adjustment', { label: 'Fee change (stress test)', method: 'fixed', amount: base.clientFee * num(stress.fee) / 100 }));
    }
    if (num(stress.targetProfit)) {
      const cur = has(s.finance.targetProfitPct) ? num(s.finance.targetProfitPct) : num(settings.targetProfitPct);
      s.finance.targetProfitPct = cur + num(stress.targetProfit);
    }
    return s;
  }

  function stressResult(p, sc, settings, stress) {
    const s = applyStress(p, sc, settings, stress);
    return { scenario: s, result: compute(p, s, settings) };
  }

  /** Promote a stressed copy to a real scenario with a fresh id. */
  function promoteStress(p, sc, settings, stress, name) {
    const s = applyStress(p, sc, settings, stress);
    s.id = uid('s');
    s.name = name || sc.name + ' (stress test)';
    s.createdAt = Date.now();
    s.notes = (sc.notes ? sc.notes + '\n' : '') + 'Created from a stress test: ' + describeStress(p, stress) + '.';
    Object.values(s.pkgs).forEach(calc => { calc.components.forEach(c => { c.id = uid('c'); }); calc.labor.rows.forEach(r => { r.id = uid('r'); }); });
    s.items.forEach(it => { it.id = uid('i'); });
    return s;
  }

  function describeStress(p, st) {
    const parts = [];
    const pct = (k, l) => { if (num(st[k])) parts.push(l + ' ' + (num(st[k]) > 0 ? '+' : '') + num(st[k]) + '%'); };
    pct('cost', 'construction cost'); pct('consultant', 'consultant cost'); pct('hours', 'labor hours'); pct('rates', 'billing rates'); pct('fee', 'client fee');
    if (num(st.targetProfit)) parts.push('target profit ' + (num(st.targetProfit) > 0 ? '+' : '') + num(st.targetProfit) + ' points');
    if (st.phaseMonths) Object.keys(st.phaseMonths).forEach(id => {
      const d = num(st.phaseMonths[id]);
      const ph = p.phases.find(x => x.id === id);
      if (d && ph) parts.push(ph.name + ' ' + (d > 0 ? '+' : '') + d + ' months');
    });
    return parts.length ? parts.join(', ') : 'no changes';
  }

  /** Evaluate one metric across a range of one stress variable. */
  function sensitivity(p, sc, settings, stressKey, values, metric, extra) {
    const M = METRICS[metric];
    return values.map(v => {
      const st = Object.assign({}, extra || {});
      if (stressKey === 'phaseMonths') st.phaseMonths = { [extra.phaseId]: v };
      else st[stressKey] = v;
      const r = stressResult(p, sc, settings, st).result;
      return { x: v, y: M.get(r) };
    });
  }

  /* ------------------------------------------------------------------ thresholds */

  /**
   * Break-even and headroom figures. Every figure states its assumption; fee
   * thresholds assume the change comes from a negotiated adjustment with consultants
   * unchanged. Figures that need missing inputs are null with a reason.
   */
  function thresholds(p, sc, settings) {
    const r = compute(p, sc, settings);
    const out = { notes: [] };
    if (r.hasPlan) {
      const req = solve(p, sc, settings, 'effortHeadroom', 0, 'flat');
      out.feeForPlan = req.ok ? req.result.clientFee : null;
      out.feeHeadroom = req.ok ? r.clientFee - req.result.clientFee : null;
      out.effortHeadroom = r.effortAllowance - r.plannedEffort;
      out.hoursHeadroom = r.blendedRate ? out.effortHeadroom / r.blendedRate : null;
      // Extra consultant cost that could be absorbed before effort headroom reaches zero.
      const k = settings.targetProfitBasis === 'netRevenue' ? 1 - r.targetProfitPct / 100 : 1;
      out.consultantAbsorb = k > 0 ? out.effortHeadroom / k : null;
    } else {
      out.notes.push('Add a labor plan to see effort, hours, and fee headroom.');
    }
    if (r.detailed) {
      const be = solve(p, sc, settings, 'projectedProfit', 0, 'flat');
      out.breakEvenFee = be.ok ? be.result.clientFee : null;
      const tgt = solve(p, sc, settings, 'profitVsTarget', 0, 'flat');
      out.feeForTarget = tgt.ok ? tgt.result.clientFee : null;
      out.feeChangeForTarget = tgt.ok ? tgt.result.clientFee - r.clientFee : null;
    } else {
      out.notes.push('Detailed break-even needs cost rates and an overhead rate: ' + r.detailedUnavailable.join(' '));
    }
    return out;
  }

  /* ------------------------------------------------------------------ snapshots */

  /**
   * Freeze a scenario with everything needed to reproduce its numbers later, even
   * after the proposal's shared facts change. kind: 'decision' | 'approved' | 'contract'.
   */
  function makeSnapshot(p, scId, settings, kind, name, note) {
    const sc = p.scenarios.find(s => s.id === scId);
    if (!sc) return null;
    const frozen = {
      scenario: clone(sc), packages: clone(p.packages), phases: clone(p.phases), roster: clone(p.roster),
      roles: clone(p.roles), roundingInc: p.roundingInc || 1, startMonth: p.startMonth,
      settings: pickSettings(settings)
    };
    const r = compute(frozenProposal(frozen), frozen.scenario, frozen.settings);
    return {
      id: uid('snap'), kind: kind || 'decision', name: name || defaultSnapName(kind), note: note || '',
      date: new Date().toISOString().slice(0, 10), createdAt: Date.now(),
      scenarioId: sc.id, scenarioName: sc.name, frozen,
      summary: summarize(r)
    };
  }

  function defaultSnapName(kind) {
    return { approved: 'Approved internal fee', contract: 'Executed contract baseline', decision: 'Saved decision point' }[kind] || 'Snapshot';
  }

  function pickSettings(s) {
    s = FB.model.normalizeSettings(s);
    return {
      targetProfitPct: s.targetProfitPct, targetProfitBasis: s.targetProfitBasis, valuePerFteMonth: s.valuePerFteMonth,
      hoursPerFteMonth: s.hoursPerFteMonth, overheadRate: s.overheadRate, consultantShareWarnPct: s.consultantShareWarnPct, maxFtePerPhase: s.maxFtePerPhase
    };
  }

  function frozenProposal(fz) {
    return { schema: FB.model.SCHEMA, id: 'snapshot', packages: fz.packages, phases: fz.phases, roster: fz.roster, roles: fz.roles, roundingInc: fz.roundingInc, startMonth: fz.startMonth || '', scenarios: [fz.scenario] };
  }

  function summarize(r) {
    return {
      clientFee: r.clientFee, presentedClientFee: r.present.clientFee, designTotal: r.designTotal,
      netRevenue: r.netRevenue, consultantClient: r.consultantClient, consultantCost: r.consultantCost,
      effortAllowance: r.effortAllowance, plannedEffort: r.plannedEffort, feePctOfCost: r.feePctOfCost
    };
  }

  /** Recompute a snapshot from its frozen inputs. Used to prove snapshots never drift. */
  function recomputeSnapshot(snap) {
    if (!snap.frozen) return null;
    return compute(frozenProposal(snap.frozen), snap.frozen.scenario, snap.frozen.settings || {});
  }

  /** Contract value from the contract snapshot plus accepted change items. */
  function contractStatus(p) {
    if (!p.contract) return null;
    const snap = p.snapshots.find(s => s.id === p.contract.snapshotId);
    if (!snap) return null;
    const orig = has(snap.legacyValue) ? num(snap.legacyValue) : snap.summary.presentedClientFee;
    const ch = p.changes;
    const accepted = sum(ch.filter(c => c.status === 'accepted'), c => Math.round(num(c.amount)));
    const pending = sum(ch.filter(c => c.status === 'proposed'), c => Math.round(num(c.amount)));
    return { snapshot: snap, original: orig, accepted, pending, current: orig + accepted, ifAccepted: orig + accepted + pending };
  }

  /* ------------------------------------------------------------------ comparison */

  /** Compare scenarios against a reference. Returns rows of metric values and deltas. */
  function compare(p, settings, refId) {
    const results = p.scenarios.map(sc => ({ sc, r: compute(p, sc, settings) }));
    const ref = results.find(x => x.sc.id === refId) || results[0];
    const rows = [
      ['clientFee', 'Client fee', 'money'],
      ['feePctOfCost', 'Fee as % of construction cost', 'pct'],
      ['feePerSf', 'Fee per square foot', 'money2'],
      ['designTotal', 'Design fee', 'money'],
      ['archTotal', 'Arch Nexus fee', 'money'],
      ['consultantClient', 'Consultants in fee', 'money'],
      ['netRevenue', 'Arch Nexus net revenue', 'money'],
      ['effortAllowance', 'Effort allowance', 'money'],
      ['plannedHours', 'Planned hours', 'hours'],
      ['plannedEffort', 'Planned effort (billing value)', 'money'],
      ['heldContingency', 'Contingency in fee', 'money']
    ].map(([key, label, unit]) => {
      const vals = results.map(x => x.r[key]);
      const refV = ref.r[key];
      return {
        key, label, unit, values: vals,
        deltas: vals.map(v => (v === null || refV === null ? null : v - refV)),
        deltaPct: vals.map(v => (v === null || refV === null || !refV ? null : (v - refV) / Math.abs(refV) * 100))
      };
    });
    const phaseRows = p.phases.map((ph, i) => ({
      phaseId: ph.id, label: ph.name,
      values: results.map(x => x.r.present.project.rowTotals[i] || 0)
    }));
    return { refId: ref.sc.id, scenarios: results.map(x => ({ id: x.sc.id, name: x.sc.name, result: x.r })), rows, phaseRows };
  }

  FB.analysis = {
    METRICS, listVariables, solve, applyStress, stressResult, promoteStress, describeStress, sensitivity, thresholds,
    makeSnapshot, recomputeSnapshot, contractStatus, frozenProposal, compare, summarize
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

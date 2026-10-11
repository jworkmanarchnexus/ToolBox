'use strict';
/* Runs the language-neutral calculation fixtures (tests/fixtures/calc.json) against the JavaScript engine.
   `build` below is the only translation from the fixture's plain description into this implementation's model. */
const test = require('node:test');
const assert = require('node:assert');
const { FB } = require('./harness');
const { model, calc } = FB;
const F = require('./fixtures/calc.json');

function build(spec) {
  const settings = model.defaultSettings();
  Object.assign(settings, spec.settings || {});
  const p = model.newProposal(Object.assign({ settings }, spec.proposal));
  const sc = p.scenarios[0], pk = p.packages[0], k = pk.id, pkg = sc.pkgs[k];
  if (spec.packageName) pk.name = spec.packageName;
  if (spec.package && spec.package.basis) pkg.basis = spec.package.basis;
  if (spec.package && spec.package.components) pkg.components = spec.package.components.map(c => model.makeComponent(c.method, c));
  for (const c of spec.addComponents || []) pkg.components.push(model.makeComponent(c.method, c));
  for (const r of spec.roles || []) p.roles[r.index].billRate = r.billRate;
  if (spec.laborRows) pkg.labor.rows = spec.laborRows.map((r, i) => ({ id: 'r' + i, roleId: p.roles[r.roleIndex].id, cells: Object.fromEntries(p.phases.map((ph, j) => [ph.id, r.hours[j]])) }));
  for (const c of spec.consultants || []) {
    const ro = p.roster.find(x => x.name === c.name) || model.addConsultant(p, c.name);
    const f = { on: true, type: c.type, value: c.value, treatment: c.treatment };
    if (c.markup !== undefined) f.markup = c.markup;
    if (c.cost !== undefined) f.cost = c.cost;
    if (c.split) { f.split = c.split; f.alloc = {}; }
    Object.assign(pkg.cons[ro.id], f);
    if (c.alloc) p.phases.forEach((ph, i) => { pkg.cons[ro.id].alloc[ph.id] = { pct: '', amt: c.alloc[i], lock: false }; });
  }
  if (spec.phaseAmounts) p.phases.forEach((ph, i) => { pkg.alloc[ph.id] = { pct: '', amt: spec.phaseAmounts[i], lock: false }; });
  for (const it of spec.items || []) sc.items.push(model.makeItem(it.kind || 'service', it));
  return { p, sc, settings };
}

for (const c of F.cases) {
  test(c.name, () => {
    const { p, sc, settings } = build(c.build);
    const r = calc.compute(p, sc, settings);
    const e = c.expect, tol = e.tolerance !== undefined ? e.tolerance : 0.005;
    const near = (got, want, what, t) => assert.ok(Math.abs(got - want) <= (t === undefined ? tol : t), `${c.id}: ${what}: expected ${want}, got ${got}`);
    for (const key of ['clientFee', 'consultantClient', 'netRevenue', 'targetProfit', 'effortAllowance', 'designTotal', 'archTotal', 'feePctOfCost', 'consultantCost', 'plannedHours']) if (e[key] !== undefined) near(r[key], e[key], key);
    if (e.effortFteMonths !== undefined) near(r.effortFteMonths, e.effortFteMonths, 'effortFteMonths', 1e-9);
    if (e.archTotalOfPackage !== undefined) near(r.pkgs[0].arch, e.archTotalOfPackage, 'archTotalOfPackage');
    if (e.archByPhaseOfPackage) p.phases.forEach((ph, i) => near(r.pkgs[0].archByPhase[ph.id], e.archByPhaseOfPackage[i], 'archByPhase[' + i + ']'));
    for (const [name, want] of Object.entries(e.consultant || {})) {
      const got = r.pkgs[0].cons.find(x => x.name === name);
      assert.ok(got, name + ' is in the result');
      if (want.client !== undefined) near(got.client, want.client, name + '.client');
      if (want.cost !== undefined) near(got.cost, want.cost, name + '.cost');
      if (want.shareOfDesign !== undefined) near(got.client / r.designTotal, want.shareOfDesign, name + ' share of the design fee', 1e-12);
    }
    (e.phases || []).forEach((x, i) => {
      const got = r.phases[i];
      for (const [f, v] of Object.entries(x)) near(got[f], v, 'phase ' + (i + 1) + ' ' + f, f.startsWith('allowanceF') ? 1e-9 : 1e-6);
    });
  });
}

/* ---------- rules.json: numbers, rounding, contract value, back-solving ---------- */
const R = require('./fixtures/rules.json');
const { money, analysis } = FB;

test('typed numbers: $, %, k, m, brackets, and blanks that stay blank', () => {
  for (const c of R.parse) assert.strictEqual(money.parse(c.text), c.value === null ? '' : c.value, JSON.stringify(c.text));
});
test('rounding: half away from zero, to the increment', () => {
  for (const c of R.roundTo) assert.strictEqual(money.roundTo(c.value, c.increment), c.expect, JSON.stringify(c));
});
test('rounding: largest remainder keeps the parts adding up to the whole', () => {
  for (const c of R.largestRemainder) {
    const out = money.largestRemainder(c.values, c.increment, c.total);
    assert.deepStrictEqual(out.map(v => Math.round(v / c.increment) * c.increment).map(v => +v.toFixed(6)), c.expect, JSON.stringify(c));
    assert.ok(Math.abs(out.reduce((a, b) => a + b, 0) - c.total) < 1e-9, 'adds up to ' + c.total);
  }
});
test('contract value: accepted, pending, current and if-accepted', () => {
  for (const c of R.contract) {
    const settings = model.defaultSettings();
    const p = model.newProposal({ settings, cost: c.originalContractValue * 20, value: 5 });
    const sc = p.scenarios[0];
    const snap = analysis.makeSnapshot(p, sc.id, settings, 'contract');
    p.snapshots.push(snap); p.contract = { snapshotId: snap.id };
    p.changes = c.changes.map((x, i) => Object.assign({ id: 'c' + i }, x));
    const cs = analysis.contractStatus(p);
    for (const [k, v] of Object.entries(c.expect)) assert.strictEqual(cs[k], v, k);
  }
});
test('back-solving: what input value reaches a target, without changing the proposal', () => {
  for (const c of R.solve) {
    const { p, sc, settings } = build(c.build);
    const k = p.packages[0].id;
    const variable = c.byChanging === 'fee percent' ? 'comp:' + k + ':' + sc.pkgs[k].components[0].id : 'con:' + k + ':' + p.roster[0].id;
    const out = analysis.solve(p, sc, settings, c.target, c.to, variable);
    assert.strictEqual(out.ok, c.expect.ok, c.name);
    if (c.expect.value !== undefined) assert.ok(Math.abs(out.value - c.expect.value) < 1e-9, c.name + ' value');
    if (c.expect.clientFee !== undefined) assert.ok(Math.abs(out.result.clientFee - c.expect.clientFee) <= c.expect.tolerance, c.name + ' fee');
    if (c.expect.netRevenue !== undefined) assert.ok(Math.abs(out.result.netRevenue - c.expect.netRevenue) <= c.expect.tolerance, c.name + ' revenue');
    if (c.expect.reasonContains) assert.ok(out.reason.includes(c.expect.reasonContains), c.name + ' reason');
    if (c.expect.originalFeePercentUnchanged !== undefined) assert.strictEqual(sc.pkgs[k].components[0].pct, c.expect.originalFeePercentUnchanged);
  }
});

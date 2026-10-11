/* Engine tests. Run: node tests/run.js */
'use strict';
const { FB, test, eq, near, ok, noNaN } = require('./harness');
const { model, calc, analysis, exporter, money } = FB;
const S = () => model.defaultSettings();

/* ---------- builders ---------- */
function proposal(opts) {
  const p = model.newProposal(Object.assign({ settings: S() }, opts || {}));
  return { p, sc: p.scenarios[0], k: p.packages[0].id };
}
function setCons(p, sc, pkgId, name, fields) {
  let c = p.roster.find(r => r.name === name);
  if (!c) c = model.addConsultant(p, name);
  Object.assign(sc.pkgs[pkgId].cons[c.id], { on: true }, fields);
  return c;
}
function compute(p, sc, s) { return calc.compute(p, sc, s || S()); }
function reconciles(res) {
  const P = res.present;
  P.packages.forEach(k => {
    near(money.sum(k.rowTotals), k.total, 1e-6, 'pkg rows');
    near(money.sum(k.colTotals), k.total, 1e-6, 'pkg cols');
    k.cells.forEach((r, i) => near(money.sum(r), k.rowTotals[i], 1e-6, 'row cells'));
    k.colTotals.forEach((t, j) => near(money.sum(k.cells, r => r[j]), t, 1e-6, 'col cells'));
  });
  near(P.project.total, P.basic, 1e-6, 'project = basic');
  near(P.basic + P.itemsClient, P.clientFee, 1e-6, 'client = parts');
  // Presented client fee within one unit per line of the exact fee.
  const lines = P.packages.length + P.items.length;
  ok(Math.abs(P.clientFee - res.clientFee) <= lines * P.inc / 2 + 1e-6, 'presented vs exact ' + P.clientFee + ' vs ' + res.clientFee);
}

/* ================================================================ EAC workbook */

test('EAC worked example: fee, consultants, revenue, target profit, allowance (EAC Plan - Calculator.xlsx)', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  setCons(p, sc, k, 'Consultants', { type: 'pctFee', value: 35, treatment: 'included' });
  const r = compute(p, sc);
  // Expected values computed independently: 10,000,000 x 5% = 500,000; 35% = 175,000; 15% of 500,000 = 75,000.
  near(r.clientFee, 500000); near(r.consultantClient, 175000); near(r.netRevenue, 325000);
  near(r.targetProfit, 75000); near(r.effortAllowance, 250000);
  near(r.effortFteMonths, 15.625, 1e-9, 'FTE-months = 250,000 / 16,000');
});

test('EAC worked example: phase rows match the workbook (fee, consultants, revenue, allowance, FTE/month)', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  setCons(p, sc, k, 'Consultants', { type: 'pctFee', value: 35, treatment: 'included' });
  const r = compute(p, sc);
  // Workbook rows D23:L27. Durations 4,6,10,8,56 weeks at 4 weeks/month = 1, 1.5, 2.5, 2, 14 months.
  const exp = [
    [50000, 17500, 32500, 25000, 1.5625, 1.5625],
    [125000, 43750, 81250, 62500, 3.90625, 2.6041666667],
    [175000, 61250, 113750, 87500, 5.46875, 2.1875],
    [25000, 8750, 16250, 12500, 0.78125, 0.390625],
    [125000, 43750, 81250, 62500, 3.90625, 0.2790178571]
  ];
  r.phases.forEach((x, i) => {
    near(x.basic, exp[i][0], 1e-6); near(x.consClient, exp[i][1], 1e-6); near(x.arch, exp[i][2], 1e-6);
    near(x.allowance, exp[i][3], 1e-6); near(x.allowanceFteMonths, exp[i][4], 1e-9); near(x.allowanceFte, exp[i][5], 1e-9);
  });
});

test('Target profit basis: net revenue option is explicit and different', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  setCons(p, sc, k, 'Consultants', { type: 'pctFee', value: 35, treatment: 'included' });
  const s = S(); s.targetProfitBasis = 'netRevenue';
  const r = compute(p, sc, s);
  near(r.targetProfit, 0.15 * 325000); near(r.effortAllowance, 325000 * 0.85);
});

/* ================================================================ WSU workbook */

function wsuCamp() {
  const settings = S();
  const p = model.newProposal({ name: 'WSU-like', settings, templateId: 'tpl-milestones' });
  const sc = p.scenarios[0];
  const camp = p.packages[0]; camp.name = 'CAMP';
  const calc0 = sc.pkgs[camp.id];
  calc0.components = [model.makeComponent('fixed', { label: 'NTP scope', amount: 1247556 })];
  setCons(p, sc, camp.id, 'Civil', { type: 'fixed', value: 39500, treatment: 'included', split: 'custom', alloc: {} });
  setCons(p, sc, camp.id, 'Structural', { type: 'pctFee', value: 10, treatment: 'included' });
  setCons(p, sc, camp.id, 'Mechanical', { type: 'pctFee', value: 13, treatment: 'included' });
  setCons(p, sc, camp.id, 'Electrical', { type: 'pctFee', value: 10, treatment: 'included' });
  const civ = p.roster.find(r => r.name === 'Civil');
  const civAmts = [0, 13500, 16000, 2000, 8000];
  p.phases.forEach((ph, i) => { calc0.cons[civ.id].alloc[ph.id] = { pct: '', amt: civAmts[i], lock: false }; });
  // Phase amounts typed in the workbook (E4:E8).
  const typed = [249511, 311889, 311889, 124756, 249511];
  p.phases.forEach((ph, i) => { calc0.alloc[ph.id] = { pct: '', amt: typed[i], lock: false }; });
  return { p, sc, camp, settings };
}

test('WSU CAMP worked example: Arch Nexus share by phase is the remainder after consultants (Final Version K4:K8)', () => {
  const { p, sc, settings } = wsuCamp();
  const r = calc.compute(p, sc, settings);
  const k = r.pkgs[0];
  const exp = [167172.37, 195465.63, 192965.63, 81586.52, 159172.37]; // workbook values, cents
  p.phases.forEach((ph, i) => near(k.archByPhase[ph.id], exp[i], 0.006));
  near(k.arch, 796362.52, 0.01, 'Arch total K9');
  near(k.cons.find(c => c.name === 'Civil').client, 39500);
  near(k.cons.find(c => c.name === 'Mechanical').client, 162182.28, 0.01);
  near(k.design, 1247556);
});

test('WSU CAMP worked example: additional services bring CAMP to $1,359,056 (E14)', () => {
  const { p, sc, settings } = wsuCamp();
  [['FF&E coordination', 75000], ['ALTA survey', 10000], ['Geotechnical investigation', 17900], ['Seismic study', 8600]]
    .forEach(([label, amount]) => sc.items.push(model.makeItem('service', { label, amount })));
  const r = calc.compute(p, sc, settings);
  near(r.clientFee, 1359056);
  reconciles(r);
});

test('WSU Secure: correct Arch total is 67% of $992,624; the workbook subtotal row uses the CAMP percentages', () => {
  const settings = S();
  const p = model.newProposal({ settings, templateId: 'tpl-milestones' });
  const sc = p.scenarios[0];
  const k = p.packages[0].id;
  sc.pkgs[k].components = [model.makeComponent('fixed', { amount: 992624 })];
  setCons(p, sc, k, 'Structural', { type: 'pctFee', value: 10, treatment: 'included' });
  setCons(p, sc, k, 'Mechanical', { type: 'pctFee', value: 13, treatment: 'included' });
  setCons(p, sc, k, 'Electrical', { type: 'pctFee', value: 10, treatment: 'included' });
  const r = calc.compute(p, sc, settings);
  near(r.pkgs[0].arch, 992624 * 0.67, 0.01, 'Arch = 665,058.08 (workbook K22 shows 633,629.71)');
  // The sum of the workbook's own phase rows K17:K21 is also 665,058.08 at 67%.
  near(money.sum(p.phases, ph => r.pkgs[0].archByPhase[ph.id]), 665058.08, 0.01);
});

test('WSU cost basis: 4.5% of cost minus the concept-design credit as a negative component (Final Version N31)', () => {
  const { p, sc, k } = proposal({ cost: 26712033 + 2916986.63, value: 4.5 });
  sc.pkgs[k].components.push(model.makeComponent('fixed', { label: 'Concept design credit', amount: -85750 }));
  const r = compute(p, sc);
  near(r.designTotal, 1247555.88, 0.01);
});

test('WSU cost-loaded schedule: 60% CAMP phase ($311,889) spreads over two months and reconciles', () => {
  const { p, sc, settings } = wsuCamp();
  const r = calc.compute(p, sc, settings);
  const cl = calc.costLoaded(p, r);
  const row = cl.rows.find(x => x.phaseName.startsWith('60%'));
  eq(row.total, 311889);
  eq(money.sum(row.months), 311889);
  const nonzero = row.months.filter(v => v);
  eq(nonzero.length, 2);
  ok(nonzero.every(v => v === 155944 || v === 155945), 'months ' + nonzero);
  eq(money.sum(cl.monthTotals), money.sum(cl.rows, x => x.total));
});

/* ================================================================ methods */

test('Percent of construction cost, top down', () => {
  const { p, sc } = proposal({ cost: 15000000, value: 5 });
  const r = compute(p, sc);
  near(r.clientFee, 750000); near(r.feePctOfCost, 5);
});

test('Workflow A (two-minute fee): $15M at 5% shows $750,000, then a consultant comes out of the fee', () => {
  const { p, sc, k } = proposal({ name: 'Quick', cost: 15000000, value: 5 });
  near(compute(p, sc).clientFee, 750000);
  setCons(p, sc, k, 'Structural', { type: 'pctFee', value: 10, treatment: 'included' });
  const r = compute(p, sc);
  near(r.clientFee, 750000, 1e-6, 'included consultant does not change the fee');
  near(r.archTotal, 675000);
});

test('Bottom-up: architect fee plus included consultants, % of design fee solved algebraically', () => {
  const { p, sc, k } = proposal({ cost: 12500000 });
  const calc0 = sc.pkgs[k];
  calc0.basis = 'arch';
  calc0.components = [model.makeComponent('fixed', { amount: 400000 })];
  setCons(p, sc, k, 'Civil', { type: 'fixed', value: 40000, treatment: 'included' });
  setCons(p, sc, k, 'Electrical', { type: 'pctFee', value: 10, treatment: 'included' });
  const r = compute(p, sc);
  near(r.designTotal, 440000 / 0.9, 1e-6);
  const e = r.pkgs[0].cons.find(c => c.name === 'Electrical');
  near(e.client / r.designTotal, 0.10, 1e-12);
  near(r.archTotal, 400000, 1e-9);
});

test('Hourly labor buildup: fee from hours x billing rate; consultants may be included (not forced additional)', () => {
  const { p, sc, k } = proposal({ method: 'labor' });
  p.roles[0].billRate = 200; p.roles[2].billRate = 150;
  const calc0 = sc.pkgs[k];
  const ph = p.phases;
  calc0.labor.rows = [
    { id: 'r1', roleId: p.roles[0].id, cells: Object.fromEntries(ph.map((x, i) => [x.id, i === 0 ? 10 : 5])) },
    { id: 'r2', roleId: p.roles[2].id, cells: Object.fromEntries(ph.map(x => [x.id, 20])) }
  ];
  let r = compute(p, sc);
  const hours = 10 + 5 * 4 + 20 * 5;
  near(r.plannedHours, hours);
  near(r.archTotal, 30 * 200 + 100 * 150);
  setCons(p, sc, k, 'Structural', { type: 'fixed', value: 10000, treatment: 'included' });
  r = compute(p, sc);
  near(r.designTotal, 21000 + 10000, 1e-9, 'arch basis: included consultant adds to design fee');
  near(r.clientFee, 31000);
});

test('Square footage and unit rate methods', () => {
  const { p, sc, k } = proposal({ cost: 1, area: 42000, method: 'area', value: 20 });
  near(compute(p, sc).clientFee, 840000);
  p.packages[0].units = 120; p.packages[0].unitLabel = 'units';
  sc.pkgs[k].components = [model.makeComponent('unit', { rate: 2500 })];
  near(compute(p, sc).clientFee, 300000);
});

test('Lump sum method', () => {
  const { p, sc } = proposal({ method: 'fixed', value: 900000 });
  near(compute(p, sc).clientFee, 900000);
});

/* ================================================================ mixed methods */

test('Mixed methods coexist without double counting; components can cover specific phases', () => {
  const { p, sc, k } = proposal({ cost: 10000000, area: 30000 });
  p.roles[1].billRate = 180;
  const calc0 = sc.pkgs[k];
  const ca = p.phases[4].id;
  const design = p.phases.slice(0, 4).map(x => x.id);
  calc0.components = [
    model.makeComponent('pctCost', { label: 'Architecture SD-Bidding', pct: 4, covers: design }),
    model.makeComponent('labor', { label: 'Construction administration', covers: [ca] }),
    model.makeComponent('area', { label: 'Interior design', rate: 2 }),
    model.makeComponent('fixed', { label: 'FF&E coordination', amount: 50000 })
  ];
  calc0.labor.rows = [{ id: 'r', roleId: p.roles[1].id, cells: { [ca]: 500, [design[0]]: 40 } }];
  const r = compute(p, sc);
  const kk = r.pkgs[0];
  near(kk.compTotal, 400000 + 90000 + 60000 + 50000, 1e-6, 'components add');
  // The 40 SD hours are planned effort but are not part of the CA-only labor component.
  near(r.plannedHours, 540);
  // Architecture (subset) is spread over its phases only, renormalized; nothing in CA.
  near(kk.comps[0].byPhase[ca], 0);
  near(money.sum(design, id => kk.comps[0].byPhase[id]), 400000, 1e-6);
  near(kk.comps[1].byPhase[ca], 90000);
  // Full-coverage components use the percentages as entered (100% total) and allocate fully.
  near(kk.compUnalloc, 0, 1e-6);
  near(money.sum(p.phases, ph => kk.designByPhase[ph.id]), kk.design, 1e-6);
  reconciles(r);
});

/* ================================================================ packages */

test('Workflow C: multiple work packages with different costs roll up to one project total', () => {
  const settings = S();
  const p = model.newProposal({ cost: 20000000, value: 4.5, settings });
  p.packages[0].name = 'Primary building';
  const secure = model.addPackage(p, 'Secure building'); secure.cost = 18000000;
  const site = model.addPackage(p, 'Site work'); site.cost = 5000000;
  const sc = p.scenarios[0];
  sc.pkgs[secure.id].components = [model.makeComponent('pctCost', { pct: 4.8 })];
  sc.pkgs[site.id].components = [model.makeComponent('pctCost', { pct: 6 })];
  setCons(p, sc, secure.id, 'Security', { type: 'fixed', value: 60000, treatment: 'additional' });
  const r = calc.compute(p, sc, settings);
  near(r.designTotal, 900000 + 864000 + 300000);
  near(r.clientFee, 2064000 + 60000);
  near(r.projectCost, 43000000);
  // Package phase splits copy the first package, so every package is fully allocated.
  r.pkgs.forEach(k => near(k.compUnalloc, 0, 1e-6));
  reconciles(r);
  const P = r.present;
  P.project.cells.forEach((row, i) => near(money.sum(row), P.project.rowTotals[i], 1e-9));
  eq(P.project.total, money.sum(P.packages, k => k.total));
});

test('Removing a package or phase keeps every scenario consistent', () => {
  const { p } = proposal({ cost: 1000000, value: 6 });
  const b = model.addPackage(p, 'B');
  model.duplicateScenario(p, p.scenarios[0].id);
  ok(model.removePackage(p, b.id));
  p.scenarios.forEach(s => eq(Object.keys(s.pkgs).length, 1));
  const ph = p.phases[1].id;
  ok(model.removePhase(p, ph));
  p.scenarios.forEach(s => Object.values(s.pkgs).forEach(c => ok(!(ph in c.alloc))));
  const n = model.normalize(p);
  eq(n.issues.length, 0, 'no repairs needed: ' + n.issues.join(';'));
});

/* ================================================================ consultants */

test('Included consultants reduce the Arch Nexus share; additional consultants raise the client fee', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 6 });
  setCons(p, sc, k, 'Civil', { type: 'fixed', value: 50000, treatment: 'included' });
  setCons(p, sc, k, 'Estimator', { type: 'fixed', value: 20000, treatment: 'additional' });
  const r = compute(p, sc);
  near(r.designTotal, 600000); near(r.archTotal, 550000); near(r.clientFee, 620000);
});

test('Consultant pricing: % of construction cost and % of design fee', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 6 });
  setCons(p, sc, k, 'Mechanical', { type: 'pctCost', value: 1.1, treatment: 'included' });
  setCons(p, sc, k, 'Electrical', { type: 'pctFee', value: 12, treatment: 'included' });
  const r = compute(p, sc);
  const c = n => r.pkgs[0].cons.find(x => x.name === n);
  near(c('Mechanical').client, 110000); near(c('Electrical').client, 72000);
  near(r.archTotal, 600000 - 182000);
});

test('Consultant markup: quotes are marked up to the client; markup stays in Arch Nexus revenue', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 6 });
  setCons(p, sc, k, 'Geotech', { type: 'quote', value: 20000, markup: 10, treatment: 'additional' });
  const r = compute(p, sc);
  const g = r.pkgs[0].cons[0];
  near(g.client, 22000); near(g.cost, 20000);
  near(r.clientFee, 622000); near(r.netRevenue, 602000);
});

test('Consultant allocations with an explicit expected cost show exposure', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 6 });
  setCons(p, sc, k, 'Structural', { type: 'pctFee', value: 11, cost: 80000, treatment: 'included' });
  const r = compute(p, sc);
  near(r.consultantClient, 66000); near(r.consultantCost, 80000);
  near(r.netRevenue, 600000 - 80000);
});

test('Impossible inputs: included % of design fee totaling 100%+ in bottom-up is an error, not a silent value', () => {
  const { p, sc, k } = proposal({});
  sc.pkgs[k].basis = 'arch';
  sc.pkgs[k].components = [model.makeComponent('fixed', { amount: 100000 })];
  setCons(p, sc, k, 'A', { type: 'pctFee', value: 60, treatment: 'included' });
  setCons(p, sc, k, 'B', { type: 'pctFee', value: 40, treatment: 'included' });
  const r = compute(p, sc);
  ok(r.warnings.some(w => w.code === 'pctOver' && w.severity === 'error'));
  noNaN(r);
});

test('Negative Arch Nexus share is flagged', () => {
  const { p, sc, k } = proposal({ cost: 1000000, value: 2 });
  setCons(p, sc, k, 'Civil', { type: 'fixed', value: 30000, treatment: 'included' });
  ok(compute(p, sc).warnings.some(w => w.code === 'negArch'));
});

/* ================================================================ phases */

test('Phase allocation: percentages, dollar amounts, and the unallocated balance', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  const a = sc.pkgs[k].alloc;
  const ph = p.phases;
  a[ph[0].id] = { pct: '', amt: 60000, lock: false }; // $ entry
  a[ph[4].id].pct = 20; // was 25
  const r = compute(p, sc);
  const kk = r.pkgs[0];
  near(kk.designByPhase[ph[0].id], 60000);
  // 500,000 - 60,000 - (25+35+5+20)% x 500,000 = 15,000
  near(kk.compUnalloc, 500000 - 60000 - 425000);
  ok(r.warnings.some(w => w.code === 'unallocated' && w.severity === 'warn'));
  sc.pkgs[k].allowUnallocated = true;
  ok(compute(p, sc).warnings.some(w => w.code === 'unallocated' && w.severity === 'info'), 'intentional balance is info, not a warning');
  reconciles(compute(p, sc));
});

test('Over-allocation is an error', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  sc.pkgs[k].alloc[p.phases[0].id].pct = 30;
  ok(compute(p, sc).warnings.some(w => w.code === 'overAllocated' && w.severity === 'error'));
});

test('Rebalance keeps locked and dollar rows, scales the rest to exactly 100%', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  const a = sc.pkgs[k].alloc;
  const ph = p.phases;
  a[ph[0].id] = { pct: 15, amt: '', lock: true };
  a[ph[1].id] = { pct: '', amt: 50000, lock: false };
  a[ph[2].id].pct = 40;
  const out = calc.rebalance(a, ph, 500000);
  ok(out.ok);
  eq(out.spec[ph[0].id].pct, 15, 'locked unchanged');
  eq(out.spec[ph[1].id].amt, 50000, 'dollar row unchanged');
  const total = 15 + 10 + money.sum(ph.slice(2), x => out.spec[x.id].pct);
  near(total, 100, 1e-9);
  sc.pkgs[k].alloc = out.spec;
  near(compute(p, sc).pkgs[0].compUnalloc, 0, 1e-6);
});

test('Rebalance refuses when nothing can move', () => {
  const ph = [{ id: 'a' }, { id: 'b' }];
  const out = calc.rebalance({ a: { pct: 50, lock: true }, b: { pct: 30, lock: true } }, ph, 100);
  ok(!out.ok && /Unlock/.test(out.reason));
});

test('Consultant phase splits: follow the fee or use a custom split (mechanical heavy in CDs)', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  const mech = setCons(p, sc, k, 'Mechanical', { type: 'fixed', value: 100000, treatment: 'included', split: 'custom' });
  const civ = setCons(p, sc, k, 'Civil', { type: 'fixed', value: 50000, treatment: 'included' });
  const ph = p.phases;
  const split = [5, 15, 60, 5, 15];
  ph.forEach((x, i) => { sc.pkgs[k].cons[mech.id].alloc[x.id] = { pct: split[i], amt: '', lock: false }; });
  const r = compute(p, sc);
  const kk = r.pkgs[0];
  const m = kk.cons.find(c => c.id === mech.id), c = kk.cons.find(x => x.id === civ.id);
  near(m.byPhase[ph[2].id], 60000);
  near(c.byPhase[ph[2].id], 50000 * 0.35, 1e-6, 'civil follows the fee split');
  near(m.byPhase[ph[2].id] / m.client, 0.6, 1e-12, 'share of consultant fee in CD');
  // Arch Nexus absorbs the difference phase by phase.
  ph.forEach(x => near(kk.archByPhase[x.id] + m.byPhase[x.id] + c.byPhase[x.id], kk.designByPhase[x.id], 1e-6));
  reconciles(r);
});

test('Workflow B: five phases, five consultants, independent splits; matrix answers every question', () => {
  const { p, sc, k } = proposal({ cost: 20000000, value: 6 });
  const names = ['Civil', 'Structural', 'Mechanical', 'Electrical', 'Acoustical'];
  names.forEach((n, i) => setCons(p, sc, k, n, { type: 'pctFee', value: [3, 10, 13, 10, 2][i], treatment: 'included' }));
  const civ = p.roster.find(r => r.name === 'Civil');
  sc.pkgs[k].cons[civ.id].split = 'custom';
  [30, 30, 25, 5, 10].forEach((v, i) => { sc.pkgs[k].cons[civ.id].alloc[p.phases[i].id] = { pct: v, amt: '', lock: false }; });
  const r = compute(p, sc);
  reconciles(r);
  const P = r.present.packages[0];
  const dd = 1, cd = 2;
  const struct = P.cols.findIndex(c => c.label === 'Structural');
  ok(P.rowTotals[dd] > 0, 'total fee for DD');
  ok(P.cells[dd][0] > 0, 'Arch Nexus fee for DD');
  ok(P.cells[cd][struct] > 0, 'structural in CD');
  const caShare = P.cells[4][P.cols.findIndex(c => c.label === 'Civil')] / P.colTotals[P.cols.findIndex(c => c.label === 'Civil')];
  near(caShare, 0.10, 0.001, 'share of civil fee in CA');
  eq(P.colTotals[0], money.sum(P.cells, row => row[0]), 'Arch Nexus across phases');
  const t = exporter.tables(p, sc, r, 'matrix');
  eq(t.rows[t.rows.length - 1].cells[t.columns.length - 1], P.total);
});

/* ================================================================ rounding */

test('Rounding: random proposals always reconcile at $1, $10, $100, $1,000', () => {
  for (let n = 0; n < 150; n++) {
    const settings = S();
    const p = model.newProposal({ cost: 1e6 + Math.random() * 4e7, value: 3 + Math.random() * 5, settings });
    if (n % 3 === 0) { const b = model.addPackage(p, 'B'); b.cost = Math.random() * 1e7; }
    const sc = p.scenarios[0];
    p.roundingInc = [1, 10, 100, 1000][n % 4];
    p.packages.forEach(pkg => {
      const nc = 1 + (n % 5);
      for (let i = 0; i < nc; i++) setCons(p, sc, pkg.id, 'C' + i, { type: ['pctFee', 'pctCost', 'fixed', 'quote'][i % 4], value: [7.3, 0.83, 12345.67, 9876.5][i % 4], treatment: i % 2 ? 'additional' : 'included', markup: i === 3 ? 7.5 : '', split: i === 2 ? 'custom' : 'follow' });
      const c2 = p.roster.find(r => r.name === 'C2');
      if (c2 && sc.pkgs[pkg.id].cons[c2.id]) p.phases.forEach((ph, i) => { sc.pkgs[pkg.id].cons[c2.id].alloc[ph.id] = { pct: [13.3, 21.7, 40, 5, 20][i % 5], amt: '', lock: false }; });
    });
    sc.items.push(model.makeItem('service', { label: 'S', amount: 12345.678 }));
    sc.items.push(model.makeItem('contingency', { method: 'pctFee', basis: 'subtotal', pct: 3.3 }));
    const r = calc.compute(p, sc, settings);
    noNaN(r);
    reconciles(r);
    // Every presented value is a multiple of the increment.
    r.present.project.cells.forEach(row => row.forEach(v => near(v / p.roundingInc, Math.round(v / p.roundingInc), 1e-9)));
  }
});

/* ================================================================ labor & staffing */

test('Staffing mode: hours = FTE x months x hours per month; extending CA from 12 to 18 months adds hours (Workflow F)', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  p.roles[2].billRate = 150;
  const ca = p.phases[4].id;
  sc.schedule[ca].months = 12;
  sc.pkgs[k].labor = { mode: 'staffing', rows: [{ id: 'r', roleId: p.roles[2].id, cells: { [ca]: 0.5 } }] };
  let r = compute(p, sc);
  const hpm = 2080 / 12;
  near(r.plannedHours, 0.5 * 12 * hpm, 1e-6);
  const before = r.plannedEffort;
  const s2 = analysis.applyStress(p, sc, S(), { phaseMonths: { [ca]: 6 } });
  r = compute(p, s2);
  near(r.plannedHours, 0.5 * 18 * hpm, 1e-6);
  near(r.plannedEffort - before, 0.5 * 6 * hpm * 150, 1e-6);
  eq(sc.schedule[ca].months, 12, 'original untouched');
  // Fee unchanged (a % of cost fee does not depend on duration); headroom shrinks.
  near(r.clientFee, 500000);
});

test('Workflow D: labor plan value vs a principal\'s % fee; allowance answers whether the fee supports the plan', () => {
  const { p, sc, k } = proposal({ cost: 15000000, value: 5 });
  setCons(p, sc, k, 'Engineers', { type: 'pctFee', value: 30, treatment: 'included' });
  p.roles.forEach((r, i) => { r.billRate = 100 + i * 20; });
  sc.pkgs[k].labor.rows = p.roles.slice(0, 4).map((r, i) => ({ id: 'r' + i, roleId: r.id, cells: Object.fromEntries(p.phases.map(ph => [ph.id, 200 + i * 50])) }));
  const r = compute(p, sc);
  // fee 750,000; consultants 225,000; net 525,000; target 112,500; allowance 412,500
  near(r.effortAllowance, 412500);
  const plan = money.sum(p.roles.slice(0, 4), (rl, i) => (200 + i * 50) * 5 * (100 + i * 20));
  near(r.plannedEffort, plan);
  near(r.effortHeadroom, 412500 - plan);
  // Required fee for the plan at target profit (consultants unchanged):
  const t = analysis.thresholds(p, sc, S());
  // allowance(F) = F - 225,000 - 0.15F  => F = (plan + 225,000) / 0.85
  near(t.feeForPlan, (plan + 225000) / 0.85, 0.01);
});

test('Labor roles without billing rates are flagged', () => {
  const { p, sc, k } = proposal({ method: 'labor' });
  sc.pkgs[k].labor.rows = [{ id: 'r', roleId: p.roles[0].id, cells: { [p.phases[0].id]: 10 } }];
  ok(compute(p, sc).warnings.some(w => w.code === 'missingRate'));
});

/* ================================================================ services, reimbursables, adjustments */

test('Additional services: fixed, hours x role rate, and pass-through with markup', () => {
  const { p, sc } = proposal({ cost: 10000000, value: 5 });
  p.roles[3].billRate = 140;
  sc.items.push(model.makeItem('service', { label: 'Renderings', amount: 40000 }));
  sc.items.push(model.makeItem('service', { label: 'Specialty study', method: 'hours', hours: 100, roleId: p.roles[3].id }));
  sc.items.push(model.makeItem('service', { label: 'Geotech', amount: 22000, provider: 'pass', markup: 10 }));
  const r = compute(p, sc);
  near(r.clientFee, 500000 + 40000 + 14000 + 22000);
  near(r.passCost, 20000);
  near(r.plannedHours, 100, 1e-9, 'hours-based service counts as planned effort');
  near(r.netRevenue, 576000 - 20000);
});

test('Included and internal items do not change the client fee; costs and reserves still count', () => {
  const { p, sc } = proposal({ cost: 10000000, value: 5 });
  sc.items.push(model.makeItem('service', { label: 'ALTA in our fee', amount: 10000, provider: 'pass', treatment: 'included' }));
  sc.items.push(model.makeItem('contingency', { label: 'Internal reserve', amount: 15000, treatment: 'internal' }));
  sc.items.push(model.makeItem('expense', { label: 'Travel', amount: 5000 }));
  const r = compute(p, sc);
  near(r.clientFee, 500000);
  near(r.netRevenue, 490000);
  near(r.reserves, 20000);
  near(r.effortAllowance, 490000 - 20000 - 75000);
});

test('Reimbursables with markup, contingency in the fee, and a discount', () => {
  const { p, sc } = proposal({ cost: 10000000, value: 5 });
  sc.items.push(model.makeItem('reimbursable', { label: 'Printing', amount: 5000, markup: 10 }));
  sc.items.push(model.makeItem('contingency', { label: 'Contingency', method: 'pctFee', basis: 'subtotal', pct: 5 }));
  sc.items.push(model.makeItem('adjustment', { label: 'Negotiated discount', amount: -20000 }));
  const r = compute(p, sc);
  // subtotal = 500,000 (no services); contingency 25,000; reimbursable 5,500; discount -20,000
  near(r.clientFee, 500000 + 5500 + 25000 - 20000);
  near(r.heldContingency, 25000);
  near(r.passCost, 5000);
  near(r.netRevenue, 510500 - 5000);
  // Effort allowance excludes held contingency.
  near(r.effortAllowance, 505500 - 25000 - 0.15 * 510500);
});

/* ================================================================ financials */

test('Detailed profitability is unavailable without cost rates and overhead, and says why', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  p.roles[0].billRate = 200;
  sc.pkgs[k].labor.rows = [{ id: 'r', roleId: p.roles[0].id, cells: { [p.phases[0].id]: 100 } }];
  const r = compute(p, sc);
  eq(r.detailed, null);
  ok(r.detailedUnavailable.some(x => /cost rates/.test(x)));
  ok(r.detailedUnavailable.some(x => /overhead/.test(x)));
});

test('Detailed profitability with cost rates and overhead; denominators are explicit', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  p.roles[0].billRate = 200; p.roles[0].costRate = 80;
  sc.pkgs[k].labor.rows = [{ id: 'r', roleId: p.roles[0].id, cells: { [p.phases[0].id]: 1000 } }];
  const s = S(); s.overheadRate = 1.5;
  const r = compute(p, sc, s);
  near(r.detailed.laborCost, 80000);
  near(r.detailed.overhead, 120000);
  near(r.detailed.projectedProfit, 500000 - 200000);
  near(r.detailed.margin, 300000 / 500000, 1e-12);
  near(r.detailed.multiplier, 500000 / 80000, 1e-12);
  const t = analysis.thresholds(p, sc, s);
  near(t.breakEvenFee, 200000, 0.01);
});

test('Financial warnings: effort over allowance, consultant share, high staffing', () => {
  const { p, sc, k } = proposal({ cost: 1000000, value: 5 });
  p.roles[0].billRate = 200;
  setCons(p, sc, k, 'Big', { type: 'pctFee', value: 60, treatment: 'included' });
  sc.pkgs[k].labor.rows = [{ id: 'r', roleId: p.roles[0].id, cells: { [p.phases[0].id]: 2000 } }];
  const codes = compute(p, sc).warnings.map(w => w.code);
  ok(codes.includes('effortOver')); ok(codes.includes('consultantShare')); ok(codes.includes('highFte'));
});

/* ================================================================ back-solving */

test('Back-solve: what fee % gives a $900,000 client fee', () => {
  const { p, sc, k } = proposal({ cost: 15000000, value: 5 });
  const v = 'comp:' + k + ':' + sc.pkgs[k].components[0].id;
  const out = analysis.solve(p, sc, S(), 'clientFee', 900000, v);
  ok(out.ok); near(out.value, 6, 1e-9);
  eq(sc.pkgs[k].components[0].pct, 5, 'original untouched');
});

test('Back-solve: architectural revenue target and "client will only pay $500k"', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 6 });
  setCons(p, sc, k, 'Civil', { type: 'fixed', value: 180000, treatment: 'included' });
  const v = 'comp:' + k + ':' + sc.pkgs[k].components[0].id;
  // Need $350,000 net revenue: fee = 530,000
  let out = analysis.solve(p, sc, S(), 'netRevenue', 350000, v);
  ok(out.ok); near(out.result.clientFee, 530000, 0.01);
  // Client pays $500,000: revenue left
  out = analysis.solve(p, sc, S(), 'clientFee', 500000, v);
  near(out.result.netRevenue, 320000, 0.01);
});

test('Back-solve reports when the chosen input cannot move the target', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 6 });
  setCons(p, sc, k, 'Civil', { type: 'fixed', value: 50000, treatment: 'included' });
  const out = analysis.solve(p, sc, S(), 'clientFee', 700000, 'con:' + k + ':' + p.roster[0].id);
  ok(!out.ok && /does not affect/.test(out.reason));
});

test('Workflow E: competitive reduction from $900k to $825k shows lost revenue and allowance, original untouched', () => {
  const { p, sc, k } = proposal({ method: 'fixed', value: 900000 });
  setCons(p, sc, k, 'Engineers', { type: 'fixed', value: 250000, treatment: 'included' });
  const base = compute(p, sc);
  const out = analysis.solve(p, sc, S(), 'clientFee', 825000, 'flat');
  ok(out.ok);
  const r = out.result;
  near(base.clientFee - r.clientFee, 75000, 0.01);
  near(base.netRevenue - r.netRevenue, 75000, 0.01, 'consultants unchanged, so revenue absorbs it');
  near(base.effortAllowance - r.effortAllowance, 75000 * 0.85, 0.01);
  near(compute(p, sc).clientFee, 900000);
});

/* ================================================================ scenarios, stress, sensitivity */

test('Scenario duplication is a deep, independent copy', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  setCons(p, sc, k, 'Civil', { type: 'fixed', value: 1000 });
  sc.items.push(model.makeItem('service', { amount: 10 }));
  const d = model.duplicateScenario(p, sc.id);
  d.pkgs[k].components[0].pct = 4;
  d.pkgs[k].cons[p.roster[0].id].value = 2000;
  eq(sc.pkgs[k].components[0].pct, 5); eq(sc.pkgs[k].cons[p.roster[0].id].value, 1000);
  ok(d.items[0].id !== sc.items[0].id);
  eq(p.scenarios[1].id, d.id, 'inserted after the source');
});

test('Stress tests never touch the original; promotion creates a new scenario with notes', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  setCons(p, sc, k, 'Civil', { type: 'quote', value: 50000, treatment: 'additional' });
  const snap = JSON.stringify(sc);
  const st = { cost: 20, consultant: 10, fee: -8, targetProfit: 5 };
  const sr = analysis.stressResult(p, sc, S(), st);
  eq(JSON.stringify(sc), snap);
  near(sr.result.designTotal, 600000);
  const s2 = analysis.promoteStress(p, sc, S(), st, 'Stressed');
  ok(s2.id !== sc.id); ok(/stress test/.test(s2.notes));
  near(compute(p, s2).clientFee, sr.result.clientFee, 1e-9);
});

test('Consultant cost stress: allocation-priced consultants keep their fee, Arch Nexus absorbs the cost', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  setCons(p, sc, k, 'Struct', { type: 'pctFee', value: 10, treatment: 'included' });
  const r = analysis.stressResult(p, sc, S(), { consultant: 20 }).result;
  near(r.consultantClient, 50000); near(r.consultantCost, 60000); near(r.netRevenue, 440000);
});

test('Sensitivity sweep: construction cost +0/10/20/30% raises a % fee linearly', () => {
  const { p, sc } = proposal({ cost: 10000000, value: 5 });
  const pts = analysis.sensitivity(p, sc, S(), 'cost', [0, 10, 20, 30], 'clientFee');
  pts.forEach((pt, i) => near(pt.y, 500000 * (1 + i * 0.1), 1e-6));
});

test('Workflow G: compare percentage, labor, and negotiated scenarios on one set of measures', () => {
  const { p, sc, k } = proposal({ cost: 15000000, value: 5 });
  p.roles[0].billRate = 200;
  const lab = model.duplicateScenario(p, sc.id, 'Labor-based');
  lab.pkgs[k].basis = 'arch';
  lab.pkgs[k].components = [model.makeComponent('labor')];
  lab.pkgs[k].labor.rows = [{ id: 'r', roleId: p.roles[0].id, cells: Object.fromEntries(p.phases.map(ph => [ph.id, 700])) }];
  const neg = model.duplicateScenario(p, sc.id, 'Negotiated');
  neg.pkgs[k].components = [model.makeComponent('fixed', { amount: 690000 })];
  const c = analysis.compare(p, S(), sc.id);
  eq(c.scenarios.length, 3);
  const fee = c.rows.find(r => r.key === 'clientFee');
  const at = name => c.scenarios.findIndex(s => s.name === name);
  near(fee.values[at('Labor-based')], 700000); near(fee.values[at('Negotiated')], 690000);
  near(fee.deltas[at('Negotiated')], -60000); near(fee.deltaPct[at('Negotiated')], -8, 1e-9);
  eq(c.phaseRows.length, p.phases.length);
});

/* ================================================================ edge inputs */

test('Blank proposal computes without NaN anywhere', () => {
  const settings = S();
  const p = model.newProposal({ settings });
  const r = calc.compute(p, p.scenarios[0], settings);
  noNaN(r);
  eq(r.clientFee, 0);
  noNaN(exporter.tables(p, p.scenarios[0], r, 'internal'));
});

test('Zero and blank inputs everywhere still reconcile', () => {
  const { p, sc, k } = proposal({ cost: 0, value: '' });
  setCons(p, sc, k, 'A', { type: 'pctFee', value: '' });
  sc.items.push(model.makeItem('contingency', { method: 'pctFee', pct: '' }));
  const r = compute(p, sc); noNaN(r); reconciles(r);
});

test('Invalid number strings parse to blank, not zero-looking garbage', () => {
  eq(money.parse('abc'), ''); eq(money.parse('1.2.3'), ''); eq(money.parse('--5'), '');
  eq(money.parse('1.5k'), 1500); eq(money.parse('$2.4m'), 2400000); eq(money.parse('(1,000)'), -1000);
});

/* ================================================================ persistence */

test('Save/load integrity: JSON round trip and normalize are lossless and idempotent', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  setCons(p, sc, k, 'Civil', { type: 'fixed', value: 40000 });
  model.addPackage(p, 'B');
  sc.items.push(model.makeItem('reimbursable', { amount: 1000 }));
  const before = compute(p, sc).clientFee;
  const n1 = model.normalize(JSON.parse(JSON.stringify(p)));
  eq(n1.issues.length, 0, n1.issues.join(';'));
  const n2 = model.normalize(n1.proposal);
  eq(JSON.stringify(n2.proposal), JSON.stringify(n1.proposal));
  near(compute(n1.proposal, n1.proposal.scenarios[0]).clientFee, before, 1e-9);
});

test('Normalize repairs malformed data instead of crashing', () => {
  const bad = { schema: 3, id: 'x', packages: [{ id: 'k1', cost: 'abc' }], phases: [], roster: [{ id: 'n1', name: 'Civil' }], roles: [], scenarios: [{ id: 's1', pkgs: { k1: { components: [{ id: 'c', method: 'bogus' }], cons: { n1: { type: 'weird' }, ghost: {} }, labor: { mode: 'x', rows: [{ id: 'r', roleId: 'nobody' }] } }, kgone: {} }, items: [{ id: 'i', kind: 'zzz' }, null] }, null] };
  const n = model.normalize(bad);
  ok(n.issues.length > 0);
  const p = n.proposal;
  eq(p.phases.length, 1);
  eq(p.scenarios.length, 1);
  eq(Object.keys(p.scenarios[0].pkgs).join(), 'k1');
  eq(p.scenarios[0].pkgs.k1.components[0].method, 'fixed');
  eq(p.scenarios[0].pkgs.k1.cons.n1.type, 'fixed');
  eq(p.scenarios[0].pkgs.k1.labor.rows.length, 0);
  eq(p.scenarios[0].items[0].kind, 'service');
  noNaN(calc.compute(p, p.scenarios[0], S()));
});

test('Normalize rejects non-objects', () => {
  let threw = false;
  try { model.normalize('nope'); } catch (e) { threw = true; }
  ok(threw);
});

/* ================================================================ migration */

test('Migration from the first prototype preserves every scenario total exactly', () => {
  delete require.cache[require.resolve('./fixtures/engine-v2.js')];
  const V2 = require('./fixtures/engine-v2.js');
  const v2 = V2.example();
  // Exercise the bottom-up and lump paths too.
  const extra = JSON.parse(JSON.stringify(v2.scenarios[0]));
  extra.id = 'bot'; extra.name = 'Bottom up'; extra.inputs.dir = 'bottom'; extra.inputs.archFee = 400000;
  const lump = JSON.parse(JSON.stringify(v2.scenarios[0]));
  lump.id = 'lump'; lump.method = 'lump'; lump.inputs.lump = 950000;
  const alloc = JSON.parse(JSON.stringify(v2.scenarios[1]));
  alloc.id = 'alloc'; alloc.inputs.basis = 'alloc'; alloc.inputs.months = 12; alloc.inputs.rows.forEach((r, i) => { r.alloc = 10 + i; });
  v2.scenarios.push(extra, lump, alloc);
  const expected = v2.scenarios.map(s => V2.compute(v2, s).grand);
  const n = model.normalize(v2);
  ok(n.issues.some(x => /Upgraded/.test(x)));
  const p = n.proposal;
  eq(p.schema, 3);
  // The first prototype rounded every line to whole dollars as it went; this engine keeps full
  // precision and rounds once. Totals therefore agree to within that line rounding.
  p.scenarios.forEach((s, i) => near(calc.compute(p, s, S()).clientFee, expected[i], 1, 'scenario ' + s.name));
  p.scenarios.forEach((s, i) => near(calc.compute(p, s, S()).present.clientFee, expected[i], 2, 'presented ' + s.name));
});

test('Migration carries the contract baseline and ad scopes', () => {
  const V2 = require('./fixtures/engine-v2.js');
  const v2 = V2.example();
  v2.baseline = { scenarioId: v2.scenarios[0].id, name: v2.scenarios[0].name, date: '2026-10-09', value: 830500 };
  v2.items = [{ id: 'a1', title: 'Lobby', fee: 20000, status: 'accepted', phase: 'adscope', added: '2026-10-09' }, { id: 'a2', title: 'Signage', fee: 5000, status: 'rejected', phase: 'adscope' }];
  const p = model.normalize(v2).proposal;
  const cs = analysis.contractStatus(p);
  eq(cs.original, 830500); eq(cs.accepted, 20000); eq(cs.current, 850500);
});

/* ================================================================ snapshots & contract */

test('Frozen snapshots reproduce their totals after the live proposal changes', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  setCons(p, sc, k, 'Civil', { type: 'fixed', value: 40000, treatment: 'additional' });
  const snap = analysis.makeSnapshot(p, sc.id, S(), 'approved');
  p.snapshots.push(snap);
  // Change shared facts and the scenario.
  p.packages[0].cost = 99; sc.pkgs[k].components[0].pct = 9; p.roster[0].name = 'Renamed';
  model.addPhase(p, 'Extra');
  const re = analysis.recomputeSnapshot(JSON.parse(JSON.stringify(snap)));
  near(re.clientFee, snap.summary.clientFee, 1e-9);
  near(snap.summary.clientFee, 540000);
});

test('Contract changes: accepted count, proposed are pending, rejected never count', () => {
  const { p, sc } = proposal({ cost: 10000000, value: 5 });
  const snap = analysis.makeSnapshot(p, sc.id, S(), 'contract');
  p.snapshots.push(snap); p.contract = { snapshotId: snap.id };
  p.changes = [
    { id: 'a', label: 'Lobby', amount: 20000, status: 'accepted' },
    { id: 'b', label: 'Signage', amount: 15000, status: 'rejected' },
    { id: 'c', label: 'Renderings', amount: 40000, status: 'proposed' }
  ];
  const cs = analysis.contractStatus(p);
  eq(cs.original, 500000); eq(cs.accepted, 20000); eq(cs.pending, 40000); eq(cs.current, 520000); eq(cs.ifAccepted, 560000);
});

/* ================================================================ exports */

test('Export totals equal the presented totals for every table', () => {
  const settings = S();
  const p = model.newProposal({ cost: 12345678, value: 5.37, settings, startMonth: '2026-11' });
  const b = model.addPackage(p, 'Site'); b.cost = 2345678;
  const sc = p.scenarios[0];
  sc.pkgs[b.id].components[0].pct = 6.1;
  setCons(p, sc, p.packages[0].id, 'Civil', { type: 'pctFee', value: 3.33, treatment: 'included' });
  setCons(p, sc, b.id, 'Landscape', { type: 'quote', value: 33333, markup: 7, treatment: 'additional' });
  sc.items.push(model.makeItem('service', { label: 'Renderings', amount: 12345.5 }));
  sc.items.push(model.makeItem('reimbursable', { label: 'Printing', amount: 1234.56, markup: 10 }));
  const r = calc.compute(p, sc, settings);
  const P = r.present;
  const last = t => t.rows[t.rows.length - 1].cells;
  eq(last(exporter.tables(p, sc, r, 'summary'))[1], P.clientFee);
  const bp = exporter.tables(p, sc, r, 'byPhase'); eq(last(bp)[bp.columns.length - 2], P.basic);
  eq(last(exporter.tables(p, sc, r, 'byDiscipline'))[1], P.basic);
  const mx = exporter.tables(p, sc, r, 'matrix'); eq(last(mx)[mx.columns.length - 1], P.basic);
  eq(last(exporter.tables(p, sc, r, 'byPackage'))[4], P.basic);
  const sch = exporter.tables(p, sc, r, 'schedule');
  eq(last(sch)[sch.columns.length - 1], P.basic);
  eq(sch.columns[1].label, 'Nov 2026');
  // Summary lines add to the total.
  const sm = exporter.tables(p, sc, r, 'summary');
  const lines = sm.rows.filter(x => !x.kind);
  near(money.sum(lines, x => x.cells[1]), P.clientFee, 1e-9);
  ok(exporter.validate(r).ok, JSON.stringify(exporter.validate(r)));
});

test('Client-facing exports never contain internal information', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  setCons(p, sc, k, 'Geo', { type: 'quote', value: 20000, markup: 15, treatment: 'additional' });
  sc.items.push(model.makeItem('contingency', { label: 'SECRET reserve', amount: 9999, treatment: 'internal' }));
  sc.items.push(model.makeItem('expense', { label: 'SECRET travel', amount: 1111 }));
  const r = compute(p, sc);
  exporter.EXPORTS.filter(e => e.audience === 'client').forEach(e => {
    const s = JSON.stringify(exporter.tables(p, sc, r, e.id));
    ok(!/SECRET|cost to|Markup|profit|allowance|Effort/i.test(s), e.id + ' leaked: ' + s.slice(0, 200));
  });
  ok(/Markup/.test(JSON.stringify(exporter.tables(p, sc, r, 'internal'))));
});

test('Validation blocks export on errors and lists unallocated balances for review', () => {
  const { p, sc, k } = proposal({ cost: 10000000, value: 5 });
  sc.pkgs[k].alloc[p.phases[0].id].pct = 5;
  let v = exporter.validate(compute(p, sc));
  ok(v.ok && v.review.some(w => w.code === 'unallocated'));
  sc.pkgs[k].alloc[p.phases[0].id].pct = 50;
  v = exporter.validate(compute(p, sc));
  ok(!v.ok && v.blocking.length);
});

test('CSV, HTML, and TSV render every table', () => {
  const { p, sc } = proposal({ cost: 10000000, value: 5, startMonth: '2027-01' });
  const r = compute(p, sc);
  exporter.EXPORTS.forEach(e => {
    const t = exporter.tables(p, sc, r, e.id);
    ok(exporter.csv(t).length > 20); ok(/<table/.test(exporter.html(t))); ok(exporter.tsv(t).includes('\t'));
  });
});

test('XLSX writer produces a valid ZIP with one sheet per table', () => {
  const { p, sc } = proposal({ cost: 10000000, value: 5 });
  const r = compute(p, sc);
  const ts = exporter.EXPORTS.map(e => exporter.tables(p, sc, r, e.id));
  const bytes = exporter.xlsx(ts);
  eq(bytes[0], 0x50); eq(bytes[1], 0x4b);
  const s = Buffer.from(bytes).toString('latin1');
  ok(s.includes('xl/worksheets/sheet7.xml'));
  ok(s.includes('PK\u0005\u0006'));
  require('fs').writeFileSync(require('path').join(__dirname, 'out-test.xlsx'), Buffer.from(bytes));
});

test('A consultant following an unallocated package fee is flagged, and the schedule says what it left out', () => {
  const { p, sc, k } = proposal({ cost: 0, startMonth: '2026-01' });
  sc.pkgs[k].components = [];
  setCons(p, sc, k, 'Landscape', { type: 'fixed', value: 30000, treatment: 'additional' });
  const r = compute(p, sc);
  ok(r.warnings.some(w => w.code === 'consUnallocated' && w.data.follow));
  const sch = exporter.tables(p, sc, r, 'schedule');
  ok(sch.notes.some(n => /Unallocated fee \(\$30,000\) is not scheduled/.test(n)), sch.notes.join('|'));
});

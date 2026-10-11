/*
 * Example proposal used by the "Open example" sandbox and by the interface tests.
 * Every number here is illustrative. Billing rates are marked as examples.
 */
(function (root) {
  'use strict';
  const FB = root.FB || (root.FB = {});
  const M = () => FB.model;

  const EXAMPLE_RATES = { 'Principal': 240, 'Senior Project Manager': 205, 'Project Manager': 180, 'Project Architect': 160, 'Job Captain': 140, 'Designer': 125, 'Technical Staff': 110, 'Administrative Support': 85 };

  function example(settings) {
    const model = M();
    const p = model.newProposal({ name: 'Example: Riverside Civic Center', client: 'Example client', cost: 24000000, area: 60000, value: 5.5, settings, startMonth: '2027-01' });
    p.notes = 'Illustrative numbers only. Billing rates are examples, not Arch Nexus rates.';
    p.example = true;
    p.roles.forEach(r => { if (EXAMPLE_RATES[r.name]) r.billRate = EXAMPLE_RATES[r.name]; });
    const civic = p.packages[0];
    civic.name = 'Civic building';
    const site = model.addPackage(p, 'Site and parking');
    site.cost = 3200000;
    const sc = p.scenarios[0];
    sc.name = '5.5% of construction';
    sc.notes = 'Principal\'s opening position.';
    sc.pkgs[site.id].components[0].pct = 7;
    sc.pkgs[civic.id].components[0].label = 'Design fee';
    sc.pkgs[site.id].components[0].label = 'Site design fee';

    const civil = model.addConsultant(p, 'Civil', 'Civil');
    const struct = model.addConsultant(p, 'Structural', 'Structural');
    const mech = model.addConsultant(p, 'Mechanical', 'Mechanical');
    const elec = model.addConsultant(p, 'Electrical', 'Electrical');
    const land = model.addConsultant(p, 'Landscape', 'Landscape');
    const est = model.addConsultant(p, 'Cost Estimator', 'Cost Estimator');
    const C = sc.pkgs[civic.id].cons, T = sc.pkgs[site.id].cons;
    Object.assign(C[civil.id], { on: true, type: 'fixed', value: 38000, treatment: 'included' });
    Object.assign(C[struct.id], { on: true, type: 'pctFee', value: 10, treatment: 'included' });
    Object.assign(C[mech.id], { on: true, type: 'pctFee', value: 13, treatment: 'included', split: 'custom' });
    Object.assign(C[elec.id], { on: true, type: 'pctFee', value: 10, treatment: 'included' });
    Object.assign(C[land.id], { on: false });
    Object.assign(C[est.id], { on: true, type: 'quote', value: 18000, treatment: 'additional' });
    Object.assign(T[civil.id], { on: true, type: 'pctFee', value: 30, treatment: 'included', split: 'custom' });
    Object.assign(T[land.id], { on: true, type: 'pctFee', value: 20, treatment: 'included' });
    [struct, mech, elec, est].forEach(c => { T[c.id].on = false; });
    // Mechanical carries more of its fee in CDs; site civil is front-loaded.
    const mSplit = [8, 22, 45, 5, 20], cSplit = [25, 30, 30, 5, 10];
    p.phases.forEach((ph, i) => {
      C[mech.id].alloc[ph.id] = { pct: mSplit[i], amt: '', lock: false };
      T[civil.id].alloc[ph.id] = { pct: cSplit[i], amt: '', lock: false };
    });

    // Realistic durations for a project of this size (months).
    [3, 4, 6, 3, 16].forEach((m, i) => { sc.schedule[p.phases[i].id].months = m; });
    // A planned staffing effort for the civic building, used to test the fee's effort allowance.
    const role = n => p.roles.find(r => r.name === n).id;
    const plan = [
      ['Principal', [40, 50, 50, 10, 60]],
      ['Senior Project Manager', [60, 110, 140, 30, 220]],
      ['Project Architect', [120, 300, 520, 60, 380]],
      ['Designer', [220, 320, 260, 10, 40]],
      ['Technical Staff', [40, 260, 700, 40, 120]],
      ['Administrative Support', [10, 20, 30, 10, 60]]
    ];
    sc.pkgs[civic.id].labor = { mode: 'hours', rows: plan.map(([n, hrs], i) => ({ id: 'r' + i, roleId: role(n), cells: Object.fromEntries(p.phases.map((ph, j) => [ph.id, hrs[j]])) })) };
    sc.items.push(model.makeItem('service', { label: 'FF&E coordination', amount: 45000 }));
    sc.items.push(model.makeItem('service', { label: 'Renderings (4 views)', amount: 24000 }));
    sc.items.push(model.makeItem('reimbursable', { label: 'Printing and travel', amount: 8000, markup: 10 }));

    // Scenario B: staffing-based fee for the civic building; the site keeps its percentage.
    const lab = model.duplicateScenario(p, sc.id, 'Staffing-based');
    lab.notes = 'PM\'s staffing plan priced at billing rates.';
    lab.pkgs[civic.id].basis = 'arch';
    lab.pkgs[civic.id].components = [model.makeComponent('labor', { label: 'Labor buildup' })];
    Object.values(lab.pkgs[civic.id].cons).forEach(c => { if (c.on && c.type === 'pctFee') { c.type = 'fixed'; } });
    lab.pkgs[civic.id].cons[struct.id].value = 128000;
    lab.pkgs[civic.id].cons[mech.id].value = 171000;
    lab.pkgs[civic.id].cons[elec.id].value = 132000;

    // Scenario C: negotiated target, same structure as A with a negotiated reduction.
    const neg = model.duplicateScenario(p, sc.id, 'Negotiated target');
    neg.notes = 'Client signaled a ceiling near $1.40M.';
    p.scenarios = [sc, lab, neg];
    neg.items.push(model.makeItem('adjustment', { label: 'Negotiated reduction', amount: -60000 }));
    p.preferredId = sc.id;
    return p;
  }

  FB.sample = { example, EXAMPLE_RATES };
})(typeof globalThis !== 'undefined' ? globalThis : this);

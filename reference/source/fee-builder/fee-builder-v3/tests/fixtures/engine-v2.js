/* ---------- Fee engine: pure functions, no DOM ---------- */
const FE = (function () {
  const num = v => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const has = v => v !== '' && v !== null && v !== undefined && Number.isFinite(typeof v === 'number' ? v : parseFloat(v));
  const r0 = Math.round;
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const uid = () => Math.random().toString(36).slice(2, 8);

  const METHODS = {
    pct: 'Percentage of construction cost',
    hourly: 'Hourly labor buildup',
    sf: 'Square footage rate',
    lump: 'All-in lump sum'
  };

  function costOf(p, sc) {
    return has(sc.inputs.costOverride) ? num(sc.inputs.costOverride) : num(p.cost);
  }

  function laborLines(p, sc) {
    const I = sc.inputs;
    const alloc = I.basis === 'alloc';
    const weeks = num(I.months) * 52 / 12;
    const rows = (I.rows || []).map(r => {
      const rate = num((p.rates.find(x => x.id === r.rateId) || {}).rate);
      const hours = alloc ? num(r.alloc) / 100 * weeks * 40 : num(r.hours);
      return { id: r.id, rate, hours, cost: r0(rate * hours) };
    });
    return { rows, weeks, hours: sum(rows, r => r.hours), total: sum(rows, r => r.cost) };
  }

  const itemFee = i => r0(num(i.fee));

  /*
   * One scenario, start to finish.
   * Consultant pricing types: 'amt' ($ quote), 'pct' (% of construction cost),
   * 'fee' (% of the base design fee: the fee before consultants on top and additional services).
   * The method yields one number, `gross`. For top-down methods it IS the base fee
   * (consultants marked Inside come out of it). For architect-known methods it is the
   * architect fee, and Inside consultants are added to reach the base fee, so the base
   * fee is solved algebraically when an Inside consultant is a % of it.
   */
  function compute(p, sc) {
    const I = sc.inputs;
    const cost = costOf(p, sc);
    const area = num(p.area);
    const hourly = sc.method === 'hourly';
    const cons = p.roster.map(r => {
      const c = (sc.cons && sc.cons[r.id]) || {};
      const type = c.type === 'amt' ? 'amt' : c.type === 'fee' ? 'fee' : 'pct';
      return { id: r.id, name: r.name, type, value: c.value, dollars: 0, inside: hourly ? false : c.inside !== false };
    });
    cons.forEach(c => {
      if (c.type === 'amt') c.dollars = r0(num(c.value));
      else if (c.type === 'pct') c.dollars = r0(cost * num(c.value) / 100);
    });
    const fixedInside = sum(cons.filter(c => c.inside && c.type !== 'fee'), c => c.dollars);
    const pInside = sum(cons.filter(c => c.inside && c.type === 'fee'), c => num(c.value) / 100);

    let gross = 0, known = 'base', labor = null;
    if (sc.method === 'pct') {
      if (I.dir === 'bottom') { gross = r0(num(I.archFee)); known = 'arch'; }
      else gross = r0(cost * num(I.feePct) / 100);
    } else if (sc.method === 'lump') {
      gross = r0(num(I.lump));
    } else if (sc.method === 'sf') {
      gross = r0(area * num(I.rate));
      if (I.covers === 'arch') known = 'arch';
    } else {
      labor = laborLines(p, sc);
      gross = labor.total; known = 'arch';
    }

    const warn = [];
    let base;
    if (known === 'base') base = gross;
    else if (pInside >= 1) { warn.push({ code: 'pctOver' }); base = gross + fixedInside; }
    else base = r0((gross + fixedInside) / (1 - pInside));
    cons.forEach(c => { if (c.type === 'fee') c.dollars = r0(base * num(c.value) / 100); });

    const insideSum = sum(cons.filter(c => c.inside), c => c.dollars);
    const topSum = sum(cons.filter(c => !c.inside), c => c.dollars);
    let arch;
    if (known === 'arch') { arch = gross; base = arch + insideSum; }
    else arch = base - insideSum;

    const total = base + topSum;                       // before additional services
    const services = sum(sc.services || [], itemFee);  // additional services in this scenario
    const grand = total + services;                    // what the client pays
    // Consultant shares are measured against the base design fee.
    cons.forEach(c => { c.share = base > 0 ? c.dollars / base * 100 : null; });

    const needsCost = (sc.method === 'pct' && I.dir !== 'bottom') || cons.some(c => c.type === 'pct' && num(c.value) > 0);
    if (needsCost && cost <= 0) warn.push({ code: 'cost' });
    if (sc.method === 'sf' && area <= 0) warn.push({ code: 'area' });
    if (arch < 0) warn.push({ code: 'negArch', inside: insideSum, base });
    return {
      cost, area, cons, insideSum, topSum, gross, arch, base, total, services, grand, labor,
      consTotal: insideSum + topSum,
      consPct: base > 0 ? (insideSum + topSum) / base * 100 : null,
      pctBase: cost > 0 ? base / cost * 100 : null,
      pctTotal: cost > 0 ? grand / cost * 100 : null,
      psfTotal: area > 0 ? grand / area : null,
      archShare: base > 0 ? arch / base * 100 : null,
      warn
    };
  }

  function contract(p) {
    const sel = p.scenarios.find(s => s.id === p.selectedId);
    const live = sel ? compute(p, sel) : null;
    const out = { hasSel: !!sel, scenTotal: live ? live.grand : 0 };
    out.proposalTotal = out.scenTotal;
    if (p.baseline) {
      const ad = p.items.filter(i => i.phase === 'adscope');
      out.orig = p.baseline.value;
      out.acc = sum(ad.filter(i => i.status === 'accepted'), itemFee);
      out.pend = sum(ad.filter(i => i.status === 'proposed'), itemFee);
      out.cur = out.orig + out.acc;
      out.all = out.cur + out.pend;
    }
    return out;
  }

  /* Rows for the copy-out fee table. Rejected ad scopes never appear. */
  function feeRows(p) {
    const rows = [];
    if (!p.baseline) {
      const sel = p.scenarios.find(s => s.id === p.selectedId);
      if (!sel) return { rows, mode: 'none' };
      const r = compute(p, sel);
      rows.push({ label: 'Architecture', amount: r.arch });
      r.cons.forEach(c => { if (c.dollars !== 0) rows.push({ label: c.name, amount: c.dollars }); });
      rows.push({ label: 'Basic services', amount: r.total, kind: 'sub' });
      (sel.services || []).forEach(s => rows.push({ label: s.title || 'Untitled service', amount: itemFee(s) }));
      rows.push({ label: 'Total fee', amount: r.grand, kind: 'total' });
      return { rows, mode: 'proposal' };
    }
    const b = p.baseline;
    rows.push({ label: 'Original contract value', amount: b.value, kind: 'sub' });
    let t = b.value;
    const ad = p.items.filter(i => i.phase === 'adscope' && i.status !== 'rejected');
    ['accepted', 'proposed'].forEach(st => {
      ad.filter(i => i.status === st).forEach(i => {
        t += itemFee(i);
        rows.push({ label: i.title || 'Untitled ad scope', amount: itemFee(i), status: st });
      });
    });
    rows.push({ label: ad.length ? 'New total contract value' : 'Current contract value', amount: t, kind: 'total' });
    return { rows, mode: 'adscope' };
  }

  function emptyInputs() {
    return { dir: 'top', feePct: '', archFee: '', costOverride: '', rate: '', covers: 'incl', lump: '', basis: 'hours', months: '', rows: [] };
  }

  function defaultCons(sc) {
    return { type: sc.method === 'pct' && sc.inputs.dir !== 'bottom' ? 'pct' : 'amt', value: '', inside: true };
  }

  function makeScenario(p, name) {
    const sc = { id: uid(), name, method: 'pct', inputs: emptyInputs(), cons: {}, services: [] };
    p.roster.forEach(r => { sc.cons[r.id] = defaultCons(sc); });
    return sc;
  }

  function starterRates() {
    return [
      { id: uid(), role: 'Principal', rate: 240 },
      { id: uid(), role: 'Project Manager', rate: 180 },
      { id: uid(), role: 'Project Architect', rate: 150 },
      { id: uid(), role: 'Designer', rate: 125 },
      { id: uid(), role: 'Technician', rate: 105 },
      { id: uid(), role: 'Admin', rate: 85 }
    ];
  }

  function blankProposal() {
    const p = {
      id: 'p' + Date.now().toString(36) + uid(), v: 2, name: '', client: '', cost: '', area: '',
      roster: [], rates: starterRates(), scenarios: [], selectedId: null, baseline: null, items: [],
      updatedAt: Date.now()
    };
    p.scenarios.push(makeScenario(p, 'Scenario 1'));
    return p;
  }

  /* Sandbox proposal with example numbers. */
  function example() {
    const p = blankProposal();
    p.id = 'example'; p.example = true;
    p.name = 'Example Office Building'; p.client = 'Example Client';
    p.cost = 12500000; p.area = 42000;
    const names = ['Civil', 'Structural', 'Mechanical', 'Electrical', 'Cost estimator'];
    p.roster = names.map(n => ({ id: uid(), name: n }));
    const [civil, struc, mech, elec, est] = p.roster;
    const R = role => p.rates.find(r => r.role === role).id;

    const s1 = makeScenario(p, '6.5% of construction');
    s1.inputs.feePct = 6.5;
    s1.cons[civil.id] = { type: 'amt', value: 40000, inside: true };
    s1.cons[struc.id] = { type: 'pct', value: 1.0, inside: true };
    s1.cons[mech.id] = { type: 'pct', value: 1.1, inside: true };
    s1.cons[elec.id] = { type: 'fee', value: 12, inside: true };
    s1.cons[est.id] = { type: 'amt', value: 18000, inside: false };

    const s2 = makeScenario(p, 'Labor buildup');
    s2.method = 'hourly';
    s2.inputs.months = 14;
    s2.inputs.rows = [
      { id: uid(), rateId: R('Principal'), hours: 100, alloc: '' },
      { id: uid(), rateId: R('Project Manager'), hours: 450, alloc: '' },
      { id: uid(), rateId: R('Project Architect'), hours: 900, alloc: '' },
      { id: uid(), rateId: R('Designer'), hours: 700, alloc: '' },
      { id: uid(), rateId: R('Technician'), hours: 800, alloc: '' },
      { id: uid(), rateId: R('Admin'), hours: 100, alloc: '' }
    ];
    s2.cons[civil.id] = { type: 'amt', value: 40000, inside: false };
    s2.cons[struc.id] = { type: 'amt', value: 118000, inside: false };
    s2.cons[mech.id] = { type: 'amt', value: 142000, inside: false };
    s2.cons[elec.id] = { type: 'amt', value: 96000, inside: false };
    s2.cons[est.id] = { type: 'amt', value: 18000, inside: false };

    const s3 = JSON.parse(JSON.stringify(s1));
    s3.id = uid(); s3.name = '6.0% plus services'; s3.inputs.feePct = 6.0;
    s3.services = [
      { id: uid(), title: 'Sustainability (LEED) documentation', fee: 35000 },
      { id: uid(), title: 'Renderings (4 views)', fee: 40000 },
      { id: uid(), title: 'Geotechnical investigation', fee: 14500 }
    ];

    p.scenarios = [s1, s2, s3];
    p.selectedId = s1.id;
    return p;
  }

  /* Fill any missing fields on a proposal loaded from storage, and move older
     proposal-level services into a scenario. */
  function normalize(p) {
    p.roster = p.roster || [];
    p.rates = p.rates && p.rates.length ? p.rates : starterRates();
    p.items = p.items || [];
    p.scenarios = p.scenarios && p.scenarios.length ? p.scenarios : [];
    p.scenarios.forEach(sc => {
      sc.inputs = Object.assign(emptyInputs(), sc.inputs || {});
      sc.inputs.rows = sc.inputs.rows || [];
      sc.cons = sc.cons || {};
      sc.services = sc.services || [];
      sc.method = METHODS[sc.method] ? sc.method : 'pct';
      p.roster.forEach(r => { if (!sc.cons[r.id]) sc.cons[r.id] = defaultCons(sc); });
    });
    if (!p.scenarios.length) p.scenarios.push(makeScenario(p, 'Scenario 1'));
    if (p.selectedId && !p.scenarios.some(s => s.id === p.selectedId)) p.selectedId = null;
    if (p.baseline === undefined) p.baseline = null;
    const legacy = p.items.filter(i => i.phase === 'proposal');
    if (legacy.length) {
      if (!p.baseline) {
        const target = p.scenarios.find(s => s.id === p.selectedId) || p.scenarios[0];
        legacy.filter(i => i.status !== 'rejected').forEach(i => target.services.push({ id: i.id, title: i.title, fee: i.fee }));
      }
      p.items = p.items.filter(i => i.phase !== 'proposal');
    }
    if (p.baseline && !p.baseline.services) p.baseline.services = [];
    p.v = 2;
    return p;
  }

  return { num, has, r0, sum, uid, METHODS, compute, laborLines, contract, feeRows, itemFee,
    makeScenario, defaultCons, blankProposal, example, normalize, starterRates };
})();
if (typeof module !== 'undefined') module.exports = FE;

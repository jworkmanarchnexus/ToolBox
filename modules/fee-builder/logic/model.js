/*
 * Fee Builder engine: data model, defaults, factories, and schema migration.
 *
 * A proposal is one JSON document. Shared project facts (packages, phases,
 * consultant roster, rate table) live on the proposal. Everything a scenario can
 * vary lives on the scenario. See docs/DATA-MODEL.md.
 */
(function (root) {
  'use strict';
  const FB = root.FB || (root.FB = {});
  const SCHEMA = 3;

  let idCounter = 0;
  function uid(prefix) {
    idCounter = (idCounter + 1) % 1296;
    const rnd = Math.random().toString(36).slice(2, 8);
    return (prefix || 'x') + rnd + idCounter.toString(36);
  }

  const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

  /* ------------------------------------------------------------------ settings */

  // Phase templates. Percentages come from the firm's own reference workbooks and are
  // labeled with their source; they are starting points, not firm policy.
  function defaultTemplates() {
    return [
      {
        id: 'tpl-traditional', name: 'Traditional (SD to CA)',
        source: 'Percentages and durations from the EAC Plan calculator',
        phases: [
          { name: 'Schematic Design', pct: 10, months: 1 },
          { name: 'Design Development', pct: 25, months: 1.5 },
          { name: 'Construction Documents', pct: 35, months: 2.5 },
          { name: 'Bidding / Permitting', pct: 5, months: 2 },
          { name: 'Construction Administration', pct: 25, months: 14 }
        ]
      },
      {
        id: 'tpl-milestones', name: 'Design review milestones',
        source: 'Percentages from the WSU CAMP cost-loaded schedule',
        phases: [
          { name: '30% Design Review', pct: 20, months: 2 },
          { name: '60% Design Review', pct: 25, months: 2 },
          { name: '90% Design Review', pct: 25, months: 3 },
          { name: '100% Conformed Documents', pct: 10, months: 2 },
          { name: 'Construction Phase Services', pct: 20, months: 20 }
        ]
      },
      {
        id: 'tpl-full', name: 'Full service (programming to closeout)',
        source: 'Phase names only; percentages left for you to set',
        phases: [
          { name: 'Programming', pct: '', months: '' },
          { name: 'Schematic Design', pct: '', months: '' },
          { name: 'Design Development', pct: '', months: '' },
          { name: 'Construction Documents', pct: '', months: '' },
          { name: 'Bidding / Permitting', pct: '', months: '' },
          { name: 'Construction Administration', pct: '', months: '' },
          { name: 'Project Closeout', pct: '', months: '' }
        ]
      }
    ];
  }

  function defaultRoles() {
    // Role names only. No firm billing or cost rates were supplied, so rates start blank.
    return ['Principal', 'Senior Project Manager', 'Project Manager', 'Project Architect',
      'Job Captain', 'Designer', 'Technical Staff', 'Administrative Support']
      .map((name, i) => ({ id: 'role-' + (i + 1), name, billRate: '', costRate: '' }));
  }

  function defaultSettings() {
    return {
      schema: 1,
      roundingInc: 1,
      defaultTemplateId: 'tpl-traditional',
      templates: defaultTemplates(),
      roles: defaultRoles(),
      // Target profit planning (EAC method). 15% of the total client fee is the value in the
      // firm's EAC Plan calculator; the basis is selectable because the workbook's choice
      // (total fee, consultants included) is a policy decision.
      targetProfitPct: 15,
      targetProfitBasis: 'clientFee', // 'clientFee' | 'netRevenue'
      // Effort-to-staffing conversion. 16,000 is the EAC calculator's "Avg SLC Arch only Cost of
      // FTE/Month". Note the workbook divides billing-rate effort by a cost figure.
      valuePerFteMonth: 16000,
      hoursPerFteMonth: 2080 / 12,
      // Detailed profitability. Blank means "not configured" and detailed metrics show as unavailable.
      overheadRate: '', // overhead as a fraction of direct labor cost, e.g. 1.6 = 160%
      // Warning thresholds. Adjustable; not firm policy.
      consultantShareWarnPct: 50,
      maxFtePerPhase: 8,
      consultantLibrary: ['Civil', 'Structural', 'Mechanical', 'Electrical', 'Plumbing', 'Landscape',
        'Fire Protection', 'Security', 'Cost Estimator', 'Acoustical', 'Interior Design', 'Geotechnical'],
      serviceLibrary: ['FF&E coordination', 'ALTA survey', 'Geotechnical investigation', 'Seismic study',
        'LEED / sustainability documentation', 'Renderings', 'Cost estimating'],
      showMarkup: false
    };
  }

  function normalizeSettings(s) {
    const d = defaultSettings();
    if (!s || typeof s !== 'object') return d;
    const out = Object.assign({}, d, s);
    out.templates = Array.isArray(s.templates) && s.templates.length ? s.templates : d.templates;
    out.roles = Array.isArray(s.roles) && s.roles.length ? s.roles : d.roles;
    out.consultantLibrary = Array.isArray(s.consultantLibrary) ? s.consultantLibrary : d.consultantLibrary;
    out.serviceLibrary = Array.isArray(s.serviceLibrary) ? s.serviceLibrary : d.serviceLibrary;
    if (!['clientFee', 'netRevenue'].includes(out.targetProfitBasis)) out.targetProfitBasis = 'clientFee';
    out.schema = 1;
    return out;
  }

  /* ------------------------------------------------------------------ factories */

  function makeAlloc(phases, pcts) {
    const a = {};
    phases.forEach((ph, i) => { a[ph.id] = { pct: pcts ? (pcts[i] === undefined ? '' : pcts[i]) : '', amt: '', lock: false }; });
    return a;
  }

  function makeComponent(method, fields) {
    return Object.assign({ id: uid('c'), label: '', method: method || 'pctCost', pct: '', amount: '', rate: '', qty: '', covers: 'all' }, fields || {});
  }

  function makeConsultantPricing(fields) {
    return Object.assign({ on: true, type: 'pctFee', value: '', treatment: 'included', markup: '', cost: '', split: 'follow', alloc: {}, note: '' }, fields || {});
  }

  function makePackageCalc(proposal, pkg, fields) {
    const calc = Object.assign({
      basis: 'design', costOverride: '', areaOverride: '', unitsOverride: '',
      components: [makeComponent('pctCost', { label: 'Design fee' })],
      alloc: makeAlloc(proposal.phases),
      allowUnallocated: false,
      cons: {},
      labor: { mode: 'hours', rows: [] }
    }, fields || {});
    proposal.roster.forEach(c => { if (!calc.cons[c.id]) calc.cons[c.id] = makeConsultantPricing({ on: false }); });
    return calc;
  }

  function makeScenario(proposal, name, fields) {
    const sc = Object.assign({
      id: uid('s'), name: name || 'Scenario', notes: '', createdAt: Date.now(),
      pkgs: {}, schedule: {}, items: [],
      finance: { targetProfitPct: '', rateFactor: 1 }
    }, fields || {});
    proposal.packages.forEach(p => { if (!sc.pkgs[p.id]) sc.pkgs[p.id] = makePackageCalc(proposal, p); });
    proposal.phases.forEach(ph => { if (!sc.schedule[ph.id]) sc.schedule[ph.id] = { months: '', start: '' }; });
    return sc;
  }

  function makeItem(kind, fields) {
    return Object.assign({
      id: uid('i'), kind: kind || 'service', label: '', method: 'fixed', pct: '', amount: '', rate: '', qty: '', hours: '', roleId: '',
      basis: 'subtotal', pkgId: '', treatment: kind === 'expense' ? 'internal' : 'add', provider: 'an', markup: '', cost: ''
    }, fields || {});
  }

  /**
   * New proposal. `opts`: name, client, cost, area, method ('pctCost'|'fixed'|'area'|'labor'),
   * value (the one initial assumption), templateId, settings.
   */
  function newProposal(opts) {
    opts = opts || {};
    const settings = normalizeSettings(opts.settings);
    const tpl = settings.templates.find(t => t.id === (opts.templateId || settings.defaultTemplateId)) || settings.templates[0];
    const p = {
      schema: SCHEMA, id: uid('p'), rev: 0, updatedAt: Date.now(), createdAt: Date.now(),
      name: opts.name || '', client: opts.client || '', number: '', startMonth: opts.startMonth || '', notes: '',
      roundingInc: settings.roundingInc || 1,
      packages: [{ id: uid('k'), name: 'Main scope', cost: opts.cost === undefined ? '' : opts.cost, area: opts.area === undefined ? '' : opts.area, units: '', unitLabel: '' }],
      phases: tpl.phases.map(ph => ({ id: uid('ph'), name: ph.name })),
      roster: [],
      roles: clone(settings.roles),
      scenarios: [], preferredId: null,
      snapshots: [], contract: null, changes: [],
      source: { kind: 'manual' }, extRefs: {}
    };
    const sc = makeScenario(p, 'Scenario A');
    const pkg = p.packages[0];
    const calc = sc.pkgs[pkg.id];
    const method = opts.method || 'pctCost';
    const comp = calc.components[0];
    comp.method = method;
    if (method === 'pctCost') comp.pct = opts.value === undefined ? '' : opts.value;
    else if (method === 'fixed') comp.amount = opts.value === undefined ? '' : opts.value;
    else if (method === 'area') comp.rate = opts.value === undefined ? '' : opts.value;
    else if (method === 'labor') { calc.basis = 'arch'; comp.label = 'Labor buildup'; }
    calc.alloc = makeAlloc(p.phases, tpl.phases.map(ph => ph.pct));
    tpl.phases.forEach((ph, i) => { sc.schedule[p.phases[i].id] = { months: ph.months, start: '' }; });
    p.scenarios.push(sc);
    p.preferredId = sc.id;
    return p;
  }

  /* ------------------------------------------------------------- structural edits */
  // These keep every scenario consistent with the shared project facts.

  function addPackage(p, name) {
    const pkg = { id: uid('k'), name: name || 'Package ' + (p.packages.length + 1), cost: '', area: '', units: '', unitLabel: '' };
    p.packages.push(pkg);
    p.scenarios.forEach(sc => {
      const first = sc.pkgs[p.packages[0].id];
      const calc = makePackageCalc(p, pkg);
      // Start the new package with the same phase percentages as the first package.
      if (first) calc.alloc = clone(first.alloc);
      sc.pkgs[pkg.id] = calc;
    });
    return pkg;
  }

  function removePackage(p, pkgId) {
    if (p.packages.length <= 1) return false;
    p.packages = p.packages.filter(k => k.id !== pkgId);
    p.scenarios.forEach(sc => { delete sc.pkgs[pkgId]; sc.items.forEach(it => { if (it.pkgId === pkgId) it.pkgId = ''; }); });
    return true;
  }

  function addPhase(p, name, index) {
    const ph = { id: uid('ph'), name: name || 'New phase' };
    if (index === undefined || index < 0 || index > p.phases.length) p.phases.push(ph);
    else p.phases.splice(index, 0, ph);
    p.scenarios.forEach(sc => {
      sc.schedule[ph.id] = { months: '', start: '' };
      Object.values(sc.pkgs).forEach(calc => {
        calc.alloc[ph.id] = { pct: '', amt: '', lock: false };
        Object.values(calc.cons).forEach(c => { if (c.alloc) c.alloc[ph.id] = { pct: '', amt: '', lock: false }; });
        calc.labor.rows.forEach(r => { r.cells[ph.id] = ''; });
      });
    });
    return ph;
  }

  function removePhase(p, phId) {
    if (p.phases.length <= 1) return false;
    p.phases = p.phases.filter(ph => ph.id !== phId);
    p.scenarios.forEach(sc => {
      delete sc.schedule[phId];
      Object.values(sc.pkgs).forEach(calc => {
        delete calc.alloc[phId];
        calc.components.forEach(c => { if (Array.isArray(c.covers)) { c.covers = c.covers.filter(x => x !== phId); if (!c.covers.length) c.covers = 'all'; } });
        Object.values(calc.cons).forEach(c => { if (c.alloc) delete c.alloc[phId]; });
        calc.labor.rows.forEach(r => { delete r.cells[phId]; });
      });
    });
    return true;
  }

  function movePhase(p, phId, dir) {
    const i = p.phases.findIndex(ph => ph.id === phId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= p.phases.length) return false;
    const t = p.phases[i]; p.phases[i] = p.phases[j]; p.phases[j] = t;
    return true;
  }

  /** Replace the phase list from a template. Existing allocations are reset to the template percentages. */
  function applyTemplate(p, tpl) {
    p.phases = tpl.phases.map(ph => ({ id: uid('ph'), name: ph.name }));
    p.scenarios.forEach(sc => {
      sc.schedule = {};
      p.phases.forEach((ph, i) => { sc.schedule[ph.id] = { months: tpl.phases[i].months, start: '' }; });
      Object.values(sc.pkgs).forEach(calc => {
        calc.alloc = makeAlloc(p.phases, tpl.phases.map(ph => ph.pct));
        calc.components.forEach(c => { c.covers = 'all'; });
        Object.values(calc.cons).forEach(c => { c.split = 'follow'; c.alloc = {}; });
        calc.labor.rows.forEach(r => { r.cells = {}; p.phases.forEach(ph => { r.cells[ph.id] = ''; }); });
      });
    });
  }

  function addConsultant(p, name, discipline) {
    const c = { id: uid('n'), name: name || 'Consultant', discipline: discipline || name || '' };
    p.roster.push(c);
    p.scenarios.forEach(sc => Object.values(sc.pkgs).forEach(calc => { calc.cons[c.id] = makeConsultantPricing({ on: true }); }));
    return c;
  }

  function removeConsultant(p, conId) {
    p.roster = p.roster.filter(c => c.id !== conId);
    p.scenarios.forEach(sc => Object.values(sc.pkgs).forEach(calc => { delete calc.cons[conId]; }));
  }

  function duplicateScenario(p, scId, name) {
    const src = p.scenarios.find(s => s.id === scId);
    if (!src) return null;
    const c = clone(src);
    c.id = uid('s');
    c.name = name || (src.name + ' copy');
    c.createdAt = Date.now();
    // Fresh ids for child rows so later edits never collide.
    Object.values(c.pkgs).forEach(calc => {
      calc.components.forEach(x => { x.id = uid('c'); });
      calc.labor.rows.forEach(r => { r.id = uid('r'); });
    });
    c.items.forEach(it => { it.id = uid('i'); });
    const at = p.scenarios.findIndex(s => s.id === scId);
    p.scenarios.splice(at + 1, 0, c);
    return c;
  }

  /* ------------------------------------------------------------------ validation */

  /**
   * Repair a proposal loaded from storage: fill missing fields, drop references to
   * deleted packages/phases/consultants, coerce types. Returns { proposal, issues }.
   * Never throws for ordinary malformed data; throws only for non-objects.
   */
  function normalize(input) {
    if (!input || typeof input !== 'object') throw new Error('Not a proposal');
    let p = clone(input);
    const issues = [];
    if (!p.schema || p.schema < 3) { p = migrateV2(p); issues.push('Upgraded from an earlier version of Fee Builder.'); }
    if (p.schema > SCHEMA) issues.push('This proposal was saved by a newer version of Fee Builder; some fields may be ignored.');
    p.schema = SCHEMA;
    p.id = p.id || uid('p');
    ['name', 'client', 'number', 'startMonth', 'notes'].forEach(k => { if (typeof p[k] !== 'string') p[k] = p[k] == null ? '' : String(p[k]); });
    p.roundingInc = [1, 10, 100, 1000].includes(+p.roundingInc) ? +p.roundingInc : 1;
    p.packages = arr(p.packages).filter(o => o && o.id).map(k => Object.assign({ name: '', cost: '', area: '', units: '', unitLabel: '' }, k));
    if (!p.packages.length) { p.packages = [{ id: uid('k'), name: 'Main scope', cost: '', area: '', units: '', unitLabel: '' }]; issues.push('Added a missing work package.'); }
    p.phases = arr(p.phases).filter(o => o && o.id).map(ph => Object.assign({ name: '' }, ph));
    if (!p.phases.length) { p.phases = [{ id: uid('ph'), name: 'Design' }]; issues.push('Added a missing phase.'); }
    p.roster = arr(p.roster).filter(o => o && o.id).map(c => Object.assign({ name: '', discipline: '' }, c));
    p.roles = arr(p.roles).filter(o => o && o.id).map(r => Object.assign({ name: '', billRate: '', costRate: '' }, r));
    p.snapshots = arr(p.snapshots);
    p.changes = arr(p.changes).filter(o => o && o.id).map(ch => Object.assign({ label: '', method: 'fixed', amount: '', status: 'proposed', added: '' }, ch));
    p.source = p.source && typeof p.source === 'object' ? p.source : { kind: 'manual' };
    p.extRefs = p.extRefs && typeof p.extRefs === 'object' ? p.extRefs : {};
    p.scenarios = arr(p.scenarios).filter(o => o && o.id);
    const pkIds = new Set(p.packages.map(k => k.id));
    const phIds = new Set(p.phases.map(x => x.id));
    const conIds = new Set(p.roster.map(c => c.id));
    const roleIds = new Set(p.roles.map(r => r.id));
    p.scenarios.forEach(sc => {
      sc.name = typeof sc.name === 'string' ? sc.name : 'Scenario';
      sc.notes = typeof sc.notes === 'string' ? sc.notes : '';
      sc.finance = Object.assign({ targetProfitPct: '', rateFactor: 1 }, sc.finance || {});
      if (!(sc.finance.rateFactor > 0)) sc.finance.rateFactor = 1;
      sc.items = arr(sc.items).filter(o => o && o.id).map(it => {
        const m = Object.assign(makeItem(it.kind), it);
        if (m.pkgId && !pkIds.has(m.pkgId)) m.pkgId = '';
        if (!['service', 'reimbursable', 'expense', 'contingency', 'adjustment'].includes(m.kind)) m.kind = 'service';
        if (!['add', 'included', 'internal'].includes(m.treatment)) m.treatment = 'add';
        return m;
      });
      const pk = sc.pkgs && typeof sc.pkgs === 'object' ? sc.pkgs : {};
      sc.pkgs = {};
      p.packages.forEach(k => {
        const calc = pk[k.id] ? Object.assign(makePackageCalc(p, k, {}), pk[k.id]) : makePackageCalc(p, k);
        if (!['design', 'arch'].includes(calc.basis)) calc.basis = 'design';
        calc.components = arr(calc.components).filter(o => o && o.id).map(c => {
          const m = Object.assign(makeComponent(c.method), c);
          if (!['pctCost', 'fixed', 'labor', 'area', 'unit'].includes(m.method)) m.method = 'fixed';
          if (Array.isArray(m.covers)) { m.covers = m.covers.filter(x => phIds.has(x)); if (!m.covers.length) m.covers = 'all'; } else m.covers = 'all';
          return m;
        });
        calc.alloc = fixAlloc(calc.alloc, p.phases);
        const cons = calc.cons && typeof calc.cons === 'object' ? calc.cons : {};
        calc.cons = {};
        p.roster.forEach(c => {
          const m = Object.assign(makeConsultantPricing({ on: false }), cons[c.id] || {});
          if (!['fixed', 'quote', 'pctCost', 'pctFee'].includes(m.type)) m.type = 'fixed';
          if (!['included', 'additional'].includes(m.treatment)) m.treatment = 'included';
          if (!['follow', 'custom'].includes(m.split)) m.split = 'follow';
          m.alloc = fixAlloc(m.alloc, p.phases);
          calc.cons[c.id] = m;
        });
        calc.labor = calc.labor && typeof calc.labor === 'object' ? calc.labor : { mode: 'hours', rows: [] };
        if (!['hours', 'staffing'].includes(calc.labor.mode)) calc.labor.mode = 'hours';
        calc.labor.rows = arr(calc.labor.rows).filter(r => r && r.id && roleIds.has(r.roleId)).map(r => {
          const cells = {};
          p.phases.forEach(ph => { cells[ph.id] = r.cells && r.cells[ph.id] !== undefined ? r.cells[ph.id] : ''; });
          return { id: r.id, roleId: r.roleId, cells };
        });
        sc.pkgs[k.id] = calc;
      });
      const schedule = sc.schedule && typeof sc.schedule === 'object' ? sc.schedule : {};
      sc.schedule = {};
      p.phases.forEach(ph => { sc.schedule[ph.id] = Object.assign({ months: '', start: '' }, schedule[ph.id] || {}); });
      void conIds;
    });
    if (!p.scenarios.length) { p.scenarios.push(makeScenario(p, 'Scenario A')); issues.push('Added a missing scenario.'); }
    if (!p.scenarios.some(s => s.id === p.preferredId)) p.preferredId = null;
    if (p.contract && !p.snapshots.some(s => s.id === p.contract.snapshotId)) p.contract = null;
    return { proposal: p, issues };
  }

  function fixAlloc(a, phases) {
    const out = {};
    a = a && typeof a === 'object' ? a : {};
    phases.forEach(ph => {
      const e = a[ph.id] || {};
      out[ph.id] = { pct: e.pct === undefined ? '' : e.pct, amt: e.amt === undefined ? '' : e.amt, lock: !!e.lock };
    });
    return out;
  }

  const arr = v => (Array.isArray(v) ? v : []);

  /* ------------------------------------------------------------------ migration */

  /**
   * Upgrade a v2 proposal (the first prototype) to v3. Totals are preserved exactly;
   * phases come from the default template because v2 had none, so every v2 fee is
   * distributed by the template percentages. See docs/DATA-MODEL.md "Migration".
   */
  function migrateV2(v2) {
    const tpl = defaultTemplates()[0];
    const p = {
      schema: SCHEMA, id: v2.id || uid('p'), rev: 0, updatedAt: v2.updatedAt || Date.now(), createdAt: v2.updatedAt || Date.now(),
      name: v2.name || '', client: v2.client || '', number: '', startMonth: '', notes: '',
      roundingInc: 1,
      packages: [{ id: 'k-main', name: 'Main scope', cost: v2.cost === undefined ? '' : v2.cost, area: v2.area === undefined ? '' : v2.area, units: '', unitLabel: '' }],
      phases: tpl.phases.map((ph, i) => ({ id: 'ph-' + (i + 1), name: ph.name })),
      roster: arr(v2.roster).map(c => ({ id: c.id, name: c.name || '', discipline: c.name || '' })),
      roles: arr(v2.rates).map(r => ({ id: r.id, name: r.role || '', billRate: r.rate === undefined ? '' : r.rate, costRate: '' })),
      scenarios: [], preferredId: v2.selectedId || null,
      snapshots: [], contract: null, changes: [],
      source: { kind: 'manual', migratedFrom: 2 }, extRefs: {}
    };
    if (!p.roles.length) p.roles = defaultRoles();
    const pk = p.packages[0].id;
    const pcts = tpl.phases.map(x => x.pct);
    arr(v2.scenarios).forEach(s => {
      const I = s.inputs || {};
      const sc = {
        id: s.id, name: s.name || 'Scenario', notes: '', createdAt: Date.now(), pkgs: {}, schedule: {}, items: [],
        finance: { targetProfitPct: '', rateFactor: 1 }
      };
      p.phases.forEach((ph, i) => { sc.schedule[ph.id] = { months: tpl.phases[i].months, start: '' }; });
      const calc = { basis: 'design', costOverride: I.costOverride === undefined ? '' : I.costOverride, areaOverride: '', unitsOverride: '', components: [], alloc: makeAlloc(p.phases, pcts), allowUnallocated: false, cons: {}, labor: { mode: 'hours', rows: [] } };
      const method = s.method;
      if (method === 'hourly') {
        calc.basis = 'arch';
        calc.components.push(makeComponent('labor', { label: 'Labor buildup' }));
        const months = parseFloat(I.months) || 0;
        (I.rows || []).forEach(r => {
          const hours = I.basis === 'alloc' ? (parseFloat(r.alloc) || 0) / 100 * months * 52 / 12 * 40 : (parseFloat(r.hours) || 0);
          const cells = {};
          p.phases.forEach((ph, i) => { cells[ph.id] = hours * pcts[i] / 100; });
          calc.labor.rows.push({ id: r.id || uid('r'), roleId: r.rateId, cells });
        });
      } else if (method === 'sf') {
        calc.basis = I.covers === 'arch' ? 'arch' : 'design';
        calc.components.push(makeComponent('area', { label: 'Area rate', rate: I.rate === undefined ? '' : I.rate }));
      } else if (method === 'lump') {
        calc.components.push(makeComponent('fixed', { label: 'Lump sum', amount: I.lump === undefined ? '' : I.lump }));
      } else if (I.dir === 'bottom') {
        calc.basis = 'arch';
        calc.components.push(makeComponent('fixed', { label: 'Architect fee', amount: I.archFee === undefined ? '' : I.archFee }));
      } else {
        calc.components.push(makeComponent('pctCost', { label: 'Design fee', pct: I.feePct === undefined ? '' : I.feePct }));
      }
      p.roster.forEach(c => {
        const o = (s.cons || {})[c.id] || {};
        const type = o.type === 'amt' ? 'fixed' : (o.type === 'fee' || o.type === 'share') ? 'pctFee' : 'pctCost';
        const additional = method === 'hourly' ? true : o.inside === false;
        calc.cons[c.id] = makeConsultantPricing({ on: true, type, value: o.value === undefined ? '' : o.value, treatment: additional ? 'additional' : 'included' });
      });
      sc.pkgs[pk] = calc;
      arr(s.services).forEach(v => sc.items.push(makeItem('service', { id: v.id || uid('i'), label: v.title || '', method: 'fixed', amount: v.fee === undefined ? '' : v.fee })));
      p.scenarios.push(sc);
    });
    if (v2.baseline) {
      const b = v2.baseline;
      const src = p.scenarios.find(s => s.id === b.scenarioId);
      const snap = {
        id: uid('snap'), kind: 'contract', name: 'Contract baseline', date: b.date || '', scenarioId: b.scenarioId || null,
        scenarioName: b.name || '', note: 'Carried over from the earlier version.', legacyValue: b.value,
        frozen: src ? { scenario: clone(src), packages: clone(p.packages), phases: clone(p.phases), roster: clone(p.roster), roles: clone(p.roles), roundingInc: 1 } : null,
        summary: { clientFee: b.value, presentedClientFee: b.value }
      };
      p.snapshots.push(snap);
      p.contract = { snapshotId: snap.id };
    }
    arr(v2.items).filter(i => i.phase === 'adscope').forEach(i => {
      p.changes.push({ id: i.id || uid('ch'), label: i.title || '', method: 'fixed', amount: i.fee === undefined ? '' : i.fee, status: ['proposed', 'accepted', 'rejected'].includes(i.status) ? i.status : 'proposed', added: i.added || '' });
    });
    return p;
  }

  FB.model = {
    SCHEMA, uid, clone, defaultSettings, normalizeSettings, defaultTemplates, defaultRoles,
    makeAlloc, makeComponent, makeConsultantPricing, makePackageCalc, makeScenario, makeItem, newProposal,
    addPackage, removePackage, addPhase, removePhase, movePhase, applyTemplate, addConsultant, removeConsultant,
    duplicateScenario, normalize, migrateV2
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

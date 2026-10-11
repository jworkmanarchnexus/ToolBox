/*
 * Fee Builder engine: export tables, validation before export, CSV, HTML for Word,
 * and a minimal dependency-free XLSX writer.
 *
 * Every exported number comes from result.present, so exported totals always equal
 * what the screen shows. Client-facing tables never include costs, markups, internal
 * items, labor plans, or profitability.
 */
(function (root) {
  'use strict';
  const FB = root.FB || (root.FB = {});
  const { sum, roundTo } = FB.money;

  const EXPORTS = [
    { id: 'summary', audience: 'client', label: 'Project fee summary' },
    { id: 'byPhase', audience: 'client', label: 'Fee by phase' },
    { id: 'byDiscipline', audience: 'client', label: 'Fee by discipline' },
    { id: 'matrix', audience: 'client', label: 'Phase by discipline matrix' },
    { id: 'byPackage', audience: 'client', label: 'Fee by work package' },
    { id: 'schedule', audience: 'client', label: 'Cost-loaded schedule' },
    { id: 'internal', audience: 'internal', label: 'Internal financial analysis' }
  ];

  /** Issues to resolve or acknowledge before exporting. */
  function validate(res) {
    const blocking = res.warnings.filter(w => w.severity === 'error');
    const review = res.warnings.filter(w => w.severity === 'warn' && ['unallocated', 'consUnallocated', 'negArchPhase', 'missingCost', 'missingArea', 'missingUnits', 'missingRate'].includes(w.code));
    const reconcile = [];
    const P = res.present;
    // Belt and braces: confirm the presented numbers reconcile before anything leaves the app.
    P.packages.forEach(k => {
      const rows = sum(k.rowTotals), cols = sum(k.colTotals);
      if (Math.abs(rows - k.total) > 1e-6 || Math.abs(cols - k.total) > 1e-6) reconcile.push('Totals for ' + k.name + ' do not reconcile.');
    });
    if (Math.abs(P.project.total - P.basic) > 1e-6) reconcile.push('Project matrix total does not match basic services.');
    if (Math.abs(P.basic + P.itemsClient - P.clientFee) > 1e-6) reconcile.push('Client fee does not equal its parts.');
    return { ok: !blocking.length && !reconcile.length, blocking, review, reconcile };
  }

  function tables(p, sc, res, which, opts) {
    opts = opts || {};
    const P = res.present;
    const head = { project: p.name || 'Untitled project', client: p.client || '', scenario: sc.name, inc: P.inc };
    const t = { summary, byPhase, byDiscipline, matrix, byPackage, schedule, internal }[which];
    if (!t) return null;
    const out = t();
    out.id = which;
    out.audience = (EXPORTS.find(e => e.id === which) || {}).audience;
    out.meta = head;
    return out;

    function summary() {
      const rows = [];
      const multi = P.packages.length > 1;
      if (multi) {
        P.packages.forEach(k => rows.push({ cells: [k.name + ': basic services', k.basic] }));
      } else {
        const k = P.packages[0];
        rows.push({ cells: ['Arch Nexus', k.arch] });
        res.pkgs[0].cons.forEach(c => { const v = k.col(c.id); if (v) rows.push({ cells: [c.name + (c.treatment === 'additional' ? '' : ''), v] }); });
      }
      rows.push({ cells: ['Basic services', P.basic], kind: 'sub' });
      const groups = [['service', 'Additional services'], ['reimbursable', 'Reimbursable expenses'], ['contingency', 'Contingency'], ['adjustment', 'Adjustments']];
      groups.forEach(([kind]) => {
        P.items.filter(it => it.kind === kind && it.treatment === 'add' && it.client !== 0).forEach(it => rows.push({ cells: [it.label || FB.calc.kindLabel(kind), it.client] }));
      });
      rows.push({ cells: ['Total fee', P.clientFee], kind: 'total' });
      return { title: 'Fee summary', columns: [{ label: 'Description', type: 'text' }, { label: 'Fee', type: 'money' }], rows };
    }

    function byPhase() {
      const multi = P.packages.length > 1;
      const cols = [{ label: 'Phase', type: 'text' }];
      if (multi) P.packages.forEach(k => cols.push({ label: k.name, type: 'money' }));
      cols.push({ label: 'Total', type: 'money' }, { label: '% of basic services', type: 'pct' });
      const rows = P.project.rowKeys.map((key, i) => {
        const cells = [P.project.rowLabels[i]];
        if (multi) P.packages.forEach(k => { const ri = k.rows.findIndex(r => r.key === key); cells.push(ri >= 0 ? k.rowTotals[ri] : 0); });
        cells.push(P.project.rowTotals[i], P.basic ? P.project.rowTotals[i] / P.basic : null);
        return { cells };
      });
      const tot = ['Basic services'];
      if (multi) P.packages.forEach(k => tot.push(k.total));
      tot.push(P.project.total, P.basic ? 1 : null);
      rows.push({ cells: tot, kind: 'total' });
      const notes = P.items.some(it => it.treatment === 'add' && it.client) ? ['Additional services, reimbursables, contingency, and adjustments are not distributed by phase.'] : [];
      return { title: 'Fee by phase', columns: cols, rows, notes };
    }

    function byDiscipline() {
      const rows = P.project.colKeys.map((key, j) => ({ cells: [P.project.colLabels[j], P.project.colTotals[j], P.basic ? P.project.colTotals[j] / P.basic : null] }));
      rows.push({ cells: ['Basic services', P.project.total, P.basic ? 1 : null], kind: 'total' });
      return { title: 'Fee by discipline', columns: [{ label: 'Discipline', type: 'text' }, { label: 'Fee', type: 'money' }, { label: '% of basic services', type: 'pct' }], rows };
    }

    function matrix() {
      const pkgId = opts.pkgId;
      const k = pkgId ? P.packages.find(x => x.pkgId === pkgId) : null;
      const src = k ? { rowLabels: k.rows.map(r => r.label), colLabels: k.cols.map(c => c.label), cells: k.cells, rowTotals: k.rowTotals, colTotals: k.colTotals, total: k.total }
        : { rowLabels: P.project.rowLabels, colLabels: P.project.colLabels, cells: P.project.cells, rowTotals: P.project.rowTotals, colTotals: P.project.colTotals, total: P.project.total };
      const cols = [{ label: 'Phase', type: 'text' }].concat(src.colLabels.map(l => ({ label: l, type: 'money' }))).concat([{ label: 'Total', type: 'money' }]);
      const rows = src.cells.map((r, i) => ({ cells: [src.rowLabels[i]].concat(r).concat([src.rowTotals[i]]) }));
      rows.push({ cells: ['Total'].concat(src.colTotals).concat([src.total]), kind: 'total' });
      return { title: 'Phase by discipline' + (k ? ': ' + k.name : ''), columns: cols, rows };
    }

    function byPackage() {
      const rows = P.packages.map((k, i) => {
        const r = res.pkgs[i];
        return { cells: [k.name, roundTo(r.metrics.cost, P.inc) || null, k.design, k.additional, k.basic, r.metrics.cost > 0 ? k.basic / r.metrics.cost : null] };
      });
      rows.push({ cells: ['Total', roundTo(res.projectCost, P.inc) || null, P.design, P.additional, P.basic, res.projectCost > 0 ? P.basic / res.projectCost : null], kind: 'total' });
      return {
        title: 'Fee by work package',
        columns: [{ label: 'Work package', type: 'text' }, { label: 'Construction cost', type: 'money' }, { label: 'Design fee', type: 'money' }, { label: 'Additional consultants', type: 'money' }, { label: 'Basic services', type: 'money' }, { label: 'Basic services % of cost', type: 'pct' }],
        rows
      };
    }

    function schedule() {
      const cl = FB.calc.costLoaded(p, res);
      const multi = P.packages.length > 1;
      const cols = [{ label: 'Phase', type: 'text' }].concat(cl.labels.map(l => ({ label: l, type: 'money' }))).concat([{ label: 'Total', type: 'money' }]);
      const rows = cl.rows.filter(r => !r.noDuration).map(r => ({ cells: [(multi ? r.pkgName + ': ' : '') + r.phaseName].concat(r.months).concat([r.total]) }));
      rows.push({ cells: ['Total'].concat(cl.monthTotals).concat([sum(cl.rows.filter(r => !r.noDuration), r => r.total)]), kind: 'total' });
      const notes = [];
      if (cl.unscheduled.length) notes.push('Not scheduled (no duration set): ' + cl.unscheduled.map(r => (multi ? r.pkgName + ': ' : '') + r.phaseName).join(', ') + '.');
      const ui = P.project.rowKeys.indexOf('_unalloc');
      if (ui >= 0 && P.project.rowTotals[ui]) notes.push('Unallocated fee (' + fmtCell(P.project.rowTotals[ui], 'money') + ') is not scheduled.');
      notes.push('Each phase is spread evenly across the months it occupies.');
      if (!p.startMonth) notes.push('Set a project start month to label months with dates.');
      return { title: 'Cost-loaded schedule', columns: cols, rows, notes };
    }

    function internal() {
      const R = res;
      const inc = P.inc;
      const m = v => (v === null || v === undefined ? null : roundTo(v, inc));
      const rows = [
        { cells: ['Client fee (proposed billing)', P.clientFee] },
        { cells: ['Consultants in fee (client amounts)', m(R.consultantClient)] },
        { cells: ['Consultant costs to Arch Nexus', m(R.consultantCost)] },
        { cells: ['Pass-through costs (reimbursables, subconsulted services)', m(R.passCost)] },
        { cells: ['Arch Nexus net revenue', m(R.netRevenue)], kind: 'sub' },
        { cells: ['Contingency held in fee', m(R.heldContingency)] },
        { cells: ['Internal reserves and expenses', m(R.reserves)] },
        { cells: ['Target profit (' + R.targetProfitPct + '% of ' + (R.targetProfitBasis === 'netRevenue' ? 'net revenue' : 'client fee') + ')', m(R.targetProfit)] },
        { cells: ['Effort allowance at billing rates', m(R.effortAllowance)], kind: 'total' },
        { cells: ['Planned effort at billing rates', R.hasPlan ? m(R.plannedEffort) : null] },
        { cells: ['Planned hours', R.hasPlan ? Math.round(R.plannedHours) : null], type: 'hours' },
        { cells: ['Effort headroom', R.hasPlan ? m(R.effortHeadroom) : null] }
      ];
      if (R.detailed) {
        rows.push({ cells: ['Direct labor cost', m(R.detailed.laborCost)] });
        rows.push({ cells: ['Overhead on direct labor', m(R.detailed.overhead)] });
        rows.push({ cells: ['Projected profit (detailed model)', m(R.detailed.projectedProfit)], kind: 'sub' });
      } else {
        rows.push({ cells: ['Projected profit (detailed model)', null], note: 'Not available: ' + R.detailedUnavailable.join(' ') });
      }
      const notes = [
        'Effort allowance is a planning figure from the target-profit method, not an accounting profit.',
        'Planned effort is valued at billing rates, not payroll cost.'
      ];
      if (!R.detailed) notes.push('Detailed profitability is not available: ' + R.detailedUnavailable.join(' '));
      const phaseTable = {
        columns: [{ label: 'Phase', type: 'text' }, { label: 'Net revenue', type: 'money' }, { label: 'Effort allowance', type: 'money' }, { label: 'FTE-months', type: 'num' }, { label: 'Months', type: 'num' }, { label: 'Avg FTE', type: 'num' }, { label: 'Planned effort', type: 'money' }, { label: 'Headroom', type: 'money' }],
        rows: R.phases.map(x => ({ cells: [x.name, m(x.netRevenue), m(x.allowance), x.allowanceFteMonths === null ? null : Math.round(x.allowanceFteMonths * 100) / 100, x.months || null, x.allowanceFte === null ? null : Math.round(x.allowanceFte * 100) / 100, R.hasPlan ? m(x.laborValue) : null, R.hasPlan && x.headroom !== null ? m(x.headroom) : null] }))
      };
      const consTable = {
        columns: [{ label: 'Consultant', type: 'text' }, { label: 'Work package', type: 'text' }, { label: 'Treatment', type: 'text' }, { label: 'In fee', type: 'money' }, { label: 'Cost to Arch Nexus', type: 'money' }, { label: 'Markup', type: 'money' }, { label: 'Scope notes', type: 'text' }],
        rows: [].concat(...R.pkgs.map(k => k.cons.map(c => ({ cells: [c.name, k.name, c.treatment === 'included' ? 'Included in design fee' : 'Additional to design fee', m(c.client), m(c.cost), m(c.client - c.cost), (c.pricing && c.pricing.note) || ''] }))))
      };
      return { title: 'Internal financial analysis', columns: [{ label: 'Measure', type: 'text' }, { label: 'Amount', type: 'money' }], rows, notes, extra: [{ title: 'By phase', table: phaseTable }, { title: 'Consultants', table: consTable }] };
    }
  }

  /* ------------------------------------------------------------------ formats */

  function fmtCell(v, type) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'string') return v;
    if (type === 'money') return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (type === 'pct') return (v * 100).toFixed(1) + '%';
    if (type === 'hours') return Math.round(v).toLocaleString('en-US');
    return String(Math.round(v * 100) / 100);
  }

  function csv(table) {
    const q = s => { s = String(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [];
    lines.push(q(table.title));
    if (table.meta) lines.push(q(table.meta.project + (table.meta.client ? ' / ' + table.meta.client : '') + ' / ' + table.meta.scenario));
    const add = t => {
      lines.push(t.columns.map(c => q(c.label)).join(','));
      t.rows.forEach(r => lines.push(r.cells.map((v, j) => {
        const type = t.columns[j] ? t.columns[j].type : 'text';
        if (v === null || v === undefined) return '';
        if (typeof v === 'number') return type === 'pct' ? String(Math.round(v * 10000) / 10000) : String(v);
        return q(v);
      }).join(',')));
    };
    add(table);
    (table.extra || []).forEach(x => { lines.push(''); lines.push(q(x.title)); add(x.table); });
    (table.notes || []).forEach(n => lines.push(q(n)));
    return lines.join('\r\n') + '\r\n';
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /** HTML table with inline styles that survive pasting into Word. */
  function html(table) {
    const one = t => {
      const th = t.columns.map((c, j) => `<th style="text-align:${j ? 'right' : 'left'};border-bottom:1px solid #504F51;padding:3pt 8pt;font-weight:bold">${esc(c.label)}</th>`).join('');
      const body = t.rows.map(r => {
        const bold = r.kind === 'total' || r.kind === 'sub';
        const top = r.kind === 'total' ? 'border-top:1px solid #504F51;' : '';
        return '<tr>' + r.cells.map((v, j) => `<td style="text-align:${j ? 'right' : 'left'};padding:2pt 8pt;${top}${bold ? 'font-weight:bold;' : ''}">${esc(fmtCell(v, t.columns[j] ? t.columns[j].type : 'text'))}</td>`).join('') + '</tr>';
      }).join('');
      return `<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:10pt"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
    };
    let out = one(table);
    (table.extra || []).forEach(x => { out += `<p style="font-family:Calibri,Arial,sans-serif;font-weight:bold;margin:10pt 0 4pt">${esc(x.title)}</p>` + one(x.table); });
    (table.notes || []).forEach(n => { out += `<p style="font-family:Calibri,Arial,sans-serif;font-size:9pt;color:#504F51">${esc(n)}</p>`; });
    return out;
  }

  /** Tab-separated text (plain-text clipboard flavor). */
  function tsv(table) {
    const one = t => [t.columns.map(c => c.label).join('\t')].concat(t.rows.map(r => r.cells.map((v, j) => fmtCell(v, t.columns[j] ? t.columns[j].type : 'text')).join('\t'))).join('\n');
    return [one(table)].concat((table.extra || []).map(x => x.title + '\n' + one(x.table))).join('\n\n');
  }

  /* ------------------------------------------------------------------ XLSX */

  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function utf8(s) { return new TextEncoder().encode(s); }

  /** Build a ZIP (stored, no compression). files: [{name, data: Uint8Array}] */
  function zip(files) {
    const chunks = [], central = [];
    let offset = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255];
    const u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    files.forEach(f => {
      const name = utf8(f.name), data = f.data, crc = crc32(data);
      const local = [].concat([0x50, 0x4b, 0x03, 0x04], u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      chunks.push(new Uint8Array(local), name, data);
      central.push([[].concat([0x50, 0x4b, 0x01, 0x02], u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)), name]);
      offset += local.length + name.length + data.length;
    });
    let cdSize = 0;
    const cdParts = [];
    central.forEach(([hdr, name]) => { const h = new Uint8Array(hdr); cdParts.push(h, name); cdSize += h.length + name.length; });
    const end = new Uint8Array([].concat([0x50, 0x4b, 0x05, 0x06], u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)));
    const all = chunks.concat(cdParts, [end]);
    const total = sum(all, a => a.length);
    const out = new Uint8Array(total);
    let p = 0;
    all.forEach(a => { out.set(a, p); p += a.length; });
    return out;
  }

  function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function xmlEsc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }

  /** XLSX workbook, one sheet per table. Numbers stay numbers with currency/percent formats. */
  function xlsx(tableList) {
    // styles: 0 normal, 1 bold, 2 money, 3 bold money, 4 pct, 5 bold pct, 6 num, 7 bold num, 8 title
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0;[Red]-&quot;$&quot;#,##0"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="13"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const usedNames = new Set();
    const sheets = tableList.map((t, si) => {
      const rows = [];
      let r = 1;
      const cell = (ci, v, style) => {
        const ref = colName(ci) + r;
        if (v === null || v === undefined || v === '') return '';
        if (typeof v === 'number') return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
      };
      const row = cs => { rows.push(`<row r="${r}">${cs.join('')}</row>`); r++; };
      row([cell(0, t.title, 8)]);
      if (t.meta) row([cell(0, t.meta.project + (t.meta.client ? ' / ' + t.meta.client : '') + ' / Scenario: ' + t.meta.scenario, 0)]);
      row([]);
      const block = tb => {
        row(tb.columns.map((c, j) => cell(j, c.label, 1)));
        tb.rows.forEach(rw => {
          const bold = rw.kind === 'total' || rw.kind === 'sub';
          row(rw.cells.map((v, j) => {
            const type = tb.columns[j] ? tb.columns[j].type : 'text';
            let st = bold ? 1 : 0;
            if (typeof v === 'number') st = type === 'money' ? (bold ? 3 : 2) : type === 'pct' ? (bold ? 5 : 4) : (bold ? 7 : 6);
            return cell(j, v, st);
          }));
        });
      };
      block(t);
      (t.extra || []).forEach(x => { row([]); row([cell(0, x.title, 1)]); block(x.table); });
      if (t.notes && t.notes.length) { row([]); t.notes.forEach(n => row([cell(0, n, 0)])); }
      const width = Math.max(1, t.columns.length);
      const colsXml = `<cols><col min="1" max="1" width="38" customWidth="1"/>${width > 1 ? `<col min="2" max="${Math.max(2, width + 4)}" width="15" customWidth="1"/>` : ''}</cols>`;
      let nm = sheetName(t.title, si), n = 2;
      while (usedNames.has(nm.toLowerCase())) nm = sheetName(t.title, si).slice(0, 26) + ' ' + (n++);
      usedNames.add(nm.toLowerCase());
      return { name: nm, xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${colsXml}<sheetData>${rows.join('')}</sheetData></worksheet>` };
    });
    const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
    const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const files = [
      { name: '[Content_Types].xml', data: utf8(ct) },
      { name: '_rels/.rels', data: utf8(rels) },
      { name: 'xl/workbook.xml', data: utf8(wb) },
      { name: 'xl/_rels/workbook.xml.rels', data: utf8(wbRels) },
      { name: 'xl/styles.xml', data: utf8(styles) }
    ].concat(sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: utf8(s.xml) })));
    return zip(files);
  }

  function sheetName(title, i) {
    const n = String(title).replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || 'Sheet';
    return n + (i ? '' : '');
  }

  FB.exporter = { EXPORTS, validate, tables, csv, html, tsv, xlsx, zip, crc32, fmtCell };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/*
 * Fee Builder controller: wires events to the store and engine, renders views, and
 * repaints calculated outputs in place while the user types.
 */
(function (root) {
  'use strict';
  const FB = root.FB;
  const U = FB.ui, V = FB.views, M = FB.model, A = FB.analysis, X = FB.exporter;
  const { num, has, parse } = FB.money;
  const doc = root.document;

  function start(mount) {
    const app = mount || doc.getElementById('app');
    let st;
    let toastTimer = null;
    let downloads = null;
    let lastSig = '';
    const hooks = {
      render: () => render(),
      paintSave: () => paintSave(),
      toast: msg => toast(msg),
      dataChanged: changedCurrent => { if (changedCurrent || !typing()) render(); else paintSave(); }
    };
    st = U.createStore(hooks);
    const S = st.S;
    S.matrixMode = '$';
    S.stress = { cost: 0, consultant: 0, hours: 0, rates: 0, fee: 0, targetProfit: 0, months: 0, phaseId: '' };
    S.sens = { var: 'cost', metric: 'netRevenue' };
    S.solve = { metric: 'clientFee', target: '', varKey: '' };
    S.solveResult = null;
    S.nf = { name: '', client: '', cost: '', method: 'pctCost', value: '', area: '', templateId: S.settings.defaultTemplateId };
    S.theme = (readUi().theme) || '';
    applyTheme();
    if (readUi().sideCollapsed) doc.body.classList.add('side-collapsed');

    /* ---------------------------------------------------------------- context & render */

    function ctxFor() {
      const p = st.current();
      if (!p) return { st, S, p: null };
      const sc = st.scenario(p);
      const res = FB.calc.compute(p, sc, S.settings);
      const O = V.buildOutputs(p, sc, res, S);
      if (!S.stress.phaseId || !p.phases.some(ph => ph.id === S.stress.phaseId)) S.stress.phaseId = (p.phases[p.phases.length - 1] || {}).id || '';
      return { st, S, p, sc, res, O, settings: S.settings };
    }

    function signature(ctx) {
      if (!ctx.p) return 'none';
      return ctx.res.pkgs.map(k => k.matrix.rows.map(r => r.key).join(',') + '|' + k.matrix.cols.map(c => c.key).join(',')).join(';')
        + '#' + ctx.res.warnings.filter(w => w.severity !== 'info').length + '#' + (ctx.res.detailed ? 1 : 0) + '#' + (ctx.res.hasPlan ? 1 : 0);
    }

    function render() {
      const focus = captureFocus();
      const y = root.scrollY || 0;
      const ctx = ctxFor();
      let body;
      if (S.ui.newFee) { ctx.nfPreview = nfPreview().text; ctx.nfPreviewSub = nfPreview().sub; body = V.newFee(ctx); }
      else if (!ctx.p) body = S.mode === 'boot' ? '<div class="layout"><p class="muted">Loading proposals…</p></div>' : V.empty(ctx);
      else {
        const view = { establish: V.establish, develop: V.develop, analyze: V.analyze, finalize: V.finalize }[S.view] || V.develop;
        body = `<div class="layout"><div class="work">${view(ctx)}</div>${V.rail(ctx)}</div>`;
      }
      app.innerHTML = V.header(ctx) + V.banners(ctx) + body + '</div></div></div>' + (S.ui.settingsOpen ? V.settingsSheet(ctx) : '') + (S.copyFallback ? copyFallbackHtml() : '');
      lastSig = signature(ctx);
      fitTitle(app.querySelector('.ptitle .f.title'));
      restoreFocus(focus);
      if (root.scrollTo && !focus.restored) root.scrollTo(0, y);
      else if (root.scrollTo) root.scrollTo(0, y);
    }

    function paint() {
      const ctx = ctxFor();
      if (!ctx.p) return;
      if (signature(ctx) !== lastSig) { render(); return; }
      app.querySelectorAll('[data-o]').forEach(el => {
        const v = ctx.O[el.dataset.o];
        if (v !== undefined && el.textContent !== v) el.textContent = v;
      });
      const railBar = app.querySelector('[data-chart="railbar"]');
      if (railBar) {
        const P = ctx.res.present;
        const total = Math.max(1, Math.abs(P.arch) + Math.abs(ctx.res.consultantClient) + Math.abs(P.itemsClient));
        const segs = railBar.querySelectorAll('i');
        [P.arch, ctx.res.consultantClient, Math.max(0, P.itemsClient)].forEach((v, i) => { if (segs[i]) segs[i].style.width = Math.max(0, v / total * 100).toFixed(2) + '%'; });
      }
      const pb = app.querySelector('[data-chart="phasebars"]');
      if (pb) pb.innerHTML = V.phaseBarsSvg(ctx, currentFilter(ctx));
      const ef = app.querySelector('[data-chart="effort"]');
      if (ef) ef.innerHTML = V.effortSvg(ctx);
      const sens = app.querySelector('[data-chart="sens"]');
      if (sens) sens.innerHTML = V.sensSvg(ctx);
      const so = app.querySelector('#stress-out');
      if (so) so.innerHTML = V.stressTable(ctx);
      const rw = app.querySelector('[data-warn="rail"]');
      if (rw) {
        const W = ctx.res.warnings.filter(w => w.severity !== 'info');
        rw.innerHTML = S.showAllWarnings ? allWarnings(W) : V.railWarnings(W, W.filter(w => w.severity === 'error'));
      }
      paintSave();
    }

    function currentFilter(ctx) {
      const p = ctx.p;
      if (p.packages.length === 1) return p.packages[0].id;
      return S.pkgFilter === 'all' || !p.packages.some(k => k.id === S.pkgFilter) ? 'all' : S.pkgFilter;
    }

    function allWarnings(W) {
      if (!W.length) return V.railWarnings(W, []);
      return W.map(w => `<div class="note ${w.severity === 'error' ? 'err' : 'warn'}">${U.icon('warn')}<div>${U.esc(w.message)}</div></div>`).join('') + '<button class="link small" data-a="show-warnings">Show fewer</button>';
    }

    function paintSave() {
      const chip = app.querySelector('#save-chip');
      if (chip) {
        const p = st.current();
        const s = p && p.example ? 'sandbox' : S.save;
        chip.dataset.s = s;
        const t = chip.querySelector('.stxt');
        const text = ({ idle: '', saving: 'Saving', saved: 'Saved', local: 'Saved in this browser', error: 'Not saved', conflict: 'Edit conflict', sandbox: 'Example, not saved' })[s] || '';
        if (t && t.textContent !== text) t.textContent = text;
      }
      const u = app.querySelector('[data-a="undo"]'), r = app.querySelector('[data-a="redo"]');
      if (u) u.disabled = !st.canUndo();
      if (r) r.disabled = !st.canRedo();
    }

    function typing() {
      const a = doc.activeElement;
      return !!(a && app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    }

    function captureFocus() {
      const a = doc.activeElement;
      if (!a || !app.contains(a) || !a.id) return { id: null };
      let s = null, e = null;
      try { s = a.selectionStart; e = a.selectionEnd; } catch (x) { /* not a text field */ }
      return { id: a.id, s, e };
    }
    function restoreFocus(f) {
      if (!f.id) return;
      const el = doc.getElementById(f.id);
      if (!el) return;
      el.focus({ preventScroll: true });
      f.restored = true;
      try { if (f.s !== null && f.s !== undefined) el.setSelectionRange(f.s, f.e); } catch (x) { /* ignore */ }
    }

    function toast(msg) {
      let t = doc.getElementById('fb-toast');
      if (!t) { t = doc.createElement('div'); t.id = 'fb-toast'; t.className = 'toast'; t.setAttribute('role', 'status'); doc.body.appendChild(t); }
      t.textContent = msg;
      t.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
    }

    function readUi() { try { return JSON.parse(localStorage.getItem('fb3.ui') || '{}') || {}; } catch (e) { return {}; } }
    function writeUi(extra) { try { localStorage.setItem('fb3.ui', JSON.stringify(Object.assign(readUi(), extra))); } catch (e) { /* storage blocked */ } }
    function applyTheme() {
      const r = doc.documentElement;
      if (S.theme) r.setAttribute('data-theme', S.theme); else r.removeAttribute('data-theme');
    }

    /* ---------------------------------------------------------------- new fee preview */

    function nfPreview() {
      const d = S.nf;
      if (d.method === 'labor') return { text: '—', sub: 'You will build the staffing plan next.' };
      try {
        const p = M.newProposal({ settings: S.settings, cost: parse(d.cost), area: parse(d.area), method: d.method, value: parse(d.value), templateId: d.templateId });
        const r = FB.calc.compute(p, p.scenarios[0], S.settings);
        const sub = r.feePctOfCost !== null ? U.pct(r.feePctOfCost) + ' of construction' : '';
        return { text: U.money(r.present.clientFee), sub };
      } catch (e) { return { text: '—', sub: '' }; }
    }

    /* ---------------------------------------------------------------- edits */

    function isSettingsPath(path) { return path.indexOf('$settings.') === 0; }

    function setField(el, value) {
      const path = el.dataset.f;
      if (isSettingsPath(path)) {
        const sp = path.slice('$settings.'.length);
        let v = value;
        if (sp === 'overheadRate') v = value === '' ? '' : value / 100;
        if (sp === 'roundingInc') v = +value || 1;
        U.setAt(S.settings, sp, v);
        st.saveSettings();
        return true;
      }
      let v = value;
      if (path === 'roundingInc') v = +value || 1;
      if (el.dataset.t === 'sel' && /\.(on|lock|allowUnallocated)$/.test(path)) v = value === 'true';
      st.mutate(p => U.setAt(p, path, v), 'f:' + path);
      return true;
    }

    app.addEventListener('input', e => {
      const el = e.target;
      if (el.dataset.f && el.dataset.t !== 'sel' && el.dataset.t !== 'bool' && el.dataset.t !== 'month') {
        setField(el, U.readInput(el));
        paint();
        return;
      }
      if (el.dataset.nf) {
        const k = el.dataset.nf;
        S.nf[k] = el.dataset.k ? parse(el.value) : el.value;
        if (k === 'method' || k === 'templateId') { render(); return; }
        const pv = nfPreview();
        const r = doc.getElementById('nf_result'), s = doc.getElementById('nf_resultsub');
        if (r) r.textContent = pv.text;
        if (s) s.textContent = pv.sub;
        return;
      }
      if (el.dataset.st) {
        S.stress[el.dataset.st] = +el.value;
        const lab = doc.getElementById('st_' + el.dataset.st + '_v');
        if (lab) lab.textContent = (+el.value > 0 ? '+' : '') + el.value + ({ targetProfit: ' pts', months: ' mo' }[el.dataset.st] || '%');
        const so = doc.getElementById('stress-out');
        if (so) so.innerHTML = V.stressTable(ctxFor());
        return;
      }
      if (el.dataset.solve) {
        S.solve[el.dataset.solve] = el.dataset.solve === 'target' ? parse(el.value) : el.value;
      }
    });

    app.addEventListener('change', e => {
      const el = e.target;
      if (el.dataset.f && (el.dataset.t === 'sel' || el.dataset.t === 'bool' || el.dataset.t === 'month')) {
        const before = el.dataset.f;
        setField(el, U.readInput(el));
        if (/\.method$/.test(before) && /\.items#/.test(before)) normalizeItemAfterMethod(before);
        if (/\.cons\.[^.]+\.split$/.test(before)) seedCustomSplit(before);
        if (/\.cons\.[^.]+\.type$/.test(before)) clearConsValueOnType(before);
        render();
        return;
      }
      if (el.dataset.f && el.dataset.t === 'text' && el.tagName === 'TEXTAREA') return;
      if (el.dataset.nf && el.tagName === 'SELECT') { S.nf[el.dataset.nf] = el.value; render(); return; }
      if (el.dataset.stPhase) { S.stress.phaseId = el.value; const so = doc.getElementById('stress-out'); if (so) so.innerHTML = V.stressTable(ctxFor()); return; }
      if (el.dataset.sens) { S.sens[el.dataset.sens] = el.value; const c = app.querySelector('[data-chart="sens"]'); if (c) c.innerHTML = V.sensSvg(ctxFor()); return; }
      if (el.dataset.solve) { S.solve[el.dataset.solve] = el.dataset.solve === 'target' ? parse(el.value) : el.value; return; }
      if (el.dataset.lib) {
        S.settings[el.dataset.lib] = el.value.split('\n').map(s => s.trim()).filter(Boolean);
        st.saveSettings();
        return;
      }
      if (el.dataset.change) { CHANGE[el.dataset.change](el); return; }
      if (el.dataset.aChange) { ACHANGE[el.dataset.aChange](el); }
    });

    app.addEventListener('focusin', e => {
      const el = e.target;
      if (el.classList && el.classList.contains('n') && (el.dataset.f || el.dataset.nf || el.dataset.solve)) {
        el.value = el.value.replace(/,/g, '');
        setTimeout(() => { try { el.select(); } catch (x) { /* ignore */ } }, 0);
      }
    });
    app.addEventListener('focusout', e => {
      const el = e.target;
      if (el.dataset && el.dataset.f && el.dataset.t === 'num') {
        const path = el.dataset.f;
        let v;
        if (isSettingsPath(path)) { v = U.getAt(S.settings, path.slice(10)); if (path.endsWith('overheadRate') && has(v)) v = num(v) * 100; }
        else { const p = st.current(); v = p ? U.getAt(p, path) : ''; }
        el.value = U.fieldText(v, el.dataset.k);
      }
      if (el.dataset && el.dataset.nf && el.dataset.k) el.value = U.fieldText(S.nf[el.dataset.nf], el.dataset.k);
    });

    app.addEventListener('keydown', e => {
      const el = e.target;
      if (el.id === 'new-con' && e.key === 'Enter') { e.preventDefault(); ACT['add-con-custom'](); return; }
      if (el.dataset && el.dataset.g && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
        const [g, r, c] = el.dataset.g.split(':');
        const nr = +r + (e.key === 'ArrowUp' ? -1 : 1);
        const next = app.querySelector(`[data-g="${g}:${nr}:${c}"]`);
        if (next) { e.preventDefault(); next.focus(); }
        else if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      }
      if (el.dataset && el.dataset.solve === 'target' && e.key === 'Enter') { e.preventDefault(); S.solve.target = parse(el.value); ACT.solve(); }
      if (el.dataset && el.dataset.nf && e.key === 'Enter') { e.preventDefault(); ACT['nf-create'](); }
    });

    doc.addEventListener('keydown', e => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) ACT.redo(); else ACT.undo(); }
      else if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); ACT.redo(); }
      else if (e.key === 'Escape' && S.ui.settingsOpen) { S.ui.settingsOpen = false; render(); }
    });

    app.addEventListener('click', e => {
      const el = e.target.closest('[data-a]');
      if (!el || el.disabled) return;
      const fn = ACT[el.dataset.a];
      if (fn) { fn(el, e); }
    });

    /* ---------------------------------------------------------------- helpers for edits */

    const sc = () => st.scenario();
    const scOf = p => p.scenarios.find(s => s.id === st.scenario(p).id);

    function normalizeItemAfterMethod(path) {
      // Keep the item's basis valid for its kind after switching to % of fee.
      st.mutate(p => {
        const it = U.getAt(p, path.replace(/\.method$/, ''));
        if (it && it.method === 'pctFee' && !it.basis) it.basis = 'design';
      }, 'f:' + path);
    }
    function seedCustomSplit(path) {
      // When a consultant switches to a custom split, start from the package's current split.
      st.mutate(p => {
        const con = U.getAt(p, path.replace(/\.split$/, ''));
        if (!con || con.split !== 'custom') return;
        const hasAny = Object.values(con.alloc || {}).some(e => has(e.pct) || has(e.amt));
        if (hasAny) return;
        const pkgPath = path.replace(/\.cons\.[^.]+\.split$/, '');
        const calc = U.getAt(p, pkgPath);
        const r = FB.calc.compute(p, scOf(p), S.settings);
        const pkgId = pkgPath.split('.').pop();
        const kr = r.pkgs.find(k => k.pkgId === pkgId);
        const tot = kr ? kr.allocatedComp : 0;
        con.alloc = {};
        p.phases.forEach(ph => { con.alloc[ph.id] = { pct: tot ? Math.round(kr.compByPhase[ph.id] / tot * 10000) / 100 : '', amt: '', lock: false }; });
        // Make the seeded percentages total exactly 100.
        const sum = p.phases.reduce((a, ph) => a + num(con.alloc[ph.id].pct), 0);
        if (tot && Math.abs(sum - 100) > 1e-9) {
          const last = p.phases.slice().reverse().find(ph => num(con.alloc[ph.id].pct) > 0);
          if (last) con.alloc[last.id].pct = Math.round((num(con.alloc[last.id].pct) + 100 - sum) * 100) / 100;
        }
        void calc;
      }, 'seed:' + path);
    }
    function clearConsValueOnType(path) {
      st.mutate(p => { const con = U.getAt(p, path.replace(/\.type$/, '')); if (con) con.value = ''; }, 'f:' + path);
    }

    function download(filename, data, mime) {
      const go = async () => {
        if (!downloads && root.claude && root.claude.use) { try { downloads = await root.claude.use('downloads'); } catch (e) { downloads = null; } }
        if (downloads) {
          try { await downloads.save({ filename, data }); toast('Saved ' + filename); }
          catch (e) { if (e && e.code !== 'declined') toast('Could not save the file (' + (e.code || 'error') + ').'); }
          return;
        }
        try {
          const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const a = doc.createElement('a');
          a.href = url; a.download = filename; doc.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
        } catch (e) { toast('Downloads are not available here.'); }
      };
      go();
    }

    async function copyTable(t) {
      const html = X.html(t), tsv = X.tsv(t);
      try {
        if (navigator.clipboard && root.ClipboardItem) {
          await navigator.clipboard.write([new root.ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([tsv], { type: 'text/plain' }) })]);
          toast('Copied. Paste into Word or Excel.');
          return;
        }
      } catch (e) { /* fall through */ }
      try { await navigator.clipboard.writeText(tsv); toast('Copied as plain text.'); return; } catch (e) { /* fall through */ }
      S.copyFallback = tsv;
      render();
      const ta = doc.getElementById('copy-fallback');
      if (ta) { ta.focus(); ta.select(); }
    }
    function copyFallbackHtml() {
      return `<div class="sheet-back" data-a="copy-close"></div><aside class="sheet" role="dialog" aria-label="Copy table" style="width:min(640px,100vw)"><header><h2>Copy table</h2><button class="icon-btn" data-a="copy-close" aria-label="Close">${U.icon('x')}</button></header><div class="body"><p class="lead">Your browser blocked automatic copying. Select the text below and copy it.</p><textarea id="copy-fallback" style="min-height:300px;font-family:ui-monospace,Menlo,monospace;font-size:12px" readonly>${U.esc(S.copyFallback)}</textarea></div></aside>`;
    }

    function safeName(s) { return (s || 'fee').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'fee'; }

    /* ---------------------------------------------------------------- change handlers */

    const CHANGE = {
      open(el) { if (!el.value) return; S.ui.newFee = false; st.open(el.value); S.solveResult = null; render(); },
      import(el) {
        const f = el.files && el.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => {
          try { const n = st.importJson(JSON.parse(String(r.result))); S.view = 'develop'; render(); toast('Imported' + (n.issues.length ? ' with repairs: ' + n.issues.join(' ') : '.')); }
          catch (e) { toast('That file is not a Fee Builder proposal.'); }
        };
        r.readAsText(f);
      },
      'exp-pkg'(el) { S.exportPkg = el.value; render(); }
    };

    const ACHANGE = {
      'covers-all'(el) { st.mutate(p => { const c = U.getAt(p, el.dataset.path); c.covers = el.checked ? 'all' : [p.phases[0].id]; }); render(); },
      'covers-one'(el) {
        st.mutate(p => {
          const c = U.getAt(p, el.dataset.path);
          let set = Array.isArray(c.covers) ? c.covers.slice() : p.phases.map(ph => ph.id);
          if (el.checked) { if (!set.includes(el.dataset.ph)) set.push(el.dataset.ph); } else set = set.filter(x => x !== el.dataset.ph);
          set = p.phases.map(ph => ph.id).filter(id => set.includes(id));
          c.covers = !set.length || set.length === p.phases.length ? 'all' : set;
        });
        render();
        const d = app.querySelector(`[data-path="${CSS.escape(el.dataset.path)}"]`);
        if (d && d.closest('details')) d.closest('details').open = true;
      },
      'toggle-markup'(el) { S.settings.showMarkup = el.checked; st.saveSettings(); render(); },
      'exp-ack'(el) { S.exportAck = el.checked; render(); }
    };

    /* ---------------------------------------------------------------- actions */

    const ACT = {
      undo() { if (st.undo()) { render(); toast('Undone'); } },
      redo() { if (st.redo()) { render(); toast('Redone'); } },
      retry() { if (S.save === 'error') { st.retry(); render(); } },
      settings() { S.ui.settingsOpen = true; render(); },
      'settings-close'() { S.ui.settingsOpen = false; render(); },
      'copy-close'() { S.copyFallback = null; render(); },
      newfee() { S.ui.newFee = true; S.nf = { name: '', client: '', cost: '', method: 'pctCost', value: '', area: '', templateId: S.settings.defaultTemplateId }; render(); const n = doc.getElementById('nf_name'); if (n) n.focus(); },
      'nf-cancel'() { S.ui.newFee = false; render(); },
      'nf-create'() {
        const d = S.nf;
        const p = st.create({ name: d.name, client: d.client, cost: parse(d.cost), area: parse(d.area), method: d.method, value: parse(d.value), templateId: d.templateId });
        S.ui.newFee = false;
        S.view = 'develop';
        st.remember();
        render();
        toast(p.name ? 'Created ' + p.name : 'Fee created');
      },
      'open-example'() { S.ui.newFee = false; st.openExample(); S.view = 'develop'; render(); },
      'save-example'() { const c = st.saveExampleCopy(); if (c) { render(); toast('Saved a copy you can edit.'); } },
      'conflict-mine'() { st.resolveConflict(true); render(); },
      'conflict-theirs'() { st.resolveConflict(false); render(); },
      'draft-restore'() { st.resolveDraft(true); render(); toast('Draft restored'); },
      'draft-discard'() { st.resolveDraft(false); render(); },
      'dismiss-issues'() { const p = st.current(); if (p) delete S.loadIssues[p.id]; render(); },
      'show-warnings'() { S.showAllWarnings = !S.showAllWarnings; paint(); },
      view(el) { S.view = el.dataset.v; S.ui.settingsOpen = false; st.remember(); writeUi({ view: S.view }); render(); root.scrollTo && root.scrollTo(0, 0); },
      atab(el) { S.analyzeTab = el.dataset.v; render(); },
      'pick-scen'(el) { const p = st.current(); S.scIds[p.id] = el.dataset.id; S.solveResult = null; render(); },
      'dup-scen'() {
        const p = st.current(), cur = st.scenario(p);
        const c = st.mutate(q => M.duplicateScenario(q, cur.id));
        if (c) { S.scIds[p.id] = c.id; render(); const n = doc.getElementById('f_scenarios_' + c.id.replace(/[^a-zA-Z0-9]/g, '_') + '_name'); toast('Duplicated. Change one number to compare.'); if (n) n.focus(); }
      },
      'new-scen'() {
        const p = st.current(), cur = st.scenario(p);
        const c = st.mutate(q => {
          const s = M.makeScenario(q, 'Scenario ' + String.fromCharCode(65 + Math.min(q.scenarios.length, 25)));
          // Same structure as the current scenario: phase splits and durations, consultants on, blank fee.
          q.packages.forEach(k => {
            const from = scOf(q).pkgs[k.id];
            s.pkgs[k.id].alloc = M.clone(from.alloc);
            Object.keys(s.pkgs[k.id].cons).forEach(id => { s.pkgs[k.id].cons[id].on = from.cons[id] ? from.cons[id].on : false; s.pkgs[k.id].cons[id].treatment = from.cons[id] ? from.cons[id].treatment : 'included'; });
          });
          s.schedule = M.clone(cur.schedule);
          q.scenarios.push(s);
          return s;
        });
        S.scIds[p.id] = c.id; S.view = 'develop'; render();
      },
      prefer(el) { st.mutate(p => { p.preferredId = el.dataset.id; }); render(); },
      ask(el) { S.confirm = el.dataset.k; render(); },
      cancel() { S.confirm = null; render(); },
      'del-scen'() {
        const p = st.current(), cur = st.scenario(p);
        st.mutate(q => { q.scenarios = q.scenarios.filter(s => s.id !== cur.id); if (q.preferredId === cur.id) q.preferredId = null; });
        S.scIds[p.id] = null; S.confirm = null; render(); toast('Scenario deleted. Undo is available.');
      },
      'dev-pkg'(el) { S.devPkg = el.dataset.id; render(); },
      'pkg-filter'(el) { S.pkgFilter = el.dataset.v; render(); },
      mmode(el) { S.matrixMode = el.dataset.v; render(); },
      basis(el) {
        const p = st.current(), s = st.scenario(p);
        const pkgId = p.packages.length > 1 && S.devPkg && s.pkgs[S.devPkg] ? S.devPkg : p.packages[0].id;
        st.mutate(q => { scOf(q).pkgs[pkgId].basis = el.dataset.v; });
        render();
      },
      'add-comp'(el) {
        st.mutate(p => {
          const calc = scOf(p).pkgs[el.dataset.pkg];
          const c = M.makeComponent(el.dataset.m, { label: '' });
          if (el.dataset.m === 'labor') {
            c.label = 'Labor buildup';
            if (!calc.labor.rows.length) calc.labor.rows = [{ id: M.uid('r'), roleId: p.roles[0].id, cells: Object.fromEntries(p.phases.map(ph => [ph.id, ''])) }];
          }
          calc.components.push(c);
        });
        render();
      },
      'del-comp'(el) { st.mutate(p => { const calc = scOf(p).pkgs[el.dataset.pkg]; calc.components = calc.components.filter(c => c.id !== el.dataset.id); }); render(); },
      'labor-mode'(el) {
        st.mutate(p => {
          const calc = scOf(p).pkgs[el.dataset.pkg];
          if (calc.labor.mode === el.dataset.v) return;
          // Convert existing cells so planned hours stay the same where durations exist.
          const r = FB.calc.compute(p, scOf(p), S.settings);
          const hpm = num(S.settings.hoursPerFteMonth) || 173.33;
          calc.labor.rows.forEach(row => {
            p.phases.forEach(ph => {
              const months = r.schedule.byId[ph.id].months;
              const v = row.cells[ph.id];
              if (!has(v)) return;
              row.cells[ph.id] = el.dataset.v === 'staffing' ? (months > 0 ? Math.round(num(v) / (months * hpm) * 1000) / 1000 : '') : Math.round(num(v) * months * hpm * 10) / 10;
            });
          });
          calc.labor.mode = el.dataset.v;
        });
        render();
      },
      'add-labrow'(el) { st.mutate(p => { scOf(p).pkgs[el.dataset.pkg].labor.rows.push({ id: M.uid('r'), roleId: el.dataset.role, cells: Object.fromEntries(p.phases.map(ph => [ph.id, ''])) }); }); render(); },
      'del-labrow'(el) { st.mutate(p => { const L = scOf(p).pkgs[el.dataset.pkg].labor; L.rows = L.rows.filter(r => r.id !== el.dataset.id); }); render(); },
      'copy-labor'(el) {
        st.mutate(p => {
          const from = p.scenarios.find(s => s.id === el.dataset.from);
          if (!from || !from.pkgs[el.dataset.pkg]) return;
          const L = M.clone(from.pkgs[el.dataset.pkg].labor);
          L.rows.forEach(r => { r.id = M.uid('r'); });
          scOf(p).pkgs[el.dataset.pkg].labor = L;
        });
        render(); toast('Labor plan copied');
      },
      'add-item'(el) {
        st.mutate(p => {
          const kind = el.dataset.kind;
          const it = M.makeItem(kind, { label: el.dataset.label || '' });
          if (kind === 'contingency') { it.method = 'pctFee'; it.basis = 'subtotal'; }
          scOf(p).items.push(it);
        });
        render();
      },
      'del-item'(el) { st.mutate(p => { const s = scOf(p); s.items = s.items.filter(i => i.id !== el.dataset.id); }); render(); },
      // ---- establish
      'add-pkg'() { st.mutate(p => M.addPackage(p)); render(); },
      'del-pkg'(el) { st.mutate(p => M.removePackage(p, el.dataset.id)); render(); toast('Package removed. Undo is available.'); },
      'add-phase'() { st.mutate(p => M.addPhase(p, 'New phase')); render(); },
      'del-phase'(el) { st.mutate(p => M.removePhase(p, el.dataset.id)); render(); },
      'ph-up'(el) { st.mutate(p => M.movePhase(p, el.dataset.id, -1)); render(); },
      'ph-down'(el) { st.mutate(p => M.movePhase(p, el.dataset.id, 1)); render(); },
      'apply-template'() {
        const id = (doc.getElementById('tpl-pick') || {}).value;
        const t = S.settings.templates.find(x => x.id === id);
        if (!t) return;
        st.mutate(p => M.applyTemplate(p, t));
        render(); toast('Phases replaced from "' + t.name + '". Undo is available.');
      },
      'save-template'() {
        const p = st.current(), s = st.scenario(p);
        const r = FB.calc.compute(p, s, S.settings);
        const k = r.pkgs[0];
        const tpl = { id: M.uid('tpl'), name: (p.name || 'Custom') + ' phases', source: 'Saved from a proposal', phases: p.phases.map(ph => ({ name: ph.name, pct: s.pkgs[p.packages[0].id].alloc[ph.id].pct, months: s.schedule[ph.id].months })) };
        void k;
        S.settings.templates.push(tpl);
        st.saveSettings();
        toast('Saved template "' + tpl.name + '"');
        render();
      },
      'add-con'(el) { st.mutate(p => M.addConsultant(p, el.dataset.name, el.dataset.name)); render(); toast(el.dataset.name + ' added to every scenario'); },
      'add-con-custom'() {
        const i = doc.getElementById('new-con');
        const name = i ? i.value.trim() : '';
        if (!name) return;
        st.mutate(p => M.addConsultant(p, name, name));
        render();
        const n = doc.getElementById('new-con'); if (n) n.focus();
      },
      'del-con'(el) { st.mutate(p => M.removeConsultant(p, el.dataset.id)); render(); toast('Consultant removed from every scenario. Undo is available.'); },
      'add-role'() { st.mutate(p => { p.roles.push({ id: M.uid('role'), name: 'New role', billRate: '', costRate: '' }); }); render(); },
      'del-role'(el) {
        st.mutate(p => {
          p.roles = p.roles.filter(r => r.id !== el.dataset.id);
          p.scenarios.forEach(s => Object.values(s.pkgs).forEach(c => { c.labor.rows = c.labor.rows.filter(r => r.roleId !== el.dataset.id); }));
        });
        render();
      },
      'load-rates'() {
        st.mutate(p => {
          S.settings.roles.forEach(sr => {
            const r = p.roles.find(x => x.name === sr.name);
            if (r) { r.billRate = sr.billRate; r.costRate = sr.costRate; }
            else p.roles.push(M.clone(sr));
          });
        });
        render(); toast('Rates reset from your defaults');
      },
      // ---- analyze
      lock(el) { st.mutate(p => { const e = scOf(p).pkgs[el.dataset.pkg].alloc[el.dataset.ph]; e.lock = !e.lock; }); render(); },
      balance(el) {
        const p = st.current(), s = st.scenario(p);
        const r = FB.calc.compute(p, s, S.settings);
        const kr = r.pkgs.find(k => k.pkgId === el.dataset.pkg);
        const pool = kr.comps.filter(c => c.method !== 'labor').reduce((a, c) => a + c.amount, 0);
        const out = FB.calc.rebalance(s.pkgs[el.dataset.pkg].alloc, p.phases, pool);
        if (!out.ok) { toast(out.reason); return; }
        st.mutate(q => { scOf(q).pkgs[el.dataset.pkg].alloc = out.spec; });
        render(); toast('Balanced to 100%');
      },
      'copy-alloc'(el) { st.mutate(p => { const s = scOf(p); const a = s.pkgs[el.dataset.pkg].alloc; Object.keys(s.pkgs).forEach(k => { s.pkgs[k].alloc = M.clone(a); }); }); render(); toast('Applied to every package'); },
      'go-export'(el) { S.view = 'finalize'; S.exportPick = el.dataset.which; render(); },
      'stress-reset'() { Object.assign(S.stress, { cost: 0, consultant: 0, hours: 0, rates: 0, fee: 0, targetProfit: 0, months: 0 }); render(); },
      'stress-promote'() {
        const p = st.current(), s = st.scenario(p);
        const spec = V.stressSpec(ctxFor());
        if (FB.analysis.describeStress(p, spec) === 'no changes') { toast('Move a slider first.'); return; }
        const n = st.mutate(q => { const ns = A.promoteStress(q, scOf(q), S.settings, spec); q.scenarios.push(ns); return ns; });
        S.scIds[p.id] = n.id;
        ACT['stress-reset']();
        toast('Saved "' + n.name + '"');
      },
      'solve-preset'(el) {
        const p = st.current(), s = st.scenario(p);
        S.solve.metric = el.dataset.m;
        if (el.dataset.var) S.solve.varKey = el.dataset.var;
        else { const v = A.listVariables(p, s).find(x => x.key.startsWith('comp:')); S.solve.varKey = v ? v.key : 'flat'; }
        S.solve.target = el.dataset.t !== undefined ? +el.dataset.t : '';
        S.solveResult = null;
        render();
        if (el.dataset.t === undefined) { const t = doc.getElementById('solve_target'); if (t) t.focus(); }
        else ACT.solve();
      },
      solve() {
        const p = st.current(), s = st.scenario(p);
        const tEl = doc.getElementById('solve_target');
        if (tEl) S.solve.target = parse(tEl.value);
        const mEl = doc.getElementById('solve_metric'), vEl = doc.getElementById('solve_var');
        if (mEl) S.solve.metric = mEl.value;
        if (vEl) S.solve.varKey = vEl.value;
        if (!has(S.solve.target)) { toast('Enter a target value.'); return; }
        S.solveResult = A.solve(p, s, S.settings, S.solve.metric, num(S.solve.target), S.solve.varKey);
        render();
      },
      'solve-apply'() { applySolve(false); },
      'solve-new'() { applySolve(true); },
      'cmp-ref'(el) { S.compareRef = el.dataset.id; render(); },
      // ---- finalize & exports
      'exp-pick'(el) { S.exportPick = el.dataset.id; render(); },
      'exp-copy'(el) { const c = ctxFor(); copyTable(X.tables(c.p, c.sc, c.res, el.dataset.id, { pkgId: S.exportPkg || '' })); },
      'exp-csv'(el) {
        const c = ctxFor();
        const t = X.tables(c.p, c.sc, c.res, el.dataset.id, { pkgId: S.exportPkg || '' });
        download(safeName(c.p.name) + '-' + el.dataset.id + '.csv', X.csv(t), 'text/csv');
      },
      'exp-xlsx'(el) {
        const c = ctxFor();
        const ids = X.EXPORTS.filter(e => el.dataset.aud === 'all' || e.audience === 'client').map(e => e.id);
        const bytes = X.xlsx(ids.map(id => X.tables(c.p, c.sc, c.res, id, { pkgId: S.exportPkg || '' })));
        download(safeName(c.p.name) + (el.dataset.aud === 'all' ? '-internal' : '-fee') + '.xlsx', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      },
      'export-json'() {
        const p = st.current();
        if (!p) return;
        download(safeName(p.name) + '.feebuilder.json', JSON.stringify(Object.assign({ exportedBy: 'Fee Builder', exportedAt: new Date().toISOString() }, p), null, 1), 'application/json');
      },
      snap(el) {
        const p = st.current(), s = st.scenario(p);
        const note = (doc.getElementById('snap-note') || {}).value || '';
        st.mutate(q => {
          const snap = A.makeSnapshot(q, s.id, S.settings, el.dataset.kind, '', note);
          q.snapshots.push(snap);
          if (el.dataset.kind === 'contract') q.contract = { snapshotId: snap.id };
        });
        render(); toast('Snapshot saved');
      },
      'snap-del'(el) { st.mutate(p => { p.snapshots = p.snapshots.filter(s => s.id !== el.dataset.id); if (p.contract && p.contract.snapshotId === el.dataset.id) p.contract = null; }); S.confirm = null; render(); },
      'snap-restore'(el) {
        const p0 = st.current();
        let ns = null, changed = false;
        st.mutate(p => {
          const snap = p.snapshots.find(s => s.id === el.dataset.id);
          if (!snap || !snap.frozen) return;
          ns = M.clone(snap.frozen.scenario);
          ns.id = M.uid('s'); ns.name = snap.name + ' (' + snap.date + ')'; ns.createdAt = Date.now();
          changed = JSON.stringify(snap.frozen.phases.map(x => x.id)) !== JSON.stringify(p.phases.map(x => x.id)) || JSON.stringify(snap.frozen.packages.map(x => x.id)) !== JSON.stringify(p.packages.map(x => x.id));
          p.scenarios.push(ns);
          const n = M.normalize(p).proposal;
          Object.assign(p, n);
        });
        if (ns) { S.scIds[p0.id] = ns.id; S.view = 'develop'; render(); toast(changed ? 'Opened as a scenario. Phases or packages have changed since, so some figures may differ.' : 'Opened as a scenario'); }
      },
      'add-change'() { st.mutate(p => { p.changes.push({ id: M.uid('ch'), label: '', method: 'fixed', amount: '', status: 'proposed', added: new Date().toISOString().slice(0, 10) }); }); render(); },
      'del-change'(el) { st.mutate(p => { p.changes = p.changes.filter(c => c.id !== el.dataset.id); }); render(); },
      'copy-changes'() {
        const p = st.current();
        const cs = A.contractStatus(p);
        const rows = [{ cells: ['Original contract value', cs.original], kind: 'sub' }];
        p.changes.filter(c => c.status === 'accepted').forEach(c => rows.push({ cells: [c.label || 'Additional scope', Math.round(num(c.amount))] }));
        p.changes.filter(c => c.status === 'proposed').forEach(c => rows.push({ cells: [(c.label || 'Additional scope') + ' (proposed)', Math.round(num(c.amount))] }));
        rows.push({ cells: [p.changes.some(c => c.status === 'proposed') ? 'New total contract value' : 'Current contract value', cs.ifAccepted], kind: 'total' });
        copyTable({ title: 'Contract value', columns: [{ label: 'Description', type: 'text' }, { label: 'Amount', type: 'money' }], rows });
      },
      // ---- settings
      'tpl-default'(el) { S.settings.defaultTemplateId = el.dataset.id; st.saveSettings(); render(); },
      'tpl-del'(el) { S.settings.templates = S.settings.templates.filter(t => t.id !== el.dataset.id); if (S.settings.defaultTemplateId === el.dataset.id) S.settings.defaultTemplateId = S.settings.templates[0].id; st.saveSettings(); render(); },
      'tpl-add'() { S.settings.templates.push({ id: M.uid('tpl'), name: 'New template', source: '', phases: [{ name: 'Phase 1', pct: '', months: '' }] }); st.saveSettings(); render(); },
      'tpl-ph-add'(el) { const t = S.settings.templates.find(x => x.id === el.dataset.id); t.phases.push({ name: 'New phase', pct: '', months: '' }); st.saveSettings(); render(); },
      'tpl-ph-del'(el) { const t = S.settings.templates.find(x => x.id === el.dataset.id); if (t.phases.length > 1) t.phases.splice(+el.dataset.i, 1); st.saveSettings(); render(); },
      'set-role-add'() { S.settings.roles.push({ id: M.uid('role'), name: 'New role', billRate: '', costRate: '' }); st.saveSettings(); render(); },
      'set-role-del'(el) { S.settings.roles = S.settings.roles.filter(r => r.id !== el.dataset.id); st.saveSettings(); render(); },
      'set-rates-example'() { S.settings.roles.forEach(r => { if (!has(r.billRate) && FB.sample.EXAMPLE_RATES[r.name]) r.billRate = FB.sample.EXAMPLE_RATES[r.name]; }); st.saveSettings(); render(); toast('Example rates filled in. Replace them with real rates.'); },
      theme(el) { S.theme = el.dataset.v; writeUi({ theme: S.theme }); applyTheme(); render(); },
      /* shell: navigation and personal display settings shared with the other Toolbox tools */
      home(el, e) { if (e) e.preventDefault(); if (S.ui.newFee) { S.ui.newFee = false; render(); } closeSide(); },
      'theme-cycle'() { S.theme = S.theme === '' ? 'light' : S.theme === 'light' ? 'dark' : ''; writeUi({ theme: S.theme }); applyTheme(); render(); },
      'side-collapse'() { setCollapsed(!doc.body.classList.contains('side-collapsed')); },
      'side-open'() { doc.body.classList.add('side-open'); if (!doc.querySelector('.side-scrim')) { const sc = doc.createElement('div'); sc.className = 'side-scrim'; sc.setAttribute('data-a', 'side-close'); doc.body.appendChild(sc); } },
      'side-close'() { closeSide(); }
    };
    function closeSide() { doc.body.classList.remove('side-open'); const sc = doc.querySelector('.side-scrim'); if (sc) sc.remove(); }
    function setCollapsed(on) {
      doc.body.classList.toggle('side-collapsed', on);
      const b = doc.querySelector('[data-a="side-collapse"]');
      if (b) { b.title = on ? 'Expand the side bar' : 'Collapse the side bar'; b.setAttribute('aria-label', b.title); }
      writeUi({ sideCollapsed: on });
    }
    // the project name is the page title: keep its box as wide as its text
    const fitTitle = el => { if (el && el.matches && el.matches('.ptitle .f.title')) el.size = Math.max(12, Math.ceil(String(el.value).length * 0.85)); };
    app.addEventListener('input', e => fitTitle(e.target));
    doc.addEventListener('click', e => { const el = e.target.closest && e.target.closest('.side-scrim'); if (el) closeSide(); });

    function applySolve(asNew) {
      const r = S.solveResult;
      if (!r || !r.ok) return;
      const p = st.current();
      const solved = M.clone(r.scenario);
      solved.items.forEach(it => { if (it.id === '_solve_flat') { it.id = M.uid('i'); it.label = 'Negotiated adjustment'; } });
      const created = st.mutate(q => {
        if (asNew) {
          solved.id = M.uid('s');
          solved.name = st.scenario(q).name + ' (solved)';
          solved.createdAt = Date.now();
          solved.notes = (solved.notes ? solved.notes + '\n' : '') + 'Solved: ' + A.METRICS[r.metric].label + ' = ' + U.money(r.achieved) + ' by changing ' + r.varLabel.toLowerCase() + '.';
          q.scenarios.push(solved);
          return solved;
        }
        const i = q.scenarios.findIndex(s => s.id === solved.id);
        q.scenarios[i] = solved;
        return solved;
      });
      if (created) S.scIds[p.id] = created.id;
      S.solveResult = null;
      render();
      toast(asNew ? 'Saved as a new scenario' : 'Applied. Undo is available.');
    }

    /* ---------------------------------------------------------------- boot */

    render();
    st.init().then(() => {
      if (!st.current() && !st.list().length) S.ui.newFee = false;
      render();
    });
    return { store: st, render, paint, ACT };
  }

  FB.app = { start };
})(typeof globalThis !== 'undefined' ? globalThis : this);

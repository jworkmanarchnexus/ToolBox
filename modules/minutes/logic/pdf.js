/* Nexus Minutes: PDF layout for meeting minutes, revised minutes and agendas.
   Draws with jsPDF (inlined in the page) and embedded Lato / Roboto Condensed. Letter portrait.
   A pure function of a snapshot (or agenda document), a revision list and an image lookup, so it runs in node for tests.
   The layout follows the firm's MIN form: corporate header, project block, participants, minutes register, next meeting, footer. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic.js'));
  else root.NMPdf = factory(root.NM);
})(typeof self !== 'undefined' ? self : this, function (NM) {
  'use strict';

  const PW = 612, PH = 792, ML = 54, MR = 54, W = PW - ML - MR;
  const TOP1 = 36, TOPN = 66, MB = 62, FOOT_Y = PH - 40;
  /* Nexus brand: #0099D8 primary, #504F51 text, #EDEDEE light, #778390 slate, #99D6EF light blue, #F18A00 orange, #93D500 green. */
  const BLUE = [0, 153, 216], INK = [80, 79, 81], DARK = [48, 47, 49], LIGHT = [237, 237, 238], SLATE = [119, 131, 144], SKY = [153, 214, 239], ORANGE = [241, 138, 0], GREEN = [147, 213, 0];
  const RULE = [200, 202, 205];
  /* Table columns */
  const C = { issue: 56, date: 44, desc: 276, who: 62, due: 66 };
  const CX = { issue: ML, date: ML + C.issue, desc: ML + C.issue + C.date, who: ML + C.issue + C.date + C.desc, due: ML + C.issue + C.date + C.desc + C.who };

  /* Characters the embedded subsets cover; anything else prints as ? rather than going missing. */
  function san(s) {
    return String(s == null ? '' : s).replace(/\r/g, '').replace(/ /g, ' ')
      .replace(/[^\n\x20-\x7e\xa1-\xff–—‘’“”•…№−]/g, '?');
  }
  const shortDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Number(m[2]) + '/' + Number(m[3]) + '/' + m[1].slice(2) : ''; };
  const longDate = (s) => (s ? NM.fmtDate(s, { month: 'long', day: 'numeric', year: 'numeric' }) : '');

  /* Minutes issued before settings existed have no document block, roster details or attendance states. */
  function prepare(snap) {
    const d = snap.data;
    const dflt = NM.defaultFirm();
    const h = d.header || {};
    if (!d.doc) {
      const yr = snap.publishedAt ? new Date(snap.publishedAt).getFullYear() : new Date().getFullYear();
      d.doc = {
        kind: 'minutes', docId: NM.docIdOf(dflt, h.number || 0, snap.rev || 0),
        firm: { name: dflt.name, short: dflt.short, web: dflt.web, offices: dflt.offices, docType: dflt.docType, formVersion: dflt.formVersion, copyright: '© ' + yr + ' ' + dflt.copyrightHolder, timeFormat: '12h' },
        project: { name: h.project || '', address: '', number: h.projectNumber || '', ownerNumber: '', ownerOrg: '', officeName: '' },
        meetingType: '', preparedBy: { name: '', title: '', org: dflt.name, phone: dflt.contactPhone, email: dflt.contactEmail }, notice: dflt.correctionNotice, next: { date: '', time: '', location: '' },
      };
    }
    d.attendees = (d.attendees || []).map((a) => Object.assign({ title: '', abbr: '', phone: '', email: '' }, a, { state: NM.snapState(a) }));
    return d;
  }

  function build(JsPDF, snap, revs, imgSrc, assets) {
    const A = assets || (typeof window !== 'undefined' ? window.NMAssets : null) || {};
    const d = prepare(snap), h = d.header, dc = d.doc, F = dc.firm;
    const agenda = dc.kind === 'agenda', draft = dc.kind === 'draft';
    const doc = new JsPDF({ unit: 'pt', format: 'letter', compress: true });
    doc.setProperties({ title: (agenda ? 'Agenda' : draft ? 'DRAFT Minutes' : 'Minutes') + ' - ' + h.series + ' - Meeting ' + h.number + (agenda || draft ? '' : ' Rev ' + snap.rev), subject: h.project, author: F.name, creator: 'Nexus Minutes' });

    /* ----- fonts ----- */
    const fonts = A.fonts || {};
    const haveFonts = !!(fonts.latoRegular && fonts.latoBold && fonts.rcBold);
    if (haveFonts) {
      const reg = (key, file, name, style) => { if (!fonts[key]) return; doc.addFileToVFS(file, fonts[key]); doc.addFont(file, name, style); };
      reg('latoRegular', 'Lato-Regular.ttf', 'Lato', 'normal'); reg('latoBold', 'Lato-Bold.ttf', 'Lato', 'bold'); reg('latoItalic', 'Lato-Italic.ttf', 'Lato', 'italic');
      reg('rcRegular', 'RobotoCondensed-Regular.ttf', 'RobotoCondensed', 'normal'); reg('rcBold', 'RobotoCondensed-Bold.ttf', 'RobotoCondensed', 'bold');
    }
    // Without the embedded fonts (only in a test harness that omits them) fall back to the standard faces.
    const FACE = haveFonts ? { body: 'Lato', head: 'RobotoCondensed' } : { body: 'helvetica', head: 'helvetica' };
    const font = (kind, style, size, color) => {
      doc.setFont(FACE[kind], style === 'italic' && !(haveFonts && fonts.latoItalic) ? 'normal' : style || 'normal');
      doc.setFontSize(size); doc.setTextColor.apply(doc, color || INK);
    };
    const wrap = (str, w, kind, style, size) => { font(kind, style, size); return doc.splitTextToSize(san(str), w); };
    const tw = (str, kind, style, size) => { font(kind, style, size); return doc.getTextWidth(san(str)); };
    const rule = (x1, x2, y, color, wd) => { doc.setDrawColor.apply(doc, color || RULE); doc.setLineWidth(wd || 0.5); doc.line(x1, y, x2, y); };
    const fill = (x, y, w, hh, color) => { doc.setFillColor.apply(doc, color); doc.rect(x, y, w, hh, 'F'); };

    let y = TOP1;
    const newPage = () => { doc.addPage(); y = TOPN; };
    const need = (hh) => { if (y + hh > PH - MB) { newPage(); return true; } return false; };

    /* ----- symbols ----- */
    function box(x, yy, state) {
      const s = 8;
      doc.setDrawColor.apply(doc, INK); doc.setLineWidth(0.8);
      if (state === 'unset') { doc.setLineDashPattern([1.4, 1.6], 0); doc.rect(x, yy, s, s); doc.setLineDashPattern([], 0); return; }
      doc.rect(x, yy, s, s);
      if (state === 'present') { doc.setLineWidth(1.1); doc.line(x + 1.6, yy + 4.2, x + 3.4, yy + 6.2); doc.line(x + 3.4, yy + 6.2, x + 7, yy + 1.4); }
      if (state === 'remote') { doc.setLineWidth(1.1); doc.line(x + 1.8, yy + 1.8, x + 6.2, yy + 6.2); doc.line(x + 6.2, yy + 1.8, x + 1.8, yy + 6.2); }
    }

    /* ----- first-page header ----- */
    function firstHeader() {
      const topY = TOP1;
      // document id, top right
      font('head', 'bold', 22, DARK);
      const idText = agenda ? 'AGENDA' : dc.docId;
      doc.text(san(idText), PW - MR, topY + 20, { align: 'right' });
      if (agenda) { font('head', 'normal', 9, SLATE); doc.text('Meeting ' + h.number, PW - MR, topY + 33, { align: 'right' }); }
      else if (draft) { font('head', 'bold', 9, [241, 138, 0]); doc.text('DRAFT - NOT ISSUED', PW - MR, topY + 33, { align: 'right' }); }
      else if (snap.rev > 0) { font('head', 'bold', 9, BLUE); doc.text('REVISION ' + snap.rev, PW - MR, topY + 33, { align: 'right' }); }
      // logo, unaltered, 1.15" wide
      const logoY = topY + 30, logoW = 84, logoH = logoW * 291 / 274;
      if (A.logo) doc.addImage('data:image/jpeg;base64,' + A.logo, 'JPEG', ML, logoY, logoW, logoH, 'nexus-logo', 'FAST');
      // firm name and offices
      const offs = F.offices.slice(0, 4);
      const offX = PW - MR - 150;
      font('body', 'normal', 6.8, INK);
      doc.text(san(F.name), offX - 14, logoY + 8, { align: 'right' });
      if (F.web) doc.text(san(F.web), offX - 14, logoY + 16, { align: 'right' });
      doc.setDrawColor.apply(doc, BLUE); doc.setLineWidth(0.8);
      let oy = logoY + 4;
      const startOy = oy;
      for (const o of offs) {
        font('head', 'bold', 7, DARK); doc.text(san(o.name).toUpperCase(), offX, oy + 6); oy += 9;
        font('body', 'normal', 6.8, INK);
        for (const l of [o.address1, o.address2]) if (l) { doc.text(san(l), offX, oy + 5); oy += 8; }
        if (o.phone) { font('body', 'bold', 6.8, INK); doc.text('T', offX, oy + 5); font('body', 'normal', 6.8, INK); doc.text(san(o.phone), offX + 7, oy + 5); oy += 8; }
        oy += 7;
      }
      doc.line(offX - 7, startOy, offX - 7, Math.max(oy - 6, startOy + 40));
      y = Math.max(logoY + logoH, oy) + 12;
    }

    /* ----- label / value grid ----- */
    const LBL = (t, x, yy) => { font('head', 'bold', 8.2, DARK); doc.text(san(t).toUpperCase(), x, yy + 7.2); };
    function infoBlock() {
      const L1 = ML, V1 = ML + 74, L2 = ML + 262, V2 = ML + 392, VW1 = L2 - V1 - 10, VW2 = PW - MR - V2;
      const lines = [];
      const time = NM.fmtTime(h.time, F.timeFormat);
      const dt = NM.fmtDate(h.date, { month: 'long', day: 'numeric', year: 'numeric' }) + (time ? ', ' + time : '');
      // left column
      let yl = y, yr = y;
      LBL('Date & time:', L1, yl); font('body', 'normal', 9.2, INK); doc.text(san(dt), V1, yl + 8); yl += 15;
      LBL('Project:', L1, yl);
      const pLines = wrap(dc.project.name || h.project || '-', VW1, 'body', 'bold', 9.2);
      font('body', 'bold', 9.2, DARK); for (const l of pLines) { doc.text(l, V1, yl + 8); yl += 11; }
      font('body', 'normal', 9, INK);
      for (const a of String(dc.project.address || '').split('\n').filter(Boolean)) for (const l of wrap(a, VW1, 'body', 'normal', 9)) { doc.text(l, V1, yl + 7.5); yl += 10.5; }
      yl += 5;
      // right column
      const kv = (label, value, bold) => {
        const lw = V2 - L2 - 6;
        LBL(label, L2, yr);
        const ls = wrap(value || '', VW2, 'body', bold ? 'bold' : 'normal', 9.2);
        font('body', bold ? 'bold' : 'normal', 9.2, bold ? DARK : INK);
        if (!ls.length) ls.push('');
        for (const l of ls) { doc.text(l, V2, yr + 8); yr += 11; }
        yr += 4; void lw;
      };
      kv('Meeting type:', dc.meetingType || '', true);
      kv('Location:', h.location || '');
      kv("Owner's project #:", dc.project.ownerNumber || '');
      kv("Architect's project #:", dc.project.number || h.projectNumber || '');
      y = Math.max(yl, yr);
      // prepared by
      const pb = dc.preparedBy || {};
      LBL(agenda ? 'Prepared by:' : 'By:', L1, y);
      let by = y;
      if (pb.name) { font('body', 'bold', 9.2, DARK); doc.text(san(pb.name), V1, by + 8); const nw = tw(pb.name, 'body', 'bold', 9.2); font('body', 'normal', 9.2, INK); if (pb.title) doc.text(san(', ' + pb.title), V1 + nw, by + 8); by += 11; }
      font('body', 'normal', 9.2, INK);
      if (pb.org) { doc.text(san(pb.org), V1, by + 8); by += 11; }
      let cy = y;
      for (const l of [pb.phone ? pb.phone + ' T' : '', pb.email]) if (l) { doc.text(san(l), V2 - 130, cy + 8); cy += 11; }
      y = Math.max(by, cy, y + 11) + 8;
      lines.length = 0;
    }

    /* ----- participants ----- */
    const PC = { name: 150, company: 128, aka: 30, tel: 76, email: 120 };
    const PX = { name: ML, company: ML + PC.name, aka: ML + PC.name + PC.company, tel: ML + PC.name + PC.company + PC.aka, email: ML + PC.name + PC.company + PC.aka + PC.tel };
    function participants() {
      need(40);
      font('head', 'bold', 8.2, DARK);
      doc.text(agenda ? 'INVITED:' : 'PARTICIPANTS:', PX.name, y + 7.5);
      for (const [k, t] of [['company', 'Company:'], ['aka', 'AKA:'], ['tel', 'Telephone #:'], ['email', 'Email Address:']]) doc.text(t.toUpperCase(), PX[k], y + 7.5);
      y += 12; rule(ML, PW - MR, y, DARK, 0.9); y += 3;
      if (!d.attendees.length) { font('body', 'italic', 9, SLATE); doc.text('No participants listed.', PX.name, y + 9); y += 16; }
      for (const a of d.attendees) {
        const nm = wrap(a.name, PC.name - 18, 'body', 'normal', 9), ttl = a.title ? wrap(a.title, PC.name - 18, 'body', 'normal', 7.4) : [];
        const co = wrap(a.company || '', PC.company - 8, 'body', 'normal', 8.8), em = wrap(a.email || '', PC.email, 'body', 'normal', 8.4), tl = wrap(a.phone || '', PC.tel - 4, 'body', 'normal', 8.4);
        const hh = Math.max(nm.length * 10.6 + ttl.length * 9, co.length * 10.6, em.length * 10, 12) + 3;
        need(hh);
        if (!agenda) box(PX.name, y + 1.8, a.state);
        const nx = agenda ? PX.name : PX.name + 14;
        font('body', 'normal', 9, DARK); let ny = y; for (const l of nm) { doc.text(l, nx, ny + 8.5); ny += 10.6; }
        font('body', 'normal', 7.4, SLATE); for (const l of ttl) { doc.text(l, nx, ny + 6.8); ny += 9; }
        font('body', 'normal', 8.8, INK); let cy = y; for (const l of co) { doc.text(l, PX.company, cy + 8.5); cy += 10.6; }
        font('body', 'normal', 8.8, INK); doc.text(san(a.abbr || ''), PX.aka, y + 8.5);
        font('body', 'normal', 8.4, INK); let ty = y; for (const l of tl) { doc.text(l, PX.tel, ty + 8.5); ty += 10; }
        let ey = y; for (const l of em) { doc.text(l, PX.email, ey + 8.5); ey += 10; }
        y += hh;
      }
      if (!agenda) {
        y += 5; need(22);
        font('head', 'bold', 8.2, DARK); doc.text('LEGEND:', ML, y + 8);
        let x = ML + 56;
        const items = [['present', 'In Attendance'], ['remote', 'Attending Via Teleconference'], ['absent', 'Not in Attendance']];
        if (d.attendees.some((a) => a.state === 'unset')) items.push(['unset', 'Not Recorded']);
        for (const [st, label] of items) { box(x, y + 1.2, st); font('body', 'normal', 8.6, INK); doc.text(label, x + 12, y + 8); x += 12 + tw(label, 'body', 'normal', 8.6) + 16; }
        y += 15;
      }
      rule(ML, PW - MR, y, DARK, 0.9); y += 9;
    }

    /* ----- notice with bold / underline legend ----- */
    function richLine(segs, x, w, size) {
      // segs: [{t, bold, ul}] wrapped word by word
      const words = [];
      for (const s of segs) for (const wd of san(s.t).split(/(\s+)/)) if (wd) words.push({ t: wd, bold: s.bold, ul: s.ul });
      let line = [], lw = 0;
      const lines = [];
      for (const wd of words) {
        const wlen = tw(wd.t, 'body', wd.bold ? 'bold' : 'normal', size);
        if (lw + wlen > w && line.length && wd.t.trim()) { lines.push(line); line = []; lw = 0; if (!wd.t.trim()) continue; }
        line.push(Object.assign({ w: wlen }, wd)); lw += wlen;
      }
      if (line.length) lines.push(line);
      for (const ln of lines) {
        need(size * 1.4);
        let cx = x;
        const trimmed = ln.slice(); while (trimmed.length && !trimmed[trimmed.length - 1].t.trim()) trimmed.pop();
        for (const s of trimmed) {
          font('body', s.bold ? 'bold' : 'normal', size, s.bold ? DARK : INK); doc.text(s.t, cx, y + size * 0.85);
          if (s.ul) { doc.setDrawColor.apply(doc, DARK); doc.setLineWidth(0.6); doc.line(cx, y + size + 0.6, cx + s.w, y + size + 0.6); }
          cx += s.w;
        }
        y += size * 1.45;
      }
    }
    function notice() {
      if (agenda) return;
      const segs = [];
      if (dc.notice && dc.notice.trim()) segs.push({ t: dc.notice.trim() + '  ' });
      segs.push({ t: 'Items in bold type are new from this meeting.', bold: true }, { t: '  ' }, { t: 'Underlined items require action.', bold: true, ul: true });
      richLine(segs, ML, W, 9);
      if (snap.rev > 0) {
        const note = (revs || []).find((r) => r.rev === snap.rev);
        const txt = 'Revised minutes (Rev ' + snap.rev + ')' + (note && note.note ? ': ' + note.note : '');
        const ls = wrap(txt, W - 14, 'body', 'bold', 8.8);
        y += 3; need(ls.length * 11 + 8);
        fill(ML, y, W, ls.length * 11 + 6, LIGHT); fill(ML, y, 3, ls.length * 11 + 6, BLUE);
        font('body', 'bold', 8.8, DARK); let ty = y + 3; for (const l of ls) { doc.text(l, ML + 10, ty + 8); ty += 11; } y += ls.length * 11 + 8;
      }
      y += 4;
    }

    /* ----- minutes table ----- */
    function tableHead() {
      font('head', 'bold', 8.6, DARK);
      doc.setDrawColor.apply(doc, DARK); doc.setLineWidth(0.9);
      doc.line(ML, y, PW - MR, y);
      doc.text('ISSUE #', CX.issue + 2, y + 12); doc.text('DATE', CX.date + 2, y + 12); doc.text('DESCRIPTION', CX.desc + 2, y + 12);
      doc.text('ACTION BY', CX.who + C.who / 2, y + 12, { align: 'center' });
      doc.text('[DUE] /', CX.due + C.due / 2, y + 8.5, { align: 'center' }); doc.text('COMPLETE', CX.due + C.due / 2, y + 17.5, { align: 'center' });
      y += 22; doc.line(ML, y, PW - MR, y); y += 4;
    }
    const tableNeed = (hh) => { if (need(hh)) { tableHead(); return true; } return false; };

    /* figures live inside the description column */
    function figDims(a, availW) {
      const ratio = a.w > 0 && a.h > 0 ? a.h / a.w : 0.75;
      let wd = a.layout === 'half' ? availW * 0.55 : availW, ht = wd * ratio;
      const maxH = 330;
      if (ht > maxH) { wd = wd * maxH / ht; ht = maxH; }
      return { wd, ht };
    }
    const figCaption = (a) => 'Att. ' + a.no + (a.caption ? '  ' + a.caption : '');
    function figHeight(a, availW) {
      if (a.layout === 'page' || !(imgSrc && imgSrc(a.imageId))) return 14;
      const f = figDims(a, availW);
      return f.ht + wrap(figCaption(a), Math.max(f.wd, 120), 'body', 'normal', 7.6).length * 9.5 + 10;
    }
    function figure(a, x, availW) {
      if (a.layout === 'page') {
        font('body', 'italic', 8, SLATE);
        for (const l of wrap('See Att. ' + a.no + (a.caption ? ' - ' + a.caption : '') + ' (attachment page)', availW, 'body', 'italic', 8)) { tableNeed(11); font('body', 'italic', 8, SLATE); doc.text(l, x, y + 8); y += 11; }
        return;
      }
      const src = imgSrc ? imgSrc(a.imageId) : '';
      if (!src) { tableNeed(12); font('body', 'italic', 8, SLATE); doc.text('Att. ' + a.no + ': image not available', x, y + 8); y += 12; return; }
      const f = figDims(a, availW);
      tableNeed(figHeight(a, availW));
      y += 3;
      doc.addImage(src, 'JPEG', x, y, f.wd, f.ht, undefined, 'FAST');
      doc.setDrawColor.apply(doc, RULE); doc.setLineWidth(0.5); doc.rect(x, y, f.wd, f.ht);
      y += f.ht + 3;
      font('body', 'bold', 7.6, BLUE); doc.text('Att. ' + a.no, x, y + 7);
      const lw = tw('Att. ' + a.no, 'body', 'bold', 7.6) + 4;
      font('body', 'normal', 7.6, SLATE);
      for (const l of doc.splitTextToSize(san(a.caption || ''), Math.max(100, availW - lw))) { doc.text(l, x + lw, y + 7); y += 9.5; }
      if (!a.caption) y += 9.5;
      y += 3;
    }

    const OPEN_STATES = ['open', 'progress', 'extended', 'new'];
    function dueCell(r) {
      if (r.state === 'done') return { t: shortDate(r.doneOn || r.due) || 'Completed', bracket: false };
      if (r.state === 'canceled') return { t: 'Canceled', bracket: false };
      return { t: r.due ? '[' + shortDate(r.due) + ']' : '', bracket: true };
    }
    const abbr = (r) => (r.whoAbbr && r.whoAbbr.length ? r.whoAbbr : r.who) || [];
    /* One row of the register. e: {issue, ref, heading, date, text, bold, ul, muted, who[], due{t}, tags[], notes[], atts[]} */
    function row(e) {
      const dw = C.desc - 8;
      const head = e.heading ? wrap(e.heading, dw, 'head', 'bold', 9.6) : [];
      const body = e.text ? wrap(e.text, dw, 'body', e.bold ? 'bold' : 'normal', 9) : [];
      const notes = (e.notes || []).map((n) => wrap(n, dw, 'body', 'italic', 8.2));
      const lh = 11.4;
      const firstH = Math.max(head.length * 11.8 + Math.min(body.length, 2) * lh, 14);
      tableNeed(Math.min(firstH + 4, 120));
      const top = y, pageAtStart = doc.getNumberOfPages();
      // left cells (first line)
      let iy = top;
      if (e.issue) { font('head', 'bold', 9.4, DARK); doc.text(san(e.issue), CX.issue + 2, iy + 8.6); iy += 10.5; }
      if (e.ref) { font('head', 'normal', 7.4, SLATE); doc.text(san(e.ref), CX.issue + 2, iy + 7.4); }
      if (e.date) { font('body', 'normal', 8.6, e.muted ? SLATE : INK); doc.text(san(e.date), CX.date + 2, top + 8.6); }
      let ay = top;
      font('body', e.bold ? 'bold' : 'normal', 8.6, DARK);
      const who = (e.who || []).join(', ');
      const wl = who ? wrap(who, C.who - 6, 'body', e.bold ? 'bold' : 'normal', 8.6) : [];
      for (const l of wl) { font('body', e.bold ? 'bold' : 'normal', 8.6, DARK); doc.text(l, CX.who + C.who / 2, ay + 8.6, { align: 'center' }); ay += 10.4; }
      if (e.due && e.due.t) { font('body', 'normal', 8.6, e.dueColor || INK); doc.text(san(e.due.t), CX.due + C.due / 2, top + 8.6, { align: 'center' }); }
      if (e.tag) { font('head', 'bold', 6.8, SLATE); doc.text(san(e.tag).toUpperCase(), CX.due + C.due / 2, top + 19, { align: 'center' }); }
      // description, line by line so a long entry can run onto the next page
      let first = true;
      const put = (ls, kind, style, size, color, ul) => {
        for (const l of ls) {
          if (!first && y + lh > PH - MB) { newPage(); tableHead(); }
          if (first) first = false;
          font(kind, style, size, color);
          doc.text(l, CX.desc + 2, y + size * 0.88);
          if (ul) { const w = doc.getTextWidth(l); doc.setDrawColor.apply(doc, DARK); doc.setLineWidth(0.6); doc.line(CX.desc + 2, y + size + 1, CX.desc + 2 + w, y + size + 1); }
          y += kind === 'head' ? 11.8 : size === 8.2 ? 10.4 : lh;
        }
      };
      put(head, 'head', 'bold', 9.6, DARK);
      put(body, 'body', e.bold ? 'bold' : 'normal', 9, e.muted ? SLATE : e.bold ? DARK : INK, e.ul);
      for (const n of notes) put(n, 'body', 'italic', 8.2, SLATE);
      if (!head.length && !body.length && !notes.length) y += 12;
      for (const a of e.atts || []) figure(a, CX.desc + 2, dw);
      if (doc.getNumberOfPages() === pageAtStart) y = Math.max(y, top + (e.issue && e.ref ? 22 : 14));
      y += 3;
    }
    function issueRule() { rule(ML, PW - MR, y, LIGHT, 0.8); y += 4; }

    function band(text) {
      tableNeed(36);
      fill(ML, y, W, 14, LIGHT);
      font('head', 'bold', 8.6, DARK); doc.text(san(text).toUpperCase(), ML + 4, y + 10); y += 18;
    }
    function minutes() {
      font('head', 'bold', 9.2, DARK); need(60); doc.text(agenda ? 'AGENDA:' : 'MINUTES:', ML, y + 8); y += 13;
      tableHead();
      if (!d.sections.length) { font('body', 'italic', 9, SLATE); doc.text(agenda ? 'No discussion items yet.' : 'No discussion items were recorded.', CX.desc + 2, y + 10); y += 18; }
      for (const sec of d.sections) {
        band(sec.no + '   ' + sec.name + (sec.time ? '   ' + sec.time : ''));
        if (!sec.topics.length) { need(16); font('body', 'italic', 9, SLATE); doc.text('None', CX.desc + 2, y + 9); y += 16; }
        for (const t of sec.topics) {
          let issue = F.refStyle === 'plain' ? t.no : (t.issue || NM.issueNo(t.no)), firstRow = true;
          const entries = [];
          for (const hs of t.history || []) for (const it of hs.items) entries.push({ date: shortDate(hs.date), text: it.text, muted: false, hist: true });
          for (const r of t.carried || []) {
            const open = OPEN_STATES.includes(r.state);
            const origDate = shortDate(r.fromDate);
            const dueE = r.state === 'done' ? { t: shortDate(r.doneOn || r.due) } : r.state === 'canceled' ? { t: 'Canceled' } : { t: r.due ? '[' + shortDate(r.due) + ']' : '' };
            const note = [];
            entries.push({ ref: NM.fmtRef(r.ref, F.refStyle), date: origDate, text: r.text, ul: open && !agenda ? true : open, who: abbr(r), due: agenda ? { t: r.due ? '[' + shortDate(r.due) + ']' : '' } : (r.state === 'extended' ? { t: '[' + shortDate(r.before) + ']' } : dueE), dueColor: r.overdue ? DARK : INK, tag: agenda ? (r.overdue ? 'overdue' : '') : '', carried: true });
            if (!agenda) {
              const upd = [];
              if (r.state === 'done') upd.push('Completed' + (r.doneOn ? ' ' + shortDate(r.doneOn) : '') + '.' + (r.note ? ' ' + r.note : ''));
              else if (r.state === 'canceled') upd.push('Canceled.' + (r.note ? ' ' + r.note : ''));
              else if (r.state === 'extended') upd.push('Due date moved to ' + shortDate(r.due) + (r.pushNote ? ': ' + r.pushNote : '.') + (r.note ? ' ' + r.note : ''));
              else if (r.state === 'progress') upd.push('In progress.' + (r.note ? ' ' + r.note : ''));
              else if (r.note) upd.push(r.note);
              if (upd.length) entries.push({ date: shortDate(h.date), text: upd.join(' '), bold: true, who: r.state === 'extended' ? abbr(r) : [], due: r.state === 'extended' ? { t: '[' + shortDate(r.due) + ']' } : r.state === 'done' ? { t: shortDate(r.doneOn || h.date) } : { t: '' }, update: true });
            }
            void note;
          }
          for (const o of t.outcomes) {
            const act = o.type === 'assignment';
            const label = o.type === 'decision' ? 'Decision: ' : '';
            entries.push({ ref: act ? NM.fmtRef(o.ref, F.refStyle) : '', date: shortDate(h.date), text: label + o.text, bold: true, ul: act, who: act ? abbr(o) : [], due: act ? { t: '[' + shortDate(o.due) + ']' } : null, atts: o.atts });
          }
          if (!entries.length) entries.push({ date: agenda ? '' : shortDate(h.date), text: '' });
          // topic title heads the first row; its own attachments follow the last row of the topic
          entries.forEach((en, i) => {
            const e1 = Object.assign({}, en);
            if (i === 0) { e1.issue = issue; e1.heading = t.text + ':'; }
            row(e1);
            firstRow = false;
          });
          void firstRow;
          for (const a of t.atts || []) row({ ref: issue, text: '', atts: [a] });
          issueRule();
        }
        for (const bk of sec.breaks || []) { need(18); font('body', 'italic', 8.8, SLATE); doc.text(san('Break, ' + bk.mins + ' min   ' + bk.time), CX.desc + 2, y + 9); y += 17; }
      }
      y += 6;
    }

    /* ----- action summary ----- */
    function summary() {
      if (agenda || !d.actions.length) return;
      const SC = { ref: 64, act: 172, who: 78, due: 90, st: 100 };
      const sx = { ref: ML, act: ML + SC.ref, who: ML + SC.ref + SC.act, due: ML + SC.ref + SC.act + SC.who, st: ML + SC.ref + SC.act + SC.who + SC.due };
      const head = (cont) => {
        if (!cont) { font('head', 'bold', 9.2, DARK); doc.text('ACTION ITEM SUMMARY', ML, y + 8); y += 13; }
        fill(ML, y, W, 14, LIGHT); font('head', 'bold', 8, DARK);
        doc.text('ITEM', sx.ref + 4, y + 10); doc.text('ACTION', sx.act, y + 10); doc.text('ACTION BY', sx.who, y + 10); doc.text('[DUE] / COMPLETE', sx.due, y + 10); doc.text('STATUS', sx.st, y + 10);
        y += 16;
      };
      need(70); head(false);
      for (const r of d.actions) {
        const rp = NM.refParts(r, F.refStyle);
        const refText = rp.ref;
        const a = wrap(r.text, SC.act - 8, 'body', 'normal', 8.6), wl = wrap(abbr(r).join(', ') || '-', SC.who - 6, 'body', 'normal', 8.6);
        const hh = Math.max(a.length * 10.4, wl.length * 10.4, rp.from ? 20 : 12) + 5;
        if (need(hh)) head(true);
        rule(ML, PW - MR, y, LIGHT, 0.7);
        const top = y + 3;
        font('head', 'normal', 8, DARK); doc.text(san(refText), sx.ref + 4, top + 8);
        if (rp.from) { font('body', 'normal', 6.4, SLATE); doc.text(san(rp.from.replace(' · ', ' ')), sx.ref + 4, top + 16.5); }
        font('body', 'normal', 8.6, INK); let ay = top; for (const l of a) { doc.text(l, sx.act, ay + 8); ay += 10.4; }
        let wy = top; for (const l of wl) { doc.text(l, sx.who, wy + 8); wy += 10.4; }
        const due = dueCell(r);
        font('body', 'normal', 8.6, INK); doc.text(san(due.t), sx.due, top + 8);
        const label = NM.STATE_LABEL[r.state] || r.state;
        const mark = r.overdue ? ORANGE : r.state === 'done' ? GREEN : r.state === 'canceled' ? SLATE : BLUE;
        fill(sx.st, top + 2, 4, 7, mark);
        font('body', 'normal', 8.4, INK); doc.text(san(label + (r.overdue ? ' · overdue' : '')), sx.st + 8, top + 8);
        y += hh;
      }
      rule(ML, PW - MR, y, LIGHT, 0.7); y += 10;
    }

    function nextMeeting() {
      need(64);
      font('head', 'bold', 9.2, DARK); doc.text('NEXT MEETING:', ML, y + 8); y += 15;
      const n = dc.next || {};
      const time = NM.fmtTime(n.time, F.timeFormat);
      LBL('Date & time:', ML, y); font('body', 'normal', 9.2, INK);
      doc.text(san(n.date ? longDate(n.date) + (time ? ', ' + time : '') : 'To be determined'), ML + 74, y + 8);
      LBL('Location:', ML + 262, y);
      const ls = wrap(n.location || '-', PW - MR - (ML + 322), 'body', 'normal', 9.2);
      font('body', 'normal', 9.2, INK); let ly = y; for (const l of ls) { doc.text(l, ML + 322, ly + 8); ly += 11; }
      y = Math.max(y + 15, ly) + 8;
    }

    function revisions() {
      if (!revs || revs.length < 2) return;
      need(40 + revs.length * 13);
      font('head', 'bold', 9.2, DARK); doc.text('REVISIONS:', ML, y + 8); y += 13;
      rule(ML, PW - MR, y, DARK, 0.9); y += 3;
      for (const r of revs) {
        const tl = wrap(r.rev === 0 ? 'Initial issue' : r.note, W - 190, 'body', 'normal', 8.6);
        need(tl.length * 10.6 + 5);
        font('head', 'bold', 8.6, BLUE); doc.text('REV ' + r.rev, ML + 2, y + 9);
        font('body', 'normal', 8.4, SLATE); doc.text(san(NM.fmtStamp(r.publishedAt)), ML + 40, y + 9);
        font('body', 'normal', 8.6, INK); for (const l of tl) { doc.text(l, ML + 170, y + 9); y += 10.6; }
        y += 3;
      }
    }

    /* ----- attachment pages ----- */
    function attachmentPages() {
      for (const a of (d.attachments || []).filter((x) => x.layout === 'page')) {
        newPage();
        font('head', 'bold', 12, BLUE); doc.text('ATT. ' + a.no, ML, y + 10);
        font('body', 'normal', 8.8, SLATE); doc.text('Item ' + san(NM.fmtRef(a.ref, F.refStyle)), ML + 58, y + 10);
        y += 18; rule(ML, PW - MR, y, DARK, 0.9); y += 8;
        const capLines = a.caption ? wrap(a.caption, W, 'body', 'normal', 9.5) : [];
        const boxH = PH - MB - y - (capLines.length ? capLines.length * 12.5 + 8 : 4);
        const src = imgSrc ? imgSrc(a.imageId) : '';
        if (!src) { font('body', 'italic', 9.5, SLATE); doc.text('Image not available.', ML, y + 10); continue; }
        const ratio = a.w > 0 && a.h > 0 ? a.h / a.w : 0.75;
        let wd = W, ht = wd * ratio;
        if (ht > boxH) { ht = boxH; wd = ht / ratio; }
        const x = ML + (W - wd) / 2;
        doc.addImage(src, 'JPEG', x, y, wd, ht, undefined, 'FAST');
        doc.setDrawColor.apply(doc, RULE); doc.setLineWidth(0.5); doc.rect(x, y, wd, ht);
        y += ht + 8;
        font('body', 'normal', 9.5, INK); for (const l of capLines) { doc.text(l, ML, y + 9); y += 12.5; }
      }
    }

    /* ----- compose ----- */
    firstHeader();
    infoBlock();
    participants();
    notice();
    minutes();
    summary();
    nextMeeting();
    revisions();
    attachmentPages();

    /* ----- running header and footer on every page ----- */
    const n = doc.getNumberOfPages();
    const issued = snap.publishedAt ? NM.fmtDate(new Date(snap.publishedAt).toISOString().slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' }) + ' ' + new Date(snap.publishedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    const printed = NM.fmtDate(new Date().toISOString().slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' });
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      if (i > 1) {
        font('head', 'bold', 10.5, DARK); doc.text(san(agenda ? 'AGENDA' : draft ? dc.docId + '  DRAFT' : dc.docId), ML, 34);
        font('body', 'normal', 8, SLATE);
        const mid = [dc.project.name || h.project, dc.meetingType, NM.fmtDate(h.date, { month: 'short', day: 'numeric', year: 'numeric' })].filter(Boolean).join('  ·  ');
        doc.text(san(mid), PW - MR, 33, { align: 'right' });
        rule(ML, PW - MR, 42, BLUE, 1);
      }
      rule(ML, PW - MR, FOOT_Y - 6, SLATE, 0.5);
      font('body', 'normal', 7.2, SLATE);
      const l1 = ['Form Version: ' + F.formVersion, F.copyright, agenda ? 'Draft agenda printed ' + printed : draft ? 'DRAFT printed ' + printed + ' - not issued' : 'Issued: ' + issued].filter((x) => x && !/: $/.test(x)).join('     ');
      doc.text(san(l1), ML, FOOT_Y + 5);
      doc.text(san([dc.project.name || h.project, h.series, 'Meeting ' + h.number + (agenda ? '' : draft ? ' (draft)' : snap.rev > 0 ? ', Rev ' + snap.rev : '')].filter(Boolean).join('  |  ')), ML, FOOT_Y + 14);
      font('head', 'bold', 9, DARK);
      const pg = 'Page ' + i + ' of ' + n;
      font('body', 'normal', 8.6, INK); doc.text(pg, PW - MR, FOOT_Y + 8, { align: 'right' });
      const pw = tw(pg, 'body', 'normal', 8.6);
      font('head', 'bold', 9, DARK); doc.text(san(F.docType), PW - MR - pw - 10, FOOT_Y + 8, { align: 'right' });
    }
    return doc;
  }


  /* ----- Preview: run the real PDF layout, record every drawing call per page, then paint the pages on canvases.
     Text measuring and page breaks come from the same code as the PDF, so the layout is the PDF's layout. ----- */
  function preview(JsPDF, snap, revs, imgSrc, assets) {
    const pages = [[]];
    const st = { font: 'helvetica', style: 'normal', size: 12, text: [0, 0, 0], fill: [0, 0, 0], draw: [0, 0, 0], lw: 0.2, dash: [], page: 0 };
    const col = (a) => { const v = [...a].filter((x) => typeof x === 'number'); return v.length >= 3 ? v.slice(0, 3) : [v[0] || 0, v[0] || 0, v[0] || 0]; };
    const rec = (op) => { pages[st.page].push(Object.assign({ lw: st.lw, dash: st.dash.slice(), draw: st.draw.slice() }, op)); };
    const hooks = {
      setFont(n, sty) { st.font = n; st.style = sty || 'normal'; },
      setFontSize(n) { st.size = n; },
      setTextColor() { st.text = col(arguments); },
      setFillColor() { st.fill = col(arguments); },
      setDrawColor() { st.draw = col(arguments); },
      setLineWidth(n) { st.lw = n; },
      setLineDashPattern(a) { st.dash = (a || []).slice(); },
      addPage() { pages.push([]); st.page = pages.length - 1; },
      setPage(n) { st.page = Math.max(0, Math.min(pages.length - 1, n - 1)); },
      text(t, x, y, o) { rec({ k: 't', t: Array.isArray(t) ? t.map(String) : String(t).split('\n'), x, y, al: (o && o.align) || 'left', font: st.font, style: st.style, size: st.size, color: st.text.slice() }); },
      line(x1, y1, x2, y2) { rec({ k: 'l', x1, y1, x2, y2 }); },
      rect(x, y, w, h, style) { rec({ k: 'r', x, y, w, h, f: /F/i.test(style || ''), s: !style || /S|DF/.test(style), fill: st.fill.slice() }); },
      addImage(src, fmt, x, y, w, h) { rec({ k: 'i', src, x, y, w, h }); },
    };
    class Rec {
      constructor(opts) {
        const real = new JsPDF(opts);
        return new Proxy(real, { get(tg, p) {
          const v = tg[p];
          if (typeof v !== 'function') return v;
          return function () { if (hooks[p]) hooks[p].apply(null, arguments); return v.apply(tg, arguments); };
        } });
      }
    }
    build(Rec, snap, revs, imgSrc, assets);
    return pages;
  }
  const FACES = { Lato: 'Lato', RobotoCondensed: '"Roboto Condensed"', helvetica: 'Helvetica, Arial, sans-serif' };
  async function loadFaces() {
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return;
    try { await Promise.all(['400', '700', 'italic 400'].map((w) => document.fonts.load(w + ' 12px Lato')).concat(['400', '700'].map((w) => document.fonts.load(w + ' 12px "Roboto Condensed"')))); } catch (_) {}
  }
  function loadImages(pages) {
    const cache = new Map(), jobs = [];
    for (const p of pages) for (const o of p) if (o.k === 'i' && !cache.has(o.src)) {
      cache.set(o.src, null);
      jobs.push(new Promise((res) => { const im = new Image(); im.onload = () => { cache.set(o.src, im); res(); }; im.onerror = () => res(); im.src = o.src; }));
    }
    return Promise.all(jobs).then(() => cache);
  }
  /* Paints one recorded page. Returns nothing; the canvas is sized here. */
  function paint(ops, cv, scale, imgs) {
    cv.width = Math.round(PW * scale); cv.height = Math.round(PH * scale);
    const cx = cv.getContext('2d'); cx.scale(scale, scale);
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, PW, PH);
    const rgb = (c) => 'rgb(' + c.map((n) => Math.round(n)).join(',') + ')';
    for (const o of ops) {
      if (o.k === 't') {
        cx.font = (o.style === 'italic' ? 'italic ' : '') + (o.style === 'bold' ? '700 ' : '400 ') + o.size + 'px ' + (FACES[o.font] || FACES.Lato);
        cx.fillStyle = rgb(o.color); cx.textAlign = o.al === 'right' ? 'right' : o.al === 'center' ? 'center' : 'left'; cx.textBaseline = 'alphabetic';
        o.t.forEach((ln, i) => cx.fillText(ln, o.x, o.y + i * o.size * 1.15));
      } else if (o.k === 'l') {
        cx.strokeStyle = rgb(o.draw); cx.lineWidth = o.lw; cx.setLineDash(o.dash); cx.beginPath(); cx.moveTo(o.x1, o.y1); cx.lineTo(o.x2, o.y2); cx.stroke(); cx.setLineDash([]);
      } else if (o.k === 'r') {
        if (o.f) { cx.fillStyle = rgb(o.fill); cx.fillRect(o.x, o.y, o.w, o.h); }
        if (o.s) { cx.strokeStyle = rgb(o.draw); cx.lineWidth = o.lw; cx.setLineDash(o.dash); cx.strokeRect(o.x, o.y, o.w, o.h); cx.setLineDash([]); }
      } else if (o.k === 'i') {
        const im = imgs && imgs.get(o.src); if (im) cx.drawImage(im, o.x, o.y, o.w, o.h);
      }
    }
  }
  async function renderPreview(JsPDF, snap, revs, imgSrc, assets, host, scale) {
    const pages = preview(JsPDF, snap, revs, imgSrc, assets);
    await loadFaces();
    const imgs = await loadImages(pages);
    host.textContent = '';
    pages.forEach((ops, i) => {
      const wrap = document.createElement('div'); wrap.className = 'pv-page';
      const cv = document.createElement('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Page ' + (i + 1) + ' of ' + pages.length);
      paint(ops, cv, scale || 1.6, imgs); wrap.appendChild(cv); host.appendChild(wrap);
    });
    return pages.length;
  }
  return { build, san, shortDate, prepare, preview, paint, renderPreview };
});


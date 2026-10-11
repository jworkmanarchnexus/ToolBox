/* Nexus Minutes: data model and rules. No DOM, no storage, no network.
   Runs in the page and in node for tests. Version 2 data model. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NM = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA = 2;
  const COLLS = ['firm', 'projects', 'series', 'images', 'meetings', 'actions', 'snapshots'];
  const FIRM_ID = 'firm-settings';
  const ATT_STATES = ['unset', 'present', 'remote', 'absent'];
  const ATT_LABEL = { unset: 'Not yet recorded', present: 'In attendance', remote: 'Via teleconference', absent: 'Not in attendance' };
  const ACTION_STATUSES = ['open', 'progress', 'done', 'canceled'];
  const ACTION_LABEL = { open: 'Open', progress: 'In progress', done: 'Completed', canceled: 'Canceled' };
  const isActive = (a) => a.status === 'open' || a.status === 'progress';
  const LAYOUTS = ['half', 'full', 'page'];
  const IMG_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
  const MAX_IMG_CHARS = 235000; // keeps one image document under the 256 KiB limit
  const DEFAULT_SECTIONS = ['General', 'Schedule', 'Site', 'Architecture', 'Structural', 'Mechanical', 'Electrical', 'Plumbing'];
  const CADENCES = ['weekly', 'biweekly', 'monthly', 'none'];
  const OUTCOME_TYPES = ['decision', 'assignment', 'info'];
  const TYPE_LABEL = { decision: 'Decision', assignment: 'Assignment', info: 'Information' };
  const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /* ---------- clock and ids ---------- */
  let clock = () => Date.now();
  let lastStamp = 0;
  function setClock(fn) { clock = fn || (() => Date.now()); lastStamp = 0; }
  function stamp() { lastStamp = Math.max(clock(), lastStamp + 1); return lastStamp; }
  function uid() {
    const c = typeof crypto !== 'undefined' ? crypto : null;
    if (c && c.randomUUID) return 'x' + c.randomUUID().replace(/-/g, '').slice(0, 20);
    let s = 'x';
    for (let i = 0; i < 20; i++) s += Math.floor(Math.random() * 36).toString(36);
    return s;
  }

  /* ---------- dates (all local, YYYY-MM-DD) ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function todayStr() { return ymd(new Date(clock())); }
  function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function addMonth(s) {
    const d = parseYmd(s);
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    const last = new Date(y, m + 1, 0).getDate();
    return ymd(new Date(y, m, Math.min(day, last)));
  }
  function nextDate(prev, cadence) {
    const today = todayStr();
    if (!prev || cadence === 'none') return today;
    const n = cadence === 'biweekly' ? addDays(prev, 14) : cadence === 'monthly' ? addMonth(prev) : addDays(prev, 7);
    return n < today ? today : n;
  }
  function fmtDate(s, opts) {
    if (!s || !DATE_RE.test(s)) return '';
    return parseYmd(s).toLocaleDateString('en-US', opts || { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  function fmtShort(s) { return fmtDate(s, { month: 'short', day: 'numeric' }); }
  /* Short date, with the year only when it differs from the reference date's year. */
  function fmtDue(s, ref) {
    if (!s) return '';
    return ref && ref.slice(0, 4) !== s.slice(0, 4) ? fmtDate(s, { month: 'short', day: 'numeric', year: 'numeric' }) : fmtShort(s);
  }
  function fmtStamp(ms) {
    return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /* Times are stored as 24-hour 'HH:MM' when they can be read; anything else is kept as typed. */
  function normTime(v) {
    const t = String(v == null ? '' : v).trim();
    if (!t) return '';
    let m = /^(\d{1,2}):(\d{2})\s*([ap])?\.?m?\.?$/i.exec(t) || /^(\d{1,2})()\s*([ap])\.?m?\.?$/i.exec(t);
    if (!m) return t;
    let h = Number(m[1]); const mi = Number(m[2] || 0);
    if (m[3]) { const pm = m[3].toLowerCase() === 'p'; if (h < 1 || h > 12) return t; h = (h % 12) + (pm ? 12 : 0); }
    if (h > 23 || mi > 59) return t;
    return pad(h) + ':' + pad(mi);
  }
  function fmtTime(v, fmt) {
    const t = normTime(v);
    const m = /^(\d{2}):(\d{2})$/.exec(t);
    if (!m) return t;
    if (fmt === '24h') return t;
    const h = Number(m[1]);
    return ((h % 12) || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  function addMinutes(v, mins) {
    const m = /^(\d{2}):(\d{2})$/.exec(normTime(v));
    if (!m || !mins) return '';
    const tot = (Number(m[1]) * 60 + Number(m[2]) + mins) % 1440;
    return pad(Math.floor(tot / 60)) + ':' + pad(tot % 60);
  }

  /* ---------- firm settings (one record, admin-only in the screens) ---------- */
  function defaultFirm() {
    return {
      name: 'Architectural Nexus, Inc.', short: 'AN', web: 'archnexus.com',
      offices: [
        { id: 'office-slc', name: 'Salt Lake City', address1: '2505 East Parleys Way', address2: 'Salt Lake City, Utah 84109', phone: '801.924.5000' },
        { id: 'office-sac', name: 'Sacramento', address1: '930 R Street', address2: 'Sacramento, California 95811', phone: '916.443.5911' },
      ],
      contactEmail: 'contact@archnexus.com', contactPhone: '801.924.5000',
      docIdPrefix: 'MIN', docType: 'Meeting Minutes', formVersion: '6/15', copyrightHolder: 'Architectural Nexus, Inc.', copyrightYear: '',
      timeFormat: '12h', refStyle: 'legacy',
      correctionNotice: 'Please review the Meeting Minutes below, and inform the Architect as soon as possible of any necessary corrections, comments, or additional information to be included.',
      meetingTypes: ['Construction Meeting', 'Owner-Architect-Contractor Meeting', 'Design Meeting', 'Coordination Meeting', 'Pre-Construction Meeting', 'Internal Meeting'],
    };
  }
  function cleanOffices(list) {
    const seen = new Set();
    return arr(list).filter((o) => o && typeof o === 'object' && str(o.name).trim()).map((o) => ({
      id: goodId(o.id), name: str(o.name).trim(), address1: str(o.address1).trim(), address2: str(o.address2).trim(), phone: str(o.phone).trim(),
    })).filter((o) => !seen.has(o.id) && seen.add(o.id));
  }
  function cleanFirm(r) {
    const d = defaultFirm();
    const f = (k) => (typeof r[k] === 'string' ? r[k] : d[k]);
    const offices = cleanOffices(r.offices);
    const types = arr(r.meetingTypes).map(str).map((x) => x.trim()).filter(Boolean);
    return {
      name: f('name').trim() || d.name, short: f('short').trim(), web: f('web').trim(), offices: Array.isArray(r.offices) ? offices : d.offices,
      contactEmail: f('contactEmail').trim(), contactPhone: f('contactPhone').trim(), docIdPrefix: f('docIdPrefix').trim(), docType: f('docType').trim() || d.docType,
      formVersion: f('formVersion').trim(), copyrightHolder: f('copyrightHolder').trim(), copyrightYear: /^\d{4}$/.test(str(r.copyrightYear)) ? r.copyrightYear : '',
      timeFormat: r.timeFormat === '24h' ? '24h' : '12h', refStyle: r.refStyle === 'plain' ? 'plain' : 'legacy', correctionNotice: f('correctionNotice'), meetingTypes: Array.isArray(r.meetingTypes) ? types : d.meetingTypes,
    };
  }
  function getFirm(st) {
    const r = st.firm[FIRM_ID];
    return r && !r.deleted ? r : Object.assign({ id: FIRM_ID, v: SCHEMA, updatedAt: 0, createdAt: 0 }, defaultFirm());
  }
  /* Firm-wide settings. The screens only offer this to administrators; the rule here is the same for every caller. */
  function updateFirm(st, patch) {
    const cur = getFirm(st);
    const next = cleanFirm(Object.assign({}, cur, patch));
    const rec = st.firm[FIRM_ID] || { id: FIRM_ID, v: SCHEMA, createdAt: stamp() };
    Object.assign(rec, next);
    st.firm[FIRM_ID] = rec;
    // The firm's own entry in each project directory follows the firm record (published minutes stay as issued).
    for (const p of live(st.projects)) {
      const x = firmParty(p);
      if (x && (x.name !== next.name || x.abbr !== next.short || x.phone !== next.contactPhone || x.email !== next.contactEmail)) {
        x.name = next.name; x.abbr = next.short; x.phone = next.contactPhone; x.email = next.contactEmail; touch(st, 'projects', p);
      }
    }
    return touch(st, 'firm', rec);
  }
  function ensureFirmParty(st, pid) {
    const p = mustProject(st, pid);
    let x = firmParty(p);
    if (x) return x;
    const f = getFirm(st);
    x = p.parties.find((y) => y.kind === 'company' && y.name.toLowerCase() === f.name.toLowerCase());
    if (x) Object.assign(x, { isFirm: true, abbr: x.abbr || f.short }); else {
      x = { id: uid(), name: f.name, kind: 'company', companyId: '', abbr: f.short, title: '', phone: f.contactPhone, email: f.contactEmail, isFirm: true };
      p.parties.push(x);
    }
    touch(st, 'projects', p);
    return x;
  }
  function addOffice(st, o) {
    const name = str(o && o.name).trim(); if (!name) throw new Error('Give the office a name.');
    const f = getFirm(st);
    if (f.offices.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new Error(name + ' is already an office.');
    const off = { id: uid(), name, address1: str(o.address1).trim(), address2: str(o.address2).trim(), phone: str(o.phone).trim() };
    updateFirm(st, { offices: f.offices.concat([off]) });
    return off;
  }
  function updateOffice(st, id, patch) {
    const f = getFirm(st);
    if (!f.offices.some((x) => x.id === id)) throw new Error('That office no longer exists.');
    if ('name' in patch && !str(patch.name).trim()) throw new Error('An office needs a name.');
    return updateFirm(st, { offices: f.offices.map((x) => (x.id === id ? Object.assign({}, x, patch) : x)) });
  }
  function removeOffice(st, id) {
    const f = getFirm(st);
    if (live(st.projects).some((p) => p.officeId === id)) throw new Error('Projects still use this office. Move them to another office first.');
    return updateFirm(st, { offices: f.offices.filter((x) => x.id !== id) });
  }

  /* ---------- state and normalizing ---------- */
  function emptyState() {
    const dirty = {}, base = {};
    for (const c of COLLS) { dirty[c] = {}; base[c] = {}; }
    const st = { v: SCHEMA, dirty, base, conflicts: {} };
    for (const c of COLLS) st[c] = {};
    return st;
  }
  /* True for saved data from the first version of the app (a different shape). */
  function isLegacy(obj) { return !!obj && typeof obj === 'object' && obj.v !== SCHEMA && (!!obj.series || !!obj.items || !!obj.meetings); }
  function normalizeState(st) {
    const out = emptyState();
    if (!st || typeof st !== 'object' || st.v !== SCHEMA) return out;
    for (const c of COLLS) {
      const src = st[c];
      if (src && typeof src === 'object') {
        for (const id of Object.keys(src)) {
          if (!ID_RE.test(id)) continue;
          const r = normalizeRec(c, src[id]);
          if (r && r.id === id) out[c][id] = r;
        }
      }
      const d = st.dirty && st.dirty[c];
      if (d && typeof d === 'object') for (const id of Object.keys(d)) if (out[c][id]) out.dirty[c][id] = 1;
      const b = st.base && st.base[c];
      if (b && typeof b === 'object') for (const id of Object.keys(b)) if (out[c][id] && typeof b[id] === 'number') out.base[c][id] = b[id];
    }
    if (st.conflicts && typeof st.conflicts === 'object') {
      for (const k of Object.keys(st.conflicts)) {
        const [c, id] = k.split('/');
        const rr = st.conflicts[k];
        if (COLLS.includes(c) && out[c][id] && rr && typeof rr === 'object') { const n = normalizeRec(c, rr); if (n) out.conflicts[k] = n; }
      }
    }
    // Meetings saved before settings inheritance: work out which values were set by hand.
    for (const m of Object.values(out.meetings)) inferOverrides(out, m);
    // Drafts saved before carried actions lived in the body get them placed now.
    for (const m of Object.values(out.meetings)) if (!m.deleted && (m.status !== 'published' || m.revising) && placeAll(out, m)) touch(out, 'meetings', m);
    return out;
  }
  const str = (v) => (typeof v === 'string' ? v : '');
  const arr = (v) => (Array.isArray(v) ? v : []);
  const idList = (v) => [...new Set(arr(v).filter((x) => typeof x === 'string' && ID_RE.test(x)))];
  const goodId = (v) => (typeof v === 'string' && ID_RE.test(v) ? v : uid());
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function cleanParties(list) {
    const seen = new Set();
    const out = [];
    for (const p of arr(list)) {
      if (!p || typeof p !== 'object') continue;
      const name = str(p.name).trim();
      const id = goodId(p.id);
      if (!name || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id, name, kind: p.kind === 'company' ? 'company' : 'person', companyId: ID_RE.test(str(p.companyId)) ? p.companyId : '',
        abbr: str(p.abbr).trim(), title: str(p.title).trim(), phone: str(p.phone).trim(), email: str(p.email).trim(), isFirm: p.isFirm === true,
      });
    }
    return out.map((p) => (p.kind === 'company' || out.some((c) => c.id === p.companyId && c.kind === 'company') ? p : Object.assign({}, p, { companyId: '' })));
  }
  function cleanAtts(list) {
    return arr(list).filter((a) => a && typeof a === 'object' && ID_RE.test(str(a.imageId))).map((a) => ({
      id: goodId(a.id), imageId: a.imageId, caption: str(a.caption), layout: LAYOUTS.includes(a.layout) ? a.layout : 'half',
    }));
  }
  function cleanOutcome(o) {
    if (!o || typeof o !== 'object') return null;
    return {
      id: goodId(o.id), type: OUTCOME_TYPES.includes(o.type) ? o.type : 'info', text: str(o.text),
      assigneeIds: idList(o.assigneeIds), due: DATE_RE.test(str(o.due)) ? o.due : '', actionId: ID_RE.test(str(o.actionId)) ? o.actionId : '', atts: cleanAtts(o.atts),
    };
  }
  /* Minutes for a section or the break after it: a whole number, 0 when blank or invalid. */
  function cleanMin(v) { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, 720) : 0; }
  function cleanSections(list) {
    return arr(list).filter((s) => s && typeof s === 'object' && str(s.name).trim()).map((s) => ({
      id: goodId(s.id), name: str(s.name).trim(), dur: cleanMin(s.dur), brk: cleanMin(s.brk),
      topics: arr(s.topics).filter((t) => t && typeof t === 'object' && str(t.text).trim()).map((t) => ({
        id: goodId(t.id), text: str(t.text).trim(), outcomes: arr(t.outcomes).map(cleanOutcome).filter(Boolean), atts: cleanAtts(t.atts), carry: idList(t.carry), carried: t.carried === true,
      })),
    }));
  }
  function cleanTemplate(list) {
    return arr(list).filter((s) => s && typeof s === 'object' && str(s.name).trim()).map((s) => ({
      id: goodId(s.id), name: str(s.name).trim(), topics: arr(s.topics).map(str).map((x) => x.trim()).filter(Boolean), dur: cleanMin(s.dur), brk: cleanMin(s.brk),
    }));
  }
  function cleanAttendees(list) {
    const seen = new Set();
    return arr(list).filter((a) => a && typeof a === 'object' && ID_RE.test(str(a.partyId)) && !seen.has(a.partyId) && seen.add(a.partyId)).map((a) => ({
      partyId: a.partyId,
      // Older records only knew present / not present. A plain "not present" there was never a recorded absence, so it stays unrecorded.
      state: ATT_STATES.includes(a.state) ? a.state : a.present === true ? 'present' : 'unset',
    }));
  }
  const OV_KEYS = ['location', 'time', 'meetingType', 'preparedBy', 'roster', 'next'];
  function cleanOv(o) {
    const out = {};
    if (o && typeof o === 'object') for (const k of OV_KEYS) if (o[k] === true) out[k] = true;
    return out;
  }
  function cleanUpdates(o) {
    const out = {};
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        if (!ID_RE.test(k) || !o[k] || typeof o[k] !== 'object') continue;
        out[k] = {
          note: str(o[k].note), done: o[k].done === true, extendTo: DATE_RE.test(str(o[k].extendTo)) ? o[k].extendTo : '', extendNote: str(o[k].extendNote),
          setStatus: ['open', 'progress'].includes(o[k].setStatus) ? o[k].setStatus : '', cancel: o[k].cancel === true, doneOn: DATE_RE.test(str(o[k].doneOn)) ? o[k].doneOn : '',
        };
      }
    }
    return out;
  }
  /* Accepts a record from storage, a remote store or an import file. Returns null if unusable. */
  function normalizeRec(coll, r) {
    if (!r || typeof r !== 'object' || r.v !== SCHEMA || !ID_RE.test(str(r.id))) return null;
    const base = { id: r.id, v: SCHEMA, updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0, createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0 };
    if (r.deleted === true) base.deleted = true;
    if (coll === 'firm') {
      if (r.deleted === true) return base;
      return Object.assign(base, cleanFirm(r));
    }
    if (coll === 'projects') {
      return Object.assign(base, {
        name: str(r.name), number: str(r.number), ownerNumber: str(r.ownerNumber), fileName: str(r.fileName).slice(0, 200), address: typeof r.address === 'string' ? r.address : str(r.location),
        ownerOrgId: ID_RE.test(str(r.ownerOrgId)) ? r.ownerOrgId : '', officeId: str(r.officeId), parties: cleanParties(r.parties), example: r.example === true,
      });
    }
    if (coll === 'images') {
      const dim = (v) => (Number.isInteger(v) && v > 0 && v < 20000 ? v : 0);
      if (r.deleted === true) return Object.assign(base, { seriesId: str(r.seriesId), data: '', w: 0, h: 0 });
      const d = str(r.data);
      if (d.length > MAX_IMG_CHARS || !IMG_RE.test(d)) return null;
      return Object.assign(base, { seriesId: str(r.seriesId), data: d, w: dim(r.w), h: dim(r.h) });
    }
    if (coll === 'series') {
      return Object.assign(base, {
        projectId: str(r.projectId), name: str(r.name), location: str(r.location), meetingType: str(r.meetingType).trim(), defaultTime: normTime(r.defaultTime),
        durationMin: Number.isInteger(r.durationMin) && r.durationMin > 0 && r.durationMin < 1440 ? r.durationMin : 0,
        cadence: CADENCES.includes(r.cadence) ? r.cadence : 'weekly', template: cleanTemplate(r.template), attendeeIds: idList(r.attendeeIds),
        preparedById: ID_RE.test(str(r.preparedById)) ? r.preparedById : '', startNumber: Number.isInteger(r.startNumber) && r.startNumber > 0 ? r.startNumber : 1,
        carryOpen: r.carryOpen !== false,
      });
    }
    if (coll === 'meetings') {
      let back = null;
      if (r.revBackup && typeof r.revBackup === 'object') {
        back = { date: DATE_RE.test(str(r.revBackup.date)) ? r.revBackup.date : '', time: normTime(r.revBackup.time), location: str(r.revBackup.location),
          meetingType: str(r.revBackup.meetingType), preparedById: ID_RE.test(str(r.revBackup.preparedById)) ? r.revBackup.preparedById : '', ov: r.revBackup.ov && typeof r.revBackup.ov === 'object' ? cleanOv(r.revBackup.ov) : null,
          next: { date: DATE_RE.test(str(r.revBackup.next && r.revBackup.next.date)) ? r.revBackup.next.date : '', time: normTime(r.revBackup.next && r.revBackup.next.time), location: str(r.revBackup.next && r.revBackup.next.location) }, attendees: cleanAttendees(r.revBackup.attendees), sections: cleanSections(r.revBackup.sections), updates: cleanUpdates(r.revBackup.updates) };
      }
      return Object.assign(base, {
        seriesId: str(r.seriesId), number: Number.isInteger(r.number) ? r.number : 0,
        date: DATE_RE.test(str(r.date)) ? r.date : '', time: normTime(r.time), location: str(r.location),
        meetingType: str(r.meetingType).trim(), preparedById: ID_RE.test(str(r.preparedById)) ? r.preparedById : '', ov: r.ov && typeof r.ov === 'object' ? cleanOv(r.ov) : null,
        next: { date: DATE_RE.test(str(r.next && r.next.date)) ? r.next.date : '', time: normTime(r.next && r.next.time), location: str(r.next && r.next.location) },
        status: ['agenda', 'minutes', 'published'].includes(r.status) ? r.status : 'agenda',
        revising: r.revising === true, revNote: str(r.revNote), revBackup: back,
        attendees: cleanAttendees(r.attendees), sections: cleanSections(r.sections), timed: r.timed === true, carried: idList(r.carried), updates: cleanUpdates(r.updates),
      });
    }
    if (coll === 'actions') {
      return Object.assign(base, {
        seriesId: str(r.seriesId), text: str(r.text), assigneeIds: idList(r.assigneeIds),
        due: DATE_RE.test(str(r.due)) ? r.due : '', origDue: DATE_RE.test(str(r.origDue)) ? r.origDue : '',
        status: ACTION_STATUSES.includes(r.status) ? r.status : 'open', seq: Number.isInteger(r.seq) && r.seq > 0 ? r.seq : 0, doneOn: DATE_RE.test(str(r.doneOn)) ? r.doneOn : '', createdIn: str(r.createdIn), ref: str(r.ref), refMeeting: Number.isInteger(r.refMeeting) ? r.refMeeting : 0, secName: str(r.secName), topicText: str(r.topicText),
        doneIn: r.doneIn ? str(r.doneIn) : null, statusIn: str(r.statusIn), doneNote: str(r.doneNote),
        pushes: arr(r.pushes).filter((p) => p && typeof p === 'object').map((p) => ({
          meetingId: str(p.meetingId), number: Number(p.number) || 0, from: DATE_RE.test(str(p.from)) ? p.from : '', to: DATE_RE.test(str(p.to)) ? p.to : '', note: str(p.note), at: Number(p.at) || 0,
        })),
      });
    }
    if (coll === 'snapshots') {
      if (!r.data || typeof r.data !== 'object') return r.deleted === true ? base : null;
      return Object.assign(base, { meetingId: str(r.meetingId), seriesId: str(r.seriesId), rev: Number.isInteger(r.rev) ? r.rev : 0, publishedAt: Number(r.publishedAt) || 0, note: str(r.note), data: clone(r.data) });
    }
    return null;
  }
  function touch(st, coll, rec) {
    rec.updatedAt = stamp();
    st.dirty[coll][rec.id] = 1;
    return rec;
  }
  const live = (map) => Object.values(map).filter((r) => !r.deleted);

  /* ---------- selectors ---------- */
  function listProjects(st) { return live(st.projects).sort((a, b) => a.name.localeCompare(b.name)); }
  function seriesOf(st, pid) { return live(st.series).filter((s) => s.projectId === pid).sort((a, b) => a.name.localeCompare(b.name)); }
  function meetingsOf(st, sid) { return live(st.meetings).filter((m) => m.seriesId === sid).sort((a, b) => b.number - a.number); }
  function actionsOf(st, sid) { return live(st.actions).filter((a) => a.seriesId === sid).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)); }
  function snapshotsOf(st, mid) { return live(st.snapshots).filter((s) => s.meetingId === mid).sort((a, b) => a.rev - b.rev); }
  function draftOf(st, sid) { return meetingsOf(st, sid).find((m) => (m.status === 'agenda' || m.status === 'minutes') && !m.revising) || null; }
  function revisingOf(st, sid) { return meetingsOf(st, sid).find((m) => m.revising) || null; }
  function latestOf(st, sid) { return meetingsOf(st, sid)[0] || null; }
  function isLatest(st, m) { const l = latestOf(st, m.seriesId); return !!l && l.id === m.id; }
  const canEditContent = (m) => m.status === 'agenda' || m.status === 'minutes';
  function projectOfSeries(st, s) { return s ? st.projects[s.projectId] || null : null; }
  function projectOfMeeting(st, m) { return projectOfSeries(st, st.series[m.seriesId]); }
  function party(p, id) { return p ? p.parties.find((x) => x.id === id) || null : null; }
  function partyName(p, id) { const x = party(p, id); return x ? x.name : 'Removed party'; }
  function partyLabel(p, id) {
    const x = party(p, id);
    if (!x) return 'Removed party';
    const c = x.kind === 'person' && x.companyId ? party(p, x.companyId) : null;
    return c ? x.name + ' (' + c.name + ')' : x.name;
  }
  function companiesOf(p) { return p.parties.filter((x) => x.kind === 'company').sort((a, b) => a.name.localeCompare(b.name)); }
  function peopleOf(p, companyId) { return p.parties.filter((x) => x.kind === 'person' && (x.companyId || '') === (companyId || '')).sort((a, b) => a.name.localeCompare(b.name)); }

  function companyOf(p, x) { return x && x.kind === 'person' && x.companyId ? party(p, x.companyId) : null; }
  /* Phone and e-mail fall back from a person to their company. */
  function contactPhone(p, x) { const c = companyOf(p, x); return x ? x.phone || (c && c.phone) || '' : ''; }
  function contactEmail(p, x) { return x ? x.email || '' : ''; }
  function abbrOf(p, x) { const c = x && x.kind === 'company' ? x : companyOf(p, x); return c ? c.abbr || c.name : ''; }
  function firmParty(p) { return p ? p.parties.find((x) => x.isFirm) || null : null; }

  /* ---------- inheritance: firm -> project -> series -> meeting ---------- */
  function inferOverrides(st, m) {
    if (m.ov) return false;
    const s = st.series[m.seriesId];
    const ov = {};
    if (s) {
      if (m.location && m.location !== s.location) ov.location = true;
      if (m.time && s.defaultTime && m.time !== s.defaultTime) ov.time = true;
    }
    m.ov = ov;
    return true;
  }
  function ovOf(st, m) { if (m.ov) return m.ov; const c = Object.assign({}, m, { ov: null }); inferOverrides(st, c); return c.ov; }
  /* The value a meeting actually uses, and where it came from: 'meeting' (set here) or 'series' (inherited). */
  function effective(st, m, key) {
    const s = st.series[m.seriesId] || {};
    const ov = ovOf(st, m);
    const none = () => ({ value: '', from: 'series' });
    if (key === 'location') return ov.location || !s.location ? { value: m.location, from: ov.location ? 'meeting' : 'series' } : { value: s.location, from: 'series' };
    if (key === 'time') return ov.time || !s.defaultTime ? { value: m.time, from: ov.time ? 'meeting' : 'series' } : { value: s.defaultTime, from: 'series' };
    if (key === 'meetingType') return ov.meetingType ? { value: m.meetingType, from: 'meeting' } : { value: s.meetingType || '', from: 'series' };
    if (key === 'preparedBy') return ov.preparedBy ? { value: m.preparedById, from: 'meeting' } : { value: s.preparedById || '', from: 'series' };
    return none();
  }
  function nextMeeting(st, m) {
    const s = st.series[m.seriesId] || { cadence: 'weekly' };
    const ov = ovOf(st, m).next;
    const loc = effective(st, m, 'location').value, time = effective(st, m, 'time').value;
    if (ov) return { date: m.next.date, time: m.next.time || time, location: m.next.location || loc, from: 'meeting' };
    const date = s.cadence === 'none' ? '' : addDaysCad(m.date, s.cadence);
    return { date, time, location: loc, from: 'series' };
  }
  function addDaysCad(prev, cadence) { return !prev ? '' : cadence === 'biweekly' ? addDays(prev, 14) : cadence === 'monthly' ? addMonth(prev) : addDays(prev, 7); }
  function preparedByInfo(st, m) {
    const p = projectOfMeeting(st, m), f = getFirm(st);
    const id = effective(st, m, 'preparedBy').value, x = party(p, id);
    const co = companyOf(p, x);
    return {
      name: x ? x.name : '', title: x ? x.title : '', org: (co && co.name) || (x ? f.name : ''),
      phone: (x && contactPhone(p, x)) || f.contactPhone, email: (x && x.email) || f.contactEmail,
    };
  }

  function mustProject(st, id) { const p = st.projects[id]; if (!p || p.deleted) throw new Error('That project no longer exists.'); return p; }
  function mustSeries(st, id) { const s = st.series[id]; if (!s || s.deleted) throw new Error('That series no longer exists.'); return s; }
  function mustMeeting(st, id) { const m = st.meetings[id]; if (!m || m.deleted) throw new Error('That meeting no longer exists.'); return m; }
  function mustEdit(m) { if (!canEditContent(m)) throw new Error('Published minutes are locked. Revise them to make changes.'); }
  function mustMinutes(m) { mustEdit(m); if (m.status !== 'minutes') throw new Error('Outcomes can be recorded once the meeting has started.'); }
  function mustBeLatest(st, m) { if (!isLatest(st, m)) throw new Error('Later meetings exist, so assignments and action updates are locked here.'); }

  /* ---------- numbering ---------- */
  function letter(i) {
    let n = i + 1, s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  /* Every section keeps its number, in order. An empty one that is left in the meeting prints as "None". */
  function outline(m) {
    let n = 0;
    return m.sections.map((sec) => {
      const no = ++n;
      return {
        sec, no,
        topics: sec.topics.map((t, ti) => {
          const tno = no ? no + '.' + (ti + 1) : '';
          const cr = arr(t.carry), k = cr.length;
          /* Open actions from earlier meetings come first under their topic and share its letter sequence. */
          return {
            t, no: tno,
            carried: cr.map((id, ci) => ({ id, letter: letter(ci), ref: tno ? tno + '.' + letter(ci) : '' })),
            outcomes: t.outcomes.map((o, oi) => ({ o, letter: letter(k + oi), ref: tno ? tno + '.' + letter(k + oi) : '' })),
          };
        }),
      };
    });
  }
  function findOutcome(m, oid) {
    for (const s of outline(m)) for (const t of s.topics) for (const x of t.outcomes) if (x.o.id === oid) return { sec: s.sec, topic: t.t, outcome: x.o, ref: x.ref };
    return null;
  }
  function findTopic(m, tid) {
    for (const sec of m.sections) { const t = sec.topics.find((x) => x.id === tid); if (t) return { sec, topic: t }; }
    return null;
  }
  const blankUpdate = () => ({ note: '', done: false, extendTo: '', extendNote: '', setStatus: '', cancel: false, doneOn: '' });
  function updateOf(m, aid) { return Object.assign(blankUpdate(), m.updates[aid]); }
  /* The due date an action had when this meeting began (before this meeting's own extension). */
  function dueAt(a, m) {
    const before = a.pushes.filter((p) => p.number < m.number);
    return before.length ? before[before.length - 1].to : a.origDue;
  }

  /* Everything the screen and the snapshot need about action items in one meeting. */
  function actionRows(st, m) {
    const refOf = {}, pos = {}; let k = 0;
    for (const s of outline(m)) for (const t of s.topics) {
      for (const c of t.carried) { refOf[c.id] = c.ref; pos[c.id] = k++; }
      for (const x of t.outcomes) pos[x.o.id] = k++;
    }
    const carried = m.carried.map((id) => st.actions[id]).filter((a) => a && !a.deleted).sort((a, b) => (pos[a.id] != null ? pos[a.id] : 1e9) - (pos[b.id] != null ? pos[b.id] : 1e9) || a.createdAt - b.createdAt).map((a) => {
      const u = updateOf(m, a.id);
      const before = dueAt(a, m);
      const progress = u.setStatus ? u.setStatus === 'progress' : a.status === 'progress';
      const state = u.done ? 'done' : u.cancel ? 'canceled' : u.extendTo ? 'extended' : progress ? 'progress' : 'open';
      const due = state === 'extended' ? u.extendTo : before;
      return {
        kind: 'carried', a, u, before, due, state, progress, seq: a.seq, doneOn: u.done ? u.doneOn || m.date : '', ref: refOf[a.id] || '', origRef: a.ref, refMeeting: a.refMeeting, ord: pos[a.id] != null ? pos[a.id] : 1e9, text: a.text, assigneeIds: a.assigneeIds,
        overdue: (state === 'open' || state === 'progress') && !!due && due < m.date, pushes: a.pushes.filter((p) => p.number < m.number).length + (state === 'extended' ? 1 : 0),
      };
    });
    const created = [];
    for (const s of outline(m)) for (const t of s.topics) for (const x of t.outcomes) {
      if (x.o.type !== 'assignment') continue;
      created.push({ kind: 'new', o: x.o, seq: x.o.actionId && st.actions[x.o.actionId] ? st.actions[x.o.actionId].seq : 0, ord: pos[x.o.id], ref: x.ref, text: x.o.text, assigneeIds: x.o.assigneeIds, due: x.o.due, state: 'new', overdue: false, pushes: 0 });
    }
    return { carried, created, all: carried.concat(created).sort((a, b) => a.ord - b.ord) };
  }
  /* Every action in a project across its series, for the project-level register.
     filter: {status: 'active'|'all'|a status, assigneeId, seriesId, overdue: true} */
  function projectActions(st, pid, filter) {
    filter = filter || {};
    const today = todayStr();
    const sids = seriesOf(st, pid).map((s) => s.id);
    const rows = [];
    for (const sid of sids) {
      const s = st.series[sid];
      for (const a of actionsOf(st, sid)) {
        const od = isActive(a) && !!a.due && a.due < today;
        if (filter.seriesId && filter.seriesId !== sid) continue;
        if (filter.assigneeId && !a.assigneeIds.includes(filter.assigneeId)) continue;
        if (filter.overdue && !od) continue;
        const stf = filter.status || 'active';
        if (stf === 'active' ? !isActive(a) : stf !== 'all' && a.status !== stf) continue;
        rows.push({ a, series: s, seriesName: s.name, overdue: od, seq: a.seq, origMeeting: a.refMeeting });
      }
    }
    return rows.sort((x, y) => (x.a.due || '9999') < (y.a.due || '9999') ? -1 : (x.a.due || '9999') > (y.a.due || '9999') ? 1 : x.seriesName.localeCompare(y.seriesName) || x.seq - y.seq);
  }
  function seriesSummary(st, sid) {
    const open = actionsOf(st, sid).filter(isActive);
    const today = todayStr();
    return { latest: latestOf(st, sid), draft: draftOf(st, sid), open: open.length, overdue: open.filter((a) => a.due && a.due < today).length };
  }
  function projectSummary(st, pid) {
    const list = seriesOf(st, pid);
    let open = 0, overdue = 0;
    for (const s of list) { const x = seriesSummary(st, s.id); open += x.open; overdue += x.overdue; }
    return { series: list.length, open, overdue };
  }
  /* Most recent earlier update note for an action, to show as context in the next meeting. */
  function lastUpdate(st, a, m) {
    const ms = meetingsOf(st, m.seriesId).filter((x) => x.number < m.number);
    for (const x of ms) {
      const u = x.updates[a.id];
      if (u && (u.note.trim() || u.extendNote.trim())) return { number: x.number, date: x.date, note: u.note.trim() || u.extendNote.trim() };
    }
    return null;
  }

  /* ---------- projects and directory ---------- */
  function createProject(st, o) {
    const name = str(o && o.name).trim();
    if (!name) throw new Error('Give the project a name.');
    const f = getFirm(st);
    const p = {
      id: ID_RE.test(str(o && o.id)) ? o.id : uid(), v: SCHEMA, name, number: str(o.number).trim(), ownerNumber: str(o.ownerNumber).trim(), fileName: str(o.fileName).trim().slice(0, 200), address: str(o.address != null ? o.address : o.location).trim(),
      ownerOrgId: '', officeId: str(o.officeId) || (f.offices[0] ? f.offices[0].id : ''), parties: [], example: !!o.example, createdAt: stamp(),
    };
    // The firm itself is always in the directory, so "prepared by" and the AN abbreviation work without setup.
    if (!o.example) p.parties.push({ id: uid(), name: f.name, kind: 'company', companyId: '', abbr: f.short, title: '', phone: f.contactPhone, email: f.contactEmail, isFirm: true });
    st.projects[p.id] = p;
    return touch(st, 'projects', p);
  }
  function updateProject(st, pid, patch) {
    const p = mustProject(st, pid);
    if ('name' in patch) { const n = str(patch.name).trim(); if (!n) throw new Error('A project needs a name.'); p.name = n; }
    if ('number' in patch) p.number = str(patch.number).trim();
    if ('ownerNumber' in patch) p.ownerNumber = str(patch.ownerNumber).trim();
    if ('fileName' in patch) p.fileName = str(patch.fileName).slice(0, 200);
    if ('address' in patch) p.address = str(patch.address).replace(/\s+$/g, '');
    if ('location' in patch) p.address = str(patch.location).trim();
    if ('officeId' in patch) { const f = getFirm(st); p.officeId = f.offices.some((o) => o.id === patch.officeId) ? patch.officeId : ''; }
    if ('ownerOrgId' in patch) { const c = party(p, patch.ownerOrgId); p.ownerOrgId = c && c.kind === 'company' ? c.id : ''; }
    return touch(st, 'projects', p);
  }
  function deleteProject(st, pid) {
    mustProject(st, pid);
    for (const s of seriesOf(st, pid)) deleteSeries(st, s.id);
    const p = st.projects[pid]; p.deleted = true; touch(st, 'projects', p);
  }
  const PARTY_TEXT = ['abbr', 'title', 'phone', 'email'];
  function addParty(st, pid, o) {
    const p = mustProject(st, pid);
    const name = str(o && o.name).trim();
    if (!name) throw new Error('Enter a name.');
    const kind = o.kind === 'company' ? 'company' : 'person';
    if (p.parties.some((x) => x.kind === kind && x.name.toLowerCase() === name.toLowerCase())) throw new Error(name + ' is already in this project.');
    let companyId = '';
    if (kind === 'person' && o.companyId) { const c = party(p, o.companyId); if (c && c.kind === 'company') companyId = c.id; }
    const x = { id: uid(), name, kind, companyId, abbr: '', title: '', phone: '', email: '', isFirm: false };
    for (const k of PARTY_TEXT) if (k in o) x[k] = str(o[k]).trim();
    p.parties.push(x); touch(st, 'projects', p);
    return x;
  }
  function updateParty(st, pid, partyId, patch) {
    const p = mustProject(st, pid);
    const x = party(p, partyId);
    if (!x) throw new Error('That entry no longer exists.');
    if ('name' in patch) {
      const n = str(patch.name).trim(); if (!n) throw new Error('A name cannot be blank.');
      if (p.parties.some((y) => y.id !== x.id && y.kind === x.kind && y.name.toLowerCase() === n.toLowerCase())) throw new Error(n + ' is already in this project.');
      x.name = n;
    }
    if ('companyId' in patch && x.kind === 'person') { const c = party(p, patch.companyId); x.companyId = c && c.kind === 'company' ? c.id : ''; }
    for (const k of PARTY_TEXT) if (k in patch) x[k] = str(patch[k]).trim();
    return touch(st, 'projects', p);
  }
  function partyUsage(st, pid, partyId) {
    const sids = new Set(seriesOf(st, pid).map((s) => s.id));
    const open = live(st.actions).filter((a) => sids.has(a.seriesId) && isActive(a) && a.assigneeIds.includes(partyId)).length;
    const drafts = live(st.meetings).filter((m) => sids.has(m.seriesId) && canEditContent(m)).filter((m) => m.sections.some((s) => s.topics.some((t) => t.outcomes.some((o) => o.type === 'assignment' && o.assigneeIds.includes(partyId))))).length;
    return { open, drafts };
  }
  function removeParty(st, pid, partyId) {
    const p = mustProject(st, pid);
    const x = party(p, partyId);
    if (!x) return;
    if (x.kind === 'company' && p.parties.some((y) => y.companyId === partyId)) throw new Error('Remove or move the people at ' + x.name + ' first.');
    const u = partyUsage(st, pid, partyId);
    if (u.open || u.drafts) throw new Error(x.name + ' is responsible for ' + (u.open ? u.open + ' open action' + (u.open === 1 ? '' : 's') : 'assignments in a meeting in progress') + '. Reassign ' + (u.open + u.drafts === 1 ? 'it' : 'them') + ' first.');
    p.parties = p.parties.filter((y) => y.id !== partyId); touch(st, 'projects', p);
    for (const s of seriesOf(st, pid)) {
      if (s.attendeeIds.includes(partyId)) { s.attendeeIds = s.attendeeIds.filter((i) => i !== partyId); touch(st, 'series', s); }
      for (const m of meetingsOf(st, s.id)) {
        if (canEditContent(m) && m.attendees.some((a) => a.partyId === partyId)) { m.attendees = m.attendees.filter((a) => a.partyId !== partyId); touch(st, 'meetings', m); }
      }
    }
  }

  /* ---------- series and template ---------- */
  function defaultTemplate() { return DEFAULT_SECTIONS.map((n) => ({ id: uid(), name: n, topics: [] })); }
  function createSeries(st, pid, o) {
    mustProject(st, pid);
    const name = str(o && o.name).trim();
    if (!name) throw new Error('Give the series a name.');
    const tpl = cleanTemplate(o.template);
    const p = st.projects[pid];
    const s = {
      id: uid(), v: SCHEMA, projectId: pid, name, location: str(o.location).trim(), meetingType: str(o.meetingType).trim(), defaultTime: normTime(o.defaultTime),
      durationMin: Number.isInteger(o.durationMin) && o.durationMin > 0 ? o.durationMin : 0, cadence: CADENCES.includes(o.cadence) ? o.cadence : 'weekly',
      template: tpl.length ? tpl : defaultTemplate(), attendeeIds: idList(o.attendeeIds).filter((i) => party(p, i)),
      preparedById: ID_RE.test(str(o.preparedById)) && party(p, o.preparedById) ? o.preparedById : '', startNumber: Number.isInteger(o.startNumber) && o.startNumber > 0 ? o.startNumber : 1,
      carryOpen: o.carryOpen !== false, createdAt: stamp(),
    };
    st.series[s.id] = s;
    return touch(st, 'series', s);
  }
  /* Draft meetings follow the series for anything they have not overridden. */
  function refreshDrafts(st, s) {
    for (const m of meetingsOf(st, s.id)) {
      if (!(m.status === 'agenda' || m.status === 'minutes') || m.revising) continue;
      const ov = ovOf(st, m);
      if (ov.roster) continue;
      const keep = new Map(m.attendees.map((a) => [a.partyId, a.state]));
      const next = s.attendeeIds.map((id) => ({ partyId: id, state: keep.get(id) || 'unset' }));
      if (JSON.stringify(next) !== JSON.stringify(m.attendees)) { m.attendees = next; touch(st, 'meetings', m); }
    }
  }
  function updateSeries(st, sid, patch) {
    const s = mustSeries(st, sid);
    const p = projectOfSeries(st, s);
    let roster = false;
    if ('name' in patch) { const n = str(patch.name).trim(); if (!n) throw new Error('A series needs a name.'); s.name = n; }
    if ('location' in patch) s.location = str(patch.location).trim();
    if ('meetingType' in patch) s.meetingType = str(patch.meetingType).trim();
    if ('defaultTime' in patch) s.defaultTime = normTime(patch.defaultTime);
    if ('durationMin' in patch) { const d = Number(patch.durationMin); s.durationMin = Number.isInteger(d) && d > 0 && d < 1440 ? d : 0; }
    if ('cadence' in patch && CADENCES.includes(patch.cadence)) s.cadence = patch.cadence;
    if ('carryOpen' in patch) s.carryOpen = !!patch.carryOpen;
    if ('startNumber' in patch) {
      const n = Number(patch.startNumber);
      if (!Number.isInteger(n) || n < 1) throw new Error('The first meeting number must be 1 or more.');
      if (meetingsOf(st, sid).length) throw new Error('The first meeting number can only change before the first meeting exists.');
      s.startNumber = n;
    }
    if ('preparedById' in patch) { s.preparedById = patch.preparedById && party(p, patch.preparedById) ? patch.preparedById : ''; }
    if ('attendeeIds' in patch) { s.attendeeIds = idList(patch.attendeeIds).filter((i) => party(p, i)); roster = true; }
    touch(st, 'series', s);
    if (roster) refreshDrafts(st, s);
    return s;
  }
  function deleteSeries(st, sid) {
    mustSeries(st, sid);
    for (const c of ['meetings', 'actions', 'images', 'snapshots']) {
      for (const r of Object.values(st[c])) if (r.seriesId === sid && !r.deleted) { r.deleted = true; touch(st, c, r); }
    }
    const s = st.series[sid]; s.deleted = true; touch(st, 'series', s);
  }
  function tplSection(s, secId) { const x = s.template.find((t) => t.id === secId); if (!x) throw new Error('That category no longer exists.'); return x; }
  function addTemplateSection(st, sid, name) {
    const s = mustSeries(st, sid);
    const n = str(name).trim();
    if (!n) throw new Error('Enter a category name.');
    if (s.template.some((t) => t.name.toLowerCase() === n.toLowerCase())) throw new Error(n + ' is already a category.');
    s.template.push({ id: uid(), name: n, topics: [] });
    touch(st, 'series', s);
    return s.template[s.template.length - 1];
  }
  function renameTemplateSection(st, sid, secId, name) {
    const s = mustSeries(st, sid); const x = tplSection(s, secId);
    const n = str(name).trim(); if (!n) throw new Error('A category needs a name.');
    x.name = n; return touch(st, 'series', s);
  }
  function setTemplateTopics(st, sid, secId, text) {
    const s = mustSeries(st, sid); const x = tplSection(s, secId);
    x.topics = str(text).split('\n').map((l) => l.trim()).filter(Boolean);
    return touch(st, 'series', s);
  }
  function moveTemplateSection(st, sid, secId, dir) {
    const s = mustSeries(st, sid);
    const i = s.template.findIndex((t) => t.id === secId); if (i < 0) return s;
    const j = i + (dir < 0 ? -1 : 1);
    if (j < 0 || j >= s.template.length) return s;
    const tmp = s.template[i]; s.template[i] = s.template[j]; s.template[j] = tmp;
    return touch(st, 'series', s);
  }
  function removeTemplateSection(st, sid, secId) {
    const s = mustSeries(st, sid);
    s.template = s.template.filter((t) => t.id !== secId);
    return touch(st, 'series', s);
  }

  /* ---------- meetings ---------- */
  function createMeeting(st, sid, o) {
    o = o || {};
    const s = mustSeries(st, sid);
    const ms = meetingsOf(st, sid);
    const draft = draftOf(st, sid);
    if (draft) throw new Error('Meeting ' + draft.number + ' is still open. Publish or delete it before starting the next one.');
    const latest = ms[0] || null;
    if (latest && latest.revising) throw new Error('Finish the revision to Meeting ' + latest.number + ' first.');
    const m = {
      id: uid(), v: SCHEMA, seriesId: sid, number: latest ? latest.number + 1 : s.startNumber || 1,
      date: DATE_RE.test(str(o.date)) ? o.date : nextDate(latest && latest.date, s.cadence),
      time: normTime(o.time) || s.defaultTime || (latest ? latest.time : ''), location: str(o.location) || s.location || (latest ? latest.location : ''),
      meetingType: s.meetingType, preparedById: s.preparedById, ov: {}, next: { date: '', time: '', location: '' },
      status: 'agenda', revising: false, revNote: '', revBackup: null,
      attendees: s.attendeeIds.map((id) => ({ partyId: id, state: 'unset' })),
      sections: s.template.map((t) => ({ id: uid(), name: t.name, dur: t.dur || 0, brk: t.brk || 0, topics: t.topics.map((text) => ({ id: uid(), text, outcomes: [], atts: [], carry: [], carried: false })) })),
      timed: s.template.some((t) => t.dur || t.brk),
      carried: s.carryOpen === false ? [] : actionsOf(st, sid).filter(isActive).map((a) => a.id), updates: {}, createdAt: stamp(),
    };
    if (o.time && normTime(o.time) !== (s.defaultTime || '')) m.ov.time = true;
    if (o.location && str(o.location) !== s.location) m.ov.location = true;
    st.meetings[m.id] = m;
    placeAll(st, m);
    return touch(st, 'meetings', m);
  }
  /* Give every open action from earlier meetings a home in this meeting's discussion items: the category and
     topic it was first raised under (a matching standing topic is reused, otherwise the topic is added). */
  function placeCarried(st, m, a) {
    if (m.sections.some((x) => x.topics.some((t) => arr(t.carry).includes(a.id)))) return false;
    const norm = (x) => str(x).trim().toLowerCase();
    const secName = a.secName || 'General';
    let sec = m.sections.find((x) => norm(x.name) === norm(secName));
    if (!sec) { sec = { id: uid(), name: secName, topics: [] }; m.sections.push(sec); }
    const text = a.topicText || a.text;
    let t = sec.topics.find((x) => norm(x.text) === norm(text));
    if (!t) { t = { id: uid(), text, outcomes: [], atts: [], carry: [], carried: true }; sec.topics.push(t); }
    t.carry = arr(t.carry); t.carry.push(a.id);
    return true;
  }
  function placeAll(st, m) {
    let changed = false;
    const as = m.carried.map((id) => st.actions[id]).filter((a) => a && !a.deleted).sort((a, b) => a.createdAt - b.createdAt);
    for (const a of as) if (placeCarried(st, m, a)) changed = true;
    return changed;
  }
  /* A value equal to what the series would supply is not an override; anything else is. */
  function setMeetingFields(st, mid, patch) {
    const m = mustMeeting(st, mid); mustEdit(m);
    const s = mustSeries(st, m.seriesId);
    m.ov = Object.assign({}, ovOf(st, m));
    if ('date' in patch) { if (!DATE_RE.test(str(patch.date))) throw new Error('Enter the meeting date.'); m.date = patch.date; }
    if ('time' in patch) { m.time = normTime(patch.time); if (m.time !== (s.defaultTime || '') && (s.defaultTime || m.time)) m.ov.time = true; else delete m.ov.time; }
    if ('location' in patch) { m.location = str(patch.location).trim(); if (m.location !== (s.location || '')) m.ov.location = true; else delete m.ov.location; }
    if ('meetingType' in patch) { m.meetingType = str(patch.meetingType).trim(); if (m.meetingType !== (s.meetingType || '')) m.ov.meetingType = true; else delete m.ov.meetingType; }
    if ('preparedById' in patch) {
      const p = projectOfSeries(st, s); const id = patch.preparedById && party(p, patch.preparedById) ? patch.preparedById : '';
      m.preparedById = id; if (id !== (s.preparedById || '')) m.ov.preparedBy = true; else delete m.ov.preparedBy;
    }
    if ('next' in patch) {
      const n = patch.next || {};
      m.next = { date: DATE_RE.test(str(n.date)) ? n.date : '', time: normTime(n.time), location: str(n.location).trim() };
      if (m.next.date || m.next.time || m.next.location) m.ov.next = true; else delete m.ov.next;
    }
    return touch(st, 'meetings', m);
  }
  /* Drop a meeting's own value so it follows the series again. */
  function resetOverride(st, mid, key) {
    const m = mustMeeting(st, mid); mustEdit(m);
    const s = mustSeries(st, m.seriesId);
    m.ov = Object.assign({}, ovOf(st, m));
    if (!OV_KEYS.includes(key)) throw new Error('Unknown setting.');
    delete m.ov[key];
    if (key === 'location') m.location = s.location || m.location;
    if (key === 'time') m.time = s.defaultTime || m.time;
    if (key === 'meetingType') m.meetingType = s.meetingType;
    if (key === 'preparedBy') m.preparedById = s.preparedById;
    if (key === 'next') m.next = { date: '', time: '', location: '' };
    if (key === 'roster') refreshDrafts(st, s);
    return touch(st, 'meetings', m);
  }
  function startMinutes(st, mid) {
    const m = mustMeeting(st, mid);
    if (m.status !== 'agenda') throw new Error('This meeting is already past the agenda stage.');
    m.status = 'minutes';
    return touch(st, 'meetings', m);
  }
  function backToAgenda(st, mid) {
    const m = mustMeeting(st, mid);
    if (m.status !== 'minutes' || m.revising || snapshotsOf(st, mid).length) throw new Error('Only a meeting that has never been published can go back to the agenda.');
    m.status = 'agenda';
    return touch(st, 'meetings', m);
  }
  function deleteDraftMeeting(st, mid) {
    const m = mustMeeting(st, mid);
    if (m.revising || snapshotsOf(st, mid).length || m.status === 'published') throw new Error('Published meetings cannot be deleted.');
    const ids = [...sectionImageIds(m.sections, new Set())];
    m.deleted = true;
    touch(st, 'meetings', m); gcImages(st, ids);
    return m;
  }

  /* ---------- attendees ---------- */
  function addAttendee(st, mid, partyId, toSeries) {
    const m = mustMeeting(st, mid); mustEdit(m);
    const p = projectOfMeeting(st, m);
    if (!party(p, partyId)) throw new Error('Pick someone from the project list.');
    m.ov = Object.assign({}, ovOf(st, m));
    if (!m.attendees.some((a) => a.partyId === partyId)) { m.attendees.push({ partyId, state: 'unset' }); m.ov.roster = true; }
    if (toSeries) { const s = mustSeries(st, m.seriesId); if (!s.attendeeIds.includes(partyId)) { s.attendeeIds.push(partyId); touch(st, 'series', s); delete m.ov.roster; refreshDrafts(st, s); } }
    return touch(st, 'meetings', m);
  }
  function removeAttendee(st, mid, partyId) {
    const m = mustMeeting(st, mid); mustEdit(m);
    m.ov = Object.assign({}, ovOf(st, m));
    m.attendees = m.attendees.filter((a) => a.partyId !== partyId);
    m.ov.roster = true;
    return touch(st, 'meetings', m);
  }
  /* state: 'unset' | 'present' | 'remote' | 'absent'. Leaving someone unmarked never counts as absent. */
  function setAttendance(st, mid, partyId, state) {
    const m = mustMeeting(st, mid); mustEdit(m);
    if (!ATT_STATES.includes(state)) throw new Error('Pick in attendance, via teleconference or not in attendance.');
    const a = m.attendees.find((x) => x.partyId === partyId);
    if (a) a.state = state;
    return touch(st, 'meetings', m);
  }
  /* Sets everyone who has not been recorded yet (or everyone, when onlyUnset is false). */
  function setAllAttendance(st, mid, state, onlyUnset) {
    const m = mustMeeting(st, mid); mustEdit(m);
    if (!ATT_STATES.includes(state)) throw new Error('Unknown attendance state.');
    m.attendees.forEach((a) => { if (!onlyUnset || a.state === 'unset') a.state = state; });
    return touch(st, 'meetings', m);
  }
  const isHere = (a) => a.state === 'present' || a.state === 'remote' || a.present === true;

  /* ---------- agenda: sections and topics ---------- */
  function addSection(st, mid, name) {
    const m = mustMeeting(st, mid); mustEdit(m);
    const n = str(name).trim(); if (!n) throw new Error('Enter a category name.');
    if (m.sections.some((s) => s.name.toLowerCase() === n.toLowerCase())) throw new Error(n + ' is already on this agenda.');
    const sec = { id: uid(), name: n, dur: 0, brk: 0, topics: [] };
    m.sections.push(sec); touch(st, 'meetings', m);
    return sec;
  }
  /* Planned minutes for a section, and the break after it. Clock times are never stored; schedule() works them out from the start time. */
  function setSectionTiming(st, mid, secId, patch) {
    const m = mustMeeting(st, mid); mustEdit(m);
    const sec = m.sections.find((x) => x.id === secId);
    if (!sec) throw new Error('That category no longer exists.');
    if ('dur' in patch) sec.dur = cleanMin(patch.dur);
    if ('brk' in patch) sec.brk = cleanMin(patch.brk);
    return touch(st, 'meetings', m);
  }
  function fmtRange(a, b, fmt) {
    let x = fmtTime(a, fmt), y = fmtTime(b, fmt);
    const mx = / (AM|PM)$/.exec(x), my = / (AM|PM)$/.exec(y);
    if (mx && my && mx[1] === my[1]) x = x.slice(0, -3);
    return '[' + x + ' - ' + y + ']';
  }
  /* Printed times per section, only when the meeting is timed. A break is printed after the last section that appears in the document at or before it. */
  function sectionTiming(st, m) {
    const out = new Map();
    if (!m.timed) return out;
    const fmt = getFirm(st).timeFormat, sc = schedule(st, m), shown = new Set(m.sections.map((x) => x.id));
    let last = null;
    m.sections.forEach((sec, i) => {
      const r = sc.rows[i];
      if (shown.has(sec.id)) { last = { time: r.start ? fmtRange(r.start, r.end, fmt) : '', breaks: [] }; out.set(sec.id, last); }
      if (r.brk && last) last.breaks.push({ mins: r.brk, time: r.brkStart ? fmtRange(r.brkStart, r.brkEnd, fmt) : '' });
    });
    return out;
  }
  function setTimed(st, mid, on) {
    const m = mustMeeting(st, mid); mustEdit(m);
    m.timed = !!on; return touch(st, 'meetings', m);
  }
  function setTemplateTiming(st, sid, secId, patch) {
    const s = mustSeries(st, sid); const t = tplSection(s, secId);
    if ('dur' in patch) t.dur = cleanMin(patch.dur);
    if ('brk' in patch) t.brk = cleanMin(patch.brk);
    return touch(st, 'series', s);
  }
  const toHM = (mins) => { const t = ((mins % 1440) + 1440) % 1440; return pad(Math.floor(t / 60)) + ':' + pad(t % 60); };
  /* Clock times for each category from the meeting start time. A break counts only between two categories, so one after the last is ignored. */
  function schedule(st, m) {
    const start = normTime(effective(st, m, 'time').value);
    const mm = /^(\d{2}):(\d{2})$/.exec(start);
    let t = mm ? Number(mm[1]) * 60 + Number(mm[2]) : 0;
    const rows = []; let total = 0, any = false;
    m.sections.forEach((sec, i) => {
      const dur = sec.dur || 0, brk = i < m.sections.length - 1 ? (sec.brk || 0) : 0;
      if (dur || brk) any = true;
      const row = { id: sec.id, dur, brk, start: mm && dur ? toHM(t) : '', end: mm && dur ? toHM(t + dur) : '', brkStart: '', brkEnd: '' };
      t += dur; total += dur;
      if (brk) { row.brkStart = mm ? toHM(t) : ''; row.brkEnd = mm ? toHM(t + brk) : ''; t += brk; total += brk; }
      rows.push(row);
    });
    return { startOk: !!mm, start: mm ? start : '', end: mm && total ? toHM(t) : '', total, any, rows };
  }
  function removeSection(st, mid, secId) {
    const m = mustMeeting(st, mid); mustEdit(m);
    const sec = m.sections.find((s) => s.id === secId);
    if (!sec) return m;
    if (sec.topics.length) throw new Error('Remove the topics in ' + sec.name + ' first.');
    m.sections = m.sections.filter((s) => s.id !== secId);
    return touch(st, 'meetings', m);
  }
  function addTopic(st, mid, secId, text) {
    const m = mustMeeting(st, mid); mustEdit(m);
    const sec = m.sections.find((s) => s.id === secId); if (!sec) throw new Error('That category is not on this agenda.');
    const t = str(text).trim(); if (!t) throw new Error('Type the discussion item first.');
    const topic = { id: uid(), text: t, outcomes: [], atts: [], carry: [], carried: false };
    sec.topics.push(topic); touch(st, 'meetings', m);
    return topic;
  }
  function setTopicText(st, mid, tid, text) {
    const m = mustMeeting(st, mid); mustEdit(m);
    const f = findTopic(m, tid); if (!f) throw new Error('That topic no longer exists.');
    const t = str(text).trim(); if (!t) throw new Error('A topic cannot be blank. Remove it instead.');
    f.topic.text = t; return touch(st, 'meetings', m);
  }
  function removeTopic(st, mid, tid) {
    const m = mustMeeting(st, mid); mustEdit(m);
    const f = findTopic(m, tid); if (!f) return m;
    if (arr(f.topic.carry).length) throw new Error('This item holds open action items from earlier meetings. Mark them done or give them a new due date instead of removing it.');
    if (f.topic.outcomes.some((o) => o.type === 'assignment')) mustBeLatest(st, m);
    const ids = [...sectionImageIds([{ topics: [f.topic] }], new Set())];
    f.sec.topics = f.sec.topics.filter((t) => t.id !== tid);
    touch(st, 'meetings', m); gcImages(st, ids);
    return m;
  }

  /* Reordering renumbers the draft. References on published minutes are frozen and do not change. */
  function moveSection(st, mid, secId, dir) {
    const m = mustMeeting(st, mid); mustEdit(m);
    const i = m.sections.findIndex((x) => x.id === secId); if (i < 0) throw new Error('That category is not on this agenda.');
    const j = i + (dir < 0 ? -1 : 1);
    if (j < 0 || j >= m.sections.length) return m;
    const t = m.sections[i]; m.sections[i] = m.sections[j]; m.sections[j] = t;
    return touch(st, 'meetings', m);
  }
  /* dir -1 / +1 moves within the category and continues into the neighbouring category at its ends.
     toSecId (optional) moves the topic to the end of another category instead. */
  function moveTopic(st, mid, tid, dir, toSecId) {
    const m = mustMeeting(st, mid); mustEdit(m);
    const f = findTopic(m, tid); if (!f) throw new Error('That topic no longer exists.');
    const from = f.sec, i = from.topics.indexOf(f.topic);
    if (toSecId) {
      const to = m.sections.find((x) => x.id === toSecId); if (!to) throw new Error('That category is not on this agenda.');
      if (to === from) return m;
      from.topics.splice(i, 1); to.topics.push(f.topic);
      return touch(st, 'meetings', m);
    }
    const j = i + (dir < 0 ? -1 : 1);
    if (j >= 0 && j < from.topics.length) { const t = from.topics[i]; from.topics[i] = from.topics[j]; from.topics[j] = t; return touch(st, 'meetings', m); }
    const si = m.sections.indexOf(from), ni = si + (dir < 0 ? -1 : 1);
    if (ni < 0 || ni >= m.sections.length) return m;
    from.topics.splice(i, 1);
    if (dir < 0) m.sections[ni].topics.push(f.topic); else m.sections[ni].topics.unshift(f.topic);
    return touch(st, 'meetings', m);
  }

  /* ---------- attachments (images pasted into topics and outcomes) ---------- */
  function sectionImageIds(sections, into) {
    for (const sec of sections) for (const t of sec.topics) {
      t.atts.forEach((a) => into.add(a.imageId));
      for (const o of t.outcomes) o.atts.forEach((a) => into.add(a.imageId));
    }
    return into;
  }
  /* Retire images that nothing refers to any more. Published snapshots and a pending revision's backup still count. */
  function gcImages(st, ids) {
    if (!ids.length) return;
    const used = new Set();
    for (const m of live(st.meetings)) { sectionImageIds(m.sections, used); if (m.revBackup) sectionImageIds(m.revBackup.sections, used); }
    for (const sn of live(st.snapshots)) for (const a of arr(sn.data.attachments)) used.add(a.imageId);
    for (const id of ids) {
      const im = st.images[id];
      if (im && !im.deleted && !used.has(id)) { im.deleted = true; im.data = ''; touch(st, 'images', im); }
    }
  }
  /* Every attachment in a meeting, numbered in reading order: Att. 1, Att. 2... */
  function listAtts(m) {
    const out = []; let n = 0;
    for (const s of outline(m)) for (const t of s.topics) {
      for (const a of t.t.atts) out.push({ att: a, no: ++n, ref: t.no, list: t.t.atts });
      for (const y of t.outcomes) for (const a of y.o.atts) out.push({ att: a, no: ++n, ref: y.ref, list: y.o.atts });
    }
    return out;
  }
  function attTarget(m, kind, id) {
    if (kind === 'topic') { const f = findTopic(m, id); return f ? f.topic : null; }
    if (kind === 'outcome') { const f = findOutcome(m, id); return f ? f.outcome : null; }
    return null;
  }
  /* img: {data: 'data:image/jpeg;base64,...', w, h}, already resized by the page. */
  function addAttachment(st, mid, kind, id, img) {
    const m = mustMeeting(st, mid); mustEdit(m);
    const target = attTarget(m, kind, id); if (!target) throw new Error('That item no longer exists.');
    const data = str(img && img.data);
    if (!IMG_RE.test(data) || data.length > MAX_IMG_CHARS) throw new Error('That image could not be stored. Try a smaller one.');
    const rec = { id: uid(), v: SCHEMA, seriesId: m.seriesId, data, w: Number(img.w) || 0, h: Number(img.h) || 0, createdAt: stamp() };
    st.images[rec.id] = rec; touch(st, 'images', rec);
    const att = { id: uid(), imageId: rec.id, caption: '', layout: 'half' };
    target.atts.push(att); touch(st, 'meetings', m);
    return att;
  }
  function setAttachment(st, mid, attId, patch) {
    const m = mustMeeting(st, mid); mustEdit(m);
    const f = listAtts(m).find((x) => x.att.id === attId); if (!f) throw new Error('That attachment no longer exists.');
    if ('caption' in patch) f.att.caption = str(patch.caption);
    if ('layout' in patch) { if (!LAYOUTS.includes(patch.layout)) throw new Error('Pick half width, full width or attachment page.'); f.att.layout = patch.layout; }
    return touch(st, 'meetings', m);
  }
  function removeAttachment(st, mid, attId) {
    const m = mustMeeting(st, mid); mustEdit(m);
    const f = listAtts(m).find((x) => x.att.id === attId); if (!f) return m;
    f.list.splice(f.list.indexOf(f.att), 1);
    touch(st, 'meetings', m); gcImages(st, [f.att.imageId]);
    return m;
  }

  /* ---------- minutes: outcomes and action updates ---------- */
  function addOutcome(st, mid, tid, type) {
    const m = mustMeeting(st, mid); mustMinutes(m);
    if (!OUTCOME_TYPES.includes(type)) throw new Error('Pick Decision, Assignment or Information.');
    if (type === 'assignment') mustBeLatest(st, m);
    const f = findTopic(m, tid); if (!f) throw new Error('That topic no longer exists.');
    const o = { id: uid(), type, text: '', assigneeIds: [], due: '', actionId: '', atts: [] };
    f.topic.outcomes.push(o); touch(st, 'meetings', m);
    return o;
  }
  function setOutcome(st, mid, oid, patch) {
    const m = mustMeeting(st, mid); mustMinutes(m);
    const f = findOutcome(m, oid); if (!f) throw new Error('That outcome no longer exists.');
    const o = f.outcome;
    const wasA = o.type === 'assignment';
    if ('type' in patch) {
      if (!OUTCOME_TYPES.includes(patch.type)) throw new Error('Pick Decision, Assignment or Information.');
      if (wasA || patch.type === 'assignment') mustBeLatest(st, m);
      o.type = patch.type;
      if (o.type !== 'assignment') o.actionId = '';
    }
    if ((wasA || o.type === 'assignment') && ('text' in patch || 'due' in patch || 'assigneeIds' in patch)) mustBeLatest(st, m);
    if ('text' in patch) o.text = str(patch.text);
    if ('due' in patch) { const d = str(patch.due); if (d && !DATE_RE.test(d)) throw new Error('Enter the due date as a date.'); o.due = d; }
    if ('assigneeIds' in patch) { const p = projectOfMeeting(st, m); o.assigneeIds = idList(patch.assigneeIds).filter((i) => party(p, i)); }
    return touch(st, 'meetings', m);
  }
  function toggleAssignee(st, mid, oid, partyId, on) {
    const m = mustMeeting(st, mid);
    const f = findOutcome(m, oid); if (!f) throw new Error('That outcome no longer exists.');
    const ids = f.outcome.assigneeIds.filter((i) => i !== partyId);
    if (on) ids.push(partyId);
    return setOutcome(st, mid, oid, { assigneeIds: ids });
  }
  function removeOutcome(st, mid, oid) {
    const m = mustMeeting(st, mid); mustMinutes(m);
    const f = findOutcome(m, oid); if (!f) return m;
    if (f.outcome.type === 'assignment') mustBeLatest(st, m);
    const ids = f.outcome.atts.map((a) => a.imageId);
    for (const sec of m.sections) for (const t of sec.topics) t.outcomes = t.outcomes.filter((o) => o.id !== oid);
    touch(st, 'meetings', m); gcImages(st, ids);
    return m;
  }
  function setUpdate(st, mid, aid, patch) {
    const m = mustMeeting(st, mid); mustMinutes(m);
    if (!m.carried.includes(aid)) throw new Error('That action is not part of this meeting.');
    const u = updateOf(m, aid);
    if (['done', 'extendTo', 'extendNote', 'cancel', 'setStatus', 'doneOn'].some((k) => k in patch)) mustBeLatest(st, m);
    if ('note' in patch) u.note = str(patch.note);
    if ('extendNote' in patch) u.extendNote = str(patch.extendNote);
    if ('extendTo' in patch) { const d = str(patch.extendTo); if (d && !DATE_RE.test(d)) throw new Error('Enter the new due date as a date.'); u.extendTo = d; if (d) { u.done = false; u.cancel = false; u.doneOn = ''; } }
    if ('setStatus' in patch) u.setStatus = ['open', 'progress'].includes(patch.setStatus) ? patch.setStatus : '';
    if ('done' in patch) { u.done = !!patch.done; if (u.done) { u.extendTo = ''; u.extendNote = ''; u.cancel = false; } else u.doneOn = ''; }
    if ('cancel' in patch) { u.cancel = !!patch.cancel; if (u.cancel) { u.extendTo = ''; u.extendNote = ''; u.done = false; u.doneOn = ''; } }
    if ('doneOn' in patch) { const d = str(patch.doneOn); if (d && !DATE_RE.test(d)) throw new Error('Enter the completion date as a date.'); u.doneOn = u.done ? d : ''; }
    if (!u.note && !u.done && !u.extendTo && !u.extendNote && !u.setStatus && !u.cancel) delete m.updates[aid]; else m.updates[aid] = u;
    return touch(st, 'meetings', m);
  }
  function reopenAction(st, aid) {
    const a = st.actions[aid]; if (!a || a.deleted) throw new Error('That action no longer exists.');
    if (a.status !== 'done' && a.status !== 'canceled') return a;
    const rev = revisingOf(st, a.seriesId);
    if (rev) throw new Error('Finish the revision to Meeting ' + rev.number + ' first.');
    a.status = 'open'; a.doneIn = null; a.doneNote = ''; a.doneOn = '';
    touch(st, 'actions', a);
    const d = draftOf(st, a.seriesId);
    if (d && !d.carried.includes(aid)) { d.carried.push(aid); placeCarried(st, d, a); touch(st, 'meetings', d); }
    return a;
  }

  /* ---------- publish and revise ---------- */
  /* Problems found before publishing. Each item says what is wrong and where to fix it:
     target {kind: 'outcome'|'topic'|'action'|'attendance'|'details'|'project', id}. blockers / warnings are the plain messages. */
  function publishIssues(st, m) {
    const items = [];
    const B = (msg, target) => items.push({ level: 'blocker', msg, target: target || null });
    const W = (msg, target) => items.push({ level: 'warning', msg, target: target || null });
    const p = projectOfMeeting(st, m), f = getFirm(st), RF = (x) => fmtRef(x, f.refStyle);
    let bare = 0, firstBare = null;
    for (const s of outline(m)) for (const t of s.topics) {
      if (!t.outcomes.length) { bare++; if (!firstBare) firstBare = t.t.id; }
      for (const x of t.outcomes) {
        const at = { kind: 'outcome', id: x.o.id };
        if (!x.o.text.trim()) B(RF(x.ref) + ' has an empty ' + TYPE_LABEL[x.o.type].toLowerCase() + '. Fill it in or remove it.', at);
        if (x.o.type === 'assignment') {
          if (!x.o.assigneeIds.length) B(RF(x.ref) + ' needs a responsible party.', at);
          if (!DATE_RE.test(x.o.due)) B(RF(x.ref) + ' needs a due date.', at);
          else if (x.o.assigneeIds.some((i) => !party(p, i))) B(RF(x.ref) + ' names someone who was removed from the project.', at);
        }
      }
    }
    const rows = actionRows(st, m);
    let quiet = 0, firstQuiet = null;
    for (const r of rows.carried) {
      const lbl = r.ref ? RF(r.ref) : (r.refMeeting ? 'Meeting ' + r.refMeeting + ' ' : '') + RF(r.origRef);
      const at = { kind: 'action', id: r.a.id };
      if (r.state === 'canceled' && !r.u.note.trim()) B('Action ' + lbl + ' is canceled but has no note saying why.', at);
      if (r.state === 'done' && r.doneOn && r.doneOn > m.date) B('Action ' + lbl + ' has a completion date after the meeting date.', at);
      if (r.state === 'extended') {
        if (!r.u.extendNote.trim()) B('Action ' + lbl + ' has a new due date but no note on why it moved.', at);
        if (r.u.extendTo <= r.before) B('Action ' + lbl + ': the new due date must be after ' + fmtShort(r.before) + '.', at);
      } else if ((r.state === 'open' || r.state === 'progress') && r.overdue && !r.u.note.trim()) { quiet++; if (!firstQuiet) firstQuiet = r.a.id; }
    }
    if (!DATE_RE.test(m.date)) B('The meeting needs a date.', { kind: 'details', id: 'date' });
    if (bare) W(bare + ' discussion item' + (bare === 1 ? ' has' : 's have') + ' no outcome.', { kind: 'topic', id: firstBare });
    if (quiet) W(quiet + ' overdue action' + (quiet === 1 ? ' has' : 's have') + ' no update.', { kind: 'action', id: firstQuiet });
    const unset = m.attendees.filter((a) => a.state === 'unset').length;
    const attT = { kind: 'attendance', id: '' };
    if (!m.attendees.length) W('No participants are listed.', attT);
    else if (!m.attendees.some(isHere)) W(unset === m.attendees.length ? 'Attendance has not been recorded.' : 'No one is marked as attending.', attT);
    else if (unset) W(unset + ' participant' + (unset === 1 ? ' has' : 's have') + ' no attendance recorded. They will print without a mark, not as absent.', attT);
    const D = (id) => ({ kind: 'details', id });
    if (!effective(st, m, 'location').value.trim()) W('No meeting location is set.', D('location'));
    if (!effective(st, m, 'time').value.trim()) W('No meeting time is set.', D('time'));
    if (!effective(st, m, 'meetingType').value.trim()) W('No meeting type is set.', D('meetingType'));
    if (!effective(st, m, 'preparedBy').value) W('No one is named as the preparer.', D('preparedBy'));
    if (!nextMeeting(st, m).date) W('No next meeting date is set. The minutes will not show a next meeting.', D('next'));
    if (p) {
      if (!p.address.trim()) W('The project has no address.', { kind: 'project', id: 'address' });
      if (!p.number.trim()) W("The architect's project number is empty.", { kind: 'project', id: 'number' });
      if (!p.ownerNumber.trim()) W("The owner's project number is empty.", { kind: 'project', id: 'ownerNumber' });
    }
    if (!f.correctionNotice.trim()) W('The firm correction notice is empty, so the minutes will print without it.', null);
    return { blockers: items.filter((x) => x.level === 'blocker').map((x) => x.msg), warnings: items.filter((x) => x.level === 'warning').map((x) => x.msg), items };
  }
  /* Human-readable action number within a series. Assigned once and never reused or renumbered. */
  function nextSeq(st, sid) { return Object.values(st.actions).filter((a) => a.seriesId === sid).reduce((n, a) => Math.max(n, a.seq || 0), 0) + 1; }
  /* Create or update the persistent action items for this meeting's assignments. */
  function syncActions(st, m) {
    const used = new Set();
    for (const s of outline(m)) for (const t of s.topics) for (const x of t.outcomes) {
      const o = x.o;
      if (o.type !== 'assignment') { o.actionId = ''; continue; }
      let a = o.actionId ? st.actions[o.actionId] : null;
      if (!a || a.deleted) {
        a = { id: uid(), v: SCHEMA, seriesId: m.seriesId, text: '', assigneeIds: [], due: '', origDue: '', status: 'open', seq: nextSeq(st, m.seriesId), doneOn: '', createdIn: m.id, ref: '', refMeeting: m.number, doneIn: null, doneNote: '', pushes: [], createdAt: stamp() };
        st.actions[a.id] = a; o.actionId = a.id;
      }
      a.text = o.text.trim(); a.assigneeIds = o.assigneeIds.slice(); a.ref = x.ref; a.refMeeting = m.number; a.origDue = o.due; a.secName = s.sec.name; a.topicText = t.t.text;
      a.due = a.pushes.length ? a.pushes[a.pushes.length - 1].to : o.due;
      used.add(a.id); touch(st, 'actions', a);
    }
    for (const a of live(st.actions)) if (a.createdIn === m.id && !used.has(a.id)) { a.deleted = true; touch(st, 'actions', a); }
  }
  /* Apply this meeting's done / extend decisions to the carried actions. Safe to run again after a revision. */
  function applyUpdates(st, m) {
    for (const id of m.carried) {
      const a = st.actions[id]; if (!a || a.deleted) continue;
      const u = updateOf(m, id);
      a.pushes = a.pushes.filter((p) => p.meetingId !== m.id);
      if (a.doneIn === m.id) { a.statusIn = ''; a.status = 'open'; a.doneIn = null; a.doneNote = ''; a.doneOn = ''; }
      if (u.done) { a.status = 'done'; a.doneIn = m.id; a.doneNote = u.note.trim(); a.doneOn = u.doneOn || m.date; }
      else if (u.cancel) { a.status = 'canceled'; a.doneIn = m.id; a.doneNote = u.note.trim(); a.doneOn = ''; }
      else {
        if (u.extendTo) {
          const from = a.pushes.length ? a.pushes[a.pushes.length - 1].to : a.origDue;
          a.pushes.push({ meetingId: m.id, number: m.number, from, to: u.extendTo, note: u.extendNote.trim(), at: stamp() });
        }
        if (u.setStatus) { a.status = u.setStatus; a.statusIn = m.id; } else if (a.statusIn === m.id) { a.status = 'open'; a.statusIn = ''; }
      }
      a.due = a.pushes.length ? a.pushes[a.pushes.length - 1].to : a.origDue;
      touch(st, 'actions', a);
    }
  }
  const pad3 = (n) => String(n).padStart(3, '0');
  const normKey = (x) => str(x).trim().toLowerCase().replace(/\s+/g, ' ');
  /* "001.02": the section number and the topic number within it, the legacy Issue # form. */
  function issueNo(tno) {
    const m = /^(\d+)\.(\d+)$/.exec(tno || '');
    return m ? pad3(Number(m[1])) + '.' + pad(Number(m[2])) : tno || '';
  }
  /* '1.2.B' -> '001.02.B'. Anything that is not a topic reference is returned as is. */
  function fmtRef(ref, style) {
    if (style === 'plain') return ref || '';
    const m = /^(\d+)\.(\d+)(?:\.([A-Z]+))?$/.exec(ref || '');
    return m ? pad3(Number(m[1])) + '.' + pad(Number(m[2])) + (m[3] ? '.' + m[3] : '') : ref || '';
  }
  function docIdOf(firm, number, rev) { return (firm.docIdPrefix ? firm.docIdPrefix + ' ' : '') + pad3(number) + '.' + pad(rev + 1); }
  function rosterOf(st, m, p) {
    return m.attendees.map((a) => {
      const x = party(p, a.partyId); const c = companyOf(p, x);
      return {
        name: x ? x.name : 'Removed party', title: x ? x.title : '', company: c ? c.name : x && x.kind === 'company' ? x.name : '', abbr: abbrOf(p, x),
        phone: contactPhone(p, x), email: contactEmail(p, x), state: a.state || 'unset',
      };
    });
  }
  /* Earlier decisions and information recorded under a topic with the same category and title, oldest first. */
  function topicHistory(st, m) {
    const prior = meetingsOf(st, m.seriesId).filter((x) => x.number < m.number && x.status === 'published').sort((a, b) => a.number - b.number);
    const idx = new Map();
    for (const pm of prior) {
      const sn = snapshotsOf(st, pm.id).slice(-1)[0]; if (!sn) continue;
      for (const sec of arr(sn.data.sections)) for (const t of arr(sec.topics)) {
        const items = arr(t.outcomes).filter((o) => o.type !== 'assignment' && o.text);
        if (!items.length) continue;
        const k = normKey(sec.name) + '|' + normKey(t.text);
        if (!idx.has(k)) idx.set(k, []);
        idx.get(k).push({ meetingNo: pm.number, date: sn.data.header.date, items: items.map((o) => ({ type: o.type, text: o.text })) });
      }
    }
    return (secName, text) => (idx.get(normKey(secName) + '|' + normKey(text)) || []).slice(-8);
  }
  function docBlock(st, m, p, s, rev, kind, stampMs) {
    const f = getFirm(st);
    const yr = f.copyrightYear || String(new Date(stampMs || clock()).getFullYear());
    const off = f.offices.find((o) => o.id === (p && p.officeId)) || null;
    const owner = p && p.ownerOrgId ? party(p, p.ownerOrgId) : null;
    return {
      kind, docId: kind === 'minutes' ? docIdOf(f, m.number, rev) : docIdOf(f, m.number, 0),
      firm: { name: f.name, short: f.short, web: f.web, offices: clone(f.offices), docType: kind === 'agenda' ? 'Meeting Agenda' : f.docType, formVersion: f.formVersion, copyright: '\u00a9 ' + yr + (f.copyrightHolder ? ' ' + f.copyrightHolder : ''), timeFormat: f.timeFormat, refStyle: f.refStyle },
      project: { name: p ? p.name : '', address: p ? p.address : '', number: p ? p.number : '', ownerNumber: p ? p.ownerNumber : '', ownerOrg: owner ? owner.name : '', officeName: off ? off.name : '' },
      meetingType: effective(st, m, 'meetingType').value, preparedBy: preparedByInfo(st, m), notice: f.correctionNotice, next: nextMeeting(st, m),
    };
  }
  function buildSnapshot(st, m, opts) {
    opts = opts || {};
    const s = mustSeries(st, m.seriesId), p = projectOfSeries(st, s);
    const L = (id) => partyLabel(p, id);
    const attList = listAtts(m);
    const attInfo = (a) => {
      const f = attList.find((x) => x.att.id === a.id), im = st.images[a.imageId];
      return { no: f ? f.no : 0, imageId: a.imageId, caption: a.caption.trim(), layout: a.layout, w: im ? im.w : 0, h: im ? im.h : 0 };
    };
    const rows = actionRows(st, m);
    const abbrs = (ids) => ids.map((i) => { const x = party(p, i); return x ? abbrOf(p, x) || x.name : 'Removed party'; });
    const toRow = (r) => ({
      ref: r.ref, fromMeeting: r.kind === 'carried' ? r.refMeeting : 0, fromRef: r.kind === 'carried' ? r.origRef : '', fromDate: r.kind === 'carried' && st.meetings[r.a.createdIn] ? st.meetings[r.a.createdIn].date : '', seq: r.seq || 0, text: r.text, who: r.assigneeIds.map(L), whoAbbr: abbrs(r.assigneeIds), due: r.due, before: r.kind === 'carried' ? r.before : '',
      state: r.state, overdue: r.overdue, pushes: r.pushes, doneOn: r.doneOn || '', note: r.kind === 'carried' ? r.u.note.trim() : '', pushNote: r.kind === 'carried' && r.state === 'extended' ? r.u.extendNote.trim() : '',
    });
    const carriedRow = (cid, letterV) => { const r = rows.carried.find((x) => x.a.id === cid); return r ? Object.assign({ letter: letterV }, toRow(r)) : null; };
    const actions = rows.all.map(toRow);
    const hist = topicHistory(st, m);
    const tm = sectionTiming(st, m);
    const sections = outline(m).map((x) => ({
      no: x.no, name: x.sec.name, time: (tm.get(x.sec.id) || {}).time || '', breaks: (tm.get(x.sec.id) || {}).breaks || [],
      topics: x.topics.map((t) => ({
        no: t.no, issue: issueNo(t.no), text: t.t.text, atts: t.t.atts.map(attInfo), carried: t.carried.map((c) => carriedRow(c.id, c.letter)).filter(Boolean), history: hist(x.sec.name, t.t.text),
        outcomes: t.outcomes.map((y) => ({ letter: y.letter, ref: y.ref, type: y.o.type, text: y.o.text.trim(), who: y.o.type === 'assignment' ? y.o.assigneeIds.map(L) : [], whoAbbr: y.o.type === 'assignment' ? abbrs(y.o.assigneeIds) : [], due: y.o.type === 'assignment' ? y.o.due : '', seq: y.o.type === 'assignment' && y.o.actionId && st.actions[y.o.actionId] ? st.actions[y.o.actionId].seq : 0, atts: y.o.atts.map(attInfo) })),
      })),
    }));
    const attachments = attList.map((x) => Object.assign(attInfo(x.att), { ref: x.ref }));
    const count = (type) => sections.reduce((n, sec) => n + sec.topics.reduce((k, t) => k + t.outcomes.filter((o) => o.type === type).length, 0), 0);
    const roster = rosterOf(st, m, p);
    const hdrTime = effective(st, m, 'time').value, hdrLoc = effective(st, m, 'location').value;
    return {
      header: {
        project: p ? p.name : '', projectNumber: p ? p.number : '', series: s.name, location: hdrLoc, number: m.number, date: m.date, time: hdrTime,
        meetingType: effective(st, m, 'meetingType').value, projectAddress: p ? p.address : '', ownerNumber: p ? p.ownerNumber : '',
      },
      doc: docBlock(st, m, p, s, opts.rev || 0, 'minutes', opts.at),
      attendees: roster.map((a) => Object.assign({ present: a.state === 'present' || a.state === 'remote' }, a)),
      sections, actions, attachments,
      counts: {
        topics: sections.reduce((n, sec) => n + sec.topics.length, 0), decisions: count('decision'), assignments: count('assignment'), info: count('info'),
        carried: rows.carried.length, done: rows.carried.filter((r) => r.state === 'done').length, canceled: rows.carried.filter((r) => r.state === 'canceled').length, extended: rows.carried.filter((r) => r.state === 'extended').length,
        overdue: rows.carried.filter((r) => r.overdue).length, open: actions.filter((r) => r.state !== 'done' && r.state !== 'canceled').length,
        present: roster.filter((a) => a.state === 'present' || a.state === 'remote').length, remote: roster.filter((a) => a.state === 'remote').length,
        absent: roster.filter((a) => a.state === 'absent').length, unrecorded: roster.filter((a) => a.state === 'unset').length, invited: m.attendees.length, attachments: attachments.length,
      },
    };
  }
  /* The agenda as a document: same shape as a snapshot so one PDF builder serves both. Not stored. */
  function buildAgendaDoc(st, m) {
    const d = buildSnapshot(st, m, { rev: 0 });
    d.doc.kind = 'agenda'; d.doc.firm.docType = 'Meeting Agenda'; d.doc.notice = '';
    for (const sec of d.sections) for (const t of sec.topics) { t.outcomes = []; t.history = []; }
    d.sections = d.sections.filter((sec) => sec.topics.length);
    d.actions = []; d.counts.decisions = d.counts.assignments = d.counts.info = 0;
    return { data: d, rev: 0, publishedAt: 0, kind: 'agenda' };
  }
  /* The minutes as they read right now, in the shape of an issued snapshot but marked as a draft. Not stored. */
  function buildDraft(st, m) {
    const rev = snapshotsOf(st, m.id).length;
    const d = buildSnapshot(st, m, { rev });
    d.doc.kind = 'draft';
    return { data: d, rev, publishedAt: 0, kind: 'draft' };
  }
  function publish(st, mid) {
    const m = mustMeeting(st, mid);
    if (m.status !== 'minutes') throw new Error(m.status === 'agenda' ? 'Start the meeting before publishing minutes.' : 'These minutes are already published.');
    const issues = publishIssues(st, m);
    if (issues.blockers.length) throw new Error('Fix ' + issues.blockers.length + ' thing' + (issues.blockers.length === 1 ? '' : 's') + ' before publishing: ' + issues.blockers[0]);
    const latest = isLatest(st, m);
    syncActions(st, m);
    if (latest) applyUpdates(st, m);
    const rev = snapshotsOf(st, mid).length;
    const snap = { id: uid(), v: SCHEMA, meetingId: mid, seriesId: m.seriesId, rev, publishedAt: stamp(), note: rev > 0 ? m.revNote : '', data: null, createdAt: 0 };
    snap.data = clone(buildSnapshot(st, m, { rev, at: snap.publishedAt }));
    snap.createdAt = snap.publishedAt;
    st.snapshots[snap.id] = snap; touch(st, 'snapshots', snap);
    m.status = 'published'; m.revising = false; m.revNote = ''; m.revBackup = null;
    touch(st, 'meetings', m);
    return snap;
  }
  function reviseMeeting(st, mid, reason) {
    const m = mustMeeting(st, mid);
    if (m.status !== 'published') throw new Error('Only published minutes can be revised.');
    const r = str(reason).trim();
    if (!r) throw new Error('Say what is being corrected. It goes in the revision table.');
    const other = revisingOf(st, m.seriesId);
    if (other) throw new Error('Meeting ' + other.number + ' is already being revised.');
    placeAll(st, m);
    m.revBackup = clone({ date: m.date, time: m.time, location: m.location, meetingType: m.meetingType, preparedById: m.preparedById, ov: ovOf(st, m), next: m.next, attendees: m.attendees, sections: m.sections, updates: m.updates });
    m.status = 'minutes'; m.revising = true; m.revNote = r;
    return touch(st, 'meetings', m);
  }
  /* Put the meeting back exactly as it was when the revision began. */
  function cancelRevision(st, mid) {
    const m = mustMeeting(st, mid);
    if (!m.revising) throw new Error('This meeting is not being revised.');
    const b = m.revBackup;
    if (!b) throw new Error('The original copy is missing, so this revision cannot be cancelled. Publish it instead.');
    const ids = [...sectionImageIds(m.sections, new Set())];
    m.date = b.date; m.time = b.time; m.location = b.location; m.meetingType = b.meetingType; m.preparedById = b.preparedById; m.ov = clone(b.ov); m.next = clone(b.next); m.attendees = clone(b.attendees); m.sections = clone(b.sections); m.updates = clone(b.updates);
    m.status = 'published'; m.revising = false; m.revNote = ''; m.revBackup = null;
    touch(st, 'meetings', m); gcImages(st, ids);
    return m;
  }

  /* ---------- sync merge ---------- */
  function validRemote(coll, id, r) {
    if (!ID_RE.test(id)) return null;
    const n = normalizeRec(coll, Object.assign({}, r, { id }));
    if (!n) return null;
    if (!n.deleted) {
      if (coll === 'projects' && !n.name) return null;
      if (coll === 'series' && (!n.name || !n.projectId)) return null;
      if (coll === 'meetings' && !n.seriesId) return null;
      if (coll === 'actions' && (!n.seriesId || !n.text)) return null;
      if (coll === 'images' && !n.seriesId) return null;
    }
    return n;
  }
  /* remote: {coll: {id: record}}. A collection missing from remote is skipped.
     fromRemote=false (an import file) marks adopted records as needing upload, newest copy wins.
     fromRemote=true never overwrites a record that has unsent local edits when someone else has changed it
     since this device last synced it: that goes to st.conflicts and waits for a person to choose. */
  function mergeRemote(st, remote, fromRemote) {
    let pulled = 0, queued = 0, conflicts = 0;
    for (const c of COLLS) {
      const rm = remote[c];
      if (!rm) continue;
      for (const id of Object.keys(rm)) {
        const r = validRemote(c, id, rm[id]);
        if (!r) continue;
        const l = st[c][id];
        const adopt = () => { st[c][id] = r; pulled++; if (fromRemote) { delete st.dirty[c][id]; st.base[c][id] = r.updatedAt; delete st.conflicts[c + '/' + id]; } else st.dirty[c][id] = 1; };
        if (!l) { adopt(); continue; }
        if (!fromRemote) {
          if (r.updatedAt > l.updatedAt) adopt(); else if (l.updatedAt > r.updatedAt) { st.dirty[c][id] = 1; queued++; }
          continue;
        }
        if (!st.dirty[c][id]) {
          if (r.updatedAt > l.updatedAt) adopt(); else if (r.updatedAt === l.updatedAt) st.base[c][id] = r.updatedAt;
          continue;
        }
        const base = st.base[c][id];
        if (r.updatedAt === l.updatedAt) { delete st.dirty[c][id]; st.base[c][id] = r.updatedAt; delete st.conflicts[c + '/' + id]; }
        else if (base !== undefined ? r.updatedAt <= base : l.updatedAt > r.updatedAt) { queued++; delete st.conflicts[c + '/' + id]; }
        else { st.conflicts[c + '/' + id] = r; conflicts++; }
      }
      if (fromRemote) for (const id of Object.keys(st[c])) if (!(id in rm) && !st.conflicts[c + '/' + id]) { st.dirty[c][id] = 1; queued++; }
    }
    return { pulled, queued, conflicts };
  }
  /* Called with the current remote copy (or null) just before a record is written. */
  function checkPush(st, c, id, remote) {
    const rec = st[c][id];
    if (!rec) return 'skip';
    if (st.conflicts[c + '/' + id]) return 'conflict';
    const r = remote ? validRemote(c, id, remote) : null;
    if (!r || r.updatedAt === rec.updatedAt) return 'ok';
    const base = st.base[c][id];
    if (base !== undefined ? r.updatedAt <= base : rec.updatedAt > r.updatedAt) return 'ok';
    st.conflicts[c + '/' + id] = r;
    return 'conflict';
  }
  function markPushed(st, c, id, sent) {
    if (st[c][id] && st[c][id].updatedAt === sent) delete st.dirty[c][id];
    st.base[c][id] = sent;
  }
  function conflictList(st) {
    return Object.keys(st.conflicts).map((k) => {
      const [c, id] = k.split('/');
      return { key: k, coll: c, id, mine: st[c][id], theirs: st.conflicts[k] };
    }).filter((x) => x.mine);
  }
  /* choice 'mine' keeps the local record and makes it the newest; 'theirs' takes the other person's copy. */
  function resolveConflict(st, c, id, choice) {
    const key = c + '/' + id, theirs = st.conflicts[key], mine = st[c][id];
    if (!theirs || !mine) { delete st.conflicts[key]; return null; }
    delete st.conflicts[key];
    if (choice === 'theirs') {
      st[c][id] = clone(theirs); delete st.dirty[c][id]; st.base[c][id] = theirs.updatedAt;
      return st[c][id];
    }
    st.base[c][id] = theirs.updatedAt;
    mine.updatedAt = Math.max(stamp(), theirs.updatedAt + 1); lastStamp = Math.max(lastStamp, mine.updatedAt);
    st.dirty[c][id] = 1;
    return mine;
  }
  function dirtyCount(st) { return COLLS.reduce((n, c) => n + Object.keys(st.dirty[c]).length, 0); }
  function exportBackup(st) {
    const out = { app: 'nexus-minutes', v: SCHEMA, exportedAt: new Date(clock()).toISOString() };
    for (const c of COLLS) out[c] = st[c];
    return JSON.stringify(out, null, 1);
  }
  function parseBackup(text) {
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new Error('That file is not a Nexus Minutes backup.'); }
    if (!j || j.app !== 'nexus-minutes') throw new Error('That file is not a Nexus Minutes backup.');
    if (j.v !== SCHEMA) throw new Error('That backup is from the first version of the app, which stored meetings differently. It cannot be imported.');
    const out = {};
    for (const c of COLLS) out[c] = j[c] && typeof j[c] === 'object' ? j[c] : {};
    return out;
  }

  /* ---------- text and html output ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const STATE_LABEL = { new: 'New', open: 'Open', progress: 'In progress', done: 'Completed', canceled: 'Canceled', extended: 'Extended' };
  function wasLine(r, ref) { return r.state === 'extended' ? 'was ' + fmtDue(r.before, ref) + (r.pushes > 1 ? ', moved ' + r.pushes + ' times' : '') : r.state === 'open' && r.pushes ? 'moved ' + r.pushes + (r.pushes === 1 ? ' time' : ' times') : ''; }

  /* Snapshots issued before attendance had states only knew present / not present, and published that as is. */
  const snapState = (a) => a.state || (a.present ? 'present' : 'absent');
  function attGroups(list) {
    const g = { present: [], remote: [], absent: [], unset: [] };
    for (const a of list) g[snapState(a)].push(a);
    return g;
  }
  const attLine = (a) => 'Att. ' + a.no + (a.caption ? ': ' + a.caption : '') + (a.layout === 'page' ? ' (attachment page)' : '');
  /* Minutes published before carried actions moved into the body have no fromRef: their table shows the
     original reference ("M1 1.2.A") instead of a number in this meeting. */
  function refParts(r, style) {
    const f = (x) => fmtRef(x, style);
    if (r.fromMeeting && r.fromRef === undefined) return { ref: 'M' + r.fromMeeting + ' ' + f(r.ref), from: '' };
    return { ref: f(r.ref), from: r.fromMeeting ? 'from M' + r.fromMeeting + ' · ' + f(r.fromRef) : '' };
  }
  const styleOf = (d) => (d && d.doc && d.doc.firm && d.doc.firm.refStyle) || 'plain';
  /* An open action from an earlier meeting, shown in the body under the topic where it lives. */
  function carriedText(r, ref, style) {
    const was = wasLine(r, ref);
    const out = ['     ' + r.letter + '. CARRIED (' + (r.fromMeeting ? 'from Meeting ' + r.fromMeeting + ', ' + fmtRef(r.fromRef, style) : 'open') + '): ' + r.text + ' — ' + (r.who.join(', ') || 'no one assigned') + ', due ' + fmtDue(r.due, ref) + (was ? ' (' + was + ')' : '') + ' [' + STATE_LABEL[r.state].toUpperCase() + ']' + (r.overdue ? ' OVERDUE' : '')];
    if (r.pushNote) out.push('        Why it moved: ' + r.pushNote);
    if (r.note) out.push('        Update: ' + r.note);
    return out;
  }
  function snapshotToText(snap, revs) {
    const d = snap.data, h = d.header, L = [], sty = styleOf(d), RF = (x) => fmtRef(x, sty);
    L.push((h.series + ' | Meeting ' + h.number + ' | Rev ' + snap.rev).toUpperCase());
    if (h.project) L.push('Project: ' + h.project + (h.projectNumber ? ' (' + h.projectNumber + ')' : ''));
    L.push('Date: ' + fmtDate(h.date) + (h.time ? ', ' + h.time : '') + (h.location ? ' | ' + h.location : ''));
    const nm = (a) => a.name + (a.company ? ' (' + a.company + ')' : '');
    const g = attGroups(d.attendees);
    L.push('In attendance: ' + (g.present.map(nm).join(', ') || 'none recorded'));
    if (g.remote.length) L.push('Via teleconference: ' + g.remote.map(nm).join(', '));
    if (g.absent.length) L.push('Not in attendance: ' + g.absent.map(nm).join(', '));
    if (g.unset.length) L.push('Attendance not recorded: ' + g.unset.map(nm).join(', '));
    L.push('');
    for (const sec of d.sections) {
      L.push(sec.no + '. ' + sec.name.toUpperCase() + (sec.time ? '  ' + sec.time : ''));
      if (!sec.topics.length) L.push('     None');
      for (const t of sec.topics) {
        L.push(RF(t.no) + '  ' + t.text);
        for (const a of arr(t.atts)) L.push('     ' + attLine(a));
        for (const r of arr(t.carried)) L.push(...carriedText(r, h.date, sty));
        for (const o of t.outcomes) {
          L.push('     ' + o.letter + '. ' + TYPE_LABEL[o.type].toUpperCase() + ': ' + o.text + (o.type === 'assignment' ? ' — ' + o.who.join(', ') + ', due ' + fmtDue(o.due, h.date) : ''));
          for (const a of arr(o.atts)) L.push('        ' + attLine(a));
        }
      }
      for (const bk of arr(sec.breaks)) L.push('     Break: ' + bk.mins + ' min ' + bk.time);
      L.push('');
    }
    L.push('ACTION ITEMS');
    if (!d.actions.length) L.push('None.');
    for (const r of d.actions) {
      const was = wasLine(r, h.date);
      L.push(refParts(r, sty).ref + '  ' + r.text + ' | ' + r.who.join(', ') + ' | Due ' + fmtDue(r.due, h.date) + (was ? ' (' + was + ')' : '') + ' | ' + STATE_LABEL[r.state].toUpperCase());
      if (refParts(r, sty).from) L.push('     First raised Meeting ' + r.fromMeeting + ', item ' + RF(r.fromRef));
    }
    L.push('');
    if (arr(d.attachments).length) {
      L.push('ATTACHMENTS');
      for (const a of d.attachments) L.push('Att. ' + a.no + '  ' + RF(a.ref) + '  ' + (a.caption || '(no caption)') + (a.layout === 'page' ? '  [full page]' : ''));
      L.push('');
    }
    if (revs && revs.length > 1) {
      L.push('REVISIONS');
      for (const r of revs) L.push('Rev ' + r.rev + ' | ' + fmtStamp(r.publishedAt) + ' | ' + (r.rev === 0 ? 'Initial issue' : r.note));
    }
    return L.join('\n').trim() + '\n';
  }
  function agendaToText(st, m) {
    const s = mustSeries(st, m.seriesId), p = projectOfSeries(st, s), L = [], RF = (x) => fmtRef(x, getFirm(st).refStyle);
    const tm = sectionTiming(st, m);
    L.push((s.name + ' | Meeting ' + m.number + ' | Agenda').toUpperCase());
    if (p) L.push('Project: ' + p.name + (p.number ? ' (' + p.number + ')' : ''));
    L.push('Date: ' + fmtDate(m.date) + (m.time ? ', ' + m.time : '') + (m.location ? ' | ' + m.location : ''));
    if (m.attendees.length) L.push('Invited: ' + m.attendees.map((a) => partyLabel(p, a.partyId)).join(', '));
    L.push('');
    const rows = actionRows(st, m).carried;
    for (const x of outline(m)) {
      if (!x.topics.length) continue;
      L.push(x.no + '. ' + x.sec.name.toUpperCase() + ((tm.get(x.sec.id) || {}).time ? '  ' + tm.get(x.sec.id).time : ''));
      for (const t of x.topics) {
        L.push(RF(t.no) + '  ' + t.t.text);
        for (const c of t.carried) {
          const r = rows.find((y) => y.a.id === c.id); if (!r) continue;
          const was = wasLine(r, m.date);
          L.push('     ' + c.letter + '. OPEN ACTION (from Meeting ' + r.refMeeting + ', ' + RF(r.origRef) + '): ' + r.text + ' | ' + r.assigneeIds.map((i) => partyLabel(p, i)).join(', ') + ' | Due ' + fmtDue(r.due, m.date) + (was ? ' (' + was + ')' : '') + (r.overdue ? ' | OVERDUE' : ''));
        }
      }
      for (const bk of arr((tm.get(x.sec.id) || {}).breaks)) L.push('     Break: ' + bk.mins + ' min ' + bk.time);
      L.push('');
    }
    return L.join('\n').trim() + '\n';
  }
  function figHTML(a, imgSrc) {
    if (a.layout === 'page') return '<p class="seeatt">See Att. ' + a.no + (a.caption ? ' \u2014 ' + esc(a.caption) : '') + ' (attachment page)</p>';
    const src = imgSrc ? imgSrc(a.imageId) : '';
    return '<figure class="fig fig-' + a.layout + '">' + (src ? '<img src="' + src + '" alt="' + esc(a.caption || 'Attachment ' + a.no) + '">' : '<div class="fig-miss">Image not available on this device yet</div>') +
      '<figcaption><b>Att. ' + a.no + '</b>' + (a.caption ? ' ' + esc(a.caption) : '') + '</figcaption></figure>';
  }
  /* imgSrc(imageId) returns a data URL or ''. Images live in their own records, not in the snapshot. */
  function snapshotToHtml(snap, revs, imgSrc) {
    const d = snap.data, h = d.header, sty = styleOf(d), RF = (x) => fmtRef(x, sty);
    const cell = (l, v, cls) => '<div class="tb-c' + (cls ? ' ' + cls : '') + '"><span class="tb-l">' + esc(l) + '</span><span class="tb-v">' + (v === '' ? '&nbsp;' : esc(v)) + '</span></div>';
    let o = '<article class="sheet">';
    o += '<header class="tb">' + cell('Project', (h.project || '') + (h.projectNumber ? ' · ' + h.projectNumber : ''), 'tb-p') + cell('Series', h.series, 'tb-s') + cell('Rev', String(snap.rev), 'tb-rev') +
      cell('Meeting No.', String(h.number)) + cell('Date', fmtDate(h.date, { month: 'short', day: 'numeric', year: 'numeric' }) + (h.time ? ', ' + h.time : ''), 'tb-d') +
      cell('Location', h.location || '') + '</header>';
    const nm = (a) => esc(a.name) + (a.company ? ' <span class="muted">(' + esc(a.company) + ')</span>' : '');
    const g = attGroups(d.attendees);
    o += '<section class="sh-att"><p><b>In attendance</b> ' + (g.present.length ? g.present.map(nm).join(' · ') : '<span class="muted">none recorded</span>') + '</p>' +
      (g.remote.length ? '<p><b>Via teleconference</b> ' + g.remote.map(nm).join(' · ') + '</p>' : '') + (g.absent.length ? '<p><b>Not in attendance</b> ' + g.absent.map(nm).join(' · ') + '</p>' : '') +
      (g.unset.length ? '<p><b>Not recorded</b> ' + g.unset.map(nm).join(' · ') + '</p>' : '') + '</section>';
    const c = d.counts;
    o += '<p class="sh-sum"><b>' + c.decisions + '</b> decision' + (c.decisions === 1 ? '' : 's') + ' · <b>' + c.assignments + '</b> new assignment' + (c.assignments === 1 ? '' : 's') + ' · <b>' + c.open + '</b> open action' + (c.open === 1 ? '' : 's') +
      (c.done ? ' · <b>' + c.done + '</b> done' : '') + (c.extended ? ' · <b>' + c.extended + '</b> extended' : '') + (c.overdue ? ' · <b class="od">' + c.overdue + ' overdue</b>' : '') + '</p>';
    for (const sec of d.sections) {
      o += '<section class="sh-sec"><h3><span class="sn">' + esc(sec.no) + '</span>' + esc(sec.name) + (sec.time ? ' <span class="stime">' + esc(sec.time) + '</span>' : '') + '</h3>';
      if (!sec.topics.length) o += '<p class="sh-none">None</p>';
      for (const t of sec.topics) {
        o += '<div class="tp"><div class="tp-no">' + esc(RF(t.no)) + '</div><div class="tp-body"><div class="tp-text">' + esc(t.text) + '</div>' + arr(t.atts).map((a) => figHTML(a, imgSrc)).join('');
        for (const r of arr(t.carried)) {
          const was = wasLine(r, h.date);
          o += '<div class="oc oc-carried a-' + r.state + '"><span class="oc-l">' + esc(r.letter) + '</span><span class="ty ty-carried">Carried</span><div class="oc-b"><div class="oc-t">' + esc(r.text) + '</div>' +
            '<div class="oc-m">' + esc(r.who.join(', ') || 'No one assigned') + ' · due ' + esc(fmtDue(r.due, h.date)) + (was ? ' (' + esc(was) + ')' : '') + (r.overdue ? ' · <b class="od">overdue</b>' : '') + ' · <b class="st-' + r.state + '">' + STATE_LABEL[r.state] + '</b>' + (r.fromMeeting ? ' · first raised Meeting ' + r.fromMeeting + ', ' + esc(RF(r.fromRef)) : '') + '</div>' +
            (r.pushNote ? '<div class="a-note"><b>Why it moved</b> ' + esc(r.pushNote) + '</div>' : '') + (r.note ? '<div class="a-note"><b>Update</b> ' + esc(r.note) + '</div>' : '') + '</div></div>';
        }
        for (const x of t.outcomes) {
          o += '<div class="oc"><span class="oc-l">' + esc(x.letter) + '</span><span class="ty ty-' + x.type + '">' + esc(TYPE_LABEL[x.type]) + '</span><div class="oc-b"><div class="oc-t">' + esc(x.text) + '</div>' +
            (x.type === 'assignment' ? '<div class="oc-m">' + esc(x.who.join(', ')) + ' · due ' + esc(fmtDue(x.due, h.date)) + '</div>' : '') + arr(x.atts).map((a) => figHTML(a, imgSrc)).join('') + '</div></div>';
        }
        o += '</div></div>';
      }
      for (const bk of arr(sec.breaks)) o += '<p class="sh-brk"><b>Break</b> ' + esc(bk.mins) + ' min ' + esc(bk.time) + '</p>';
      o += '</section>';
    }
    if (!d.sections.length) o += '<p class="sh-empty muted">No discussion items were recorded.</p>';
    o += '<section class="sh-acts"><h3>Action items</h3>';
    if (d.actions.length) {
      o += '<div class="ahead"><span>Ref</span><span>Action</span><span>Responsible</span><span>Due</span><span>Status</span></div>';
      for (const r of d.actions) {
        const was = wasLine(r, h.date);
        o += '<div class="arow a-' + r.state + '"><div class="a-ref">' + esc(refParts(r, sty).ref) + (refParts(r, sty).from ? '<small>' + esc(refParts(r, sty).from) + '</small>' : '') + '</div><div class="a-main"><div class="a-text">' + esc(r.text) + '</div>' +
          (r.pushNote ? '<div class="a-note"><b>Why it moved</b> ' + esc(r.pushNote) + '</div>' : '') + (r.note ? '<div class="a-note"><b>Update</b> ' + esc(r.note) + '</div>' : '') + '</div>' +
          '<div class="a-meta"><div class="a-who">' + (r.who.length ? esc(r.who.join(', ')) : '<span class="muted">—</span>') + '</div>' +
          '<div class="a-due' + (r.overdue ? ' od' : '') + '">' + esc(fmtDue(r.due, h.date)) + (was ? '<small>' + esc(was) + '</small>' : '') + (r.overdue ? '<small>overdue</small>' : '') + '</div>' +
          '<div class="a-st st-' + r.state + '">' + STATE_LABEL[r.state] + '</div></div></div>';
      }
    } else o += '<p class="muted sh-empty">No open action items.</p>';
    o += '</section>';
    const pages = arr(d.attachments).filter((a) => a.layout === 'page');
    if (pages.length) {
      o += '<section class="sh-attp"><h3>Attachments</h3>';
      for (const a of pages) {
        const src = imgSrc ? imgSrc(a.imageId) : '';
        o += '<figure class="fig-page"><div class="fp-h"><b>Att. ' + a.no + '</b><span>' + esc(RF(a.ref)) + '</span></div>' + (src ? '<img src="' + src + '" alt="' + esc(a.caption || 'Attachment ' + a.no) + '">' : '<div class="fig-miss">Image not available on this device yet</div>') + (a.caption ? '<figcaption>' + esc(a.caption) + '</figcaption>' : '') + '</figure>';
      }
      o += '</section>';
    }
    if (revs && revs.length) {
      o += '<section class="sh-revs"><h3>Revisions</h3>';
      for (const r of revs) o += '<div class="rrow"><span class="r-n">Rev ' + r.rev + '</span><span class="r-d">' + esc(fmtStamp(r.publishedAt)) + '</span><span class="r-t">' + (r.rev === 0 ? 'Initial issue' : esc(r.note)) + '</span></div>';
      o += '</section>';
    }
    return o + '</article>';
  }
  function exportDocument(snap, revs, css, imgSrc) {
    const h = snap.data.header, lt = '<';
    return [lt + '!doctype html>', lt + 'html lang="en">', lt + 'head>', lt + 'meta charset="utf-8">', lt + 'meta name="viewport" content="width=device-width,initial-scale=1">',
      lt + 'title>' + esc(h.series + ' Meeting ' + h.number + ' Rev ' + snap.rev) + lt + '/title>', lt + 'style>' + css + lt + '/style>', lt + '/head>',
      lt + 'body class="export">', snapshotToHtml(snap, revs, imgSrc), lt + '/body>', lt + '/html>'].join('');
  }
  function fileSlug(snap) {
    const h = snap.data.header;
    return (h.series + ' meeting ' + h.number + ' rev ' + snap.rev).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  /* File names: a pattern with {date} {project} {series} {number} {doc} {rev}. Default reads
     "2026-10-10 Project Name Series Name Minutes". Revisions add " Rev N"; agendas and drafts say so. */
  const FILE_DEFAULT = '{date} {project} {series} {doc}';
  function fileName(pattern, snap, ext) {
    const h = snap.data.header, kind = (snap.data.doc && snap.data.doc.kind) || snap.kind || 'minutes';
    const rev = snap.rev || 0;
    const doc = kind === 'agenda' ? 'Agenda' : kind === 'draft' ? 'Minutes DRAFT' : 'Minutes' + (rev > 0 ? ' Rev ' + rev : '');
    const vals = { date: h.date || '', project: h.project || '', series: h.series || '', number: h.number || '', doc, rev: String(rev) };
    let out = String(pattern && pattern.trim() ? pattern : FILE_DEFAULT).replace(/\{(\w+)\}/g, (all, k) => (k.toLowerCase() in vals ? vals[k.toLowerCase()] : all));
    out = out.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '').slice(0, 150).trim();
    return (out || 'Minutes') + (ext ? '.' + ext : '');
  }

  /* One Markdown file for a whole series, written so an AI can answer "when / what was decided" questions.
     Every outcome line carries its own full context tag (series, meeting, date, section, item) so it still
     makes sense when a search tool returns it alone. Latest issued revision of each meeting; an agenda only
     when that meeting never became minutes. */
  function seriesExport(st, sid, opts) {
    const s = mustSeries(st, sid), p = projectOfSeries(st, s);
    const ms = meetingsOf(st, sid).slice().sort((a, b) => a.number - b.number || (a.date < b.date ? -1 : 1));
    const docs = [];
    for (const m of ms) {
      const snaps = snapshotsOf(st, m.id);
      if (snaps.length) { const sn = snaps[snaps.length - 1]; docs.push({ m, snap: sn, kind: 'minutes', label: 'MINUTES (issued Rev ' + sn.rev + ')' }); }
      else if (m.status === 'minutes') docs.push({ m, snap: buildDraft(st, m), kind: 'draft', label: 'MINUTES, DRAFT (not yet issued)' });
      else if (m.status === 'agenda') docs.push({ m, snap: buildAgendaDoc(st, m), kind: 'agenda', label: 'AGENDA ONLY (no minutes for this meeting)' });
    }
    const iso = (x) => x || 'no date';
    const one = (x) => String(x == null ? '' : x).replace(/\s*\n\s*/g, ' ').trim();
    const nm = (a) => a.name + (a.company ? ' (' + a.company + ')' : '');
    const O = [];
    O.push('# ' + s.name + (p ? ' — ' + p.name : '') + ': meeting record');
    O.push('');
    O.push('Exported ' + todayStr() + '. Series: ' + s.name + '. ' + (p ? 'Project: ' + p.name + (p.number ? ' (' + p.number + ')' : '') + '. ' : '') + 'Meetings included: ' + docs.length + '.');
    O.push('');
    const howFrom = O.length;
    O.push('## How to use this file');
    O.push('- Meetings are in order, oldest first. Dates are YYYY-MM-DD.');
    O.push('- Each meeting is a "## MEETING n" section, then "### Section" (a category such as SITE), then "#### Item" (a discussion topic).');
    O.push('- Every line that records a decision, assignment, information, agenda item or carried action starts with a context tag: [Series | Meeting n | date | section | item]. Quote that tag when you answer, so the reader can find the source.');
    O.push('- DECISION = something decided. ASSIGNMENT = a new action item given to a person with a due date. INFORMATION = noted, no action. CARRIED ACTION = an open action from an earlier meeting, with its status and update at that meeting.');
    O.push('- Item letters like 3.1.B mean section 3, topic 1, outcome B. The final "Action item ledger" gives the current status of every action in the series.');
    O.push('- Meetings marked AGENDA ONLY were planned but have no minutes. DRAFT minutes are not yet issued and may change.');
    O.push('');
    const howto = O.splice(howFrom, O.length - howFrom);
    if (!(opts && opts.part)) O.push(...howto);
    O.push('## Contents');
    for (const d of docs) O.push('- Meeting ' + d.m.number + ' | ' + iso(d.snap.data.header.date) + ' | ' + d.label);
    O.push('');
    for (const d of docs) {
      const dat = d.snap.data, h = dat.header, sty = styleOf(dat), RF = (x) => fmtRef(x, sty), agenda = d.kind === 'agenda';
      const tag = (secNo, secName, ref) => '[' + s.name + ' | Meeting ' + h.number + ' | ' + iso(h.date) + (secName ? ' | Section ' + secNo + ' ' + secName : '') + (ref ? ' | Item ' + RF(ref) : '') + ']';
      O.push('---');
      O.push('');
      O.push('## MEETING ' + h.number + ' — ' + iso(h.date) + ' — ' + d.label);
      O.push('Series: ' + s.name + (h.project ? ' | Project: ' + h.project : '') + ' | Date: ' + iso(h.date) + (h.time ? ' ' + h.time : '') + (h.location ? ' | Location: ' + h.location : '') + (h.meetingType ? ' | Type: ' + h.meetingType : ''));
      if (!agenda) {
        const g = attGroups(dat.attendees);
        O.push('Present: ' + (g.present.map(nm).join('; ') || 'none recorded') + (g.remote.length ? ' | Via teleconference: ' + g.remote.map(nm).join('; ') : '') + (g.absent.length ? ' | Not in attendance: ' + g.absent.map(nm).join('; ') : '') + (g.unset.length ? ' | Attendance not recorded: ' + g.unset.map(nm).join('; ') : ''));
      } else O.push('Invited: ' + (dat.attendees.map(nm).join('; ') || 'none listed'));
      O.push('');
      for (const sec of dat.sections) {
        O.push('### Section ' + sec.no + ': ' + sec.name + (sec.time ? ' ' + sec.time : ''));
        if (!sec.topics.length) O.push('None.');
        for (const t of sec.topics) {
          O.push('#### Item ' + RF(t.no) + ': ' + one(t.text));
          O.push('- ' + tag(sec.no, sec.name, t.no) + (agenda ? ' AGENDA ITEM: ' : ' DISCUSSION TOPIC: ') + one(t.text));
          for (const a of arr(t.atts)) O.push('- ' + tag(sec.no, sec.name, t.no) + ' ATTACHMENT: ' + (one(a.caption) || 'image, no caption'));
          for (const r of arr(t.carried)) {
            const was = wasLine(r, h.date);
            O.push('- ' + tag(sec.no, sec.name, t.no + '.' + r.letter) + ' CARRIED ACTION' + (r.seq ? ' #' + r.seq : '') + ' (first raised Meeting ' + (r.fromMeeting || '?') + (r.fromDate ? ', ' + r.fromDate : '') + '): ' + one(r.text) + ' | Assigned to: ' + (r.who.join(', ') || 'no one') + ' | Due: ' + iso(r.due) + (was ? ' (' + was + ')' : '') + ' | Status at this meeting: ' + STATE_LABEL[r.state] + (r.pushNote ? ' | Why it moved: ' + one(r.pushNote) : '') + (r.note ? ' | Update: ' + one(r.note) : ''));
          }
          for (const o of arr(t.outcomes)) {
            O.push('- ' + tag(sec.no, sec.name, o.ref) + ' ' + TYPE_LABEL[o.type].toUpperCase() + ': ' + one(o.text) + (o.type === 'assignment' ? ' | Assigned to: ' + (o.who.join(', ') || 'no one') + ' | Due: ' + iso(o.due) + (o.seq ? ' | Action #' + o.seq : '') : ''));
            for (const a of arr(o.atts)) O.push('  - attachment: ' + (one(a.caption) || 'image, no caption'));
          }
        }
        O.push('');
      }
      if (!agenda && dat.next && (dat.next.date || dat.next.time)) O.push('Next meeting: ' + iso(dat.next.date) + (dat.next.time ? ' ' + dat.next.time : '') + (dat.next.location ? ' | ' + dat.next.location : ''));
      O.push('');
    }
    O.push('---');
    O.push('');
    O.push('## Action item ledger (current status of every action in ' + s.name + ')');
    const acts = actionsOf(st, sid);
    if (!acts.length) O.push('None.');
    for (const a of acts) {
      const raised = a.createdIn && st.meetings[a.createdIn] ? st.meetings[a.createdIn] : null;
      O.push('- Action #' + (a.seq || '?') + ': ' + one(a.text) + ' | Assigned to: ' + (a.assigneeIds.map((i) => partyLabel(p, i)).join(', ') || 'no one') + ' | Raised: ' + (raised ? 'Meeting ' + raised.number + ', ' + iso(raised.date) : 'unknown') + (a.ref ? ', item ' + a.ref : '') + ' | Due: ' + iso(a.due) + (a.origDue && a.origDue !== a.due ? ' (originally ' + a.origDue + ')' : '') + ' | Status: ' + ACTION_LABEL[a.status] + (a.doneOn ? ' on ' + a.doneOn : '') + (a.doneNote ? ' | Note: ' + one(a.doneNote) : '') +
        (arr(a.pushes).length ? ' | Moved: ' + a.pushes.map((x) => 'Meeting ' + x.number + ' moved ' + x.from + ' to ' + x.to + (x.note ? ' (' + one(x.note) + ')' : '')).join('; ') : ''));
    }
    return { howto, text: O.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n', count: docs.length, kinds: docs.map((d) => d.kind), name: s.name, project: p ? p.name : '' };
  }
  /* Every series in a project in one file: shared reading guide once, then each series in turn. */
  function projectExport(st, pid) {
    const p = mustProject(st, pid);
    const parts = seriesOf(st, pid).map((s) => seriesExport(st, s.id, { part: true })).filter((r) => r.count);
    const O = ['# ' + p.name + (p.number ? ' (' + p.number + ')' : '') + ': meeting record, all series', '',
      'Exported ' + todayStr() + '. Project: ' + p.name + '. Series included: ' + parts.map((r) => r.name).join('; ') + '. Meetings included: ' + parts.reduce((n, r) => n + r.count, 0) + '.', ''];
    if (parts.length) O.push(...parts[0].howto);
    O.push('- This file holds more than one meeting series. Each series starts with its own "# " heading, and every context tag begins with the series name.', '');
    for (const r of parts) O.push('', '', r.text);
    return { text: O.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n', count: parts.reduce((n, r) => n + r.count, 0), series: parts.length, name: 'All Series', project: p.name };
  }
  function ordinalWord(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  /* ---------- example project ---------- */
  function buildExample(st) {
    const t = todayStr();
    const p = createProject(st, { name: 'Example Medical Office TI', number: '26-114', location: 'Salt Lake City, UT', example: true });
    const co = (name) => addParty(st, p.id, { name, kind: 'company' });
    const per = (name, c) => addParty(st, p.id, { name, kind: 'person', companyId: c.id });
    const co2 = (name, abbr) => addParty(st, p.id, { name, kind: 'company', abbr });
    const owner = co2('Riverton Clinic Group', 'RCG'), gc = co2('Okafor Construction', 'OC'), arch = co2('Studio Nair Architects', 'SNA'), mep = co2('Ferrer MEP', 'FM');
    const dana = per('Dana Reyes', owner), sam = per('Sam Okafor', gc), priya = per('Priya Nair', arch), luis = per('Luis Ferrer', mep);
    const firmCo = ensureFirmParty(st, p.id);
    const jordan = addParty(st, p.id, { name: 'Jordan Ames', kind: 'person', companyId: firmCo.id, title: 'Project Architect' });
    updateProject(st, p.id, { ownerOrgId: owner.id, ownerNumber: 'RCG-0417' });
    const s = createSeries(st, p.id, {
      name: 'Weekly OAC Meeting (example)', location: 'Zoom', cadence: 'weekly', meetingType: 'Owner-Architect-Contractor Meeting', defaultTime: '10:00', durationMin: 60, preparedById: jordan.id,
      attendeeIds: [jordan.id, dana.id, sam.id, priya.id, luis.id],
      template: [
        { name: 'General', topics: [] }, { name: 'Schedule', topics: ['Three-week look-ahead'] }, { name: 'Site', topics: [] }, { name: 'Architecture', topics: [] },
        { name: 'Structural', topics: [] }, { name: 'Mechanical', topics: [] }, { name: 'Electrical', topics: [] }, { name: 'Plumbing', topics: [] },
      ],
    });
    const sec = (m, name) => m.sections.find((x) => x.name === name);
    const topic = (m, secName, text) => addTopic(st, m.id, sec(m, secName).id, text);
    const out = (m, tp, type, text, who, due) => { const o = addOutcome(st, m.id, tp.id, type); setOutcome(st, m.id, o.id, { text }); if (type === 'assignment') setOutcome(st, m.id, o.id, { assigneeIds: who, due }); return o; };

    const m1 = createMeeting(st, s.id, { date: addDays(t, -14), time: '10:00 AM' });
    const t1 = topic(m1, 'Site', 'Need to understand owner parking requirements');
    const t2 = topic(m1, 'Architecture', 'Door 104 hardware conflicts with fire-rated frame');
    const t3 = topic(m1, 'Mechanical', 'Corridor 120 ceiling height vs. duct routing');
    const t4 = topic(m1, 'Schedule', 'Updated look-ahead needed before permit comments return');
    startMinutes(st, m1.id); setAllAttendance(st, m1.id, 'present');
    out(m1, t1, 'info', 'SRDP requires 4 stalls per 1,000 s.f.');
    out(m1, t1, 'assignment', 'Provide updated site plan with parking counts', [arch.id], addDays(t, -7));
    out(m1, t2, 'assignment', 'Confirm the proposed closer keeps the frame rating', [priya.id], addDays(t, -7));
    out(m1, t3, 'decision', 'Corridor ceiling set at 9’6”.');
    out(m1, t3, 'assignment', 'Revise duct layout for the 9’6” ceiling', [luis.id], addDays(t, 5));
    out(m1, t4, 'assignment', 'Issue the updated three-week look-ahead', [sam.id], addDays(t, -7));
    publish(st, m1.id);

    const acts = actionsOf(st, s.id);
    const byText = (x) => acts.find((a) => a.text.startsWith(x));
    const m2 = createMeeting(st, s.id, { date: addDays(t, -7), time: '10:00 AM' });
    const t5 = topic(m2, 'Electrical', 'Long-lead switchgear delivery');
    const t6 = topic(m2, 'Architecture', 'Exam room casework mockup');
    startMinutes(st, m2.id); setAllAttendance(st, m2.id, 'present');
    out(m2, t5, 'info', 'Supplier quotes 16 weeks from release.');
    out(m2, t5, 'assignment', 'Check the schedule impact of a 16-week lead time', [sam.id], addDays(t, 10));
    out(m2, t6, 'decision', 'Mockup will be built in exam room 3.');
    setUpdate(st, m2.id, byText('Provide updated site plan').id, { extendTo: addDays(t, 2), extendNote: 'Waiting on the revised survey from civil.' });
    setUpdate(st, m2.id, byText('Confirm the proposed closer').id, { done: true, note: 'Closer keeps the 90-minute rating. Cut sheet attached to RFI 12.' });
    setUpdate(st, m2.id, byText('Revise duct layout').id, { note: 'Layout is about half done.' });
    publish(st, m2.id);

    const m3 = createMeeting(st, s.id, { date: t, time: '10:00 AM' });
    topic(m3, 'Site', 'Review parking counts on the updated site plan');
    topic(m3, 'Architecture', 'Confirm restroom accessory mounting heights');
    return p;
  }

  return {
    SCHEMA, COLLS, FIRM_ID, ATT_STATES, ATT_LABEL, ACTION_STATUSES, ACTION_LABEL, STATE_LABEL, OV_KEYS, isActive, isHere, snapState, attGroups, DEFAULT_SECTIONS, CADENCES, OUTCOME_TYPES, TYPE_LABEL, ID_RE,
    setClock, uid, stamp, todayStr, addDays, nextDate, fmtDate, fmtShort, fmtDue, fmtStamp, ordinalWord, esc, letter,
    emptyState, isLegacy, normalizeState, normalizeRec, touch, normTime, fmtTime, addMinutes, defaultFirm, getFirm, updateFirm, addOffice, updateOffice, removeOffice,
    effective, nextMeeting, preparedByInfo, ovOf, resetOverride, companyOf, contactPhone, contactEmail, abbrOf, firmParty, issueNo, fmtRef, docIdOf, setAttendance, setAllAttendance,
    listProjects, seriesOf, meetingsOf, actionsOf, snapshotsOf, draftOf, revisingOf, latestOf, isLatest, canEditContent,
    projectOfSeries, projectOfMeeting, party, partyName, partyLabel, companiesOf, peopleOf,
    outline, findOutcome, findTopic, updateOf, dueAt, actionRows, seriesSummary, projectSummary, lastUpdate,
    ensureFirmParty, createProject, updateProject, deleteProject, addParty, updateParty, removeParty, partyUsage,
    createSeries, updateSeries, deleteSeries, addTemplateSection, renameTemplateSection, setTemplateTopics, moveTemplateSection, removeTemplateSection,
    setSectionTiming, setTemplateTiming, setTimed, schedule, createMeeting, setMeetingFields, startMinutes, backToAgenda, deleteDraftMeeting,
    addAttendee, removeAttendee,
    addSection, removeSection, moveSection, moveTopic, projectActions, addTopic, setTopicText, removeTopic,
    LAYOUTS, MAX_IMG_CHARS, listAtts, addAttachment, setAttachment, removeAttachment,
    addOutcome, setOutcome, toggleAssignee, removeOutcome, setUpdate, reopenAction,
    publishIssues, publish, reviseMeeting, cancelRevision,
    mergeRemote, checkPush, markPushed, conflictList, resolveConflict, dirtyCount, exportBackup, parseBackup,
    snapshotToText, agendaToText, snapshotToHtml, exportDocument, fileSlug, fileName, seriesExport, projectExport, FILE_DEFAULT, refParts, buildExample, buildAgendaDoc, buildDraft,
  };
});


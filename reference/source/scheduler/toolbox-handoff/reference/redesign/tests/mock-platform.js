/* In-memory stand-in for the host platform (window.claude.use: db, user, room, downloads).
   Injected before the page loads, for browser QA and the end-to-end tests. Not part of the app. */
(function () {
  const store = new Map(); // path -> data
  const subs = new Set(); // { kind: 'col'|'doc', path, cb }
  let auto = 0;
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const parentOf = (p) => p.slice(0, p.lastIndexOf('/'));
  const docSnap = (path) => ({ id: path.split('/').pop(), exists: store.has(path), data: () => clone(store.get(path)) });
  const colDocs = (col) => [...store.keys()].filter((k) => parentOf(k) === col).map(docSnap);
  const notify = (path) => {
    for (const s of subs) {
      if (s.kind === 'doc' && s.path === path) setTimeout(() => s.cb(docSnap(path)), 0);
      if (s.kind === 'col' && s.path === parentOf(path)) setTimeout(() => s.cb({ docs: colDocs(s.path) }), 0);
    }
  };
  const docRef = (path) => ({
    id: path.split('/').pop(), path,
    get: async () => docSnap(path),
    set: async (d) => { store.set(path, clone(d)); notify(path); },
    update: async (d) => { if (!store.has(path)) { const e = new Error('not found'); e.code = 'not_found'; throw e; } store.set(path, Object.assign(store.get(path), clone(d))); notify(path); },
    delete: async () => { store.delete(path); notify(path); },
    onSnapshot: (cb) => { const s = { kind: 'doc', path, cb }; subs.add(s); setTimeout(() => cb(docSnap(path)), 0); return () => subs.delete(s); },
  });
  const query = (path, order, lim) => ({
    orderBy: (f, dir) => query(path, [f, dir], lim),
    limit: (n) => query(path, order, n),
    get: async () => {
      let docs = colDocs(path);
      if (order) docs.sort((a, b) => ((a.data()[order[0]] > b.data()[order[0]] ? 1 : -1) * (order[1] === 'desc' ? -1 : 1)));
      if (lim) docs = docs.slice(0, lim);
      return { docs };
    },
  });
  const colRef = (path) => Object.assign(query(path), {
    doc: (id) => docRef(path + '/' + (id || 'm' + (++auto).toString(36) + Date.now().toString(36))),
    onSnapshot: (cb) => { const s = { kind: 'col', path, cb }; subs.add(s); setTimeout(() => cb({ docs: colDocs(path) }), 0); return () => subs.delete(s); },
  });
  const db = { collection: colRef, doc: docRef };
  window.__mock = { store, saved: [] };
  const PEOPLE = { u_me: 'Josh Workman', u_kent: 'Kent', u_maria: 'Maria Lopez', u_sam: 'Sam Park' };
  const me = (window.__mockUser || 'u_me');
  const user = {
    id: async () => me,
    can: async () => true,
    isOwner: async () => me === 'u_me',
    canEdit: async () => me === 'u_me',
    profiles: async (ids) => Object.fromEntries(ids.map((id) => [id, { id, name: PEOPLE[id] || '' }])),
    search: async (q) => Object.keys(PEOPLE).filter((id) => PEOPLE[id].toLowerCase().includes(String(q || '').toLowerCase())).map((id) => ({ id, name: PEOPLE[id] })),
  };
  const room = { presence: async () => {}, onPeers: (cb) => { setTimeout(() => cb({ peers: [] }), 0); return () => {}; } };
  const toB64 = async (data) => {
    let u8;
    if (typeof data === 'string') u8 = new TextEncoder().encode(data);
    else if (data instanceof Blob) u8 = new Uint8Array(await data.arrayBuffer());
    else if (data instanceof ArrayBuffer) u8 = new Uint8Array(data);
    else u8 = new Uint8Array(data.buffer || data);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const downloads = { save: async ({ filename, data }) => { window.__mock.saved.push({ filename, b64: await toB64(data) }); return { status: 'saved' }; } };
  const svc = { db, user, room, downloads };
  window.claude = { use: async (k) => svc[k] || null };
})();

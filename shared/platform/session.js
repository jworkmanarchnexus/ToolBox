/* Session: who is signed in. CONTRACT section 3.
   Locally, "sign in as" picks a seeded test user. In production this becomes the firm's network sign-in; the methods stay the same. */
import { request, pref } from './http.js';

let me = null;
let people = null;

export const Session = {
  /* test users for the sign-in-as picker (local only) */
  devUsers() { return request('GET', '/api/dev/users'); },

  async signInAs(personId) {
    pref('user', personId);
    me = null; people = null;
    const person = await Session.load().catch((e) => { pref('user', ''); throw e; });
    if (!person) throw new Error('That person is not in the Toolbox.');
    return person;
  },
  signOut() { pref('user', ''); me = null; people = null; },

  /* loads the signed-in person; resolves to null when nobody is signed in or the saved sign-in is no longer valid */
  async load() {
    if (!pref('user')) { me = null; return null; }
    try { me = await request('GET', '/api/me'); } catch (e) { if (e.status === 401) { pref('user', ''); me = null; } else throw e; }
    return me;
  },

  me() { return me; },
  isAdmin() { return !!me && me.firmRole === 'admin'; },

  /* people picker and names. Names are looked up when shown; records store ids only (CONTRACT section 2, rule 3). */
  async directory() { return people || (people = await request('GET', '/api/people')); },
  async names(ids) {
    const all = await Session.directory();
    const byId = new Map(all.map(p => [p.id, p.name]));
    return Object.fromEntries(ids.map(id => [id, byId.get(id) || 'Unknown person']));
  },
  async search(text) {
    const q = String(text || '').trim().toLowerCase();
    return (await Session.directory()).filter(p => !q || p.name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q));
  },
};

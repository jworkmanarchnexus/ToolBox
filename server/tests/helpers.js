'use strict';
const dbmod = require('../db/db');
const { seed } = require('../seed');
const { createServer } = require('../app');

/* a fresh in-memory database (seeded unless told otherwise) with a real server on a random local port */
async function start({ seeded = true } = {}) {
  const db = dbmod.open(':memory:');
  if (seeded) seed(db);
  const server = createServer(db);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const person = username => db.get('SELECT * FROM people WHERE username = ?', username);
  const project = number => db.get('SELECT * FROM projects WHERE number = ?', number);

  /* api('a.rivera').put('/api/x/y/id', {...}, { ifMatch: 1 }) -> { status, body } */
  function api(username) {
    const id = username ? person(username).id : null;
    const call = async (method, path, body, opts = {}) => {
      const headers = {};
      if (id) headers['x-toolbox-user'] = id;
      if (opts.ifMatch !== undefined) headers['if-match'] = String(opts.ifMatch);
      let payload;
      if (body !== undefined) {
        payload = opts.raw ? body : JSON.stringify(body);
        headers['content-type'] = opts.raw ? 'text/csv' : 'application/json';
      }
      const res = await fetch(base + path, { method, headers, body: payload });
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch (e) { json = text; }
      return { status: res.status, body: json };
    };
    return {
      id,
      get: (p) => call('GET', p),
      put: (p, b, o) => call('PUT', p, b, o),
      post: (p, b, o) => call('POST', p, b, o),
      del: (p, o) => call('DELETE', p, undefined, o),
    };
  }
  return { db, base, api, person, project, close: () => new Promise(r => server.close(() => { db.close(); r(); })) };
}

module.exports = { start };

'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('./errors');
const access = require('./access');
const records = require('./records');
const locks = require('./locks');
const backup = require('./backup');
const vp = require('./vp');

const ROOT = path.resolve(__dirname, '..');
const STATIC_DIRS = ['shell', 'shared', 'modules'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};
const MAX_BODY = 20 * 1024 * 1024;
/* LOCAL ONLY: the "sign in as" picker. Production replaces this with the firm's network sign-in (CONTRACT section 8, decision 1). */
const USER_HEADER = 'x-toolbox-user';

function sendJson(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' }, headers));
  res.end(JSON.stringify(body));
}

function serveStatic(urlPath, res) {
  let rel;
  try { rel = decodeURIComponent(urlPath === '/' ? '/shell/index.html' : urlPath); } catch (e) { return sendJson(res, 400, { error: 'bad path' }); }
  const file = path.normalize(path.join(ROOT, rel));
  const top = path.relative(ROOT, file).split(path.sep)[0];
  if (!STATIC_DIRS.includes(top)) return sendJson(res, 404, { error: 'not found' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, 'Request is too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const text = await readBody(req);
  if (!text) return {};
  try { return JSON.parse(text); } catch (e) { throw new HttpError(400, 'The request body is not valid JSON.'); }
}

const personOut = p => ({ id: p.id, username: p.username, name: p.display_name, email: p.email, title: p.title, firmRole: p.firm_role });
const projectOut = (p, level) => ({
  id: p.id, number: p.number, name: p.name, client: p.client, status: p.status,
  vp: { projectId: p.vp_project_id, number: p.vp_number }, source: p.source === 'vantagepoint' ? 'vantagepoint' : 'local',
  access: access.ACCESS_NAME[level], rev: p.rev,
});

function createServer(db, opts) {
  const devLogin = !opts || opts.devLogin !== false;

  function currentUser(req) {
    const id = req.headers[USER_HEADER];
    const p = id && db.get('SELECT * FROM people WHERE id = ? AND active = 1', String(id));
    if (!p) throw new HttpError(401, 'Sign in first.');
    return p;
  }
  const requireAdmin = user => { if (user.firm_role !== 'admin') throw new HttpError(403, 'Only firm admins can do this.'); };
  function projectFor(user, id, action) {
    const p = access.projectRow(db, id);
    // a project you cannot see does not exist as far as you are concerned
    if (!p || !access.can(db, user.id, p, 'view')) throw new HttpError(404, 'Project not found.');
    if (action && !access.can(db, user.id, p, action)) throw new HttpError(403, 'You do not have permission to do this on this project.');
    return p;
  }

  async function route(req, res, url, user) {
    const m = req.method;
    const seg = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent); // drop "api"
    const q = Object.fromEntries(url.searchParams);

    if (m === 'GET' && seg[0] === 'health') return { body: { ok: true } };

    if (m === 'GET' && seg[0] === 'dev' && seg[1] === 'users') {
      if (!devLogin) throw new HttpError(404, 'Not found.');
      return { body: db.all('SELECT * FROM people WHERE active = 1 ORDER BY display_name').map(personOut) };
    }

    const me = user();

    if (m === 'GET' && seg[0] === 'me') return { body: personOut(me) };
    if (m === 'GET' && seg[0] === 'people') return { body: db.all('SELECT * FROM people WHERE active = 1 ORDER BY display_name').map(personOut) };

    if (seg[0] === 'projects') {
      if (m === 'GET' && seg.length === 1) {
        const scope = q.scope || 'all';
        const out = [];
        for (const p of db.all('SELECT * FROM projects ORDER BY number')) {
          const level = access.levelFor(db, me.id, p);
          if (level < 1) continue;
          if (scope === 'archived' ? p.status !== 'archived' : p.status !== 'active') continue;
          if (scope === 'mine' && !db.get('SELECT 1 AS x FROM project_team WHERE project_id = ? AND person_id = ?', p.id, me.id)) continue;
          out.push(projectOut(p, level));
        }
        return { body: out };
      }
      if (seg.length >= 2) {
        const p = projectFor(me, seg[1]);
        if (m === 'GET' && seg.length === 2) return { body: projectOut(p, access.levelFor(db, me.id, p)) };
        if (m === 'GET' && seg[2] === 'team' && seg.length === 3) {
          return { body: db.all('SELECT t.person_id, t.role, p.display_name FROM project_team t JOIN people p ON p.id = t.person_id WHERE t.project_id = ? ORDER BY p.display_name', p.id).map(r => ({ userId: r.person_id, name: r.display_name, role: r.role })) };
        }
        if (seg[2] === 'access') {
          projectFor(me, p.id, 'manageAccess');
          if (m === 'GET' && seg.length === 3) {
            return { body: db.all('SELECT o.*, pe.display_name FROM access_overrides o JOIN people pe ON pe.id = o.person_id WHERE o.project_id = ? ORDER BY pe.display_name', p.id).map(o => ({ userId: o.person_id, name: o.display_name, kind: o.kind, reason: o.reason, createdBy: o.created_by, createdAt: o.created_at })) };
          }
          if (m === 'PUT' && seg.length === 4) {
            const body = await readJson(req);
            if (!['deny', 'grant_viewer', 'grant_editor'].includes(body.kind)) throw new HttpError(400, 'kind must be deny, grant_viewer or grant_editor.');
            if (!db.get('SELECT 1 AS x FROM people WHERE id = ?', seg[3])) throw new HttpError(404, 'Person not found.');
            if (body.kind === 'deny' && !access.P.canDeny(access.accessInput(db, me.id, p, [me.id, seg[3]]), me.id, seg[3])) {
              throw new HttpError(403, 'You cannot remove this person. Project leads and yourself are protected; a firm admin can.');
            }
            db.tx(() => {
              db.run('DELETE FROM access_overrides WHERE project_id = ? AND person_id = ?', p.id, seg[3]);
              db.run('INSERT INTO access_overrides (id, project_id, person_id, kind, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?)', require('./ids').newId(), p.id, seg[3], body.kind, body.reason || null, me.id, db.now());
            });
            return { body: { ok: true } };
          }
          if (m === 'DELETE' && seg.length === 4) {
            db.run('DELETE FROM access_overrides WHERE project_id = ? AND person_id = ?', p.id, seg[3]);
            return { body: { ok: true } };
          }
        }
      }
      throw new HttpError(404, 'Not found.');
    }

    if (seg[0] === 'locks' && seg.length >= 3) {
      if (m === 'GET' && seg.length === 3) return { body: locks.list(db, seg[1], seg[2]) };
      if (seg.length === 4 && m === 'PUT') return { body: locks.acquire(db, me.id, seg[1], seg[2], seg[3]) };
      if (seg.length === 4 && m === 'DELETE') return { body: locks.release(db, me.id, seg[1], seg[2], seg[3]) };
    }

    if (seg[0] === 'backup') {
      requireAdmin(me);
      if (m === 'GET') return { body: backup.exportBackup(db, me.id, q.module || null) };
      if (m === 'POST') return { body: backup.importBackup(db, await readJson(req)) };
    }

    if (seg[0] === 'admin' && seg[1] === 'import-vp' && m === 'POST') {
      requireAdmin(me);
      const csv = await readBody(req);
      const fn = { employees: vp.importEmployees, projects: vp.importProjects, team: vp.importTeam }[q.kind];
      if (!fn) throw new HttpError(400, 'Add ?kind=employees, projects or team and send the CSV as the body. Import employees and projects before the team.');
      return { body: fn(db, csv) };
    }

    // /api/<module>/<collection>[/<id>]
    if (seg.length === 2 && m === 'GET') return { body: records.list(db, me.id, seg[0], seg[1], q) };
    if (seg.length === 3) {
      const ifMatch = req.headers['if-match'];
      if (m === 'GET') return { body: records.get(db, me.id, seg[0], seg[1], seg[2]) };
      if (m === 'PUT') { const r = records.put(db, me.id, seg[0], seg[1], seg[2], await readJson(req), ifMatch); return { status: r.status, body: r.record }; }
      if (m === 'DELETE') return { body: records.remove(db, me.id, seg[0], seg[1], seg[2], ifMatch) };
    }
    throw new HttpError(404, 'Not found.');
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        return serveStatic(url.pathname, res);
      }
      let cached;
      const user = () => cached || (cached = currentUser(req));
      const out = await route(req, res, url, user);
      sendJson(res, out.status || 200, out.body);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, Object.assign({ error: e.message }, e.extra));
      if (e && e.status && e.status < 500) return sendJson(res, e.status, { error: e.message });
      console.error(e);
      sendJson(res, 500, { error: 'Something went wrong on the server.' });
    }
  });
}

module.exports = { createServer };

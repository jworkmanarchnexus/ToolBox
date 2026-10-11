/* The only place in the front end that calls fetch (CLAUDE.md rule 1). Everything else in shared/platform/ goes through here.
   In production Kent re-implements the platform adapters; modules never see this file. */

export class ApiError extends Error {
  constructor(status, message, body) { super(message); this.name = 'ApiError'; this.status = status; this.body = body || {}; }
}
/* thrown by a save when someone else saved first. `current` is the stored record, so the module can merge. */
export class ConflictError extends ApiError {
  constructor(body) { super(409, body.error || 'Someone else saved a newer version.', body); this.name = 'ConflictError'; this.current = body.current; }
}

const config = {
  baseUrl: '',
  /* per-device preference store; the shell swaps in Toolbox.pref when it is loaded */
  pref: (() => { const m = new Map(); return (k, v) => (v === undefined ? (m.has(k) ? m.get(k) : null) : (m.set(k, v), v)); })(),
  onSignedOut: () => {},
};
export function configure(opts) { Object.assign(config, opts); }
export function pref(k, v) { return config.pref(k, v); }

export function currentUserId() { return config.pref('user'); }

export async function request(method, path, { body, ifMatch, raw } = {}) {
  const headers = {};
  const user = currentUserId();
  if (user) headers['X-Toolbox-User'] = user;
  if (ifMatch !== undefined && ifMatch !== null) headers['If-Match'] = String(ifMatch);
  let payload;
  if (body !== undefined) {
    payload = raw ? body : JSON.stringify(body);
    headers['Content-Type'] = raw ? 'text/csv' : 'application/json';
  }
  const res = await fetch(config.baseUrl + path, { method, headers, body: payload });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { error: text }; }
  if (res.status === 401) config.onSignedOut();
  if (res.status === 409 && json.current) throw new ConflictError(json);
  if (!res.ok) throw new ApiError(res.status, json.error || `Request failed (${res.status})`, json);
  return json;
}

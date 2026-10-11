/* Directory: projects and teams (CONTRACT section 4). Read-only: projects come from the Vantagepoint copy.
   ProjectRef = { id, number, name, client, status, vp: { projectId, number }, source, access: 'read'|'write'|'admin' } */
import { request } from './http.js';

export const Directory = {
  /* scope: 'all' (every active project you can see, the default), 'mine' (you are on the team), 'archived' */
  projects({ scope } = {}) { return request('GET', '/api/projects' + (scope ? `?scope=${encodeURIComponent(scope)}` : '')); },
  project(id) { return request('GET', `/api/projects/${encodeURIComponent(id)}`); },
  /* -> [{ userId, name, role: 'pic'|'pm'|'pa'|'team' }] */
  team(projectId) { return request('GET', `/api/projects/${encodeURIComponent(projectId)}/team`); },

  /* manual access overrides: project admins only (the server enforces it) */
  accessOverrides(projectId) { return request('GET', `/api/projects/${encodeURIComponent(projectId)}/access`); },
  setAccess(projectId, personId, kind, reason) {
    return request('PUT', `/api/projects/${encodeURIComponent(projectId)}/access/${encodeURIComponent(personId)}`, { body: { kind, reason } });
  },
  clearAccess(projectId, personId) {
    return request('DELETE', `/api/projects/${encodeURIComponent(projectId)}/access/${encodeURIComponent(personId)}`);
  },
};

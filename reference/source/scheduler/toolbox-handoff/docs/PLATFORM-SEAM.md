# Platform seam: everything coupled to the prototype's host platform

The prototype runs as one HTML file inside Claude's Artifact host, which supplies four services through `window.claude.use(...)`. These are the **only** places the editor depends on its host. Everything else (engine, rendering, exports, dialogs, history diff, nudge) is plain browser JavaScript.

Replace these with calls to the Toolbox API. Keep the rest.

## Where it connects: `boot()` in `reference/source/app-export.js`

```js
const c = window.claude;
if (!c || !c.use) { S.noStore = true; ... }          // "This page needs to be opened from Claude"
const [db, room, user, dl] = await Promise.all([c.use('db'), c.use('room'), c.use('user'), c.use('downloads')]);
S.db = db; S.room = room; S.user = user; S.dl = dl;
S.meId = await user.id();
S.readonly = (await user.can('data.write')) === false;
db.collection('schedules').onSnapshot(onSchedSnap, ...);   // live list of ALL schedules
db.doc('config/holidays').onSnapshot(onHolSnap, ...);      // firm holiday list
if (room) room.onPeers(onPeers, ...);                       // presence
```

## 1. `db`: storage

| Prototype call | Where | Production replacement |
|---|---|---|
| `db.collection('schedules').onSnapshot(cb)` | `boot`, `onSchedSnap` in app-core.js | **Gone.** The editor opens one schedule: `GET /api/schedules/:id`. A project's schedule list comes from the project page. Live updates become a cheap `GET /api/schedules/:id/meta` poll (version) or a push channel. |
| `S.schedules` (Map of every schedule) | app-core.js, app-ui.js (`renderSheet` picker, `openSettings` "Copy holidays from another project") | Replace with: the current schedule only, plus a list of the **same project's** schedules for a switcher. "Copy holidays from" should list only schedules the user can access (server call). |
| `db.doc('schedules/<id>').set(data)` | `save()` | `PUT /api/schedules/:id { doc, baseVersion }`. Server returns the new version or 409. Replace the `sid` comparison (`handleRemote`, and the pre-save re-read at the top of `save()`) with the server's atomic version check. On a 409 the client runs the existing `reconcile()` (merge) flow with the document the server returns. |
| `db.collection('schedules').doc()` + `.set` | `createSchedule()` | `POST /api/projects/:id/schedules { name, templateId }`. The "Add example schedule" checkbox in `openNew()` becomes the template picker. `exampleTasks()` in engine.js is the seed for the built-in example/sample template. |
| `db.doc('schedules/<id>').delete()` | `deleteSchedule()` | `DELETE /api/schedules/:id` (soft delete). |
| `db.collection('schedules/<id>/history')` get / orderBy / limit / `doc().set` / `doc().delete` | `recordHistory`, `loadHistory`, `clearHistory` | Move to the server. The server writes the history entry in the same transaction as the save (merge rule: same user within 10 minutes updates the latest entry; keep newest 40). Client calls `GET /api/schedules/:id/history`. Remove the client-side pruning loop. |
| `db.doc('config/holidays').onSnapshot` | `onHolSnap` | `GET /api/me` or a settings call returning `firm_settings.holidays`; no live subscription needed. |
| Error code `quota_exceeded` | `save()` | Map to HTTP 413 / 507. |

Production behavior changes at this seam (see SPEC §7): an atomic version check plus the client-side three-way merge (`merge.js`, `reconcile()`/`applyMerge()` in app-core.js) instead of last-save-wins, server-assigned version numbers, and server-side history.

## 2. `user`: identity and permission

| Prototype call | Where | Production |
|---|---|---|
| `user.id()` | `S.meId` | `GET /api/me`. |
| `user.can('data.write')` -> `S.readonly` | `boot` | Server-computed effective access for **this schedule's project**: READ -> `readonly = true`; archived -> `readonly = true`. Return it with the schedule: `{ doc, version, access: 'read'|'write'|'admin', archived }`. |
| `user.profiles(ids)` -> `{id: {name}}` | `refreshNames` | Names embedded in API responses, or `GET /api/users?ids=...`. Used for "Last saved by", history rows, baseline "set by", presence chips. |

`S.readonly` is a UI state only. **The server must enforce it** (SPEC §4.5). Also: when a save returns 403, show a clear message and keep the working copy.

## 3. `room`: presence (optional)

| Prototype call | Where | Production |
|---|---|---|
| `room.presence({sid: scheduleId, dirty: boolean})` | `updatePresence` | Optional. Heartbeat to a presence endpoint/channel with schedule id and "has unsaved changes". |
| `room.onPeers(cb)` -> peers with `kind`, `isMe`, `by`, `presence` | `onPeers`, `peersHere`, `peersElsewhere` | Optional. Drives the "Here now" chips and the "X is editing this schedule right now" banner. If skipped, remove the chips and keep the version-conflict banner. |

## 4. `downloads`: saving files

| Prototype call | Where | Production |
|---|---|---|
| `S.dl.save({filename, data})` returning `{status: 'saved'}`; errors with `code: 'declined' \| 'too_large'` | `saveFile()` in app-export.js | Create a `Blob` from `data` and trigger an `<a download>` click. `data` is a string (CSV), `ArrayBuffer` (PDF, XLSX), `Uint8Array` (zip) or a PNG blob. Keep the success toast. |

(Several export types in one download were removed from the UI. The export dialog is now single-type. `runExportJob` still contains the multi-file zip branch, which is currently unused with a single selection and can stay or be removed.)

## 5. Browser storage keys (per-device, intentionally local)

| Key | Meaning |
|---|---|
| `schedsheet:last` | Last opened schedule id (used to reopen). Replace with the route. |
| `schedsheet:detail` | Whether the "Detailed view" toggle is on. Keep per user (localStorage or a user-preferences table). |
| `schedsheet:xtype` | Last export type chosen. Keep. |
| `schedsheet:xo2:<type>` | Per-device export settings for a report type. Overridden by `exportDefaults[type]` in the schedule when shared. Keep. |
| `schedsheet:xo` | Legacy export settings (pre per-type); read once as the Internal default. Can drop. |
| `schedsheet:desc:<scheduleId>[:<type>]` | The free-text description on an export. Keep. |

All localStorage access is wrapped in try/catch and the app works without it. Keep that.

## 6. Runtime libraries and assets

| Item | Prototype | Production |
|---|---|---|
| xlsx 0.18.5, jsPDF 2.5.1, JSZip 3.10.1 | Lazy-loaded from cdnjs when first needed (`loadLib`) | Self-host; load lazily from your own origin. |
| Fonts: IBM Plex Sans / Mono, Barlow Condensed | Google Fonts `<link>` in `head.html`; canvas export uses the same names | Self-host the font files. Canvas drawing for exports waits on the fonts; confirm they are loaded before drawing. |
| Arch Nexus logo | Base64 data URI in `logo.js` (`LOGO`) | Hosted asset; also allow a firm admin to replace it. |

## 7. Build

`reference/source/build.sh` concatenates `head.html`, `style.css` (inline), `body.html` and one IIFE of `engine.js app-core.js app-ui.js app-task.js app-order.js logo.js app-export.js` + `boot()`. Because of the single IIFE, top-level `const`/`function` names are shared across files. If you move to ES modules or a bundler, make the dependencies explicit, but do not change behavior. Note: the files reference each other's functions freely (for example `app-core.js` calls `renderAll()` from `app-ui.js`); order matters only when code runs at load time.

## 8. Suggested refactor, smallest first

1. Introduce one thin `api` object (the only place that does network I/O) with methods like `loadSchedule`, `saveSchedule`, `listHistory`, `duplicate`. Make the editor call only that object. This turns the seam into one file.
2. Delete `onSchedSnap`/`S.schedules`/`schedSig` logic; open one schedule by id.
3. Replace `sid` handling with `version`/409 handling.
4. Move `recordHistory/loadHistory/clearHistory` server-side.
5. Replace `S.readonly` source.
6. Optional: presence.

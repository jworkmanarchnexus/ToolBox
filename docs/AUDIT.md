# Audit of the existing apps (2026-10-11)

What each app touches today: storage, identity, project data and the platform. Function names are from the published builds in `reference/published/`; they should match the source in the zips.

All three run as Claude artifacts and reach the platform through `window.claude.use('db' | 'user' | 'room' | 'downloads')`. Each artifact has its **own** database. When this audit was made, each database held one test record and nothing real.

| | Published as | Database URL (artifact) |
|---|---|---|
| Scheduler (redesign) | `Toolbox · Scheduler` | https://claude.ai/artifact/WC4qkhRUTpP2QRB6JanJjY |
| Scheduler v34 (live, older) | `Schedule Sheet` | https://claude.ai/artifact/SgWKekdByXZaF5dDnkR17p (not ported; it is the old version) |
| Fee Builder | `Toolbox · Fee Builder` | https://claude.ai/artifact/CyrALzn2VQuCBW99reJzFS |
| Minutes | `Nexus Minutes` | https://claude.ai/artifact/EwFx6QfBsG7gSYsmR2c3Eq |

## Scheduler (redesign)

**Platform calls are spread out.** About 25 direct database calls, in four areas:

- **Start-up** (`boot()`): `use('db'|'room'|'user'|'downloads')`, then live snapshots of:
  - `projects`, `schedules`, `config/holidays`, `templates`, `config/templateManagers`;
  - `data/users/<me>` (personal templates).
  - Also `user.id()`, `user.can('data.write')`, `user.isOwner()`, `room.onPeers()`.
- **Saving and history:**
  - `save()` reads `schedules/<id>` first and compares `sid` (save id) to detect someone else's save, then `set()`.
  - `recordHistory()`, `loadHistory()` and `clearHistory()` use `schedules/<id>/history` (newest 40, saves by one person within 10 minutes merged).
  - `createSchedule()` and `deleteSchedule()`.
- **Projects** ("the data boundary for project information"): `createProject()`, `updateProject()`, `assignSchedule()`, `primaryOf()` and `setPrimary()`. Projects are a hand-entered list, labeled "Local project list" (`PROJECT_SOURCE`). `noteRecent()` and `recentProjects()` use `localStorage` `toolbox:recent`.
- **Templates:** `createMyTemplate()`, `writeTemplate()`, `deleteTemplate()`, `restoreStarter()`, `moveToCompany()`, `setTplManagers()`.
  - Who may do what: `isTplManager()`, `canEditTpl()`, `canMine()`.

**Identity.**
- `S.meId` is the platform user id. It is stored in `createdBy`, `updatedBy`, history `by`, and `config/templateManagers.ids`.
- Names come from `user.profiles()` in `refreshNames()`; the people picker uses `user.search()`.

**Presence.** `updatePresence()` sends `{ sid, dirty }`. `onPeers()`, `peersHere()` and `peersElsewhere()` drive "Kent is editing".

**Per-device storage.** `localStorage` keys:
- `toolbox:*` (shared preferences through `pref()`);
- `schedsheet:last`, `schedsheet:detail`;
- `schedsheet:xo3:<type>`, `schedsheet:desc:<id>:<type>`, `schedsheet:xtype`, `schedsheet:xkind` (export settings).

**Permissions.**
- `effectiveAccess()`, `canDo()`, `canDeny()` and `canDuplicate()` (SPEC §4.3) are pure and tested, written to run on a server.
- They are **not used live** today; artifact sharing decides who can edit.

**Records.**
- Schedules have no schema version.
- Task ids are `'t' + 7 random characters`.
- Document ids come from the database.

**Backup.** None for data. Exports are CSV, Excel, PNG and PDF of a schedule.

## Fee Builder

**Platform calls are confined to `src/ui/store.js`** (`createStore()`), plus `downloads` in `src/ui/app.js`.
- The database collection is `proposals`.
- Personal settings live at `data/users/<id>/settings`.
- **Fallback to `localStorage`** (`fb3.proposals`, `fb3.settings`) when the database is unavailable.
- **Drafts** go to `fb3.draft.<id>` on every edit, for crash recovery.
- UI state goes to `fb3.ui`.

**Concurrency.** A `rev` counter per proposal; a conflict is offered when the stored `rev` moved. It is not transactional.

**Identity.** Only for the settings path. Proposals carry no `createdBy` or `updatedBy`.

**Projects.**
- Stored on the proposal itself: `name`, `client`, `number`.
- `source: { kind: 'manual' }` and `extRefs: {}` already exist as slots for a Vantagepoint link.

**Records.**
- `schema: 3`, with migrations from v1 and v2 (`model.normalize`, `migrateV2`).
- Ids are prefixed (`p…`, `k…`, `ph…`).

**Backup.** Per-proposal JSON export and import (`*.feebuilder.json`). No whole-database backup.

**Source layout** (from the build markers):
- `src/engine/`: money, model, calc, analysis, exporter, sample;
- `src/ui/`: util, store, views, app.

## Minutes

**Platform calls are confined to one block of `app.js`.**
- **`Local`:** IndexedDB database `nexus-minutes`, store `kv`, key `state`. Falls back to `localStorage` `nm:state`, then to memory.
- **Remote:**
  - `initRemote()`, `pullAll()`, `pullMerge()` and `pushDirty()` sync to the artifact database.
  - The collections are `firm`, `projects`, `series`, `images`, `meetings`, `actions`, `snapshots` (`NM.COLLS`).
  - It pulls on start, on window focus (if more than 30 seconds since the last pull) and on "Sync now".
  - It pushes dirty records about one second after an edit.
  - It works offline and pushes when back online.

**Concurrency.**
- `NM.mergeRemote()`, `NM.checkPush()`, `NM.markPushed()`, `NM.resolveConflict()`.
- These are `updatedAt` comparisons against a per-record base.
- A conflicting record is held for the person to choose; nothing is silently overwritten.

**Identity.**
- No user ids in records.
- People in minutes are project **parties** (companies and people on the project, kept by Minutes).
- The platform user is used only for `canWrite` and `admin`.

**Projects.** Its own list: `number`, `ownerNumber`, `name`, `address`, `officeId`, `ownerOrgId`, `parties[]`. The example uses number `26-114`.

**Records.** `v: 2` on every record. Ids are `'x' + 20` characters (`uid()`), validated by `ID_RE = /^[A-Za-z0-9_-]{6,64}$/`.

**Backup.** Full backup export and import (`exportBackup`, `parseBackup`).

**Per-device storage.** `nm:ui`, `nm:theme`, `nm:side` and other `nm:*` preferences. Note these are **not** the shared `toolbox:*` keys.

**Pure code.**
- `logic.js` (`NM`): "No DOM, no storage, no network", Node-testable.
- The PDF layout is a pure function using jsPDF, with Lato and Roboto Condensed embedded.

## Design system drift

Measured with `design-system/tools/audit.py`:

- **Scheduler:** 0 differences. It is the reference.
- **Fee Builder:**
  - Same token values.
  - 29 extra parallel token names.
  - 93 of 105 shared classes defined.
  - 14 hard-coded colors.
- **Minutes:**
  - 19 shared tokens missing.
  - `--accent` redefined as the link color.
  - 25 parallel tokens (`--paper`, `--ink`, `--rule`…).
  - 48 of 105 shared classes.
  - Its own icon set (`ICON`, stroke 1.8 instead of 1.75).

## Cross-app risks for the migration

1. Three separate project lists, in three shapes, joined only by a typed project number.
2. Platform user ids (`u_` plus 22 characters) mean nothing outside the artifacts. Map them to people at import using the backup's `people` map.
3. Three different ways of detecting two people saving at once (`sid`, `rev`, `updatedAt` with a base). The server uses one: compare-and-set on `rev`.
4. Preference keys differ (`toolbox:*` vs `nm:*` vs `fb3.ui`). The shell should own theme, side bar and density under `toolbox:*`.

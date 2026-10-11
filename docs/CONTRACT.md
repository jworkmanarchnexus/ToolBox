# Toolbox platform contract

**Version 1.1 · 2026-10-11 · for Josh and Kent** (section 8 records the first decisions)

This is what every Toolbox app needs from the platform underneath it. It covers today (the apps run as Claude artifacts) and production (Archnexus infrastructure built by Kent). Each app's own SPEC covers its features. This document covers only the seam: data, identity, projects, people, files and live presence.

The rule that makes migration cheap: **in each app, only its adapter code talks to the platform.** Screens and business logic never call the database, the user service or the browser's storage directly. When production arrives, Kent reimplements the adapters and leaves the rest of the app alone.

---

## 1. What the apps use today

All three apps reach the Claude artifact platform through `window.claude.use(name)`.

| Service | What it is today | Scheduler | Fee Builder | Minutes |
|---|---|---|---|---|
| `db` | Realtime JSON document store, one per artifact. Last writer wins, no transactions. | yes, live snapshots | yes, live snapshots | yes, pull and push sync |
| `user` | Opaque per-org user id (`u_` plus 22 characters), display names, `can('data.write')`, `isOwner()`, `canEdit()`, `search()` | yes | settings only | permission flags only |
| `room` | Who has the page open now (presence) | yes ("Kent is editing") | no | no |
| `downloads` | Hands the viewer a generated file | yes | yes | yes |
| Browser storage | Per-device preferences, drafts, offline copy | prefs, export settings | prefs, drafts, fallback store | IndexedDB offline copy, prefs |

**Each app has its own database.** Nothing is shared between apps today: the Scheduler, Fee Builder and Minutes each keep their own projects.

### 1.1 Collections per app

Paths are document-store paths. `<me>` is the signed-in user's id.

**Scheduler** (`Toolbox · Scheduler`)

| Path | Holds | Written by |
|---|---|---|
| `projects/<id>` | Hand-entered project: `number, name, client, status, primaryId, createdBy, createdAt, updatedAt` | anyone with write access |
| `schedules/<id>` | One schedule: tasks, calendar, colors, baseline, `projectId`, `sid` (save id), `createdBy/At`, `updatedBy/At` | anyone with write access |
| `schedules/<id>/history/<hid>` | Last 40 saved versions | the app on every save |
| `config/holidays` | Firm holiday list | anyone with write access |
| `templates/<id>` | Company templates (and hidden starter markers) | template managers |
| `config/templateManagers` | `{ ids: [userId] }` | artifact owner |
| `data/users/<me>/<id>` | Personal templates | that user only |

**Fee Builder** (`Toolbox · Fee Builder`)

| Path | Holds |
|---|---|
| `proposals/<id>` | One proposal: scenarios, packages, phases, roster, snapshots, contract, changes. `schema: 3`, `rev` counter, `source`, `extRefs` |
| `data/users/<me>/settings` | Personal settings: roles, rates, templates |

**Minutes** (`Nexus Minutes`)

| Path | Holds |
|---|---|
| `firm/firm-settings` | Firm name, offices, document style |
| `projects/<id>` | Project: `number, ownerNumber, name, address, parties[]` (companies and people on the project) |
| `series/<id>` | A recurring meeting series and its agenda template |
| `meetings/<id>` | One meeting: agenda, minutes, attendance, status |
| `actions/<id>` | Action items, carried between meetings |
| `snapshots/<id>` | Issued minutes, never edited after publishing |
| `images/<id>` | Attached photos (JPEG data, under 256 KB each) |

Every Minutes record carries `v: 2` and `updatedAt`.

---

## 2. Rules for records (all apps, starting now)

1. **Ids are client-generated strings** of 6–64 characters from `[A-Za-z0-9_-]`. Production must accept and keep them; it may add its own primary key alongside.
2. **Every top-level record carries:**
   - `schemaVersion` (integer)
   - `createdAt`, `updatedAt` (milliseconds since epoch)
   - `createdBy`, `updatedBy` (user id)
   - `rev` (integer, +1 on every save)

   The apps differ on this today; section 7 lists the gaps.
3. **Store ids, never names.** People are referenced by user id or (Minutes) by project-contact id. Names are looked up when displayed.
4. **References are ids.** A schedule points at its project with `projectId`; it does not copy the project's name.
5. **Projects carry a Vantagepoint slot.** Every project record has `vp: { projectId: null, number: "<typed number>" }` until Vantagepoint is connected. See section 4.
6. **Saving is compare-and-set.** A save sends the `rev` it started from. If the stored record has moved on, the save is refused and the app merges or asks. The Scheduler (save id), Fee Builder (`rev`) and Minutes (`updatedAt` with a base) do this three different ways today. Production should implement one mechanism, compare-and-set on `rev` (HTTP `If-Match`), and the adapters translate.
7. **Full backup on demand.** Every app can export and import its whole dataset in the format in section 6. That is how test data moves to production, and it is the safety net while data lives in artifacts.

---

## 3. Identity and permissions

**Today:**
- A user is an opaque id from the artifact platform. It is the same person across one owner's artifacts, and means nothing outside them.
- Write access comes from artifact sharing ("can edit" vs "can view").
- Firm roles and Vantagepoint teams do not exist yet.

**Production needs:**
- **Sign-in.** Kent to decide (likely Microsoft 365 / Entra ID, since that is what Archnexus staff already use).
- **A stable employee id.** Ideally the same id Vantagepoint uses for employees, so project teams can be matched to logins.
- **Firm roles.** `admin` and `viewer` to start.
- **Server-side permission checks.** The browser only hides buttons.

**The permission rule** is already written as a pure, tested function in the Scheduler (`effectiveAccess`, `canDo`, `canDeny`, `canDuplicate`; SPEC §4.3). Production runs it on the server for every app:
- PIC, PM and PA on the Vantagepoint team have **admin** on the project: edit, plus manage access.
- Anyone else on the Vantagepoint team has **read**.
- Manual overrides can deny, or grant viewer or editor.
- Archived projects are read-only for everyone except firm admins.
- Duplicating needs read on the source and write on the destination.

**Mapping today's ids at migration.** Every backup (section 6) includes a `people` map of user id to display name, resolved at export time. Kent maps those names to employee ids once. About 80 people makes that a short list, not a project.

### Adapter interface: `Session`

```js
Session.me()                       // -> { id, name } | null
Session.names(ids)                 // -> { [id]: name }   (looked up, never stored)
Session.search(text)               // -> [{ id, name }]   (people picker)
Session.canWrite()                 // -> boolean          (today: artifact sharing; production: role check)
Session.isAdmin()                  // -> boolean          (today: artifact owner)
Session.access(projectId)          // -> 'none' | 'read' | 'write' | 'admin'   (production; today derived from canWrite)
```

---

## 4. Projects and people (the directory)

**Today:**
- Each app has its own hand-entered project list, in its own shape.
- Fee Builder stores the project on each proposal (`name`, `client`, `number`).
- The only thing joining them is a typed project number, such as `26-114`.

**Production:**
- Projects come from Vantagepoint and are read-only in the Toolbox: number, name, client, status, team with roles.
- App data hangs off the Vantagepoint project id.

**The bridge, starting now:**
- Every app's project record carries `vp: { projectId: null, number }`.
- At migration, a one-time match by `number` fills `vp.projectId`. Anything unmatched goes to a review list.
- Keep project numbers in the firm's real format, so the match works. (The Minutes sample uses `26-114`; please confirm this is the real Vantagepoint format.)
- Minutes keeps project **contacts** (owner, consultants, contractors) itself. Vantagepoint is not expected to hold those. They stay app data.

### Adapter interface: `Directory`

```js
Directory.projects({ scope })      // scope: 'mine' | 'all' | 'archived'  -> [ProjectRef]
Directory.project(id)              // -> ProjectRef | null
Directory.team(projectId)          // -> [{ userId, role: 'pic'|'pm'|'pa'|'team' }]   (production only)
// today, hand-entered projects are also written through the directory:
Directory.createProject(fields), Directory.updateProject(id, fields)   // disabled in production

ProjectRef = { id, number, name, client, status: 'active'|'archived', vp: { projectId, number }, source: 'local'|'vantagepoint' }
```

---

## 5. Data store and files

Each app has **one store module** with app-level methods, such as `saveSchedule` and `listProposals`, never raw paths. Those methods are this contract. Kent implements them against his API:

**Scheduler `Store`**
```js
watchProjects(cb), watchSchedules(cb), watchHolidays(cb), watchCompanyTemplates(cb), watchTemplateManagers(cb), watchMyTemplates(cb)
getSchedule(id), saveSchedule(id, data, baseSid), createSchedule(data) -> id, deleteSchedule(id), moveSchedule(id, projectId)
addHistory(id, entry), listHistory(id, n), clearHistory(id)
saveHolidays(list)
saveCompanyTemplate(id, data), deleteCompanyTemplate(id), saveMyTemplate(id, data), deleteMyTemplate(id), saveTemplateManagers(ids)
exportAll() -> Backup, importAll(Backup)
```

**Fee Builder `store`** (already one module, `src/ui/store.js`)
```js
watchProposals(cb), saveProposal(p, baseRev), deleteProposal(id), loadSettings(), saveSettings(s)
exportProposal(id), importProposal(json), exportAll() -> Backup, importAll(Backup)
```

**Minutes `Local` + `Remote`** (already one block)
```js
pull(collections) -> { [coll]: { [id]: record } }, push(coll, id, record), get(coll, id)
exportBackup() -> Backup, importBackup(Backup)
```

**Live updates.**
- The Scheduler and Fee Builder rely on live snapshots: another person's save appears without a reload.
- Minutes pulls on start, on focus and every 30 seconds, and works offline.
- Production can support the first pattern with a change feed (WebSocket or server-sent events) or with polling (15–30 seconds is acceptable for these tools). Kent to choose.

**Presence** (Scheduler only): "who else has this schedule open, and are they editing". Nice to have in production; the app works without it.

**Files**: `Files.save({ filename, data })` for exports (PDF, Excel, CSV, PNG, JSON). In production this is a normal browser download.

---

## 6. Backup format (all apps)

```json
{
  "format": "toolbox-backup",
  "formatVersion": 1,
  "app": "scheduler | fee-builder | minutes",
  "appSchemaVersion": 3,
  "exportedAt": "2026-10-11T12:00:00Z",
  "exportedBy": "u_...",
  "people": { "u_...": "Josh Workman" },
  "collections": {
    "projects": { "<id>": { } },
    "schedules": { "<id>": { } }
  }
}
```

- Import is **additive**: existing ids are skipped or offered as conflicts, never silently overwritten.
- Personal data (`data/users/...`) exports only for the person exporting.
- Production must be able to load this format, so migration is load the backups, then map people and projects.

---

## 7. Where each app stands

| | Scheduler | Fee Builder | Minutes |
|---|---|---|---|
| Platform calls confined to adapter code | **No.** About 25 direct database calls in four areas (saving and history, projects, templates, start-up), plus `user`, `room` and `downloads` calls | **Yes** (`store.js`); downloads in `app.js` | **Yes** (one block in `app.js`) |
| Pure, tested business logic | Yes: engine, merge, access, duplicate, templates | Yes: `src/engine/*` | Yes: `logic.js`, `pdf` |
| Schema version on records | **No** | `schema: 3`, with migrations | `v: 2` |
| `rev` / compare-and-set | save id (`sid`) | `rev` | `updatedAt` + base |
| `createdBy` / `updatedBy` | Yes | No (single-user records today) | No; contacts are project parties |
| Projects | Own list, `vp` slot missing | On the proposal; `extRefs` slot exists | Own list, `vp` slot missing |
| Full backup export/import | **No** | Per proposal only | Yes |
| People map in backup | No | n/a | n/a (no user ids stored) |
| Design system | Reference | Same tokens, 29 parallel names | Own vocabulary; 48 of 105 shared classes |

### Work to close the gaps (no backend needed)

1. **Scheduler:**
   - Move every platform call into `Store`, `Session`, `Presence` and `Files` adapter sections.
   - Add `schemaVersion: 1` to schedules, projects and templates.
   - Add the `vp` slot to projects.
   - Add full backup export/import with the people map.
2. **Fee Builder:**
   - Add a whole-database backup alongside the per-proposal one.
   - Add `createdBy`/`updatedBy`.
   - Use `extRefs.vp = { projectId: null, number }`.
   - Move onto the design system CSS.
3. **Minutes:**
   - Add the `vp` slot to projects.
   - Wrap the backup in the common format.
   - Move onto the design system CSS. This is a visible change: Minutes will look like the Scheduler.

---

## 8. Decisions

### Answered (Josh, 2026-10-11)

| # | Question | Answer | What it changes |
|---|---|---|---|
| 1 | Sign-in | Intranet app, network username and password (the firm's Windows domain). | The user id becomes the domain account. Records store that id. Locally, a "sign in as" picker of test users stands in. Vantagepoint employees must be matched to domain accounts, most likely by email; to confirm. |
| 2 | Database | One database for all tools, structured so adding a tool does not change what exists. | Shared core tables (people, projects, project team, access overrides, firm settings) plus one set of tables per module. A new tool adds its own tables and reads the core ones. At ~80 users, "scalable" is about structure, not load. |
| 3 | Record ids | Not decided. | Default until decided: text ids generated by the app (UUID-style). These work in any database and survive import, and can become a secondary key if Kent prefers database-generated ids. |
| 4 | Live updates | Refresh every 15–30 seconds is acceptable. | No realtime feed needed. Each module polls for changes since a timestamp (`GET .../changes?since=`). The Scheduler's "someone else is editing" indicator becomes a short-lived lock record refreshed by the same poll. |
| 5 | Vantagepoint | Copy project and team data nightly. | A nightly job fills `vp_projects`, `vp_employees` and `vp_project_team`. The Toolbox reads only its own copy and never calls Vantagepoint during the day. Locally, the same tables load from a CSV export. |
| 6 | Hosting | One Toolbox with a sidebar. Front end will probably be rebuilt. | Since the screens are likely to be rewritten, the durable assets are the specs, the data model, this contract, the design system, and the business rules with their tests. See below. |

**What "front end will be rebuilt" means for current work.** The schedule cascade, the fee calculations and the minutes carry-forward rules are the hardest parts to get right, and they are pure code with tests. Their tests should be written as language-neutral fixtures (JSON input and expected output) so they still apply if the rebuild uses another language, such as C# on a Microsoft stack. Screens are prototypes: they define behavior and look, and are not production code.

### Still open (for Kent)

1. **Record ids** (question 3 above).
2. **Server stack.** Which language, framework and database engine (for example .NET with SQL Server, or Node with PostgreSQL)? This decides whether the business-logic code is reused directly or serves as the reference for a port.
3. **Account key.** Which domain attribute is the stable user id (username, UPN or email)? Do Vantagepoint employee records hold the same value, so teams can be matched to logins?
4. **Project key and number format.** Which Vantagepoint field is the permanent project id, and what is the exact project number format?

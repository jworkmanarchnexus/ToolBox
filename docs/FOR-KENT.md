# For Kent

The Toolbox: three internal tools (Scheduler, Fee Builder, Minutes) in one web app with one database. This is a working prototype that runs on Josh's computer. This page is what you need to host it, rebuild the screens, or both. Read `CLAUDE.md` for the working rules, `docs/CONTRACT.md` for the seam between the apps and the platform, and `docs/DECISIONS.md` for the reasoning behind each choice (including what I was unsure about).

## 1. What is durable and what is a prototype

| Durable (keep, or port with the tests as the check) | Prototype (defines behavior and look; likely to be rebuilt) |
|---|---|
| The business rules: `modules/*/logic/` (scheduling cascade, three-way merge, templates, commitments, permissions, fee calculations, Minutes numbering, carry-forward, sync decisions) | The screens: `modules/*/ui/`, `shell/` |
| The language-neutral fixtures: `modules/*/tests/fixtures/*.json`, `shared/rules/tests/fixtures/permissions.json` | The local server in `server/` (Node with SQLite): a faithful but small stand-in for your platform |
| The contract (`docs/CONTRACT.md`) and the three module specs (`docs/SPEC-*.md`) | The "sign in as" picker (no real authentication) |
| The data model (`server/db/schema.sql`, the record shapes in the specs) | The nightly Vantagepoint copy loaded from CSV files |
| The design system (`design-system/`, generated into `shared/design-system/`) | |

If the rebuild is in another language (for example C# on SQL Server), the fixtures are the acceptance tests for the rules: each is JSON in, JSON out, with a short description at the top of the file saying how to read it. The JavaScript runners next to them (`*-fixtures.test.js`, `cascade.test.js`, `merge-fixtures.test.js`, `calc-fixtures.test.js`, `shared/rules/tests/permissions.test.js`) show the translation from fixture to code.

## 2. Run it

Needs Node 22.5 or newer (`node:sqlite`). On Windows PowerShell type `npm.cmd` for `npm`.

```
npm install          # one dev dependency (jsdom) for the tests
npm start            # builds the bundles, then serves http://localhost:5280 (127.0.0.1 only)
npm test             # about 180 tests, 20 seconds
npm run seed         # reset the local database to the made-up seed data
npm run backup       # full backup JSON into backups/ (git-ignored)
```

The database is `server/db/toolbox.sqlite` (git-ignored). Seed data is made up: 8 people, 12 projects, in CSV files shaped like a Vantagepoint export (`server/db/seed/`).

## 3. How it fits together

```
server/            Node API and static files. Binds to 127.0.0.1 only.
  app.js           the whole HTTP surface (below); records.js is the permission-checked generic store
  access.js        feeds shared/rules/permissions.js from the database; the rule runs on every call
  vp.js            Vantagepoint copy (CSV import: employees, projects, team); backup.js
shell/             sign-in-as picker, side bar, routing, theme and density; loads a module bundle on demand
shared/
  platform/        THE ONLY CODE THAT TALKS TO THE SERVER: Session, Directory, Store (+ polling), Locks, Files, Cache, Backup
  rules/           permissions (pure, tested), used by the server and the screens
  design-system/   generated from design-system/project by `node design-system/tools/build_css.js`
  vendor/          xlsx, jspdf, jszip, self-hosted
modules/<id>/      bundle.json (file order), logic/ (pure rules), ui/, tests/ (+ fixtures/)
tools/build.js     concatenates a module's files into modules/<id>/dist (generated, git-ignored)
```

**The seam.** Modules never call `fetch` or browser storage; they receive the platform adapters from the shell. A test fails if any module source breaks that rule, uses a hex color outside its `tokens.css`, or uses an undefined style variable. Replace `shared/platform/*` (about 300 lines) and the modules do not change.

**Record store.** One generic table for every module: `records(module, collection, id, project_id, rev, schema_version, data JSON, created/updated at and by, deleted)`. Each module stores its own shapes; adding a module adds no tables. Core data (people, projects, project team, access overrides, firm settings, locks) has real columns. The SQL is plain enough to port to SQL Server or PostgreSQL (no SQLite-only features, no triggers). Whether to keep the generic table or turn each collection into real tables is your call; the JSON shapes are in the specs.

**API** (all under `/api`, JSON, header `X-Toolbox-User: <person id>` in the local stand-in):

| Call | What it does |
|---|---|
| `GET /me`, `/people`, `/projects?scope=all|mine|archived`, `/projects/:id`, `/projects/:id/team` | who, people, the projects the person can see (with their access level), a project's team |
| `GET/PUT/DELETE /projects/:id/access[/:personId]` | manual access overrides (project admins; the deny rules from the permission rule apply) |
| `GET /:module/:collection?since=<ms>&projectId=` | records the person may read; `since` returns changes including deletions, plus `serverTime` (the poll cursor) |
| `GET/PUT/DELETE /:module/:collection/:id` | one record. `PUT` with `If-Match: <rev>` (none when creating): 409 with the stored record on a stale save, 428 if it exists and no revision was sent, 403 without permission. `DELETE` is a soft delete. Body: `{ data, projectId }`; `data.schemaVersion` is required. |
| `PUT/DELETE/GET /locks/:module/:collection[/:id]` | short-lived "who is editing" markers (45 seconds, refreshed) |
| `GET/POST /backup[?module=]` | export or additively import, firm admins only; format in CONTRACT section 6 |
| `POST /admin/import-vp?kind=employees|projects|team` | the nightly Vantagepoint copy, CSV body, firm admins only. Order: employees, projects, team. |

**Permissions** are decided by one pure function (`effectiveAccess`) plus naming conventions for records without a project (`records.js` documents them): `firm-*` (everyone reads; firm admins, and anyone named in `firm-writers/<collection>`, write), `personal-*` (only the creator), `owned-*` (project rules when linked; creator, firm admins and, read-only, firm viewers when not). Anything else without a project: everyone reads, the creator or an admin writes. These conventions are my assumption; check them against what you want.

## 4. What the prototype is not, and what to watch

- **There is no real authentication.** The picker sends a person id the browser chooses. Never expose this server beyond `127.0.0.1`. Replace `currentUser()` in `server/app.js` with your sign-in (domain account, per CONTRACT section 8).
- **Polling, not push.** Watchers poll every 20 seconds (`shared/platform/http.js`, `pollMs`); Minutes also every 30. CONTRACT section 8 says that is acceptable.
- **Server-side history.** The Scheduler writes its version history from the browser after a save. Move it into the save transaction.
- **The Scheduler loads every schedule the person can see** and filters in the page. Fine for tens of projects; list per project if it grows.
- **Vantagepoint** is a nightly CSV copy here. The columns in `server/db/seed/*.csv` are my guess at your export; the real project key, number format and employee key are still open (below).
- **Images** in Minutes are records of under 256 KB each; a file store would be better at scale.
- **Backups of whole modules include personal records** when a firm admin exports (a backup that drops data is not a backup). The contract says personal data exports only for its owner; decide which you want.

## 5. Moving data from the artifacts

Each of the three artifacts has a backup export (Minutes: file; Fee Builder: per proposal and, through this port, a whole-module backup; Scheduler: none before this port). Platform user ids in those files (`u_...`) mean nothing outside the artifacts; the common backup format carries a `people` map of id to name. Map those names to domain accounts once (about 80 people), then import with `POST /api/backup`. Project numbers (`26-114`) match Vantagepoint projects by number; anything unmatched needs a person's eye.

## 6. Decisions still open for you

1. **Record ids.** Text ids generated by the app (32 hex characters for schedules, UUIDs for people and projects) until you decide.
2. **Server stack.** Language, framework, database engine (decides whether the rules run as-is or are ported from the fixtures).
3. **Account key.** Which domain attribute is the stable user id, and whether Vantagepoint employee records carry the same value.
4. **Project key and number format.** The permanent Vantagepoint project id, and the exact project number format.

Also decided provisionally and worth your eye (details in `docs/DECISIONS.md`): per-collection permission conventions; fee proposals before a project exists are private to their author, firm admins and firm viewers; one primary schedule per project stored as a Scheduler record; template managers stored as a record the server consults.

## 7. Tests as a safety net

`npm test` covers: the permission rule on the server (every call) and in the platform; compare-and-set and polling; backup round trip; the Vantagepoint import; each module's engine suites at their original counts (Scheduler 53, 80 and 199; Fee Builder 64; Minutes 16 written for this port); every fixture; and interface tests that drive the real screens in jsdom against a real server. Not covered by automated tests: PNG and PDF drawing (checked by hand in a real browser), photo attachments in Minutes, and a phone-width layout.

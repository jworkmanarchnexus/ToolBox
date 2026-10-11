# Decisions log

Record non-obvious technical decisions here with a date and one line of reasoning. Product decisions Josh makes go here too, attributed to him.

- 2026-10-11 (Josh): One Toolbox app with a sidebar, one database for all tools. Runs locally on Josh's computer until Kent's intranet server exists.
- 2026-10-11 (Josh): Production sign-in uses network (domain) credentials. Vantagepoint data is copied nightly. Polling every 15–30 s is acceptable. The front end will probably be rebuilt by Kent.
- 2026-10-11: The design system was extracted from the Scheduler redesign, which is the visual reference.
- 2026-10-11: Source zips unpacked untouched into `reference/source/{scheduler,fee-builder,minutes}/`. The zips themselves are git-ignored (redundant once unpacked). Zip names differ from the kit README: `toolbox-handoff-redesign.zip`, `fee-builder-phase2.zip`, `nexus-minutes-v16.zip`.
- 2026-10-11: Node v24.21.0 on Josh's machine; `node:sqlite` loads, so no database package needed. Server is plain CommonJS with no dependencies. `npm test` uses `node --test` with globs for `server/`, `shared/`, `modules/`.
- 2026-10-11: `.gitattributes` forces LF line endings so Windows checkouts don't produce noisy diffs.

## Baseline test counts (before porting, run as-is from `reference/source/`)

| App | Result | Notes |
|---|---|---|
| Scheduler engine (`test-engine.js`) | 53 pass | matches the expected 53 |
| Scheduler merge (`test-merge.js`) | 80 pass | matches the expected 80 |
| Scheduler other modules (`tests/test-units.js`) | **199 pass** | the kit expected 189; the zip has 10 more. Use 199 as the baseline |
| Scheduler end-to-end (`tests/e2e-*.py`) | **not run** | needs Python, a browser and extra packages; to set up when Phase 2 needs it |
| Fee Builder (`npm test`: build, then 85 checks) | 85 pass, 0 fail | needed `npm install` (jsdom); run in a scratch copy so `reference/` stays untouched |
| Minutes | **no tests exist** | the v16 zip ships no test files. `src/logic.js` is written to be loadable from Node, so Phase 4 should write tests for it before porting |

## Phase 1 decisions (2026-10-11)

- **Records table.** `records(module, collection, id, project_id, rev, schema_version, data JSON, created/updated at and by, deleted)`. One table serves every module, so a new module needs no schema change. Kent can keep it, or turn each collection into real tables when he rebuilds (the JSON shapes are in each module's SPEC). Core data has real columns.
- **Envelope.** The API returns `{ module, collection, id, projectId, rev, schemaVersion, createdAt, createdBy, updatedAt, updatedBy, deleted, data }`. The CONTRACT section 2 fields live in the envelope, not inside `data`; the module only supplies `data.schemaVersion`. The server owns `rev` and the stamps, so a module cannot forge them.
- **Compare-and-set.** `PUT` with `If-Match: <rev>`; creating needs no header; an existing record without one gets 428; a stale one gets 409 with the stored record in `current`. `DELETE` is a soft delete (needs `If-Match` too) so other people's polls see the tombstone.
- **Polling cursor.** `GET .../:collection?since=<ms>` returns records with `updated_at > since` (including deleted ones) plus `serverTime`. The server clock is strictly increasing, so two writes in one millisecond are never missed (tested).
- **Who may touch a record** (`server/records.js`):
  - Has a `projectId`: the shared permission rule decides (view, create, edit, delete); archived projects are read-only.
  - No project and collection `personal-*`: only the person who created it.
  - No project and collection `firm-*`: everyone reads, only firm admins write.
  - No project, any other name: everyone reads; the creator or a firm admin writes.
  - **This is my assumption.** Phase 2 and 3 will test it against real needs (templates, holidays, pursuit proposals).
- **A project you cannot see returns 404**, not 403, so existence is not leaked.
- **Sign-in as (local only).** The browser sends `X-Toolbox-User: <person id>`; `/api/dev/users` lists the test people. This is a stand-in for the network sign-in and has no security value. Do not expose the server beyond 127.0.0.1.
- **Firm roles** (`admin`, `viewer`) live on `people.firm_role`, loaded from `server/db/seed/firm_roles.csv`, because Vantagepoint does not hold them. The `import-vp` endpoint never touches them.
- **VP import.** `POST /api/admin/import-vp?kind=employees|projects|team` with the CSV as the body (firm admins only). Order matters: employees, projects, team. The team file replaces the team of every project it mentions, like a nightly copy would. A project whose status is not "Active" becomes archived. CSV columns are in `server/db/seed/`; **they are my guess at a VP export** and should be checked against the real export.
- **Backup.** `GET /api/backup` (full: core tables and every module) or `?module=x`; `POST /api/backup` imports. Firm admins only. Import is additive and reports what it skipped. The CONTRACT says personal data exports only for the person exporting; the admin backup includes it, because a full backup that drops data is not a backup. Revisit if that matters.
- **Locks** last 45 s and are refreshed by the editor every 15 s. They are advisory; compare-and-set is the real protection.
- **No project create or edit API.** Projects arrive only through the Vantagepoint copy. The CONTRACT's `Directory.createProject` is not built; add it only if a module needs hand-entered projects locally.
- **Design system CSS** is generated by `design-system/tools/build_css.js`, a Node port of the Python script (output verified identical). `shared/design-system/` is committed and a test fails if it goes stale.
- **`shared/platform/package.json`** sets `"type": "module"` so the same files run in the browser and in Node tests.
- **Windows PowerShell blocks `npm`** (script execution policy). Use `npm.cmd`, or Command Prompt, or Git Bash.

## Not done in Phase 1

- The Scheduler's own permission tests (`test-units.js`) are ported as fixtures in `shared/rules/tests/fixtures/permissions.json`; the Scheduler module still carries its own copy of `permissions.js` until Phase 2 deletes it.
- `audit.py` was not run: the shell loads the generated stylesheet rather than embedding its own tokens, so there is nothing for it to compare yet.

## Phase 2 decisions: Scheduler (2026-10-11)

- **The bundle.** The Scheduler was written as one shared scope (about 25 files reach across each other's top-level names). Rewriting that into ES modules would have been a large rewrite with no behavior gain, so `tools/build.js` concatenates the files listed in `modules/scheduler/bundle.json` into `modules/scheduler/dist/scheduler.js` (and the stylesheets into `scheduler.css`). `dist/` is generated and git-ignored; `npm start` and `npm test` build it first. This is the "build step a phase proves is needed" in CLAUDE.md. Fee Builder and Minutes already build to one file, so they use the same tool.
- **Engine and rules are untouched.** `engine.js`, `merge.js`, `templates.js`, `commit.js`, `impact.js` and `dup.js` are byte-identical to the redesign source (checked with `cmp`). `permissions.js` is `shared/rules/permissions.js`, also identical. Baseline counts are held by `modules/scheduler/tests/baseline.test.js`: 53, 80, 199.
- **One data-layer file.** `modules/scheduler/ui/store.js` is the only Scheduler file that talks to the platform; the shell hands it the adapters (`Session`, `Directory`, `Store`, `Locks`, `Files`). A test (`server/tests/rules.test.js`) fails if any module source calls `fetch`, `localStorage`, `indexedDB` or `window.claude`.
- **What replaced what.**
  - Live snapshots became polling (about 20 s, `shared/platform/store.js`). Names come from the directory, never from records.
  - The save-id check became compare-and-set on `rev`. A 409 carries the stored record, which goes into the existing three-way merge dialog.
  - Presence became locks: a person holds a lock on the schedule while it has unsaved changes. "Here now" therefore shows editors only; it no longer shows people who merely have it open.
  - The hand-entered project list became the Directory (read-only). **Add project, Project details and "Unassigned" creation are gone** (projects come from Vantagepoint). Project access (`read`, `write`, `admin`) drives which buttons show.
  - Personal templates became `personal-templates` records. Company templates are `firm-templates`; template managers are the record `firm-writers/firm-templates`, which the server consults (see `isWriter` in `server/records.js`).
  - A project's primary schedule is a record in `project-settings` (id `ps-<projectId>`), because projects themselves are read-only.
- **History** is one record per saved version, in a collection per schedule named `h-<scheduleId>` (linked to the schedule's project, so it follows the same permissions). The client still merges saves by one person within 10 minutes and keeps the newest 40, as before. The server does not write history in the same transaction as the save (PLATFORM-SEAM suggests that); Kent can move it server-side.
- **Ids.** Schedules and history entries use 32 hex characters from `crypto.getRandomValues` (works on plain http, unlike `randomUUID`). Starter templates have short ids ("fed"), so their company copies are stored as `starter_<id>` (the server needs 6 or more characters).
- **Self-hosted libraries.** `xlsx`, `jspdf` and `jszip` (same versions as before) are in `shared/vendor/`; nothing loads from a CDN. Fonts come from the shared design system.
- **Per-device settings** use `pref()` (`toolbox:sched.*` keys) instead of the old `schedsheet:*` keys, so existing browser settings do not carry over.
- **Module CSS.** `ui/tokens.css` holds the Scheduler-only tokens (bars, weekends, audience colors, older preset hues, dark overlays) and is the only module stylesheet allowed to contain hex colors. `editor.css` and `scheduler.css` use tokens only (checked by a test). Six dark tooltip and paper-preview colors that were hard-coded became tokens.
- **Mounting.** The shell loads the bundle on first use and keeps the module's pages alive while you visit other pages. Leaving with unsaved edits asks first (`isDirty`/`confirmLeave`). Switching user reloads the page so no state survives.
- **Not ported:** the three Python/Playwright end-to-end scripts (`e2e-export.py`, `e2e-legacy.py`, `e2e-templates.py`). They drove the old mock platform and file paths. Their server-touching coverage (create, save, merge, permissions, templates, managers) is rebuilt in `modules/scheduler/tests/integration.test.js`, which runs the real bundle in jsdom against the real server. Canvas drawing for PNG and PDF export cannot run in jsdom, so exports were checked by hand in a real browser: CSV, Excel, PNG and PDF each produced a valid file.
- **Found and fixed while porting:** a template opened before the managers list arrived showed "view only" and stayed that way, and a template edited by someone else did not refresh. Both existed in the original (they depended on snapshot timing); `tplChanged` now re-checks.

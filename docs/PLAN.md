# Plan

One phase at a time. At the end of each phase: run all tests, click through the app in a browser, commit, and give Josh a short plain-language summary before starting the next phase.

## Phase 0: Repo and running skeleton

- `git init`, `.gitignore` (node_modules, `server/db/*.sqlite*`, `backups/`, OS junk), first commit, push to the private GitHub repo Josh created.
- Unzip each source zip from `reference/source-zips/` into `reference/source/<app>/`, untouched. If a zip is missing, note it in `docs/DECISIONS.md` and use `reference/published/<app>.html` instead:
  - Fee Builder's published page marks each source file with `/* ---- src/... ---- */` and splits cleanly.
  - The Scheduler and Minutes pages do not, and their tests are only in the zips.
- Run each app's existing tests from its source as-is, and record the counts in `docs/DECISIONS.md` as the baseline (the Scheduler reported engine 53, merge 80, other modules 189).
- `package.json`, `npm start` serving an empty shell page at http://localhost:5280 bound to 127.0.0.1, `npm test` running a trivial test.

**Done when:** Josh runs `npm start`, opens the link and sees a page, and the repo is on GitHub.

## Phase 1: Shell, shared core, local server

- **Server:**
  - Schema for the core tables: `people`, `projects` (with VP fields), `project_team`, `access_overrides`, `firm_settings`.
  - The generic `records` table.
  - The API from CLAUDE.md.
  - Compare-and-set saves on `rev`.
  - `GET ...?since=` for polling.
  - Backup export and import in the CONTRACT §6 format.
  - VP CSV import.
- **Seed data:** about 8 made-up people with roles (PIC, PM, PA, staff, one firm admin), about 12 made-up projects (active and archived) with teams, as CSV in the shape a VP export would have.
- **Shell:**
  - "Sign in as" picker.
  - Sidebar from the design system (`SideNav`) with the three modules (placeholders for now).
  - Hash routing, theme (auto, light, dark) and density preferences.
  - A shared project picker.
- **`shared/platform/`:** `Session`, `Directory`, `Store` (with a polling helper), `Files`, `Locks` (short-lived "who is editing" records, refreshed by the poll).
- **`shared/rules/`:** move the Scheduler's permission functions here with their tests. The server uses them on every write.
- **`shared/design-system/`:** generated from `design-system/` by a script (adapt `design-system/tools/build_css.py`, or port it to Node so only Node is required).

**Done when:**
- Josh can sign in as different test users and see different projects according to the permission rule.
- A write without permission is refused by the server (tested).
- Backup export then import round-trips with nothing lost (tested).

## Phase 2: Scheduler module

- Port from `reference/source/scheduler/` (the redesign, not v34). Engine, merge, templates, access and duplicate code go into `logic/` unchanged, with their tests.
- Replace every platform call (CLAUDE.md rule 1; AUDIT lists them) with the shared adapters:
  - The live snapshots become polling.
  - Presence becomes `Locks`.
  - The hand-entered project list becomes `Directory`.
  - Personal templates become records owned by the user.
- Add `schemaVersion` and `rev` to schedules, and the Scheduler's part of the backup.
- Write fixtures for the cascade (typed predecessors, lags, holidays, locks) from the existing tests.

**Done when:**
- All baseline Scheduler tests pass.
- Josh can create a schedule in a seeded project, edit it, and see a second test user's change within 30 seconds.
- Two users editing the same schedule get the existing merge flow, not a silent overwrite.
- Exports (PDF, Excel, PNG) still work.

## Phase 3: Fee Builder module

- Port from source. The engine (`money`, `model`, `calc`, `analysis`, `exporter`) goes into `logic/` with its tests. `store.js` is re-pointed at the shared `Store`; keep its draft recovery and undo.
- Proposals link to a project with `projectId` when one exists. **Ask Josh:** proposals are often written before a VP project number exists (pursuits). Should they link to a VP promotional project, stay unlinked until won, or something else?
- Move onto the design system: Fee Builder already uses the same token values, so drop its 29 parallel token names and duplicate component CSS.

**Done when:** the baseline tests pass, a proposal round-trips through save, reload and backup, and `audit.py` shows no missing or different tokens.

## Phase 4: Minutes module

- Port from source. `logic.js` and the PDF layout go into `logic/` with their tests.
- Keep offline working:
  - The IndexedDB copy stays as the local cache.
  - The push and pull sync talks to the server through `Store` instead of the artifact database.
  - Conflict holding stays.
- Projects come from `Directory`. Project **contacts** (owners, consultants, contractors) stay Minutes data, keyed by project.
- Move onto the design system. This is visible: Minutes will look like the Scheduler. Show Josh before and after screenshots before finishing.

**Done when:** the baseline tests pass, a meeting goes agenda → minutes → published PDF, action items carry forward, and editing offline then reconnecting syncs without loss.

## Phase 5: Handoff quality

- `docs/SPEC-<module>.md` for each module: behavior, data, permissions, open questions. Start from the specs in the source zips.
- Language-neutral fixtures for every business rule.
- A `docs/FOR-KENT.md`: how to run it, what is prototype versus durable, the contract, and the decisions still open.
- Refresh the published design-system artifact from `design-system/` if it changed.

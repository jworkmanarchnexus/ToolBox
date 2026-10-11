# Toolbox handoff: Scheduler

**Updated Oct 10 2026 with the redesign.** Start with `SPEC.md`. Section 16 describes what the redesign adds, and the new pages in `docs/` cover the design system, the new data fields and the working-day proposal.

| Folder | What it is |
|---|---|
| `reference/redesign/` | Source of the redesigned preview (the visual and interaction reference for the port), its build in `dist/index.html`, and its tests (`tests/`). |
| `reference/v34/` | The prototype as it was before the redesign: source and build. Its jsdom test suites were lost in a workspace reset and are not included. |

What follows is the original handoff README for v34. Its file paths now live under `reference/v34/`.

---

# Toolbox / Scheduler: handoff package

**For:** Kent and the Claude instance building this on Archnexus's existing infrastructure.
**From:** Josh Workman. Prepared with Claude from a working prototype.
**Status:** Draft 1. Josh may still change the spec; check the date and version at the top of `SPEC.md`.

## What this is

Toolbox is a family of small internal web apps at `toolbox.archnexus.com`. The first module, **Scheduler**, lets project teams build shared project schedules with automatic date cascading (like MS Project, but much lighter). Projects and permissions come from Vantagepoint.

A **working prototype** of the schedule editor exists. It is a single HTML file written to run inside Claude's Artifact host, which provided storage, login, sharing and file downloads. Your job is to **adapt it to our real infrastructure** and build the Toolbox shell, project browser and permission model around it.

## Read in this order

1. **`SPEC.md`**: what to build. Product behavior, roles and permissions, VP integration, data model, API, migration, acceptance criteria, open questions. Start here. Items tagged **[OPEN]** need an answer before you build that part; do not guess.
2. **`docs/PLATFORM-SEAM.md`**: the *only* places the prototype depends on its host platform, and what to replace each with. Short, and the most useful file for the port.
3. **`docs/DATA-SCHEMA.md`** and **`docs/schedule.schema.json`**: the schedule document, field by field, with the normalization rules the server must repeat.
4. **`docs/EDITOR-FEATURES.md`**: everything the editor does today. This is the behavior you must preserve.
5. **`reference/`**: the prototype's source, a built copy, tests and screenshots.

## What is in `reference/`

| Path | What |
|---|---|
| `source/engine.js` | The scheduling engine and helpers. **Pure JavaScript, no DOM, no dependencies.** Runs in the browser and in Node (`module.exports`). Keep it as it is. |
| `source/merge.js` | The three-way merge used when two people edit the same schedule (SPEC §7.1). Pure JavaScript, no DOM, Node-compatible. Tested by `source/test-merge.js`. |
| `source/app-core.js` | State, normalizers (`docToWork`), save/load, history, baseline, colors, undo, the 30-minute save nudge. Contains most of the storage calls to replace. |
| `source/app-ui.js` | Toolbar, table, Gantt, dialogs (settings, history, colors), banners. |
| `source/app-task.js`, `app-order.js` | Task popup and link dragging; row reordering. |
| `source/app-export.js` | PDF/Image/Excel/CSV export, the export dialog, shared export defaults, and `boot()` (the platform connection point). |
| `source/logo.js` | The Arch Nexus logo as a data URI. Replace with a hosted asset. |
| `source/body.html`, `head.html`, `style.css`, `build.sh` | Page markup, styles, and the script that concatenates everything into one file. |
| `source/test-engine.js`, `source/test-merge.js` | Engine and merge tests (run with `node`). |
| `build/schedule-reference-build.html` | A built copy of the prototype, for reading and for running the tests. |
| `tests/` | Browser-simulation tests (jsdom): `smoke.js` (282 checks across the UI), `export-test.js`, `legacy-test.js`. Their mock database in `smoke.js` shows exactly what the editor expects from storage. `mock-platform.js` fakes the host platform so the reference build can be opened in a real browser. |
| `screenshots/` | A few real-browser captures of the main screens. |

## Running the tests

```
cd reference/tests
npm install            # jsdom, jszip, xlsx
npm test               # smoke + export + legacy + engine + merge
```

Expected: `smoke passed 282 checks`, `export tests passed`, the legacy and engine lines print "ok"/"passed". The tests load `../build/schedule-reference-build.html` and `../source/engine.js`.

To see the prototype in a browser without the original host: serve the build, and inject `reference/tests/mock-platform.js` before the page scripts (for example with a Playwright `add_init_script`, or paste it in the console and then load the build). It fakes `window.claude` with an in-memory database.

To rebuild the single file after editing source: `sh reference/source/build.sh` (writes `dist/index.html`).

## Ground rules

1. **Server-side authorization.** The prototype's "read-only" is a UI state. In production every action is checked on the server (SPEC §4.5).
2. **Do not rewrite `engine.js`.** It has been tested hard and encodes many small decisions (calendar-day math, locked tasks, holds, cycles). Reuse it, including on the server.
3. **Keep behavior, change plumbing.** The editor's behavior is the product. `docs/EDITOR-FEATURES.md` is the checklist. If you change the UI framework, the four test files are your safety net; adapt only the parts that touch the seam.
4. **Do not add autosave** (the review-then-Save model is deliberate) without asking Josh.
5. **Do not guess [OPEN] items.** Ask Josh. The blocking ones are in SPEC §15.
6. **Self-host** the libraries, fonts and logo (SPEC §11). The prototype loads them from public CDNs.
7. **Read-only on Vantagepoint.** No VP credentials in the browser.

## Known gaps in the prototype that you should not inherit blindly

- History pruning and the 10-minute merge were tested only against a mock database.
- The phone layout works but is not a dedicated mobile design.
- The prototype's concurrency check is best-effort (it re-reads the stored document before writing; no atomic compare-and-set). Production needs the atomic version check plus the three-way merge already built (SPEC §7.1, `reference/source/merge.js`).
- `S.schedules` assumes one flat list of all schedules (fine for a prototype with a handful, wrong for production); see PLATFORM-SEAM §1.

## Contact

Questions about intent, priorities or any [OPEN] item: Josh Workman.

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

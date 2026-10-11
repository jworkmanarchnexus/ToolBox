# Schedule editor: behavior inventory (acceptance baseline)

This describes what the working prototype does, from a user's point of view. The production editor must match it unless the SPEC says otherwise. Where behavior is covered by automated tests, the test file is noted. When in doubt, the reference build (`reference/build/schedule-reference-build.html`, open it with `reference/tests/mock-platform.js` injected as a page-load script; see the README) and the tests are the truth; the screenshots in `reference/screenshots/` show the look.

Design principles that explain many details:

- **Simple first.** Many users are overwhelmed by project-management tools. Advanced features are hidden by default (Detailed view, Executive view, Baseline, working days) and each has a plain-language tooltip.
- **Never surprise the user with moved dates.** Non-working days produce flags with one-click fixes, not automatic shifts. Edits cascade, and a toast tells the user how many other tasks moved, with Undo.
- **Review before commit.** Edits stay on the user's screen (undoable) until they click Save.

## 1. Views

- **Table** (default): one row per task. Columns: row number (click to select, drag to reorder), issue flag, task name, Type (activity/milestone), Audience (Detailed view only), Exec checkbox (only when the Executive view is on), Start, Days, Finish, Slip (only when baseline is on), Predecessors (Detailed view only), lock, row actions (move up/down, add task below, insert linked task, delete).
- **Gantt**: bars on a time scale with weekend/holiday shading, today line, dependency arrows, bar labels, row labels. Dependency link nodes at bar ends (Detailed view): drag from one bar's node onto another task to create a link; a tooltip says whether the link is allowed ("That would create a loop").
- **Executive** (only if enabled in Project settings): Gantt of client-level tasks flagged Exec, for client executives. Has its own bar colors (default color + per-activity color).
- **Detailed view** toggle (remembered per device): adds dependency tools (Predecessors column, link nodes), the Audience column, audience colors with a legend. Off by default so basic users see a plain list.
- **Time scale** menu (Days / Weeks / Months / Quarters; Quarters is about 1 px per day, with Q1-Q4 under each year, meant for very long projects and the executive summary), saved with the schedule; also drives PDF and image exports unless overridden in the export dialog.
- Toolbar: Table | Gantt | Executive, Add task, Undo, History, Scale, Detailed view, "Only rows with issues", Issues, Project settings, Export, Save (primary, disabled when nothing to save, pulses when there are unsaved changes).

## 2. Tasks and dates

- Add, rename, delete, reorder (drag or move up/down), multi-select rows.
- Task = activity (duration in days) or milestone (single date, duration 0).
- Start/Finish are editable. Typing a **finish** changes the duration; typing a **start** on a linked task creates a **hold** (not-before). Typed dates accept: `10/15`, `10/15/26`, `Oct 15`, `15 Oct 2026`, `2026-10-15`, `today`, `+7`, `-3` (see `parseTyped`, tested in `test-engine.js`).
- Dates are **calendar days**. Duration and lag count calendar days.
- Task popup (click a name or bar): name, type, start, duration, finish, audience level, Exec + color, lock, hold, predecessors editor (Detailed view only), issues with fixes, delete. Every control has a tooltip.
- Start grayed out when predecessors drive it; typing a later date = hold.

## 3. Dependencies and the cascade

- Types: **FS** (finish-to-start) and **SS** (start-to-start), each with a lag (days, may be negative).
- Predecessor text in the table: `3`, `5SS+2`, `4FS-1` (row numbers). Parsed/validated by `parsePreds` with friendly errors.
- Multiple predecessors: the task starts at the **latest** date any link requires.
- Changing a task cascades to everything downstream immediately. After an edit that moved more than the edited task, a toast says "N linked tasks moved to follow. Undo to put them back."
- **Locked** tasks never move. If predecessors need a later date a *lock conflict* issue appears with a fix ("Move to <date>"); the fix asks for confirmation before moving a locked date.
- **Holds** (not-before) delay a task past what predecessors require.
- Circular links are detected, flagged, and prevented when linking.
- Engine details and edge cases: `reference/source/engine.js`, `reference/source/test-engine.js` (53 + typed-date + working-day assertions).

## 4. Issues panel

- "Issues" button with a count; panel lists each problem with a one-click fix: Locked date conflicts, circular links, milestone on a non-working day, task starting or finishing on a non-working day (dismissible per task, stored in `ignore`).
- "Only rows with issues" filter in the Table.
- Fixes that would move a **locked** date ask for confirmation.

## 5. Audience levels

- Each task is **Client**, **Design team** or **Internal**. Exports are cumulative: Client export = client only; Design export = client + design; Internal = all.
- Colors per level in Project settings (with the 18-color palette + custom colors). In Detailed view, bars are colored by audience with a legend. (v34 added a diagonal hatch for design and a crosshatch for internal; the redesign drops the patterns and uses solid colors only.)
- Lock icons, issue markers and holds appear only in the Internal export.

## 6. Executive view and export

- Enabled in Project settings. Checking **Exec** on a Client-level task includes it. (A design/internal task can never appear.)
- Executive bar color: a project default plus a per-activity color square left of the task number, executive view only. Changing the default asks "Default only / All activities".
- Color picker: 18 presets + "+" to add a custom hex color saved to the project (max 16, shared by the audience pickers).

## 7. Project settings (dialog)

Project details (number, client, issue note) · Time scale · Holidays (add by year for U.S. federal holidays with optional Utah Pioneer Day, add a date, copy from another schedule) · Executive summary on/off · Baseline and slip on/off (with Set / Clear baseline) · Audience colors · collapsed **Advanced** section with **Working days** (checkbox per weekday; seven off not allowed; "Back to Monday to Friday").

## 8. Baseline and slip (off by default)

- Set baseline: snapshot of every task's start and duration. Clear baseline (with confirmation).
- Table: Slip column ("+3d", "-2d", "0") showing how far the **finish** has moved against baseline.
- Gantt: a thin ghost bar under each task at the baseline position, slip labels, legend strip.
- Tasks added after the baseline have no slip.
- Exports can turn baseline/slip **off** but never on; if the project has it off, exports never show it.

## 9. Version history

- Every save is kept; saves by the same person within 10 minutes merge into one entry; newest 40 kept.
- History dialog: list with who, when, and what restoring would change (added, removed, moved, renamed counts). The newest row says it matches what is on screen.
- Restore loads the old version as an **unsaved** change (undoable). Saving it creates a new entry; the replaced version stays available. The schedule's current name is kept on restore.

## 10. Save model and nudges

- Nothing is saved until the user clicks Save. Status cell shows "All changes saved" / "Unsaved changes".
- Save nudge: after 30 minutes of unsaved edits, a banner offers Save now / Remind me later (15 min). Viewing never triggers it. Tested in `smoke.js`.
- Banners: someone else saved a newer version (Merge now / Load theirs); someone else is editing; holidays not customized yet.
- **Concurrent edits:** when Save finds that someone else saved since the user loaded, the app merges their changes into the user's on screen (unsaved) and says what happened; where both changed the same thing a dialog asks which to keep (their version is preselected). Undo reverses the merge. See SPEC §7.1; covered by `test-merge.js` and `smoke.js`.

## 11. Exports (PDF, Image, Excel, CSV)

- **Single-choice** report type per export: Executive summary (if enabled), Client, Design team, Internal. Each type has its own remembered settings; they can be **shared as the project default** (stored in the schedule's `exportDefaults`), which override per-device settings until reset. Controls: Share / Update / Reset / Stop sharing. The schedule must be saved to share.
- Gantt exports (PDF, Image) options: **Time scale** (auto = schedule's, or days/weeks/months/quarters), dates next to bars (none/start/finish/range), dates in the left task list, durations, task numbers, dependency arrows, current-date line, weekend/holiday shading, baseline and slip, issue markers (internal only), color by audience (design/internal only), legend, project number and client, logo, "last saved by/date", print date, free-text description (defaults to the issue note). PDF only: paper size (Letter, Tabloid, A4, A3, landscape), **fit all dates on one page width**; otherwise the chart is split into pages (rows down, date windows across) with page numbers. The preview warns when fit shrinks text below ~60%.
- Header: title block with project number · client · issue note; right side shows "Last saved by" and "Printed" lines **bottom-aligned with the logo** (two lines stack upward).
- Excel and CSV: task table for the selected type (Task, Type, Start, Days, Finish, Predecessors, Audience; Locked/Held/Issues for Internal; baseline columns when on).
- Hidden-task rule: an export never leaks tasks above its audience level; dates still come from the full schedule.
- Covered by `export-test.js` and `smoke.js`.

## 12. Responsive and accessibility

- Works at 330 px width (phone): toolbar wraps, dialogs scroll, ghost buttons wrap. Several fixes exist specifically for phones; do not regress them.
- Native form controls, keyboard operation (Enter/Space on bars and rows, Escape closes dialogs/menus/pickers independently), `aria-live` toast, `aria-pressed`/`aria-checked`, visible focus. Light and dark themes via `prefers-color-scheme` and a `data-theme` override.

## 13. Known limitations of the prototype (carry forward unless the SPEC changes them)

- No autosave by design.
- The prototype's check for a newer save is best-effort (no atomic compare-and-set); production adds an atomic version check (SPEC §7.1).
- History/pruning was tested only against a mock database, not a real one.
- The color chooser on phones uses the system picker and is unverified; dark-mode appearance of custom hex colors is unverified.
- Not built: Excel/CSV import, JSON backup/restore, a compact phone layout.

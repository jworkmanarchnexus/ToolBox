# Schedule document: data schema

Machine-readable version: `schedule.schema.json` (JSON Schema 2020-12; validated against the prototype's example schedule). This page explains what each field means and which rules the code enforces. The authoritative normalizers are `docToWork` (load) and `save` (write) in `reference/source/app-core.js`, plus `normOffDays`, `normColors` and the color helpers in `engine.js`.

## Metadata outside the document

In the prototype, bookkeeping lived inside the document. In production these become table columns, **not** document fields:

| Prototype field | Production |
|---|---|
| `id` (db key) | `schedules.id` |
| `sid` (random per-save token used to detect "someone else saved") | replaced by `schedules.version` (integer) with a version check on save |
| `updatedBy`, `updatedAt` | `schedules.updated_by`, `updated_at` |
| `createdBy`, `createdAt` | `schedules.created_by`, `created_at` |
| (none: schedules had no project) | `schedules.project_id` |

The prototype's "last saved by Maria, Oct 9 12:00 PM" label, and the same text on export pages ("Last saved by … · …"), come from updatedBy/updatedAt. Keep supplying them from the columns.

## Top-level fields

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | "Untitled schedule" | Schedule name. In production unique within a project is recommended, not required. |
| `scale` | `days` \| `weeks` \| `months` \| `quarters` | `weeks` | Gantt time scale (quarters is for very long projects and executive summaries). Also the default for PDF and image exports. |
| `colors` | `{client, design, internal}` | blue / teal / violet (redesign: `nexus` / `nexus-d40` / `bluegray`) | Bar color per audience level. Each is a preset key or `#rrggbb`. |
| `customColors` | string[] (max 16) | `[]` | Project-saved custom colors, lowercase `#rrggbb`, unique. Shown in every color picker. |
| `holidays` | `{date, name}[]` | firm list until first saved | This project's own holiday list. |
| `hset` | boolean | false | True once holidays were deliberately set (even to none). Drives the "Holidays haven't been customized" banner. |
| `offDays` | integer[] 0-6 | `[0, 6]` | Non-working weekdays, 0 = Sunday. An empty array = every day works. Seven days off is rejected (falls back to `[0,6]`). Never moves dates; only flags and shading. |
| `execOn` | boolean | false | Shows the Executive view and export type. |
| `execColor` | color | `blue` (`nexus` for schedules made in the redesign) | Default bar color in the Executive view/export. |
| `baselineOn` | boolean | false | Enables baseline and slip. Off by default. |
| `baseline` | object \| null | null | `{at, by, tasks: {taskId: {s: 'YYYY-MM-DD', d: duration}}}`. Snapshot of every task's start and duration when set. |
| `info` | `{number, client, issue}` | empty strings | Printed under the export title. Max 40 / 80 / 160 chars. Whitespace collapsed. Production: number and client from VP. |
| `exportDefaults` | `{executive?, client?, design?, internal?}` | `{}` | Shared export settings per report type. Unknown keys dropped; only known option keys of the right type kept. |
| `commitWarn` | integer 0-365 | `0` | *Added in the redesign.* Margin in calendar days below which a met commitment is shown "at risk". 0 = off (never "at risk"). |
| `projectId` | string \| null | null | *Added in the redesign.* The project this schedule belongs to. Production: the `schedules.project_id` column, not a document field. null = an unassigned (older) schedule. |
| `tasks` | task[] | `[]` | Ordered list. Order is the display order and the row numbers used in predecessor text. |

## Task

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique within the schedule. Referenced by `deps`, `baseline.tasks`. Never reuse. |
| `name` | string | Free text. |
| `kind` | `task` \| `milestone` | Milestone has duration 0 and a single date. |
| `duration` | integer | **Calendar days**, minimum 1 for tasks, 0 for milestones. |
| `start` | `YYYY-MM-DD` | See "Start" below. |
| `locked` | boolean | A locked task never moves. If predecessors need a later date, the engine raises a *lock conflict* flag instead. |
| `notBefore` | date \| null | A "hold": do not start earlier than this. Meaningless without predecessors (cleared on normalize). |
| `deps` | `{id, type, lag}[]` | `type` `FS` (finish-to-start, default) or `SS` (start-to-start). `lag` is calendar days, may be negative. Self-links, unknown ids and duplicates are ignored. Cycles are detected and flagged. |
| `ignore` | string[] | Issue codes the user dismissed: `startNonwork`, `finishNonwork`. |
| `lvl` | `client` \| `design` \| `internal` | Audience level. Default `client`. Controls which exports include the task. |
| `exec` | boolean | Include in the Executive summary. Only effective when `lvl` is `client` (`isExecTask`). |
| `exColor` | color \| null | Executive-only bar color. null = use `execColor`. |
| `commit` | `{date, note}` \| null | *Added in the redesign.* A date promised for this activity (`YYYY-MM-DD`, note max 80 chars). Never moves anything: it is compared with the forecast finish (milestone: its date). margin = commit − forecast in calendar days: < 0 late, < `commitWarn` at risk, otherwise on track. Copied by Duplicate only within the same project, never shifted. |

## How dates work (engine semantics)

- Dates are calendar dates with no time zone. Internally the engine converts to **epoch-day integers in UTC** (`parseDate`/`fmtISO`). Never use local-time `Date` for schedule math.
- `end` is **exclusive**: `end = start + duration`. `finish` (the last day the task occupies) is `end - 1` for tasks, `start` for milestones.
- A task **with no predecessors** is *anchored*: its start is exactly `start`.
- A task **with predecessors**: start = the latest date any link allows (FS: predecessor `end + lag`; SS: predecessor `start + lag`), or `notBefore` if later (the task is then *held*).
- A **locked** task starts at its stored `start` regardless.
- `recalc()` writes each task's computed start back into `start`, so the stored `start` is always the current computed start.
- **Lag and duration count calendar days, not working days.** This is deliberate: a dependency never silently skips weekends. Non-working days (weekends via `offDays`, plus holidays) only produce flags (start/finish on a non-working day; milestone on a non-working day) with a one-click fix, never automatic shifts.
- Flags: `lockConflict` (error), `cycle` (error), `milestoneNonwork` (error), `startNonwork` / `finishNonwork` (warning, dismissible via `ignore`).

## Normalization rules the server must repeat

On every save (and on import/duplicate/template create), sanitize rather than trust:

1. Unknown top-level or task fields: drop.
2. Strings: coerce to string; collapse whitespace where the client does (`info`).
3. Dates: must match `^\d{4}-\d{2}-\d{2}$` and be a real calendar date; invalid start falls back to the next working day. Invalid `notBefore` -> null.
4. `duration`: integer, `max(1, round(n))` for tasks, 0 for milestones.
5. `deps[].type` anything but `SS` -> `FS`; `lag` rounded to integer.
6. Colors: preset key or `#rrggbb` (lowercased). Anything else -> null/default. **This is also a CSS-injection control**, because colors are written into style attributes.
7. `customColors`: valid hex only, unique, max 16.
8. `offDays`: integers 0-6, unique, not all seven.
9. `exportDefaults`: keep only known keys of the correct type/enum (see schema).
10. Size limits: suggested max 2000 tasks and 2 MB per document.

Safest approach: run the same normalizer on the server. `engine.js` is plain JS with `module.exports`, so Node can import it. The remaining normalizers (`docToWork` helpers) live in `app-core.js` and should be extracted into a shared, DOM-free module as part of the port.

## History entries

A history entry is the full document at the time of a save plus `at` (epoch ms) and `by` (user id). Production: `schedule_history.doc` + `saved_at` + `saved_by`.

## Firm holiday list

`config/holidays` in the prototype: `{ items: [{date, name}] }`. It is used only as the starting list for schedules that never set their own (`holShared`). Production: `firm_settings['holidays']`. A schedule that has its own `holidays` array always uses its own.

## Projects (added in the redesign)

In the preview, projects are a local list (`projects/<id>` documents) because Vantagepoint is not connected. In production these come from VP and are read-only in Toolbox; only `primaryId` (and access overrides, SPEC 4.3) are Toolbox's own.

| Field | Type | Notes |
|---|---|---|
| `number` | string, max 24 | VP project number |
| `name` | string, max 120 | |
| `client` | string, max 80 | |
| `status` | `active` \| `archived` | Production: mapped from VP status (SPEC 3.3) |
| `primaryId` | schedule id \| null | The project's primary schedule. null = the earliest-created schedule is primary. |

Color preset keys added in the redesign (all optional, older keys still valid): `nexus`, `nexus-t20`, `nexus-t40`, `nexus-t70`, `nexus-d20`, `nexus-d40`, `nexus-d60`, `nexus-light`, `bluegray`, `darkgray`, `brand-orange`, `brand-green`.

## Templates (added with the Templates module)

One shape for starter, company and personal templates (`templates.js` documents it):

| Field | Type | Notes |
|---|---|---|
| `kind` | `"template"` | Marks template documents in a person's private area |
| `name` | string, max 80 | |
| `category` | string, max 40 | Groups company templates |
| `description` | string, max 240 | |
| `scale` | `days` \| `weeks` \| `months` \| `quarters` | Time scale given to new schedules |
| `execOn` | boolean | New schedules get the Executive view |
| `tasks` | template task[] | `{ k, name, d (days) \| ms: true, after?: [k \| [k, 'FS'\|'SS', lag]], lvl?, exec?, exColor?, phase? (the wizard asks for its length), off? (days after the start, unlinked activities only) }` |
| `basedOn` | string \| null | Name of the template or schedule it started from |
| `hidden` | boolean | Company only: a removed starter template |
| `createdBy`, `createdAt`, `updatedBy`, `updatedAt` | | Production: columns |

Where they live in the preview:
- **Company templates:** `templates/<id>`. A starter's id is reused when a manager edits or removes it.
- **Personal templates:** `data/users/<user id>/<id>`, private to that person.
- **Template managers:** `config/templateManagers` `{ ids: [user ids] }`.

Production: a `templates` table with `scope` (company \| personal) and `owner_id`. Personal rows are readable only by their owner, and company rows are writable only by the Template manager role. Schedules made from a template keep no link to it.

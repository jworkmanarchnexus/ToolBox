# Spec: Minutes

What Minutes does and must keep doing, for whoever rebuilds the screens. The rules are in `modules/minutes/logic/logic.js` (pure, "NM") and `pdf.js` (page layout), with 16 characterization tests and language-neutral fixtures in `modules/minutes/tests/`. Minutes' source shipped with no spec or tests; this page and those tests are the first written record of what it does.

## 1. What it is

Meeting agendas and minutes for project meetings that recur (a series: the weekly owner-architect-contractor meeting). An agenda is a list of discussion items under categories (Site, Schedule, Mechanical...). In the meeting the person records outcomes under each item: a decision, information, or an **assignment**. Assignments become numbered **action items** that stay on every later agenda until completed or canceled. Published minutes are issued as an immutable numbered document; corrections are issued as new revisions. It works offline and syncs when it can.

## 2. The life of a meeting

1. **Agenda.** Created from the series (categories and standing topics from the series template, the roster of attendees, location, time, preparer). Open actions from earlier meetings are placed on it under the topic they came from, marked carried. Items can be added, moved and removed. Only one meeting per series is a draft at a time.
2. **Minutes.** "Start meeting" keeps the same items and lets the person record attendance (present, by phone, absent, not recorded) and outcomes. An assignment needs text, a responsible party and a due date. Carried actions get updates: done (with a date), moved to a later date (a note is required), canceled (a note is required), or a progress note.
3. **Publish.** Blocked by errors (empty outcomes, assignments missing a party or date, canceled or moved actions without a note, a completion date after the meeting, no meeting date), with warnings that do not block (no outcome on an item, attendance not recorded, no next meeting, empty location, time, type, preparer, project address or numbers). Publishing freezes the firm, project and contact details into an issued copy (Rev 0), creates the action items, applies the updates, and locks the meeting.
4. **Revise.** Reopen published minutes with a reason; changes are published as Rev 1, 2, ...; earlier revisions stay as issued; the revision can be cancelled to restore the meeting exactly. Assignments and action updates are locked on any meeting that is not the latest in its series.

Rules in detail are in `modules/minutes/tests/logic.test.js` and the fixtures: `carry-forward.json` (how an action lives across four meetings), `dates-and-numbers.json` (next meeting date by cadence, times, topic references, document ids), `sync.json` (below).

## 3. Numbers and identifiers

Meetings number from the series' start number. Topics are numbered `<category>.<topic>`; an action under a topic may carry a letter. Actions are numbered once per series and never reused or renumbered. The document id is `<firm prefix> <meeting 3 digits>.<revision + 1, 2 digits>` ("AN 012.01"). The firm can show references plain (`1.2.B`) or padded (`001.02.B`).

## 4. Data

Module `minutes`; each record keeps its own `v: 2` and `updatedAt` (and the server's envelope: `rev`, `createdBy`, and so on). Records are never deleted by the app: a deleted record stays with `deleted: true`.

| Collection | Record | Linked to project? |
|---|---|---|
| `firm-settings` | The firm: name, offices, document style, numbering, notices, meeting types. One record. | no; everyone reads, firm admins write |
| `projects` | Keyed by the **Toolbox project id**: address, owner's project number, office, owner organisation, **parties** (companies and people on the project, with phone, email, abbreviation). Name and number are copied from Vantagepoint and read-only. | yes |
| `series` | A recurring meeting: name, location, type, default time, duration, cadence, template (categories, standing topics, timing), default attendees, preparer, start number, carry-open setting | yes |
| `meetings` | One meeting: details (with "from series" overrides), attendees, sections and topics with outcomes, attachments, carried actions and their updates, revision backup | yes (through its series) |
| `actions` | Action items: text, assignees, due and original due, status, number, history of moves, where it was raised and closed | yes |
| `snapshots` | An issued copy of a meeting (Rev 0, 1, ...): everything needed to reproduce the document. Never edited. | yes |
| `images` | Attached photos, shrunk in the browser to under 256 KB | yes |

People in minutes are **parties of the project**, not Toolbox users; no user ids are stored.

## 5. Sync (offline first)

Each device keeps a full local copy per person and works without the network. For every record it remembers the `updatedAt` it last synced and whether it has unsent edits. On pulling (start, window focus, every 30 seconds, "Sync now") or before writing, it compares with the server's copy: take theirs, keep and send ours, or, when both changed since the last sync, hold the record and ask which to keep. Nothing is overwritten silently. The server adds an atomic check (each write names the server revision it started from). The decision table is `sync.json`. Editing offline then reconnecting sends everything (tested).

## 6. Permissions

Per project, from Vantagepoint: PIC, PM and PA can start minutes for a project and edit everything under it; the rest of the team can read; others see nothing. A read-only person sees "View only" and disabled fields. Firm settings: firm admins write, everyone reads. The server enforces all of this; the screens only follow it.

## 7. Outputs

The published sheet on screen; a PDF drawn in the browser with the same layout code as the preview (Letter portrait: corporate header, project block, participants, minutes register, next meeting, footer); text and HTML copies; the agenda as PDF or text; series and project exports; a backup file (common Toolbox format, files from the earlier version still import). File names follow a pattern the firm can set (tokens `{date} {project} {series} {number} {doc} {rev}`).

## 8. Differences from the old prototype

Projects are not created in Minutes: a project lead starts minutes for a Vantagepoint project. The example project is a private sandbox on the device and is never sent to the server. Moving around inside Minutes is not in the address bar. Firm settings are reached from a button on the home page.

## 9. Open questions

For Josh: whether the architect's project number format `26-114` is the real Vantagepoint format; who can publish (today anyone who can edit the project); whether read-only team members should be able to see unpublished agendas (today they can).

For Kent: moving Minutes' records into real tables if the stack is rebuilt (the JSON shapes are defined by `normalizeRec` in `logic.js`); retention of issued copies; whether photos should live in a file store rather than records (each is a record under 256 KB now).

Not built: routes for the screens inside Minutes, automated tests for the PDF layout beyond "a valid PDF is produced", and for photo attachments (the image-shrinking code is unchanged).

## 10. Tests

`npm test`: `logic.test.js` (16), `rules-fixtures.test.js` (5: dates and numbers, three sync tables, carry-forward), `ui.test.js` (12, real screens against a real server: projects from Vantagepoint, permissions, series and meeting flow through publish and carry-forward, held conflicts, offline then reconnect, per-person local copy, backups, firm settings).

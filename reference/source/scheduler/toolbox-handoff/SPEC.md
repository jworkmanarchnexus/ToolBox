# Toolbox — Scheduler module: product and technical specification

**Status:** DRAFT 1, for review by Josh before it goes to Kent.
**Audience:** Kent and the Claude instance that will build this on Archnexus's existing infrastructure.
**Owner:** Josh Workman (Senior Associate, moving into CFO role).

How to read the tags in this document:

- **[DECIDED]**: Josh has stated or agreed to this. Build it this way.
- **[ASSUMED]**: a reasonable default Claude chose to fill a gap. Confirm or change it.
- **[OPEN]**: a real question. Do not guess; get an answer from Josh, Kent or IT.
- **[REFERENCE]**: the behavior already exists in the working prototype. Match it. See `docs/EDITOR-FEATURES.md`.

---

## 0. Summary

Toolbox is a set of small internal web apps that save Archnexus staff time on tasks that normally take a long time. It lives at `toolbox.archnexus.com`. A left sidebar lists the modules. **Scheduler** is the first module.

Scheduler lets project teams build and share project schedules with MS-Project-style dependency logic (a change to one task's date cascades to everything that depends on it), kept far lighter than MS Project. A working prototype exists (`reference/`). It runs as a single HTML file on a platform that provided its own database, login and sharing. This spec describes the production version: the same editor, wrapped in a real application with Vantagepoint-driven projects and permissions.

### What is being built

1. **Toolbox shell**: sign-in, sidebar, module registry, user/role handling, audit log. Built once, shared by all future modules. (§2)
2. **Vantagepoint (VP) sync**: projects and project team assignments come from VP. (§3)
3. **Permission model**: automatic from VP, with manual overrides by project admins. (§4)
4. **Scheduler module**: project browser, project page, templates, duplicate, archive/view-only, and the schedule editor. (§5, §6)
5. **Migration** of the schedules that exist in the prototype. (§10)

### What is NOT being built (non-goals)

- Not a replacement for MS Project. No resource leveling, costs, critical-path analytics, or multiple calendars per task.
- No VP write-back. Toolbox only reads from VP.
- No native mobile app. The editor must work in a phone browser, but desktop is the main use.
- Real-time collaborative editing (two cursors in one schedule) is out of scope. See §7 for what is in scope.

### Guidance for the implementer

- The app must be adapted to the existing stack. This spec is stack-agnostic on purpose. §12 lists the decisions Kent must make.
- **Keep `engine.js` and its tests as they are.** It is the scheduling logic, it has no dependencies, it runs in both the browser and Node, and 53+ tests describe its behavior. Do not rewrite it. Port around it.
- **Do not trust the client.** In the prototype, "read-only" is a UI state. In production every permission check must be enforced on the server. (§4.5)

---

## 1. Glossary

| Term | Meaning |
|---|---|
| Project | A job in Vantagepoint. Has a project number, name, client, status and team. Source of truth is VP. |
| Schedule | One Gantt/table document that belongs to exactly one project. A project can have many schedules. |
| Template | A schedule-shaped starting point that is not attached to a project. Includes a "Blank" template. |
| Active / Archived project | Derived from the VP project status. See §3.3. |
| PIC / PM / PA | Principal-in-charge, project manager, project administrator, as recorded in VP. They get write access and project admin rights on their projects. |
| Project team | Everyone VP lists as assigned to the project. They get view access. |
| Project admin | A PIC, PM or PA of the project. Can edit schedules and manage access. |
| Firm admin | A Toolbox-wide administrator. See §4.2. |
| Override | A manual access change made in Toolbox on top of what VP says. |
| Task | A row in a schedule: an activity (has a duration) or a milestone (single date). |

---

## 2. Toolbox shell

### 2.1 Navigation [DECIDED]

- URL: `toolbox.archnexus.com`.
- Left sidebar lists the modules the signed-in user is allowed to use. Today: **Scheduler**. The list must be driven by a module registry (config or table), not hard-coded, so adding module #2 does not require touching the shell.
- Clicking a module opens its home page in the main area.
- The sidebar collapses to a menu button on narrow screens.

### 2.2 Sign-in [OPEN]

- Sign-in must use the firm's existing identity provider (single sign-on). **Which one is it: Microsoft Entra / M365, Google Workspace, or something else?** Kent to confirm.
- Users must be matched between the identity provider and VP employees. Proposed key: work email address. **[OPEN]** Does VP store the same email the IdP uses? If not, a mapping table is needed (§3.4).
- Sessions, timeouts, MFA: follow existing firm policy. Do not invent a new scheme.

### 2.3 Shared services every module can use [ASSUMED]

- Current user (id, display name, email, roles).
- Project list and project access check: `can(user, action, projectId)`.
- Audit log writer.
- Toast/notification and error-banner conventions (the prototype's visual language is the baseline).

### 2.4 Audit log [ASSUMED]

An append-only record of: sign-ins (optional), schedule create / duplicate / delete / restore, every save (who, when, schedule, version), every access override (who changed whose access, to what, when), template create/edit/retire, VP sync failures. Viewable by firm admins. Retention: **[OPEN]** per firm policy.

---

## 3. Vantagepoint integration

All VP access is **read-only**.

### 3.1 What Toolbox needs from VP

For every project, at minimum:

| Field | Use |
|---|---|
| VP project id (stable key) | Primary link between VP and Toolbox. Never use project number as the key if it can be edited. |
| Project number | Shown in the UI and in exports ("Project 2026-014"). |
| Project name | Shown in grids. |
| Client name | Shown in grids and exports. |
| Status | Decides Active vs Archived. |
| PIC, PM, PA (employee ids) | Write access and project admin rights. |
| Project team (employee ids, optionally with role) | View access. |

For every employee: VP employee id, name, email, active/terminated flag.

### 3.2 How to get it [OPEN]

**Is Archnexus on Vantagepoint cloud or on-premises?** The answer decides the method:

- Cloud: probably the VP REST API (OAuth). Confirm available endpoints cover projects, project team/roles and employees.
- On-premises: a read-only SQL account or a read replica, on a view limited to the fields above.

Either way: **no VP credentials in the browser, ever.** The Toolbox server talks to VP; the browser talks only to Toolbox.

### 3.3 Active vs Archived [DECIDED, mapping OPEN]

- Active/Archived is derived from the VP status. There is no separate manual flag in Toolbox, so nobody has to maintain two lists.
- **[OPEN]** Exact mapping of VP status values (e.g. Active → Active; Inactive / Dormant / Closed → Archived?). Josh to confirm the list of status values the firm actually uses.
- Josh's wording has used both "archived" and "inactive". In the UI use **Archived**. In code and the data model use `is_archived` (boolean) derived from status.

### 3.4 Sync behavior [ASSUMED]

- A server-side job refreshes projects, team assignments and employees on a schedule (proposed: every 15 minutes, plus a manual "Sync now" for firm admins).
- Sync is **idempotent** and **additive-safe**: a failed or empty response must never wipe the project list or remove anyone's access. If VP returns an error or implausibly few records, keep the previous data and log the failure.
- Store the last successful sync time. Show it to firm admins, and show a warning banner to everyone if data is older than a threshold (proposed: 24 hours).
- When a project is deleted or merged in VP: keep the Toolbox project row (mark `vp_missing`), keep its schedules, make them view-only, and flag for a firm admin. Never cascade-delete schedules because of a VP change.
- When a person is terminated in VP or disabled in the IdP: they lose access immediately on the next sync (or immediately at sign-in, whichever is first). Their name stays on history and audit entries.
- When PM/PIC/PA changes in VP: write access and admin rights move on the next sync. Manual overrides are untouched (§4.3).

---

## 4. Roles and permissions

### 4.1 Where access comes from [DECIDED]

1. **Automatic from VP.** Anyone assigned to a project in VP gets **view** access to that project's schedules. Anyone assigned as **PM, PA or PIC** gets **write** access and **project admin** rights.
2. **Manual overrides** made by a project admin in an admin view: turn off someone VP gave access to, or add someone VP did not.
3. **Firm-wide roles** (§4.2).

Permissions belong to the **project**, not to individual schedules. [DECIDED] Every schedule in a project has the same audience.

### 4.2 Firm-wide roles [DECIDED]

| Role | Rights |
|---|---|
| **Firm admin** | Everything. Manages firm-wide settings, templates, firm holidays, VP sync, and access on any project. Can fix lockouts. Few people. |
| **Firm viewer** (leadership) | Read access to every project's schedules, with no per-project assignment. Intended for leadership (e.g. the CFO). Cannot edit unless also given project access. |
| *(everyone else)* | Access only through the project rules in §4.3. |

**[OPEN]** Who is a firm admin and who is a firm viewer at launch? Proposed: Josh and Kent as firm admins; leadership list from Josh as firm viewers. Store these as data (a table), not as code.

### 4.3 Effective access on one project [DECIDED, details ASSUMED]

For user U on project P, compute in this order:

```
1. If U is a firm admin                         -> ADMIN on P
2. Else if U has a manual DENY on P             -> NONE        (even if VP says otherwise)
3. Else take the highest of:
     - VP says U is PIC, PM or PA on P          -> ADMIN
     - manual grant "editor" on P               -> WRITE
     - VP says U is on the project team of P    -> READ
     - manual grant "viewer" on P               -> READ
     - U is a firm viewer                       -> READ
4. Else                                         -> NONE
```

Levels, lowest to highest: `NONE < READ < WRITE < ADMIN`.

Rules that go with it:

- **A manual deny always beats VP.** Without this, removals would silently undo themselves on the next sync. A deny survives syncs until a project admin removes it.
- **A manual grant survives syncs** even when VP does not list that person. It is removed only by a project admin.
- **A project admin cannot deny another VP-derived project admin** (PIC/PM/PA). This prevents lockouts and lateral fights. Only a firm admin can. [ASSUMED]
- **A project admin cannot deny themselves** or remove their own admin rights. [ASSUMED]
- **Manual grants cannot create new admins.** Admin comes only from VP (PIC/PM/PA) or firm admin. If the PM wants a second person to edit, they grant "editor". [ASSUMED]
- All override changes record who, when, and an optional reason, in the audit log.
- ADMIN includes WRITE, which includes READ.

### 4.4 What each level can do [DECIDED]

| Action | NONE | READ | WRITE | ADMIN |
|---|---|---|---|---|
| See the project in the grid | no | yes | yes | yes |
| Open and view a schedule (view-only) | no | yes | yes | yes |
| Export a schedule (PDF, image, Excel, CSV) | no | yes | yes | yes |
| **Duplicate a schedule out of this project** (as source) | no | yes | yes | yes |
| Edit and save a schedule | no | no | yes | yes |
| Create a new schedule in this project | no | no | yes | yes |
| Delete a schedule | no | no | yes | yes |
| Restore an earlier version | no | no | yes | yes |
| Duplicate a schedule **into** this project (as destination) | no | no | yes | yes |
| Open the project admin view; add or remove people | no | no | no | yes |

**Duplicate rule [DECIDED]:** to duplicate a schedule, the user needs **READ or WRITE on the source project** and **WRITE on the destination project**. Both are checked on the server. The destination picker lists only projects where the user has WRITE.

**Archived projects [DECIDED]:** schedules on an archived project can be viewed and duplicated, but not edited. Writes are rejected on the server for every role, including ADMIN and firm admin. A project becomes editable again only when its VP status makes it Active. A firm admin may still delete schedules on archived projects. [ASSUMED]

### 4.5 Enforcement [DECIDED, critical]

- Every API call checks the effective access on the server. The UI hides what a user cannot do, but hiding is not security.
- Listing endpoints must filter by access. A user must never be able to learn a project exists, its client, or its schedule names if they have NONE access. (Exception: see §5.2 for the "all projects" browse mode, which is **[OPEN]**.)
- Saves must verify WRITE on the schedule's project at save time, not at page load. A user whose access was revoked mid-session must be rejected on the next save, and told clearly.

---

## 5. Scheduler module: pages and flows

### 5.1 Scheduler home [DECIDED]

Route: `/scheduler`.

Two groups:

1. **Active projects**: a grid of cards, one per active project.
2. **Archived projects**: a section **collapsed by default**, below the active grid. Expanding it shows only archived projects that **have at least one schedule**. (Archived projects with no schedules are not shown.)

Each active project card shows: project number, name, client, and either:
- the number of schedules and the most recent update ("3 schedules · updated Oct 9 by Maria"), or
- **"No schedule exists"** when it has none.

Clicking a card opens the **Project page** (§5.2).

Grid usability [DECIDED in principle, details ASSUMED]:

- Default filter is **My projects** (projects where the user has any access through VP or overrides). Toggle for **All projects**. Search box (number, name, client). Filter chips: Has schedule / No schedule.
- **[OPEN]** What should "All projects" show for someone with only READ via a project team? Proposed: firm viewers and firm admins see all; everyone else only sees their own projects. A regular user never sees projects they have no access to.
- Sort: most recently updated first, then project number. Remember the user's last filter.
- Must stay fast with several hundred projects (paginate or virtualize the grid).

### 5.2 Project page [DECIDED]

Route: `/scheduler/projects/:projectId`.

Shows the project header (number, name, client) and:

- **Existing schedules** as a list/cards (name, primary badge, last updated by/when, task count). Click one to open it.
- **New schedule** button (WRITE or ADMIN only). If the project has no schedules, this is the main call to action.
- **Access** button (ADMIN only) opening the admin view (§5.5).

**Primary schedule [DECIDED]:** a project with several schedules can mark one as **primary** (ADMIN or WRITE). Exactly one primary at a time per project. The primary schedule is the one shown first, and is what any future cross-project summary should use. The first schedule created on a project is primary automatically.

### 5.3 New schedule [DECIDED]

1. User clicks **New schedule** on a project.
2. A **template picker** opens. It lists the available templates, with a **Blank** template always first. Each template shows name, short description and task count.
3. User picks one and enters a schedule name (default: template name).
4. Optional: **start date**. For templates with dates, all dates are shifted so the first task starts on that date (see §5.4, same shifting rule). Default: next working day.
5. The schedule is created in that project with the template's tasks, and opens in the editor.
6. **Project details are pre-filled from VP** (project number and client). [ASSUMED] In the prototype these were typed by hand.

**Templates [DECIDED]:**
- Templates are managed by **firm admins** (create, edit, retire). Not by individual project teams.
- A firm admin can create a template from any schedule ("Save as template") or from scratch.
- A retired template no longer appears in the picker but does not affect schedules already created from it.
- Templates are copied at creation: later template edits never change existing schedules.
- Templates contain tasks, dependencies, audience levels, exec flags, colors, custom colors, scale, off days. They do **not** contain: baseline, history, project details, shared export defaults. [ASSUMED]
- **[OPEN]** Do templates need categories (e.g. "Pursuit", "Design", "Construction")? Probably not at launch. Add when the list exceeds ~12.

### 5.4 Duplicate [DECIDED, with Josh's rule]

Available on any schedule the user can at least READ, including schedules in archived projects.

Flow:
1. User clicks **Duplicate** on a schedule.
2. The dialog lists **only projects where the user has WRITE** (the destination rule in §4.4). Search box. Archived destinations are excluded.
3. User picks the destination project and a new name (default: "Copy of <name>").
4. **Dates:** choose one:
   - **Keep the dates exactly as they are.** (identical copy, as originally requested)
   - **Set a new start date.** Every date moves by the same number of calendar days so the earliest task starts on the chosen date. Locked dates and "hold until" dates move by the same amount. [ASSUMED. Josh asked for an identical copy; Claude recommended offering this because identical dates are rarely wanted for a new project. Confirm default.]
5. Created schedule becomes a **new, independent schedule** in the destination project.

What a duplicate copies and does not copy [ASSUMED]:

| Copied | Not copied |
|---|---|
| Tasks (names, durations, dependencies, lag, locks, holds, audience level, exec flag, exec color) | Version history |
| Time scale, off days, holidays, audience colors, custom colors | Baseline and slip data (the new schedule starts with none; the baseline setting itself is copied) |
| Executive summary setting and default color | Primary flag |
| Shared export defaults | Project details: replaced by the **destination** project's number/client from VP |

The duplicate is recorded in the audit log with source schedule, destination project and user. The new schedule's "created by" is the duplicating user.

**[OPEN]** If some projects carry content restrictions (e.g. federal work), should duplication out of them be limited or blocked? Josh to say; if yes, add a per-project "restrict copying" flag set by a firm admin.

### 5.5 Project admin view [DECIDED]

Route: `/scheduler/projects/:projectId/access` (ADMIN only; firm admins always).

Shows a table of people with access to the project:

| Column | Notes |
|---|---|
| Name, email | |
| Source | "Vantagepoint: PIC / PM / PA / Team member", "Added manually", "Firm viewer", "Firm admin" |
| Effective access | Admin / Can edit / Can view / No access (removed manually) |
| Actions | Remove (creates a deny), Restore (removes the deny), Change to editor / viewer (manual grants) |

Features:
- **Add person**: search the directory (IdP/VP employees), choose "Can edit" or "Can view".
- **Removed people** are shown in a separate collapsed list so a deny can be undone.
- Changes take effect immediately and are audited with an optional reason field.
- A banner explains how it works: "People assigned in Vantagepoint are added automatically. Removing someone here overrides Vantagepoint until you restore them."
- Last VP sync time is shown.
- Rules from §4.3 apply (cannot remove other PIC/PM/PA, cannot remove self).

### 5.6 Schedule editor [REFERENCE]

Route: `/scheduler/schedules/:scheduleId`.

The editor is the prototype, adapted only where it touches the platform (§7, `docs/PLATFORM-SEAM.md`). Full behavior: `docs/EDITOR-FEATURES.md`. In summary: a Table view and Gantt view, optional Executive view, dependencies with automatic cascade, locks and holds, issues panel, baseline and slip, non-working days, per-project holidays, audience levels (client / design / internal), version history, undo, shared export settings, and PDF / image / Excel / CSV export.

Changes required for production:

- Header shows **project number and name** and a link back to the project page, instead of a free "schedule picker" dropdown. Switching between a project's schedules happens from the project page (or a compact switcher limited to that project).
- Read-only mode is driven by the server-computed access level (READ, or archived project), and the banner text changes: "You have view access to this schedule." with a **Duplicate** button.
- "Here now" presence shows only people who currently have the same schedule open. See §7.4.
- The "New" / "Rename" / "Delete" controls move to the project page and a schedule menu, shown only to WRITE/ADMIN.

---

## 6. Navigation summary

```
Toolbox
 └─ Sidebar: Scheduler
     └─ /scheduler                        Active projects grid  |  Archived (collapsed)
         └─ /scheduler/projects/:id       Project page: schedules list, New schedule, Access
             ├─ New schedule              template picker -> create -> editor
             ├─ /access                   Project admin view (ADMIN)
             └─ /scheduler/schedules/:id  Editor (view-only if READ or archived)
                  └─ Duplicate            pick destination (WRITE only) -> copy
```

---

## 7. Saving, concurrency, history, presence

### 7.1 Save model [REFERENCE, improved]

- The editor keeps a working copy in the browser. Edits are local and undoable until the user clicks **Save**. This is deliberate: the prototype's users expect to review a cascade before committing it.
- On Save, the client sends the whole schedule document to the server.

**Concurrency [DECIDED]:** replace the prototype's "last save wins" with **optimistic concurrency plus a three-way merge**. The merge is already built and tested in the prototype (`reference/source/merge.js`, 80 assertions in `test-merge.js`, plus the flow in `smoke.js`). Port it; do not redesign it.

*Server side*
- Every schedule has an integer `version` that increases on each save.
- The client sends the `version` it loaded. If the server's version is newer, the server rejects the save (HTTP 409) and returns the latest document and version. Check and write must be one atomic operation (compare-and-set, or a transaction).
- The prototype has no compare-and-set (its storage is a plain document store), so it re-reads the stored document just before writing and compares a per-save token. That leaves a small race window. Production must close it with the atomic check.

*Client side: the merge*
- The client keeps three copies of the schedule: **base** (what it loaded, or last saved), **mine** (what is on screen) and **theirs** (the latest saved version, returned with the 409).
- On a 409 (or when the user clicks "Merge now" in the newer-version banner), the client computes `merge3(base, mine, theirs)`, **puts the merged result on screen as an unsaved change, and does not save it.** The user reviews it, then clicks Save again. If yet another save has landed meanwhile, the cycle repeats.
- The merge is a pure function with no I/O. It runs in the browser; it can also run on the server if you prefer.
- A toast reports what happened ("Merged Maria's changes (3 tasks changed, 1 added) with yours. Review it, then Save.") with an Undo button. **Undoing a merge must also restore the old base**, otherwise a later save would silently overwrite theirs. The prototype stores the old base inside the undo entry.

*Merge rules (task and field level)*

| Situation | Result |
|---|---|
| Different fields of the same task changed by each side | Both kept |
| Same field changed by both to the same value | Kept, no conflict |
| Same field changed by both to different values | **Conflict**: the user chooses mine or theirs (dialog); default is theirs, so nothing already saved is replaced unless the user chooses |
| Task added by each side | Both kept; the other side's new rows are placed next to their old neighbors |
| Task deleted by one side, untouched by the other | Deleted |
| Task deleted by one side, edited by the other | **Conflict** (keep the task with the edits, or delete it) |
| Links (dependencies) | Merged one predecessor at a time: adds and removals combine; changing the same link two ways is a conflict |
| Dismissed-issue codes, custom colors | Added and removed independently |
| Row order | Whoever reordered wins; if both reordered, theirs wins; the other side's new rows are inserted by neighbor |
| Project settings (name, scale, details, colors, working days, holidays by date, shared export settings, baseline) | Same field rules; a baseline set differently by both is a conflict |

Two rules matter more than they look:
1. **Dates the engine computes are not inputs.** A task that follows predecessors and is not locked has a stored start that is just a cache of the engine's result. The merge never compares those values (otherwise every cascade would look like a conflict). Only inputs are compared: name, type, duration, lock, hold, audience, executive flag and color, links, dismissed issues, and the start of tasks that are anchored or locked. After the merge the engine recalculates every date.
2. **The merge can create a problem neither person made**, for example a circular link when A links 3 to 5 and B links 5 to 3. The merge does not hide this: the result goes through the normal engine, and the Issues panel shows it. The toast also says so.

Also keep: soft presence ("Maria is editing this schedule right now") as a courtesy so most conflicts never happen (§7.4).

### 7.2 Version history [REFERENCE]

- Every save is recorded. Saves by the same person within 10 minutes merge into one history entry. The newest 40 entries are kept.
- Restoring a version puts it on screen as an **unsaved change** that can be undone. The next save creates a new entry, so the version that was replaced is still available.
- Server-side: history is best-effort and must never block a save. Keep the pruning job (newest 40) transactional or idempotent.
- Retention beyond 40: **[OPEN]**. Proposed: keep 40; revisit if storage is not a concern.

### 7.3 Unsaved-changes nudge [REFERENCE]

After 30 minutes of unsaved edits, a banner asks the user to save ("Save now" / "Remind me later" for 15 minutes). Viewing never triggers it. Read-only users never see it. Already built and tested.

### 7.4 Presence [ASSUMED]

The prototype showed who else had the same schedule open and who was "editing" (had unsaved changes). It is a courtesy, not a lock. For production: implement with whatever the infrastructure provides (WebSocket / SSE / short polling every ~20 seconds). If real-time is unavailable, **polling the schedule's version number every ~30 seconds** is enough to power the "X saved a newer version" banner. Presence is optional for launch; the version check in §7.1 is not.

### 7.5 Autosave [OPEN]

The prototype has no autosave on purpose (see §7.1). **Do not add autosave without asking Josh.**

---

## 8. Data model

A suggested relational model. Adapt names and types to the existing database. The schedule document itself stays a JSON document (§8.2, `docs/DATA-SCHEMA.md`); do not explode tasks into rows unless there is a strong reason, because the editor reads and writes the whole document.

### 8.1 Tables

```
users                    (id, idp_subject, email, display_name, vp_employee_id, is_active, created_at)
firm_roles               (user_id, role)                      -- role in ('admin','viewer')

projects                 (id, vp_project_id UNIQUE, number, name, client, vp_status, is_archived,
                          vp_missing, synced_at)
project_team             (project_id, user_id, vp_role)       -- vp_role in ('pic','pm','pa','team'); replaced on each sync
project_access_override  (id, project_id, user_id, kind, reason, created_by, created_at)
                         -- kind in ('deny','grant_viewer','grant_editor'); at most one row per (project,user)

schedules                (id, project_id, name, is_primary, doc JSONB, version INT,
                          created_by, created_at, updated_by, updated_at, deleted_at)
schedule_history         (id, schedule_id, saved_by, saved_at, doc JSONB)
templates                (id, name, description, doc JSONB, is_active, created_by, created_at, updated_at)

firm_settings            (key, value JSONB)                   -- includes the firm holiday list
audit_log                (id, at, actor_user_id, action, project_id, schedule_id, detail JSONB)
sync_runs                (id, started_at, finished_at, ok, projects_seen, error)
```

Constraints:

- `schedules.project_id` is NOT NULL for new schedules. (Migrated schedules may start in an "unassigned" holding state. See §10.)
- At most one `is_primary = true` per project.
- Soft-delete schedules (`deleted_at`) so an accidental delete can be undone by a firm admin for some period. [ASSUMED]
- Index `schedules(project_id)`, `project_team(user_id)`, `project_access_override(project_id, user_id)`.

### 8.2 Schedule document

See `docs/DATA-SCHEMA.md` and `docs/schedule.schema.json`. The document is validated on the server on every save with the same rules the client uses to normalize on load (dates, colors, durations, dependency types, caps such as 16 custom colors). Reject or sanitize unknown shapes; never store raw client JSON unchecked. The engine (`engine.js`) can be reused on the server for validation and for computing dates in any server-side feature.

Size: a typical schedule is under 100 KB. Set a hard cap (proposed 2 MB) and return a clear error.

### 8.3 Dates

All dates in schedule documents are calendar dates (`YYYY-MM-DD`), with no time zone. The engine uses epoch-day integers in UTC internally to avoid daylight-saving bugs. Keep it that way. Do not convert to local `Date` objects.

---

## 9. API surface (suggested)

REST shown for clarity; use whatever the existing infrastructure uses (REST, tRPC, GraphQL). All endpoints require sign-in and enforce §4.

```
GET    /api/me                                   current user, firm roles, last VP sync time
GET    /api/projects?scope=mine|all&status=active|archived&q=...&hasSchedule=true|false
GET    /api/projects/:id                         project + caller's effective access
GET    /api/projects/:id/schedules               list (no documents)
POST   /api/projects/:id/schedules               { name, templateId, startDate? }             WRITE
GET    /api/schedules/:id                        full document + version + caller's access
PUT    /api/schedules/:id                        { doc, baseVersion }  -> 200 {version} | 409 {latest}   WRITE
PATCH  /api/schedules/:id                        { name?, isPrimary? }                         WRITE
DELETE /api/schedules/:id                                                                       WRITE
GET    /api/schedules/:id/history                list of entries
GET    /api/schedules/:id/history/:hid           one entry's document
POST   /api/schedules/:id/duplicate              { destProjectId, name, startDate? | keepDates } source READ+, dest WRITE
GET    /api/schedules/:id/meta                   { version, updatedBy, updatedAt }  (cheap; for polling)

GET    /api/projects/:id/access                  people + source + effective access            ADMIN
PUT    /api/projects/:id/access/:userId          { kind: deny | grant_viewer | grant_editor, reason? }   ADMIN
DELETE /api/projects/:id/access/:userId          remove the override                           ADMIN
GET    /api/directory?q=...                      people search for "add person"                ADMIN

GET    /api/templates                            active templates (no documents)
GET    /api/templates/:id
POST   /api/templates                            { name, description, fromScheduleId? | doc }  firm admin
PUT    /api/templates/:id                        firm admin
POST   /api/admin/vp-sync                        firm admin
GET    /api/admin/audit?...                      firm admin
GET/PUT /api/admin/firm-holidays                 firm admin
```

Errors: use clear, human-readable messages the UI can show as-is. 403 for lack of access (do not reveal existence for NONE; return 404 instead). 409 for version conflicts. 413 for oversize documents.

---

## 10. Migration of prototype schedules [ASSUMED]

The prototype stores schedules in its platform's database and has no project concept. Plan:

1. **Export:** a script (or an export button added to the prototype) dumps every schedule document as JSON, with `name`, creator and timestamps. History is optional.
2. **Import:** a firm-admin tool loads each JSON into `schedules` with `project_id = NULL` ("Unassigned") and `version = 1`.
3. **Assign:** firm admins assign each unassigned schedule to a project. Unassigned schedules are visible only to firm admins and their creator until assigned.
4. After assignment, project details (number/client) can be refreshed from VP.
5. The prototype's firm holiday list (`config/holidays`) moves to `firm_settings`.

How many schedules exist today: **[OPEN]**. Probably very few (it's a test environment). If fewer than ~10, assigning by hand is fine.

Do **not** migrate per-browser settings (`schedsheet:*` localStorage keys). They are device preferences. (Project-wide export settings are already inside the schedule document.)

---

## 11. Non-functional requirements

**Security**
- All authorization server-side (§4.5). Treat any client claim of role or access as untrusted.
- No VP credentials or secrets in client code or responses.
- The UI builds DOM with a helper that sets `textContent`; the `html` option is used only for internal icons. Keep that rule. Never inject user text as HTML. Enforce a Content-Security-Policy.
- Colors are validated as presets or `#rrggbb` before being written into CSS. Keep the validation on the server too.
- Rate-limit save and duplicate.
- **[OPEN]** Hosting and data-residency requirements for federal projects. Josh/IT to say whether anything in schedules (task names, dates) could be restricted, and where the data may live.

**Privacy**
- The audit log and history store user ids; show display names in the UI. Names of departed staff must remain on history.

**Accessibility**
- The prototype already uses native controls, keyboard operation for rows and dialogs, `aria-live` toasts, `aria-pressed`/`aria-checked` states and visible focus. Do not regress these. Target WCAG 2.1 AA.

**Browsers and devices**
- Current Chrome, Edge, Safari (macOS and iOS), Firefox. The editor must be usable at phone width (the prototype has several phone-specific fixes; keep them).

**Performance**
- Editor must stay responsive with at least 200 tasks. (The prototype was tested with 80.)
- The project grid must load in under 2 seconds with several hundred projects.

**Offline / flaky networks**
- A failed save must keep the user's working copy and say so. Never discard unsaved edits on a failed save.

**Dependencies loaded at runtime**
- The prototype lazy-loads `xlsx 0.18.5`, `jsPDF 2.5.1` and `JSZip 3.10.1` from a public CDN, and fonts (IBM Plex, Barlow Condensed) from Google Fonts. In production, **self-host these** (also needed for a strict CSP). Check licenses (SheetJS Community 0.18.5 is Apache-2.0).
- The Arch Nexus logo is embedded as a data URI in `logo.js`. Replace with a hosted asset (and add a way for a firm admin to replace it).

**Observability**
- Log errors with enough context to find the schedule and user. Surface VP sync health to firm admins.

---

## 12. Decisions Kent must make

1. Front-end approach: keep the editor as framework-free modules (lowest risk, recommended) or rebuild the UI in the firm's framework. Either way, `engine.js` and its tests are kept as-is, and the editor's behavior must match `docs/EDITOR-FEATURES.md`.
2. Back-end language, framework, database (the relational model in §8 is a suggestion; JSONB-style document storage for the schedule is strongly recommended).
3. Identity provider integration and user matching (§2.2).
4. VP access method (§3.2) and sync schedule.
5. Real-time presence mechanism, or polling only (§7.4).
6. Where templates, firm holidays, the logo and the audit log live in the existing system.
7. Deployment, environments, and how to run the reference tests in CI.

---

## 13. Suggested phases

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | Answers to the [OPEN] items marked blocking: IdP, VP method, VP status values, who are firm admins/viewers | Kent and Josh sign off |
| 1 | Toolbox shell + sign-in + module registry + users/roles + audit log | A user signs in and sees an empty Scheduler item |
| 2 | VP sync (projects, team, employees) and effective-access function with unit tests | Access table matches §4.3 for a hand-checked sample |
| 3 | Scheduler home + project page + read-only editor | Real projects show; a READ user can open a schedule view-only |
| 4 | Editor write path: save with version check, history, create from template (incl. Blank) | Two people saving at once never overwrite each other |
| 5 | Project admin view + manual grants/denies | Remove/restore a person; survives a VP sync |
| 6 | Duplicate (with the §4.4 rule), archived behavior, templates admin, set-as-primary | Duplicate blocked where the user lacks WRITE on the destination |
| 7 | Migration of prototype schedules, firm holidays, logo, self-hosted libraries | Prototype can be retired |
| 8 | Hardening: security review, accessibility pass, load test, runbook | Go-live checklist (§14) complete |

---

## 14. Acceptance criteria

**Access and permissions**
1. A user on a project's VP team, not PIC/PM/PA, can open that project's schedules view-only and cannot edit, delete, create or restore. The server rejects those calls even if the UI is bypassed.
2. A VP-derived PIC/PM/PA can edit and can open the admin view for their project only.
3. A manual deny removes a VP-assigned person's access. It is still in effect after a VP sync. Restoring it returns the VP-derived access.
4. A project admin cannot deny another PIC/PM/PA of the same project, and cannot deny themselves.
5. A firm viewer can read every project and edit none, unless separately granted.
6. A person with NONE access cannot see the project in any list, search or API response.
7. Revoking access mid-session causes the next save to fail with a clear message, and the user's unsaved work remains on screen.
8. Duplicate: succeeds only when the user has READ or WRITE on the source and WRITE on the destination. The destination list never shows projects where they lack WRITE. A direct API call with a disallowed destination returns 403.

**Projects and schedules**
9. Active projects show in the grid. Archived projects with schedules show in the collapsed section. Archived projects without schedules do not show.
10. An active project with no schedules says "No schedule exists" and offers New schedule to WRITE/ADMIN users only.
11. New schedule offers Blank plus all active templates; the result is independent of the template afterwards.
12. A project with several schedules has exactly one primary.
13. Archived-project schedules open view-only for everyone and reject writes at the server.
14. Duplicate with "new start date" shifts all dates by the same delta and preserves every dependency, lag, lock and hold; the earliest task starts on the chosen date; baseline is not copied; project details come from the destination project.

**Saving**
15. Two users open the same schedule; A saves; B saves without reloading. B never overwrites A: B's edits are merged with A's on screen unsaved, and only a second Save writes. Where both changed the same field, B must choose, and the default keeps A's value. Undoing the merge restores B's pre-merge state *and* base so a later save merges again instead of overwriting.
16. A failed save (network error) keeps the working copy and the unsaved state.
17. History shows entries; restore puts the version on screen as an unsaved change; undo reverses it; the next save adds a new entry and keeps the replaced one.

**VP sync**
18. A failed or empty VP response changes nothing and logs a failure.
19. A project removed from VP is kept, marked, and its schedules become view-only.
20. A PM change in VP moves write/admin rights on the next sync. Manual overrides are unchanged.

**Editor parity** (all must still pass in the new environment)
21. `reference/tests/smoke.js`, `export-test.js`, `legacy-test.js` and `reference/source/test-engine.js` pass, adapted only at the platform seam (`docs/PLATFORM-SEAM.md`).
22. The editor behaves as in `docs/EDITOR-FEATURES.md` at desktop and at 330 px width.

**Exports**
23. Exports never include tasks the viewer's selected audience should not see. (Executive/client exports exclude design and internal tasks; baseline/slip can be turned off in an export but never forced on.)

### Go-live checklist
- [ ] All [OPEN] items resolved or consciously deferred.
- [ ] Penetration or security review of authorization paths done.
- [ ] Accessibility check on the grid, project page and admin view.
- [ ] Backup and restore tested for schedules and history.
- [ ] VP sync monitored with alerting on failure.
- [ ] Runbook: how to fix a lockout, how to re-run sync, how to restore a deleted schedule.

---

## 15. Open questions, collected

Blocking (needed before building):
1. Identity provider and how users map to VP employees (§2.2).
2. VP cloud or on-premises, and the access method (§3.2).
3. VP status values and which count as Archived (§3.3).
4. Who the firm admins and firm viewers are at launch (§4.2).
5. Do any projects need a "restrict copying" control (§5.4)?

Can be decided during the build:
6. Default for Duplicate: keep dates, or set a new start date (§5.4).
7. ~~Conflict handling on save~~ (decided: three-way merge, §7.1). Still open: whether the merge should also run on the server, and a UI for resolving conflicts more than one at a time.
8. History retention beyond 40 entries (§7.2).
9. Real-time presence or polling only (§7.4).
10. Template categories (§5.3).
11. Whether "All projects" is visible to ordinary users or only to firm roles (§5.1).
12. Audit log retention (§2.4).
13. Hosting / data-residency for federal projects (§11).
14. How many prototype schedules need migrating (§10).

Ideas parked for later (not in scope now): JSON backup/restore for individual schedules, Excel/CSV **import** of tasks, a compact phone layout, cross-project portfolio view built from each project's primary schedule, notifications when someone saves, a "who changed what" per-task change log.

---

## 16. Next iteration: the redesign preview [REFERENCE, Oct 10 2026]

A redesigned build of the Scheduler is published as a **separate preview** next to the live prototype. It is the visual and interaction reference for the Toolbox port, and it supersedes §5.6 where the two differ. The schedule document is backward compatible: v34 schedules open, recalculate and save unchanged (`tests/e2e-legacy.py`). The engine (`engine.js`) is unchanged.

### 16.1 What the preview adds
- **Toolbox shell:**
  - A module registry with the side bar (`shell.js`).
  - Hash routing: `#/scheduler` for home, `#/scheduler/p/<projectId>` for a project, `#/scheduler/s/<scheduleId>` for a schedule.
  - Breadcrumbs, the user chip, and a collapsible side bar that becomes a drawer on phones.
- **Project browser and project page (§5.1, §5.2):**
  - Search, active and archived groups, recent projects, and unassigned (legacy) schedules.
  - Each project has a primary schedule.
  - Projects are a **local list labeled as such**, because Vantagepoint is not connected. All project reads and writes go through `data.js`, so swapping in VP touches one file.
- **New schedule (§5.3):** a template wizard (`templates.js`) with phase lengths in whole weeks.
  - Each phase runs Monday to Friday, and the next phase starts the following Monday.
  - Snapping to working days happens once, at creation.
  - The resulting schedule has no flags.
- **Duplicate (§5.4):** `dup.js` is pure and tested.
  - All dates shift by one delta.
  - History, baseline and the primary flag are not copied.
  - Commitments are copied only within the same project.
  - The rule "write access on the destination" is enforced by the server, not here.
- **Permissions (§4.3):** `permissions.js` computes `effectiveAccess()` as a pure function meant to run **on the server**. The preview does not use it for real decisions.
- **Commitments:** an optional `task.commit = {date, note}` compared with the forecast, plus a schedule-level `commitWarn` threshold. Status is late, at risk, or on track. Commitments never move dates (`commit.js`).
- **Change impact:** after each edit, a card lists:
  - what moved, how far, and the new last date;
  - commitments affected;
  - new conflicts and warnings.
  It offers Undo and a "Show what moved" detail. The analysis (`impact.js`) diffs engine results and ignores the derived starts of linked activities.
- **Editor:**
  - A compact context bar and view toolbar (Table, Timeline, Executive).
  - A dense table with a density toggle.
  - An inspector drawer that replaces the old task popup.
  - A timeline whose list is aligned with the chart, with fit-to-view and scroll-to-today.
  - Bulk actions on a multi-row selection.
  - Settings reorganized as "Schedule settings".
- **Exports:**
  - A full-window export workspace: format and audience tabs, options on the left, a true preview on the right (the actual PDF page, with page navigation), and the download button.
  - PDFs are **vector**: jsPDF's `context2d` draws the same painting code as the preview, with Lato and Roboto Condensed embedded.
  - The executive and client presets can use **phase bands**, the one-page overview from page 11 of the brand guide.
  - Options are remembered per audience, and can be shared as project defaults.
- **Design system:** Arch Nexus tokens, self-hosted fonts and Lucide icons, plus dark mode (`docs/DESIGN-SYSTEM.md`).

### 16.2 Data additions (all optional)
- **New fields:** `task.commit`, `schedule.commitWarn` and `schedule.projectId` (which becomes the `schedules.project_id` column in production).
- **New color presets:** the brand color preset keys. See `docs/DATA-SCHEMA.md` and `docs/schedule.schema.json`.
- Older clients ignore the new fields. The three-way merge (`merge.js`) treats `commit` as a task field and `commitWarn` as a schedule setting.

### 16.3 Not in the preview (by design)
- **Vantagepoint:** project lists, teams and status from VP (§3).
- **Permissions:** enforcing them (§4.5), and the project admin view (§5.5).
- **Working-day durations:** written up as a proposal only, in `docs/WORKING-DAYS-PROPOSAL.md`.

### 16.4 Tests
| Suite | What it covers |
|---|---|
| `node test-engine.js` | Engine (53) |
| `node test-merge.js` | Three-way merge (80) |
| `node tests/test-units.js` | Templates (including schedule-to-template conversion), commitments, impact, permissions, duplicate (199) |
| `python3 tests/e2e-export.py` | Export workspace and every file type in real Chromium, including PDF fonts and vector text (39) |
| `python3 tests/e2e-legacy.py` | v34 schedules load, recalculate and save unchanged (7) |
| `python3 tests/e2e-templates.py` | Templates module: library, Save as template, template editing, wizard phases, move to company, starters, managers, non-manager limits (41) |

The prototype's jsdom smoke suite (`smoke.js`, about 296 checks) does **not** cover the redesign. Its selectors target the old markup. The end-to-end tests above plus the browser QA flow replace it for this iteration. Porting the smoke suite to the new markup is open work.

### 16.5 Templates module [DECIDED with Josh, Oct 10 2026]
A Templates page under Scheduler (`#/scheduler/templates`, in the side bar and on the Scheduler home). Code: `tpl-store.js` (data and access), `tpl-ui.js` (page, dialogs, editor template mode), with conversions in `templates.js`.

**Two libraries**
- **Company templates** are offered to everyone in the new-schedule wizard, grouped by category.
  - The seven starter templates ship with the app.
  - A template manager can edit a starter, which stores a company copy under the same id, or remove one, which stores a hidden marker. A removed starter can be restored.
- **My templates** are private to each person. In this preview they are stored under `data/users/<id>/`, which no one else can read, the page owner included. People add to them by:
  - **New template**, which starts blank, from any template, or from any schedule;
  - **Save as template** in a schedule's ⋯ menu;
  - **Duplicate** on any template card. This is how a template is based on an existing one.

**Editing.** A template opens in the full schedule editor (table, timeline, executive view). Activities, milestones, links (FS/SS, lags), audiences and executive flags all work as in a schedule.
- **Sample dates:** the editor lays the template out from a sample start date, the next Monday. Only lengths, links and offsets are stored.
- **Not part of a template:** history, export, commitments and date locks.
- **Template settings** (in place of Settings):
  - name, category and description;
  - the executive overview on/off;
  - which activities the new-schedule wizard asks about, with their length in weeks. Each activity's inspector also has a "New-schedule wizard" checkbox.

**From a schedule to a template.** Saving a schedule as a template keeps lengths, links, lags, audiences and executive flags.
- **Dates:** an activity with no links keeps its distance in days from the earliest one.
- **Locks are dropped:** a locked activity becomes an ordinary linked one, or keeps its offset if it has no links. Holds, commitments, dismissed issues, baselines and history are dropped too.
- **Wizard default:** the activities the wizard asks about default to the client-level activities marked Exec.

**Move to Company templates.** A template manager can move one of their own templates into the company list. It is a move, not a copy: it leaves My templates. To keep a personal version, duplicate it first.

**Template managers.** A small list kept at `config/templateManagers`. Only the page owner edits it (the database enforces that with a `write: owner` rule), and the owner always counts as a manager.
- **Production:** this becomes a firm-wide **Template manager** role (§4.2), and the server enforces it on every company-template write.
- **The preview's limitation:** writes to company templates are limited only in the interface here, because database rules cannot follow a list of people.

**Independence.** A schedule made from a template is a separate copy. Changing or removing a template never changes schedules already made from it.

**Data:** see `docs/DATA-SCHEMA.md`, "Templates".

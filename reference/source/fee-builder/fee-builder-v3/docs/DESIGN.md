# Design Rationale

## One screen for the quick fee, depth on request

- **New fee asks for four things** (name, construction cost, method, one assumption) and shows the fee before anything is created. The default phase template and an empty consultant list come with it; nothing else is required. A $15M project at 5% shows $750,000 on the first screen.
- **Progressive disclosure follows the work, not a settings tree.** A simple project has one work package, so package controls never appear until a second package is added. The labor plan stays folded until a labor component exists or a plan is started. Markup and expected-cost columns stay hidden until switched on or used. The detailed profitability panel says what it needs instead of showing empty numbers.
- **Four workflow steps, freely navigable:** Establish (shared facts) › Develop (this scenario's fee) › Analyze (phases and disciplines, financials, stress test and solve, compare) › Finalize (preferred scenario, validation, exports, snapshots, contract). They are tabs, not a wizard; nothing has to be completed in order.
- **A persistent summary rail** keeps the position in view everywhere: client fee, % of construction, $/SF, an Arch Nexus / consultants / services bar, design fee, Arch Nexus fee, net revenue, effort allowance, planned effort, headroom, and the top issues. On narrow screens it moves above the work.
- **Shared versus scenario is labeled on every section** ("Shared by all scenarios" or "Scenario: …"), so edits to shared facts are deliberate, and adding a consultant says it was added to every scenario.

## Phases and consultants, where the spreadsheets hurt most

- **Allocation is a short table**, one row per phase, with a percentage *or* a dollar amount, a lock, the resulting fee, and the duration. The footer shows the total %, the allocated amount, the unallocated balance, and a status tag (fully allocated, not fully allocated, over-allocated, or left unallocated on purpose). **Balance to 100%** is one click and respects locks. Arrow keys and Enter move down a column.
- **The phase × discipline matrix is the editing surface for consultant splits.** Each consultant column has a "Follows fee / Custom split" control in its header. Choosing Custom turns that column's cells into percentage inputs (starting from the current split), with the dollar amount under each one. No dialogs.
- **Three readings of the same matrix:** dollars, % of each discipline (what share of the structural fee falls in CD), % of each phase (what share of DD goes to each discipline). Every row and column total reconciles at the chosen rounding.
- **Package filter:** all packages combined, or one package to edit.
- **A bar chart** shows Arch Nexus and consultants by phase. The cost-loaded schedule appears under the matrix as soon as durations exist.

## Comparing approaches

- Scenarios are chips under the project name. **Duplicate** is one click and opens the copy ready for the one changed number.
- **Compare** puts every scenario on the same measures, whatever method built it, with changes against a chosen reference in dollars and percent, plus basic services by phase.
- **Stress test** sliders update a Now / Stress test / Change table immediately and never touch the scenario. **Save as a new scenario** keeps a tested variation.
- **Solve backward** asks the question in words: make [target] equal [value] by changing [the input you choose]. Presets cover the common questions ("The client will pay at most…", "We need this much net revenue…", "What fee supports our labor plan?").

## One design language across Toolbox

Fee Builder now renders from the same tokens, components, fonts, logo, and page shell as the Toolbox Scheduler. The shared files are in `src/shared/` (see its README for provenance and the rules a tool follows).

- **Shell:** the Toolbox side bar (approved logo, "Toolbox", the tool list, theme and collapse controls; a drawer on phones), breadcrumbs, and a page title row with a hairline under it. On the landing page the title is "FEE BUILDER" in Nexus Blue caps, as the Scheduler's is; once a proposal is open, the project name is the title and is editable in place.
- **Actions** sit at the right of the title row: save status, undo, redo, settings, the proposal picker, and the single primary button (New fee).
- **Workflow and scenarios** sit under the title: the four steps as a segmented control, scenarios as selectable buttons (preferred marked with a star).
- **Controls** are the shared 32 px bordered controls (28 px in tables), sentence-case buttons, segmented controls with a raised choice, banners with a colored left rule, and chips for status.
- **Type:** Roboto Condensed for headings, labels, table headers, and numbers in the summary; Lato for body text. Both are embedded, so nothing loads from the network and the fonts are now verified in screenshots.
- **Editable versus calculated:** editable values are bordered controls; calculated values are plain text. This replaces the earlier blue-tinted underline fields, which the Scheduler does not use.
- **Color:** Nexus Blue for marks, focus, and the page title; blue text uses the brand's 40% shade; orange only for warnings; red only for errors. Chart series use the brand's blue tints and shades and blue grays.
- **Light and dark** share the Scheduler's token set.

What changed from the first visual pass: the top brand bar, the blue-ruled section headings, the all-caps buttons, and the underline fields are gone. Section headings are now the Scheduler's hairline-over-condensed-caps pattern.

## Small things that matter in daily use

- Numbers accept `15m`, `250k`, `$1,250`, `(500)` and reformat on leaving the field. Typing never moves focus or rebuilds the field being edited; calculated cells repaint in place.
- Undo and redo (Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z) cover every change, with rapid typing in one field grouped into one step.
- Save status is always visible (Saving, Saved, Saved in this browser, Not saved, Edit conflict) and a failure offers a JSON backup.
- Exports are previewed in place and labeled Client-facing or Internal only.

# Fee Builder: Phase 2 Handoff

Arch Nexus Toolbox application #3. This phase rewrote the first prototype into a fee-development tool covering work packages, phase × discipline allocation, staffing plans, target-profit planning, scenarios, stress testing, back-solving, and exports. No Vantagepoint connection, by design.

Companion documents: ARCHITECTURE.md (review and decisions), CALCULATIONS.md (every formula), DATA-MODEL.md (schema and migration), WORKBOOK-NOTES.md (what the reference spreadsheets contributed and where their formulas disagree with their intent), DESIGN.md (interface rationale).

## How to run

| What | How |
|---|---|
| Use it inside Claude | The published artifact (the existing Fee Builder link, now on this version). Proposals save to the artifact's shared store; Settings are personal. |
| Use it anywhere else | Open `dist/fee-builder-standalone.html` in a current browser. Saves to that browser only. Good for user testing. |
| Run the tests | `npm install` once (installs jsdom), then `npm test`. Needs Node 18+; developed on Node 22. |
| Rebuild after editing `src/` | `node build.js` |

## What changed from the first prototype

- **Work packages**, each priced independently and rolled into the project.
- **Mixed methods within a package:** components (% of cost, lump sum, area × rate, units × rate, labor hours × rates) that add together, with **phase coverage** so methods for different parts of the work do not overlap, and a **basis** switch for top-down (total design fee) or bottom-up (Arch Nexus share).
- **Phases:** templates (Traditional SD–CA and Design review milestones, both with percentages from the firm's workbooks; Full service with names only), add/rename/reorder/remove, save as template.
- **Phase allocation** by % or $, with locks, Balance to 100%, and an intentional-unallocated option. **Consultant splits** follow the fee or are custom per consultant, edited directly in the **phase × discipline matrix** ($, % of discipline, % of phase views; package filter).
- **Consultants:** four pricing types (fixed, quote, % of cost, % of design fee), included or additional, optional markup and expected cost (exposure), scope notes. The algebraic solve for bottom-up fees is kept.
- **Labor plans** by role × phase in hours or staffing (FTE × months) mode, with planned FTE by phase, priced into the fee or used as planned effort only.
- **Services, reimbursables, contingency, adjustments, and expenses**, each with its own pricing method and an explicit treatment (added to the client fee, included in it, or internal only).
- **Financials:** the EAC target-profit method reproduced exactly (fee → consultants → net revenue → target profit → effort allowance → FTE-months, by phase), a detailed cost model only when cost rates and overhead exist, consultant economics, thresholds, and warnings.
- **Scenarios:** duplicate, new with the same structure, delete, preferred, notes; **Compare** with deltas; **Stress test** (cost, consultants, hours, rates, fee, target profit, phase duration) with promotion to a new scenario; **sensitivity** chart; **Solve backward** for any target by an input the user chooses.
- **Finalize:** validation before export; client-facing exports (summary, by phase, by discipline, matrix, by package, cost-loaded schedule) and an internal financial analysis; Copy for Word (formatted HTML table), CSV, and Excel (.xlsx, built in, no library); **snapshots** (decision point, approved internal fee, executed contract) that reproduce exactly; contract value with additional scopes (accepted counts, proposed pending, rejected never counts or exports).
- **Settings** (personal): templates, default roles and rates, target-profit % and basis, FTE-month value and hours, overhead, rounding, warning thresholds, libraries, theme.
- **Reliability:** full-precision engine with controlled rounding; undo/redo; draft recovery; revision-based conflict detection; malformed-data repair; v2 → v3 migration with totals preserved and the original kept; JSON backup and import.
- **One Toolbox design language:** the same tokens, fonts, logo, side-nav shell, page header, buttons, controls and banners as the Scheduler (`src/shared/`, with a README of the rules), light and dark themes. See DESIGN.md.

## Test results

`npm test` on Node 22: **85 passed, 0 failed.**

**Engine (64 tests, `tests/engine.test.js`)**
- Worked examples from the workbooks: EAC totals and every EAC phase row; WSU CAMP Arch Nexus by phase (to the cent), CAMP total with services ($1,359,056), the Secure correction, the cost basis with the concept-design credit, the cost-loaded schedule split.
- Every method; mixed methods with phase coverage; multiple packages; included versus additional; all four consultant pricing types; markup and exposure; bottom-up algebra; impossible inputs; negative Arch Nexus share.
- Allocation (%, $, unallocated, intentional, over-allocation), Balance with locks, consultant splits.
- Rounding reconciliation on 150 random proposals at $1/$10/$100/$1,000.
- Staffing mode and CA extension; labor versus allowance with the required fee; missing rates.
- Services, pass-through, included and internal items, reimbursables, contingency, discount.
- Detailed profitability unavailable and available; financial warnings.
- Back-solving (fee %, revenue target, "client pays $500k", no-effect input, the $900k → $825k reduction).
- Duplication independence, stress tests never mutate, promotion, consultant cost stress, sensitivity, comparison.
- Blank, zero, and invalid inputs; save/load round trip; normalize repair; migration parity on every v2 method; contract carry-over; frozen snapshots; export totals; client exports leak nothing internal; validation gating; CSV/HTML/TSV; XLSX structure (the generated file also opens cleanly in openpyxl).

**Interface (21 tests, `tests/ui.test.js`, jsdom on the built page)**
- Workflows A to G from the brief, each clicking and typing through the real interface.
- Typing keeps the same input element and focus; undo/redo; copy for Word puts HTML and plain text on the clipboard; exports blocked until issues are acknowledged; snapshots and contract changes; Settings recalculate.
- The shared Toolbox shell: side bar with the approved logo and tool list, page title and breadcrumbs, collapse and theme controls remembered across reloads, the phone drawer, and the title box following the name length.
- Persistence: standalone save and reload; draft recovery; a v2 proposal in the shared store migrated, totals preserved, written back as v3 with the original kept; save revisions and a concurrent-edit conflict resolved; malformed saved data repaired.

**Visual review (manual, real Chromium via Playwright):** every view at 1440 px, the Develop and Analyze views and the navigation drawer at 390 px (phone; no sideways page scroll, tables scroll inside their containers), and dark mode, all with the real Lato and Roboto Condensed (now embedded). Compared against the Scheduler rendered the same way. Not compared: the two tools side by side in the live Claude artifact frame.

## Not tested

- The live artifact with real sign-ins. The shared store was empty at publish, so no real saved data has been migrated yet. Persistence was tested against an in-memory stand-in for the store.
- Two people editing the same proposal at the same moment in the live artifact (conflict detection is tested with the stand-in).
- The download confirmation inside Claude, and pasting into Word and Excel on a real desktop (clipboard content is tested; the paste is not).
- Screen readers and keyboard-only use beyond Tab, arrows, Enter, and the undo shortcuts.

## Known limitations

- **Concurrency is detected, not prevented.** Saves are not transactional; two saves in the same instant can still overwrite each other.
- **Access:** everyone the artifact is shared with sees every proposal in it. There are no per-proposal permissions.
- **Additional services, reimbursables, contingency, and adjustments are not phased**, so they are outside the matrix and the cost-loaded schedule (exports say so).
- **Phase dollar amounts** become percentages when a component covers only some phases (with a warning).
- **The cost-loaded schedule** spreads evenly over each phase's months; there are no custom monthly curves or overlapping phase-start editing beyond the stored `start` field, which has no screen yet.
- **One labor plan per package per scenario**; hours-based services are not split by phase.
- **"Reset selected assumptions"** is covered by undo and by duplicating before experimenting; there is no per-field reset.
- **Contract changes** are fixed amounts only.
- **No audit trail** beyond snapshots; undo history lasts for the session.
- **Settings are personal**, not firm-governed. New proposals copy them; existing proposals keep their own values.
- **On phones** the summary rail sits above the work and is long; dense tables scroll sideways inside their containers.
- **Toolbox tool links:** the side bar links to the Scheduler and Minutes artifacts, opening in a new tab. Not tested inside the live Claude frame, where links may behave differently.
- **Shared design files are copies**, not one served stylesheet. Nexus Minutes has not been moved onto them yet.

## Decisions that need Arch Nexus input

1. **Target profit basis:** the EAC calculator measures it on the total fee (consultants included). Is that firm policy, or should it be net revenue?
2. **Effort value per FTE-month:** EAC divides billing-rate effort by a $16,000 *cost* figure. Confirm the intended convention.
3. **Billing rates, cost rates, overhead rate:** none were supplied. The detailed model stays unavailable until they are entered.
4. **Consultant markup or handling fee policy:** none assumed.
5. **Warning thresholds** (consultant share 50% of basic services; 8 FTE in a phase) are placeholders.
6. **Rounding convention** for proposals ($1 default; $100 or $1,000 available).

## Recommended next steps

1. Give two or three principals the standalone page with one real recent proposal each; watch where they hesitate. The WSU pattern and the EAC pattern should each be rebuilt by someone other than their author.
2. Settle the six decisions above and enter firm rates in Settings.
3. Add phasing for additional services (an optional phase on each item) so the matrix can include them.
4. Add per-proposal ownership and permissions before wide sharing; consider moving storage to the Toolbox back end.
5. Add a phase start/overlap editor and connect phase timing to the Toolbox Scheduler.
6. Add an audit log of changes after an approved snapshot.

## Future Vantagepoint opportunities

Detailed in ARCHITECTURE.md section 6. In short:
- Project facts on New fee.
- Rate schedules with effective dates.
- Comparable projects and historical fees in Compare.
- Actual labor and consultant cost to calibrate thresholds and the detailed model.
- Pushing an approved snapshot's phase × discipline budget into project setup.

The data model already reserves `source` and `extRefs` for this.

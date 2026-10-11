# Spec: Fee Builder

What Fee Builder does and must keep doing, for whoever rebuilds the screens. The formulas are in `modules/fee-builder/logic/` (pure code, 64 engine tests) and in the original `CALCULATIONS.md`; language-neutral figures are in `modules/fee-builder/tests/fixtures/` (`calc.json`, `rules.json`).

Longer background kept as written: `reference/source/fee-builder/fee-builder-v3/docs/` (`HANDOFF.md`, `ARCHITECTURE.md`, `CALCULATIONS.md`, `DATA-MODEL.md`, `WORKBOOK-NOTES.md`, `DESIGN.md`).

## 1. What it is

A fee-development tool for proposals: price a project several ways, see what is left for Arch Nexus after consultants, test whether the effort fits, compare scenarios, and issue figures that reproduce. It has no Vantagepoint dependency for its numbers; a proposal can be linked to a Vantagepoint project for access and the project number.

## 2. The workflow (four views)

| View | What the person does |
|---|---|
| Establish | Project facts, work packages (each with its own construction cost, area, units), phases (from a template: Traditional SD to CA, Design review milestones, Full service), the consultant roster, roles and billing rates, and the link to a Vantagepoint project. |
| Develop | Price each package: components that add together (percent of cost, lump sum, area x rate, units x rate, labor hours x rates), with phase coverage so methods for different parts of the work do not overlap, and a basis (top-down total design fee, or bottom-up Arch Nexus share). Add consultants (fixed, quote, % of cost, % of design fee; included or additional; markup; expected cost), services, reimbursables, contingency, adjustments. |
| Analyze | Phase allocation (by % or $, locks, balance to 100%), the phase x discipline matrix, financials (effort allowance, target profit, FTE-months, staffing), scenarios (duplicate, compare, preferred), stress tests (cost, consultants, hours, rates, fee, target profit, phase length) and back-solving ("what fee gives $900,000?"). |
| Finalize | Validation, client-facing exports (summary, by phase, by discipline, matrix, by package, cost-loaded schedule) and an internal analysis; Copy for Word, CSV, Excel; snapshots (decision point, approved internal fee, executed contract) that reproduce exactly; contract value with additional scopes (accepted counts, proposed is pending, rejected never counts). |

A right-hand summary rail shows the client fee, the split, net revenue, the effort allowance and warnings, and updates as the person types. There is a sandbox example proposal that is never saved.

## 3. Rules that matter (tested by fixtures)

- Calculations run at full precision; figures are rounded once for presentation to the proposal's increment ($1 default; $10, $100, $1,000 available). Halves round away from zero; parts use the largest-remainder method so rows, columns and totals always reconcile.
- Included consultants come out of the design fee (top-down) or are added to it (bottom-up, solved algebraically when priced as a percent of the design fee); additional consultants raise the client fee. Markup stays in Arch Nexus revenue.
- Effort allowance = net revenue minus target profit (default 15% of the client fee, or of net revenue by setting); FTE-months divide by a firm value per FTE-month ($16,000 in the EAC calculator).
- Impossible inputs (included percentages reaching 100% in bottom-up) are errors, not silent numbers. A negative Arch Nexus share is flagged.
- A snapshot freezes a proposal's figures; it must reproduce after the live proposal changes. Contract status: original, accepted, pending, current, if-accepted.
- Client-facing exports never contain internal information; export is blocked by errors until the person acknowledges them.

Fixtures cover the EAC and WSU worked examples (to the cent), every consultant pricing type, labor build-up, markup and exposure, target-profit basis, rounding, contract value and back-solving. The engine's own 64 tests cover the rest (migration, allocation, stress tests, exports).

## 4. Data

Module `fee-builder`. All records carry the envelope fields set by the server.

| Collection | Record | Access |
|---|---|---|
| `owned-proposals` | One proposal document (`schema: 3`): packages, phases, roster, roles, scenarios (per-package pricing, consultants, items, allocation, labor), snapshots, contract, changes, `source`, `extRefs` | Linked to a project: that project's access (PIC, PM, PA edit; team reads; others none). Not linked: its author and firm admins edit, firm viewers read, nobody else sees it. |
| `personal-settings` | One person's settings, id `settings-<person id>`: roles and rates, templates, target-profit basis and percent, FTE-month value and hours, overhead, rounding, thresholds, libraries | Only that person. |

A proposal linked to a Vantagepoint project carries `extRefs.vp = { projectId, number }`; the record's project link is what the server uses for access. Documents saved by the first prototype (v1/v2) migrate on load with totals preserved and the original kept (`legacyOriginal`).

## 5. Behavior outside the figures

- Edits save about 0.7 seconds after the last keystroke; every edit also keeps a draft on the computer, offered back after a crash.
- Saves are compare-and-set on the server's revision. If someone else saved first, the person chooses which version to keep.
- Undo and redo (150 steps per proposal).
- Other people's changes arrive by polling.

## 6. Permissions summary

Who can see a pursuit that is not linked to a project is a decision, not a law of nature (section 7). Once linked, access follows the project exactly like the other tools. Firm admins can edit any proposal; firm viewers can read them. Personal settings are private even from firm admins.

## 7. Open questions

For Josh (carried from the source handoff, still open): target-profit basis (the EAC calculator uses the client fee: policy, or net revenue?); the effort value per FTE-month ($16,000 is labelled a cost figure in the workbook); real billing, cost and overhead rates (the detailed profitability model stays unavailable until entered); consultant markup policy; warning thresholds (consultant share 50% of basic services, 8 FTE in a phase are placeholders); the rounding convention.

Decided provisionally and worth confirming: pursuits start unlinked and private (author, firm admins, firm leadership) and are linked to a project later; whether a wider group (all principals?) should see pursuits needs a sharing rule that does not exist yet.

Not built: phasing for additional services (they are outside the matrix), a phase start/overlap editor, custom monthly curves for the cost-loaded schedule, per-field reset, an audit trail after an approved snapshot, a connection to the Scheduler's phase timing.

## 8. Tests

`npm test`: the 64 original engine tests (`baseline.test.js` holds the count), the fixture runner (`calc-fixtures.test.js`, 19), and 25 interface tests against a real server (14 original workflows, plus saving, drafts, v2 migration, conflict choices, malformed-data repair, project linking and who can see what, personal settings, and a backup round trip).

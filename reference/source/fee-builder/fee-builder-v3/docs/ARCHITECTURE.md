# Fee Builder: Review and Architecture Decisions

## 1. The first prototype

**Strengths kept**
- A pure calculation engine separate from the interface, with automated tests (68 checks).
- The shared project-level consultant roster, priced independently in each scenario.
- The "included in the fee / additional to the fee" distinction, and the algebraic solve for consultants priced as a % of the design fee in bottom-up fees.
- Multiple scenarios with a comparison, a preferred scenario, a frozen baseline, and additional scopes whose rejected items never count or export.
- Plugs visibly different from calculated values; a copyable fee table.

**What had to change**

| Prototype | Problem | Now |
|---|---|---|
| One fee method per scenario | Real fees mix methods (WSU, the brief's examples) | Components per package, each with its own method and phase coverage |
| One package | WSU has a primary facility, a secure facility, and site work | Work packages, each priced independently, rolled up without double counting |
| No phases | Phase and phase × discipline allocation is the core requirement | Configurable phases and templates, allocation with locks and Balance, per-consultant splits, an editable matrix |
| Every line rounded to whole dollars as it went | Small drifts; totals could not reconcile by construction | Full precision internally, rounding once at presentation with controlled rounding |
| Hourly fees forced consultants to "additional" | Not always true | Treatment is always the user's choice |
| No financial view | The EAC workflow and profitability were missing | Target-profit planning (reproducing EAC exactly), an optional detailed cost model, thresholds, and warnings |
| Last-write-wins saving, no recovery | Silent loss of work possible | Revision-based conflict detection, local draft recovery, JSON backup, and a migration that keeps the original |
| Yellow plug fields, a navy palette, Archivo / IBM Plex | Not Arch Nexus | The shared Toolbox design language (tokens, type, logo, shell) from the Scheduler, in `src/shared/` |

## 2. Source structure

```
src/engine/   pure calculation; runs in Node and the browser; no DOM
  money.js      parsing user numbers, rounding, largest remainder, controlled rounding
  model.js      data model, defaults, factories, structural edits, normalize, v2 -> v3 migration
  calc.js       compute(proposal, scenario, settings) -> result, present(), costLoaded(), rebalance()
  analysis.js   solve(), stress tests, sensitivity, thresholds(), snapshots, compare()
  exporter.js   export tables, validate(), CSV / HTML / TSV, a dependency-free XLSX writer
  sample.js     the example proposal (illustrative numbers)
src/ui/       interface; reads engine results, never calculates
  util.js       formatting, icons, id-based paths into a proposal
  store.js      state, undo/redo, persistence, drafts, conflicts
  views.js      HTML for each region from (proposal, scenario, result)
  app.js        events and actions
  styles.css    Fee Builder's own rules and aliases onto the shared Toolbox tokens
src/shared/   fonts, tokens, components, shell, and logo shared with the Scheduler (see its README)
build.js      joins the files into dist/fee-builder.html (artifact) and dist/fee-builder-standalone.html
tests/        engine tests, interface tests (jsdom), the first prototype's engine as a migration fixture
```

There is no framework and no runtime dependency. The build only concatenates files. jsdom is a development dependency for the interface tests.

## 3. Data-model decisions

- **One truth per figure.** Inputs are stored; every derived figure is recomputed. No total is stored where it could disagree with its parts. Snapshots are the one deliberate exception: they store a frozen copy *and* a summary, and the app re-derives the summary from the frozen copy to prove they still agree ("Reproduces").
- **Shared facts versus scenario assumptions.** Packages (identity, cost, area, units), phases, roster, and rates live on the proposal. Scenarios hold methods, pricing, allocations, labor plans, durations, items, and overrides (including a per-scenario construction-cost override for scope alternatives). Structural edits (`addPhase`, `removeConsultant`, and so on) update every scenario in one step so nothing dangles.
- **Stable ids everywhere**, and an id-addressed path syntax (`scenarios#s1.pkgs.k1.components#c1.pct`) so edits survive reordering.
- **Schema version and migration.** `schema: 3`. `normalize()` repairs malformed or partial data (missing arrays, dangling references, unknown enums) and never throws for ordinary bad data; `migrateV2()` upgrades the first prototype with totals preserved (tested scenario by scenario against the original engine). The original is kept on the record as `legacyOriginal`.
- **Integration fields reserved, not used:** `source` (where facts came from) and `extRefs` (external identifiers). See section 6.

Full schema: DATA-MODEL.md.

## 4. Calculation decisions

- **Components add; the basis says what they add up to.** That single rule supports top-down, bottom-up, and mixed fees without double counting, and keeps "a fee entered as a total" distinct from "a component of the total".
- **Phase coverage** on components, rather than a separate structure per phase, prevents overlaps while keeping simple fees simple.
- **Allocation never rebalances itself.** Locks and Balance are explicit; an unallocated balance is either acknowledged (information) or flagged.
- **Algebra instead of iteration** wherever a quantity depends on itself (included % of design fee in bottom-up packages). Impossible combinations are errors.
- **Every metric is affine in any single input**, so back-solving is exact and fast, and the solver can report "this input does not affect that target".
- **Two financial views, never mixed.** The EAC target-profit method (planning, billing-rate based, matches the firm's tool) and a detailed cost model (only with cost rates and overhead). Neither is presented as accounting profit.
- **No invented policy.** Billing rates, cost rates, overhead, and markup start blank. Target profit (15%, basis = client fee) and $16,000 per FTE-month come from the EAC workbook and are labeled as such. Phase-template percentages are labeled with their source workbook.

## 5. Persistence

| Where | What |
|---|---|
| Inside Claude | Proposals are documents in the artifact's shared `db` collection `proposals`, visible to everyone the artifact is shared with (Contributor or above can write). Settings are in each viewer's private subtree `data/users/<id>/settings`. |
| Standalone page | Browser `localStorage` (this browser only). |
| Always | A local draft of every unsaved change (`fb3.draft.<id>`), offered back on reload if it is newer than the saved copy. |

- Saves are debounced (about 0.7 s) and carry a revision number. When the store delivers a newer revision of a proposal that has unsaved local edits, the app stops and asks which version to keep. This detects most concurrent edits but is **not transactional**: two saves landing in the same instant can still overwrite each other.
- Documents over about 240 KB are refused with a message (delete old snapshots or scenarios). The example proposal is about 17 KB.
- JSON export and import provide a portable backup.

## 6. Future integration (documented, not built)

Nothing in this phase talks to Vantagepoint, the Toolbox Scheduler, or any other system. These are the intended extension points, so a connector can plug in without restructuring:

| Capability | Where it would plug in | Shape |
|---|---|---|
| Project facts | `newProposal()` / Establish | name, client, number, and package cost/area supplied by a lookup; recorded in `proposal.source = {kind, fetchedAt}` and `extRefs = {vantagepoint: {projectId}}` |
| Rate schedules | the proposal `roles` table (copied from Settings today) | `[{id, name, billRate, costRate}]` with an effective date and source |
| Comparable projects and historical fees | a read-only panel in Compare | a list of `{project, cost, area, fee, phases}` evaluated with the same `compute()` |
| Actual labor and consultant cost | thresholds and the detailed model | actual hours by role and phase, actual consultant invoices |
| Approved planning data out | from an `approved` or `contract` snapshot | the frozen scenario plus `present` totals by phase and discipline |
| Toolbox Scheduler | `costLoaded()` | phases with start and duration in months are already independent of the fee model; a scheduler could supply them instead of the scenario's `schedule` |

The `source`/`extRefs` fields round-trip through `normalize()` today, so nothing about the stored data needs to change when a connector arrives.

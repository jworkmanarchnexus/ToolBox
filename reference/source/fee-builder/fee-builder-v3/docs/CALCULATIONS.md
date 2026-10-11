# Fee Builder: Calculation Reference

The calculation engine lives in `src/engine/`. It is pure JavaScript with no screen code, so every rule below can be tested without a browser (`node tests/run.js`). If this document and the code disagree, the code is what runs; please report the discrepancy.

Files: `money.js` (parsing, rounding), `model.js` (data model, migration), `calc.js` (one scenario), `analysis.js` (back-solving, stress tests, thresholds, snapshots, comparison), `exporter.js` (export tables and files).

---

## 1. Financial definitions

These terms are not interchangeable. The interface and exports use them exactly as defined here.

| Term | Definition |
|---|---|
| **Design fee** | A work package's fee for basic services. It *includes* consultants marked "Included in design fee". |
| **Arch Nexus fee** | Design fee minus included consultants. What remains for Arch Nexus's own basic services. |
| **Basic services** | Design fee plus consultants marked "Additional to design fee". |
| **Client fee** | Basic services plus client-facing additional services, reimbursables (with markup), contingency, and adjustments (discounts are negative). This is the proposed billing amount. |
| **Consultant fees in proposal** | What the client is charged for consultants (client amounts), included and additional. |
| **Consultant cost** | What Arch Nexus pays consultants. Equal to the client amount unless there is a markup or an explicit expected cost. |
| **Pass-through cost** | What Arch Nexus pays for reimbursables and for services provided by subconsultants. |
| **Arch Nexus net revenue** | Client fee − consultant costs − pass-through costs. The EAC calculator calls this "Est. Architectural Revenue" (FeeDirLab). |
| **Held contingency** | Contingency added to the client fee. Counted in net revenue but held back from planning. |
| **Internal reserves** | Items marked "internal planning only" (contingency reserves, project expenses, internal services). Never shown to the client. |
| **Target profit** | Target-profit % × the chosen basis (client fee by default, which matches the EAC calculator; or net revenue). A planning assumption. |
| **Effort allowance** | Net revenue − held contingency − internal reserves − target profit. The most effort, *valued at billing rates*, that still leaves the target profit. The EAC calculator calls it "Est. Max amount to plan effort to" (EAC Bill). |
| **Planned effort** | Labor-plan hours × billing rates (plus hours-based Arch Nexus services). Not payroll cost. |
| **Direct labor cost** | Labor-plan hours × cost rates. Only available when every staffed role has a cost rate. |
| **Projected profit** (detailed) | Earned revenue − direct labor cost − overhead − internal reserves, where earned revenue = net revenue − held contingency and overhead = direct labor cost × overhead rate. Only available when cost rates and an overhead rate exist. |

Effort allowance is a planning figure, not an accounting profit. Projected profit is a model, not a guarantee. Where an input is missing, the app shows "not available" with the reason rather than an apparently precise number.

## 2. Structure

A **proposal** holds shared facts: work packages (each with construction cost, area, units), phases, the consultant roster, and the rate table. A **scenario** holds everything that can vary: how each package's fee is built, consultant pricing, phase allocations, labor plans, durations, services and adjustments, and finance overrides. Scenarios never change shared facts; editing a shared fact deliberately updates every scenario.

Each scenario computes each work package independently, then adds the packages and the scenario's services and adjustments into the project figures. Nothing is counted twice: packages are disjoint, and every item states whether it adds to the client fee, is already included, or is internal.

## 3. Fee components and basis

A package's fee is built from one or more **components**. Each component produces an amount:

| Method | Amount |
|---|---|
| % of construction cost | package construction cost × % |
| Lump sum | the amount entered (may be negative, for example a credit for work already paid) |
| Area × rate | (area override, or package area) × rate |
| Units × rate | (unit override, or package units) × rate |
| Labor hours × rates | Σ over the phases the component covers of the labor plan's billing value |

Components **add together**. The package's **basis** says what they add up to:

- **Total design fee** (top-down). Components = design fee. Arch Nexus fee = design fee − included consultants.
- **Arch Nexus share only** (bottom-up). Components = Arch Nexus fee. Design fee = Arch Nexus fee + included consultants.

A scenario may override a package's construction cost, area, or units without changing the project facts (useful for "what if the budget is $X" scenarios).

### Covering phases (mixed methods without double counting)

Each component covers **all phases** (default) or a chosen subset. Use subsets when different methods price different parts of the work, for example architecture at 4% of cost for SD through bidding, plus construction administration from staffing hours for CA only. The interface shows coverage on every component. The engine does not guess at overlap: two components covering the same phase both count, by design (for example, an interior-design area rate on top of architecture).

## 4. Consultants

Every consultant on the shared roster can participate in each package of each scenario (`on`), and is priced one of four ways:

| Pricing | Client amount | Cost to Arch Nexus |
|---|---|---|
| Fixed $ in fee | amount entered | expected cost if entered, else amount ÷ (1 + markup) |
| Consultant quote (cost) | quote × (1 + markup) | quote |
| % of construction cost | package cost × % | expected cost if entered, else amount ÷ (1 + markup) |
| % of design fee | package design fee × % | expected cost if entered, else amount ÷ (1 + markup) |

Markup defaults to blank (0%). Arch Nexus has no stated markup policy in the supplied materials, so none is assumed. A markup or an explicit expected cost below the client amount shows up as Arch Nexus revenue. An expected cost *above* the client amount shows the exposure.

**Treatment:**
- **Included in design fee**: the client amount comes out of the design fee, reducing the Arch Nexus share. It does not change the client fee.
- **Additional to design fee**: the client amount is added, raising basic services and the client fee.

Labor-based fees no longer force consultants to be additional (the first prototype did). In bottom-up packages an included consultant simply adds to the Arch Nexus fee to form the design fee.

### Solving percentages of the design fee

In a top-down package, "% of design fee" is a simple product. In a bottom-up package the design fee depends on the consultants, and a consultant priced as a % of the design fee depends on the design fee. The engine solves this directly instead of iterating:

```
design fee = (Arch Nexus fee + fixed included consultants) / (1 − Σ included "% of design fee" rates)
```

Example: Arch Nexus $400,000, civil $40,000 fixed, electrical 10% of design fee, all included. Design fee = 440,000 ÷ 0.9 = $488,889, and electrical = $48,889, exactly 10%.

If the included percentages total 100% or more there is no answer. The engine raises an error, ignores those percentages, and says so; it never substitutes a value silently.

## 5. Phase allocation

### Package fee by phase

1. **Labor components** are spread by their own hours by phase (only over the phases they cover).
2. **All other components** are spread by the package's **phase allocation**: each phase holds either a percentage or a dollar amount.
   - A dollar entry takes that amount. A percentage entry takes the component pool × %.
   - Whatever is left is the **unallocated balance**. Positive means some fee is not assigned to a phase; negative means the phases are over-allocated.
   - A component limited to certain phases is spread over those phases in proportion to their percentages (renormalized to 100% within its coverage). If a phase uses a dollar amount while some component has limited coverage, the dollar amount is converted to a percentage of the pool and a warning explains it.

### The unallocated balance: intentional or an error

- Unallocated and not acknowledged: **warning** ("not fully allocated").
- Unallocated and marked "leave the balance unallocated on purpose": **information** only. The amount appears in an "Unallocated" row so totals still reconcile.
- Over-allocated: **error**.

### Balance (an explicit action, never automatic)

**Balance to 100%** leaves locked phases and dollar phases alone and scales the unlocked percentages in proportion so the total is exactly 100% (to 0.01%, with the residue placed on the largest phase). If every phase is locked or in dollars, or the locked phases already exceed 100%, Balance refuses and says why. Typing in a phase never rebalances other phases behind the user's back.

### Consultants by phase

Each consultant either **follows the fee** (spread in proportion to the package's allocated fee by phase) or uses a **custom split** (percentages or dollar amounts per phase of that consultant's own fee, with its own unallocated balance and warnings). Different consultants can have different splits, for example mechanical weighted toward CDs and civil toward early phases. When a consultant switches to custom, the split starts from the package's current split so nothing jumps.

### Arch Nexus by phase

- Top-down: Arch Nexus in a phase = design fee in that phase − included consultants in that phase.
- Bottom-up: Arch Nexus in a phase = the components' allocation in that phase; the design fee in that phase = Arch Nexus + included consultants.

A negative Arch Nexus share in any phase is flagged (consultant splits take more than that phase's fee).

### Matrix

For each package the engine builds a phase × discipline matrix (Arch Nexus plus each participating consultant, with an Unallocated row when needed). The project matrix is the sum of the package matrices. It answers "total fee for DD", "Arch Nexus fee for DD", "what structural receives in CD", "what share of a consultant's fee falls in CA" (the "% of each discipline" view), and "Arch Nexus revenue across all phases" (the Arch Nexus column total).

## 6. Labor and staffing

A labor plan is one per package per scenario: rows of roles × phases.

- **Hours mode:** cells are hours.
- **Staffing mode:** cells are FTE fractions; hours = FTE × phase months × hours per FTE-month (default 2,080 ÷ 12 = 173.3, configurable).

Billing value = hours × role billing rate × the scenario's rate factor (1 unless a stress test or solve changed it). Direct labor cost = hours × role cost rate. Planned FTE in a phase = hours ÷ (months × hours per FTE-month).

The plan is used two ways: a labor component prices it (only the phases it covers), and the financial analysis always compares the whole plan with the effort allowance. Capacity questions ("how many hours does this fee support?") are answered by the thresholds and the solver (section 9).

Changing a phase duration affects staffing-mode plans (more months means more hours at the same FTE) but not hours-mode plans (the same hours spread thinner). Both effects are shown.

## 7. Services, reimbursables, contingency, adjustments, expenses

Scenario-level items, each with its own pricing method (fixed, hours × rate, % of fee, % of construction, area × rate, units × rate) and an explicit treatment:

| Treatment | Effect |
|---|---|
| Added to client fee | Raises the client fee. |
| Included in existing fee | Documents scope already in the design fee. No change to the client fee. A subconsultant's or reimbursable's cost still comes out of net revenue. |
| Internal planning only | Never reaches the client. Held back from the effort allowance (and from projected profit). |

Kinds: **service** (by Arch Nexus or by a subconsultant with optional markup), **reimbursable** (amount is the expected cost; client amount = cost × (1 + markup)), **contingency** (client-facing contingency is held; internal contingency is a reserve), **adjustment** (signed; a discount is negative), **expense** (always internal).

Order of evaluation avoids circularity: services, reimbursables, and expenses are computed first. Contingency and adjustments priced as "% of basic + services" use that subtotal, which excludes contingency and adjustments themselves.

Services, reimbursables, contingency, and adjustments are not distributed by phase; exports say so.

## 8. Target-profit planning (EAC method) and detailed profitability

### Target-profit planning

```
net revenue      = client fee − consultant costs − pass-through costs
target profit    = target % × (client fee | net revenue)        [basis set in Settings]
effort allowance = net revenue − held contingency − internal reserves − target profit
FTE-months       = effort allowance ÷ effort value per FTE-month  [default $16,000, from the EAC calculator]
```

By phase, the allowance is split in proportion to Arch Nexus net revenue by phase (Arch Nexus fee in that phase plus any consultant markup in that phase). When consultants follow the fee and carry no markup, this equals the EAC calculator's method of applying the fee phase percentages. Average FTE in a phase = FTE-months ÷ phase months.

**Reproduction of the EAC Plan calculator** (automated test): $10,000,000 × 5% = $500,000 fee; consultants 35% = $175,000; net revenue $325,000; target profit 15% × $500,000 = $75,000; effort allowance **$250,000**; 15.625 FTE-months. Every phase row matches (fee, consultants, revenue, allowance, FTE-months, FTE per month).

**A consequence worth knowing.** Under this method, a fee built purely from billing-rate hours always shows planned effort above the allowance, because the method reserves target profit *on top of* effort valued at billing rates. If billing rates already contain profit, choose a lower target or use the detailed model.

### Detailed profitability

Only when every staffed role has a cost rate and Settings has an overhead rate:

| Measure | Formula (denominator stated) |
|---|---|
| Earned revenue | net revenue − held contingency |
| Direct labor cost | Σ hours × cost rate (plus hours-based services by role) |
| Overhead | direct labor cost × overhead rate |
| Projected profit | earned revenue − direct labor cost − overhead − internal reserves |
| Margin | projected profit ÷ earned revenue |
| Effective multiplier | earned revenue ÷ direct labor cost |
| Break-even multiplier | 1 + overhead rate |

No firm overhead rate, cost rates, or profitability policy were supplied, so none is assumed. Until they are entered, these measures show "not available" with the missing inputs listed.

## 9. Back-solving, stress tests, thresholds

### Back-solving

The user picks a **target** (client fee, design fee, Arch Nexus fee, net revenue, effort allowance, effort headroom, projected profit), a **value**, and **which single input changes** (a component's %, amount, or rate; a consultant's value; a labor-plan scale; a negotiated adjustment; the target-profit %). The engine never chooses the variable. Every target is affine in any single input in this engine, so two evaluations give the answer; up to six secant steps cover edge cases. The result is shown first, then applied only if the user chooses "Apply" or "Save as a new scenario".

If the chosen input cannot move the target, the solver says so. If the answer is negative where that makes no sense (for example a negative fee %), it says so.

"Negotiated adjustment" changes the client fee with consultants unchanged, so Arch Nexus absorbs the change. Example: $900,000 → $825,000 loses $75,000 of net revenue and $63,750 of effort allowance at a 15% target on the client fee.

### Stress tests

Stress tests evaluate a modified **copy** of the scenario: construction cost ±%, consultant costs ±%, labor hours ±%, billing rates ±%, client fee ±% (as a negotiated adjustment), target profit ± points, and one phase's duration ± months. The scenario is never changed. "Save as a new scenario" writes the stressed copy as a new scenario with a note describing the stress.

Consultant cost stress raises what consultants cost Arch Nexus. Quotes pass through to the client with their markup; consultants priced as allocations keep their client amount, so the increase shows as exposure.

The sensitivity chart evaluates one measure at −30% to +30% of one variable.

### Thresholds

All assume a negotiated fee change with consultants unchanged:

- Client fee that supports the labor plan at target profit (effort headroom = 0).
- Fee headroom = current client fee − that fee.
- Hours headroom = effort headroom ÷ the plan's blended billing rate.
- Extra consultant cost that can be absorbed before effort headroom reaches zero (divided by (1 − target %) when the target is on net revenue).
- Detailed model only: break-even client fee (projected profit = 0) and client fee for the target profit.

Reaching a threshold does not guarantee profit.

## 10. Rounding

- Every calculation runs at full floating-point precision in dollars. Nothing is rounded mid-calculation.
- Presented figures round once, in one place (`present()` in `calc.js`), to the proposal's increment ($1 by default; $10, $100, or $1,000 selectable). Every screen and export uses these presented figures.
- Each package matrix uses **controlled rounding**: every cell moves to an adjacent multiple of the increment, and every row, every column, and the grand total add up exactly. It is solved as a small bounded flow problem. A randomized test of 30,000 tables found no case needing the fallback (column totals kept exact, rows absorbing).
- The project matrix is the sum of package matrices, so it reconciles too.
- The presented client fee is the sum of the presented package totals and presented item amounts, so the summary always adds up. It can differ from the unrounded fee by at most half an increment per line.
- Splitting a phase into months (cost-loaded schedule) uses the same controlled rounding, so monthly figures add to each phase total exactly.
- No dollars are lost or invented: allocations use largest-remainder rounding.

## 11. Validation

The engine returns warnings with a severity:

- **Error** (blocks export until acknowledged): over-allocated phases or consultant splits, included percentages ≥ 100% in a bottom-up package, negative Arch Nexus fee, negative effort allowance, projected loss (detailed model).
- **Warning**: unallocated balance not acknowledged, consultant split unallocated, negative Arch Nexus share in a phase, missing construction cost/area/units where used, roles without billing rates, planned effort above the allowance, projected profit below target, consultant share above the threshold, implied staffing above the threshold.
- **Information**: intentionally unallocated balance, even split where a component's covered phases have no percentages, rate factor ≠ 1.

Before export the app also re-checks that presented package rows, columns, and totals reconcile and that the client fee equals its parts.

Warning thresholds (consultant share 50% of basic services; 8 FTE in a phase) are adjustable in Settings. They are prompts, not firm policy.

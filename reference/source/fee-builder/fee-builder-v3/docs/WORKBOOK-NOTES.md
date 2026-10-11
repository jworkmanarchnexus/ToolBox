# Notes on the Reference Workbooks

How the two supplied workbooks shaped Fee Builder, and the places where a formula disagrees with its own evident intent. The spreadsheets were treated as evidence of how Arch Nexus works, not as financial authority. Where a formula looks wrong, Fee Builder keeps the business intent and the discrepancy is recorded here. Cell references are to the supplied files.

## EAC Plan - Calculator.xlsx

**What Fee Builder takes from it:** the target-profit planning method (section 8 of CALCULATIONS.md), reproduced exactly by an automated test: fee $500,000, consultants $175,000, architectural revenue $325,000, target profit $75,000, max planned effort (EAC Bill) $250,000, and every phase row.

| Item | Workbook | Note | Fee Builder |
|---|---|---|---|
| Target profit basis | `C12 = C11*C8`: 15% of the **total fee**, consultants included | Profit is more often measured against the firm's own revenue. Measuring it on the total fee makes the profit amount grow with consultant pass-through. | Kept as the default because it is the firm's current tool. Selectable in Settings: client fee or net revenue. |
| Effort to staffing | `I22 = G22/$I$19`, where I19 is $16,000 labeled "Avg SLC Arch only Cost of FTE/Month" | Divides effort valued at **billing rates** by a **cost** per FTE-month, mixing two bases. The column is labeled "FTEs" but holds FTE-months. | Kept as "effort value per FTE-month" ($16,000 default), clearly labeled, configurable. The result is labeled FTE-months. |
| Months | `K = J/4` (4 weeks per month) | A month is about 4.33 weeks. | Durations are entered in months directly; the default template carries the EAC's month values so results match. |
| Consultant phase split | `E23 = $C$9*D23`: consultants take the same phase % as the fee | A reasonable default, but WSU shows consultants with different splits. | Default "follows the fee"; custom splits per consultant are supported. |

## Copy of WSU CAMP Cost Loaded Schedule-Nexus 261008.xlsx

**What Fee Builder takes from it:** multiple work packages (CAMP facility, Secure facility, site), milestone phases (30/60/90/100%/CA), a phase × discipline matrix with Arch Nexus as the remainder, consultants mixing fixed per-phase amounts (civil) and percentages (structural, mechanical, electrical), separately priced services (FF&E, ALTA, geotech, seismic), scope alternatives (Baseline / Plus 2 Bay / Full Scope), a concept-design credit, a planned-versus-actual consultant comparison, and a monthly cost-loaded schedule. Automated tests reproduce the CAMP Arch Nexus column by phase (K4:K8) to the cent, the CAMP total of $1,359,056 (E14), and the 4.5%-less-credit cost basis (N31).

| # | Location | What the formula does | Evident intent | Effect |
|---|---|---|---|---|
| 1 | Final Version `K22:P22` (Secure subtotal row) | `=$J22*K$3` etc.: multiplies the Secure subtotal by the **CAMP** percentages in row 3 | Use the Secure percentages in row 16 | Arch total shows $633,629.71; the Secure phase rows (K17:K21) add to $665,058.08. Civil shows $31,428 although Secure has no civil. Fee Builder computes $665,058.08 (test). |
| 2 | Josh Version `M15:Q15`, RIC 3-4 `K15:O15` | Secure discipline percentages add to **97%** (0.625 + 0.015 + 0.10 + 0.13 + 0.10) | Add to 100% | 3% of every Secure phase is assigned to no one (for example `R16` = 192,568.86 against a phase of 198,524.60). Fee Builder flags any split that does not reconcile. |
| 3 | Josh Version `M21:R21`, RIC 3-4 `K21:P21` | Secure subtotal uses CAMP row 3 percentages | Same as #1 | Same as #1. |
| 4 | Cost Loaded Schedule `G7:H7` ("100% Design Secure") | References `'Final Version'!$Q7` (CAMP) | Reference `$Q20` (Secure) | Secure 100% Design is scheduled at $124,756 instead of $99,262: about $25,494 overstated. |
| 5 | Final Version `K28`, `K31`, `K34`, `K38` | Site cost share = building cost ÷ (**Full** CAMP + Secure) for Baseline and Mid as well as Full | Use each case's own total in the denominator | Baseline shares add to 84% and Mid to 95% instead of 100%, so part of the $5.25M site is unassigned in those cases. |
| 6 | Final Version `K10:L10` ("Geo + Alta + Seismic") | Arch $18,000 + Civil $10,000 = $28,000 | Match E11:E13 = $10,000 + $17,900 + $8,600 = $36,500 | The two places disagree by $8,500. |
| 7 | Final Version `F45:F51`, Josh Version `F46:F52` | WSU CAMP column refers to `G9 + G11 + G13`, which are empty (or partly) | Refer to the CAMP fee | The CAMP planned allocation shows $0 (or $10,000), so planned-versus-actual covers only Secure. RIC 3-4 fixes this. |
| 8 | Final Version `Q9` | `=ROUNDUP($J9*Q$3,1)` | Plain total | Harmless here; rounding up mid-table can drift totals. Fee Builder rounds once at presentation. |
| 9 | Final Version `E4:E8` | Phase amounts typed as rounded constants (249,511 etc.) | 20/25/25/10/20% of the subtotal | Typed amounts add to 1,247,556 while the source cost basis gives 1,247,555.88, so the sheet does not update if the cost changes. In Fee Builder phases are percentages or amounts of a live fee. |
| 10 | Final Version `F26:G26` | Adds back the original concept-design fee, then subtracts an unlabeled $150,000 | Unknown | No label explains the $150,000. Not modeled. |

### How the WSU structure maps to Fee Builder

- CAMP, Secure, and Site are **work packages** (site cost can be its own package, or pro-rated into building packages before entry).
- 30/60/90/100/CA is the **Design review milestones** phase template.
- Civil's per-phase dollar amounts are a **custom split** with dollar entries; the other engineers **follow the fee**; Arch Nexus is the remainder.
- The concept-design credit is a **negative lump-sum component** (it reduces the design fee before consultant percentages apply, as in the workbook) or a negative **adjustment** (after basic services).
- Baseline / Plus 2 Bay / Full Scope are **scenarios** using the scenario construction-cost override.
- Planned-versus-actual consultant amounts are the consultant **expected cost** against the **client amount**; the difference is shown as exposure.
- The cost-loaded schedule spreads each phase evenly across its months, as the workbook does, with rounding that keeps every phase total exact.

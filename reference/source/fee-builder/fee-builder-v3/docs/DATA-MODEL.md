# Data Model (schema 3)

One proposal is one JSON document. Blank numbers are stored as `""`; the engine reads them as zero where a number is required and as "not entered" where that matters (for example a blank phase percentage versus 0%).

```jsonc
{
  "schema": 3,
  "id": "p…", "rev": 7, "createdAt": 0, "updatedAt": 0,
  "name": "", "client": "", "number": "", "startMonth": "2027-01", "notes": "",
  "roundingInc": 1,                                   // 1 | 10 | 100 | 1000
  "packages": [ { "id": "k…", "name": "Civic building", "cost": 24000000, "area": 60000, "units": "", "unitLabel": "" } ],
  "phases":   [ { "id": "ph…", "name": "Schematic Design" } ],      // ordered
  "roster":   [ { "id": "n…", "name": "Mechanical", "discipline": "Mechanical" } ],
  "roles":    [ { "id": "role-1", "name": "Principal", "billRate": 240, "costRate": "" } ],
  "scenarios": [ /* see below */ ],
  "preferredId": "s…",
  "snapshots": [ /* see below */ ],
  "contract": { "snapshotId": "snap…" },             // or null
  "changes":  [ { "id": "ch…", "label": "", "method": "fixed", "amount": 20000, "status": "proposed|accepted|rejected", "added": "2026-10-10" } ],
  "source": { "kind": "manual" },                    // reserved for integrations
  "extRefs": {},                                     // reserved for integrations
  "legacyOriginal": { }                              // only on records migrated from the first prototype
}
```

## Scenario

```jsonc
{
  "id": "s…", "name": "5.5% of construction", "notes": "", "createdAt": 0,
  "finance": { "targetProfitPct": "", "rateFactor": 1 },   // blank % = use Settings
  "schedule": { "<phaseId>": { "months": 3, "start": "" } },  // blank start = after the previous phase
  "items": [ {
    "id": "i…", "kind": "service|reimbursable|expense|contingency|adjustment",
    "label": "", "method": "fixed|hours|pctFee|pctCost|area|unit",
    "amount": "", "pct": "", "rate": "", "qty": "", "hours": "", "roleId": "",
    "basis": "design|basic|subtotal", "pkgId": "",
    "treatment": "add|included|internal", "provider": "an|pass", "markup": "", "cost": ""
  } ],
  "pkgs": {
    "<packageId>": {
      "basis": "design|arch",
      "costOverride": "", "areaOverride": "", "unitsOverride": "",
      "components": [ { "id": "c…", "label": "", "method": "pctCost|fixed|area|unit|labor", "pct": "", "amount": "", "rate": "", "qty": "", "covers": "all" /* or [phaseIds] */ } ],
      "alloc": { "<phaseId>": { "pct": 10, "amt": "", "lock": false } },
      "allowUnallocated": false,
      "cons": { "<consultantId>": {
        "on": true, "type": "fixed|quote|pctCost|pctFee", "value": "", "treatment": "included|additional",
        "markup": "", "cost": "", "split": "follow|custom",
        "alloc": { "<phaseId>": { "pct": "", "amt": "", "lock": false } }, "note": ""
      } },
      "labor": { "mode": "hours|staffing", "rows": [ { "id": "r…", "roleId": "role-1", "cells": { "<phaseId>": 40 } } ] }
    }
  }
}
```

Invariants (enforced by `normalize()` and the structural edit functions):
- Every scenario has a `pkgs` entry for every package, a `cons` entry for every roster consultant, and `alloc`/`schedule`/labor cells for every phase.
- Component `covers` lists only existing phases; an empty list becomes `"all"`.
- Labor rows reference existing roles.
- `preferredId` and `contract.snapshotId` point at existing records or are null.

## Snapshot

```jsonc
{
  "id": "snap…", "kind": "decision|approved|contract", "name": "", "note": "", "date": "2026-10-10", "createdAt": 0,
  "scenarioId": "s…", "scenarioName": "",
  "frozen": { "scenario": {}, "packages": [], "phases": [], "roster": [], "roles": [], "roundingInc": 1, "startMonth": "", "settings": {} },
  "summary": { "clientFee": 0, "presentedClientFee": 0, "designTotal": 0, "netRevenue": 0, "consultantClient": 0, "consultantCost": 0, "effortAllowance": 0, "plannedEffort": 0, "feePctOfCost": 0 }
}
```

`frozen` carries everything needed to recompute the snapshot, including the planning settings in force, so later edits to the proposal or to personal Settings never change it.

## Settings (per user)

```jsonc
{
  "schema": 1, "roundingInc": 1, "defaultTemplateId": "tpl-traditional",
  "templates": [ { "id": "", "name": "", "source": "", "phases": [ { "name": "", "pct": 10, "months": 1 } ] } ],
  "roles": [ { "id": "", "name": "", "billRate": "", "costRate": "" } ],
  "targetProfitPct": 15, "targetProfitBasis": "clientFee|netRevenue",
  "valuePerFteMonth": 16000, "hoursPerFteMonth": 173.333,
  "overheadRate": "",                          // fraction of direct labor, e.g. 1.6
  "consultantShareWarnPct": 50, "maxFtePerPhase": 8,
  "consultantLibrary": [], "serviceLibrary": [], "showMarkup": false
}
```

## Migration from the first prototype (schema 2)

| v2 | v3 |
|---|---|
| `cost`, `area` | one package "Main scope" |
| (no phases) | the Traditional template's phases and percentages, so every v2 fee is spread by those percentages |
| `rates[{role, rate}]` | `roles[{name, billRate}]` |
| method `pct` top / bottom | basis `design` with a `pctCost` component / basis `arch` with a `fixed` component |
| method `sf` (covers incl / arch) | `area` component with basis `design` / `arch` |
| method `lump` | `fixed` component |
| method `hourly` (hours or % of time) | basis `arch`, a `labor` component, hours spread across phases by the template percentages; consultants stay additional, as v2 forced |
| consultant `amt` / `pct` / `fee` | `fixed` / `pctCost` / `pctFee` |
| `services` | `items` of kind `service` |
| `baseline` | a `contract` snapshot carrying the v2 contract value |
| ad-scope `items` | `changes` |

v2 rounded every line to whole dollars; v3 rounds once. Migrated totals agree within $1 (exact) and $2 (presented), tested on every v2 method.

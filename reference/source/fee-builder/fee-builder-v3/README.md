# Fee Builder (Arch Nexus Toolbox)

Develop, test, and finalize architectural and engineering proposal fees. One analytical environment for many methods: percentage of construction cost, lump sum, area or unit rates, and staffing buildups, mixed within a project, across work packages, phases, and consultants.

**Start with `docs/HANDOFF.md`.**

## Quick start

```
open dist/fee-builder-standalone.html   # any current browser; saves to that browser only
npm install                             # once: installs jsdom for the interface tests
npm test                                # builds, then runs 85 engine and interface tests
node build.js                           # rebuild dist/ after editing src/
```

## Layout

```
src/engine/   calculation engine (no DOM): money, model, calc, analysis, exporter, sample
src/ui/       interface: util, store, views, app, styles.css (Fee Builder only)
src/shared/   the Toolbox design language shared with the Scheduler: fonts, tokens, components, shell, logo
dist/         fee-builder.html (published as a Claude artifact), fee-builder-standalone.html
tests/        engine.test.js, ui.test.js, harness.js, run.js, fixtures/engine-v2.js
docs/         HANDOFF, ARCHITECTURE, CALCULATIONS, DATA-MODEL, WORKBOOK-NOTES, DESIGN, screenshots/
```

No runtime dependencies. The only development dependency is jsdom.

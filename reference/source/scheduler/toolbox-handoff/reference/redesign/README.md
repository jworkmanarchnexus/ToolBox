# Toolbox · Scheduler: redesign preview

The Arch Nexus Scheduler, rebuilt on a Toolbox shell and the Arch Nexus design system. It is published as a **separate preview**; the live prototype (v34) is untouched.

## Build
```
python3 tools/gen-assets.py   # only when fonts or icons change (needs @fontsource/lato, @fontsource/roboto-condensed, lucide-static under FONT_NODE_MODULES)
sh build.sh                   # -> dist/index.html (one self-contained page)
```
`build.sh` lists the files in load order. Production should serve them as separate files (docs/PLATFORM-SEAM.md).

## Files
| File | Role |
|---|---|
| `engine.js` | Scheduling engine (unchanged from v34) |
| `merge.js` | Three-way merge for concurrent saves |
| `templates.js`, `commit.js`, `impact.js`, `permissions.js`, `dup.js` | Pure, Node-testable modules added in this iteration |
| `brand.js`, `tokens.css`, `ui.css`, `shell.css`, `editor.css`, `fonts.css`, `icons.js` | Design system |
| `shell.js`, `browser.js`, `data.js` | Toolbox shell, routing, project browser and page, project data boundary |
| `tpl-store.js`, `tpl-ui.js` | Templates module: company and personal templates, managers, template editing |
| `app-core.js`, `app-ui.js`, `gantt.js`, `app-task.js`, `app-order.js` | Editor |
| `app-export.js`, `export-draw.js`, `export-ui.js`, `pdffonts.js`, `logo.js` | Exports (data, drawing, workspace) |
| `main.js` | Start-up and platform services |

## Tests
`cd tests && npm install && npm test`. The browser tests use Playwright with Chromium, and serve the CDN export libraries from a local `node_modules` (env `LIBS`). See SPEC.md §16.4.

## Docs
- `SPEC.md`: the full spec for the Toolbox port. §16 covers this iteration.
- `docs/DESIGN-SYSTEM.md`: tokens, contrast, type, components, logo and export rules.
- `docs/DATA-SCHEMA.md`, `docs/schedule.schema.json`: the schedule document, including the new optional fields.
- `docs/PLATFORM-SEAM.md`: what production replaces.
- `docs/EDITOR-FEATURES.md`: the v34 behavior inventory.
- `docs/WORKING-DAYS-PROPOSAL.md`: working-day durations, a proposal only.

# Toolbox design system (Arch Nexus)

Source: *Arch Nexus Brand Elements Guide* (2019): colors (p. 5, 10–11), logo rules (p. 6–7) and the phase-band schedule example (p. 11). Code: `tokens.css` (values), `ui.css` (components), `shell.css` (Toolbox frame), `editor.css` (Scheduler), `brand.js` (schedule color presets), `export-draw.js` (print and PDF).

Every Toolbox tool should use these tokens instead of its own colors. The rules below are written for that.

## 1. Color

### Brand values (kept exact)

| Token | Value | Brand name | Use |
|---|---|---|---|
| `--nx-blue` | `#0099D8` | Nexus Blue (Pantone Process Blue C) | The accent: bars, selected marks, focus, the today line in light UI |
| `--nx-t20` `--nx-t40` `--nx-t70` | `#BEDAEC` `#87BEDE` `#6FAFE0` | Nexus Blue tints | Phase-band progression, soft fills |
| `--nx-d20` `--nx-d40` `--nx-d60` | `#0084BA` `#006B97` `#005175` | Nexus Blue shades | Text-safe blue, primary buttons, milestones |
| `--nx-bluegray` | `#778390` | Blue Gray | Internal-audience color, quiet graphics |
| `--nx-lightgray` | `#EDEDEE` | Light Gray | Headers, quiet surfaces |
| `--nx-darkgray` | `#504F51` | Dark Gray | Body text |
| `--nx-orange` `--nx-green` `--nx-lightblue` | `#F18A00` `#93D500` `#99D6EF` | Tertiary | Small accents only: warning fill, "on track" fill, today marker |

### Text contrast (WCAG AA)

Some brand values fail AA for small text. Those values stay as they are in graphics, and text uses a darker brand shade or a darker derived value. Derived values are marked as derived in `tokens.css`.

| Token | Value | Contrast on white | Why |
|---|---|---|---|
| `--text` | `#504F51` (brand Dark Gray) | 8.1:1 | Body text |
| `--text-2` | `#66707B` (derived from Blue Gray) | 5.0:1 | Secondary text. Brand Blue Gray is only 3.9:1. |
| `--accent-text` | `#006B97` (brand shade 2) | 5.9:1 | Links and primary buttons. Nexus Blue is only 3.2:1 behind white text. |
| `--warn` | `#A65F00` (derived from Orange) | 4.9:1 | Warning text. Orange stays as `--warn-fill`. |
| `--ok` | `#4D7A00` (derived from Green) | 5.1:1 | Success text. Green stays as `--ok-fill`. |
| `--crit` | `#C4312B` | 5.0:1 | Errors and conflicts only. Red is not a brand color, so it is limited to things that are actually wrong. |

On colored fills (phase bands, bars with labels), `inkOn()` in `export-draw.js` picks white or near-black text (`#1E2428`). Band names are 14 pt bold, which WCAG counts as large text, so the 3:1 rule applies to them. Measured results for the phase progression:

| Fill | Ink chosen | Contrast |
|---|---|---|
| `#BEDAEC`, `#87BEDE`, `#6FAFE0` (tints) | near-black | 10.8, 7.8, 6.6 |
| `#0099D8` Nexus Blue | white | 3.2 |
| `#0084BA` shade 1 | white | 4.2 |
| `#006B97`, `#005175` (shades 2, 3) | white | 5.9, 8.6 |

The 10 pt date line under each name uses the same ink. On Nexus Blue and shade 1 that line passes 3:1 but not 4.5:1. That is a deliberate trade, so the band reads like the page 11 example. If it matters for a given audience, the fix is to switch to near-black on Nexus Blue (4.9:1). Shade 1 cannot reach 4.5:1 with either ink.

### One meaning per color

- **Blue** means selection, focus, or "this is the schedule": bars and accents.
- **Orange** means warning, and also marks today.
- **Red** means error or conflict, and nothing else.
- **Green** means on track, used sparingly.
- **Audience colors** default to Nexus Blue for client, shade 2 for the design team and Blue Gray for internal. They are solid colors, with no patterns. Schedules are almost always viewed and printed in color, and the audience is also listed in the table and the inspector, so color is not the only place it appears.

### Dark mode

`tokens.css` redefines the surfaces, text, and lighter text-blue values under `prefers-color-scheme: dark` and `[data-theme="dark"]`. Brand graphics keep their hue. Exports are always printed on white, whatever the theme.

## 2. Type

| Role | Font | Token |
|---|---|---|
| Interface, body, table cells | Lato 400 and 700 | `--f-ui` |
| Labels, column headers, titles, numbers in charts, export headings | Roboto Condensed 400 and 700 | `--f-cond` |

- **Scale:** 11, 12.5, 14 (base), 16, 20 and 28 px (`--fs-xs` … `--fs-2xl`).
- **Small caps labels:** Roboto Condensed 700, 11.5 px, uppercase, 0.08em letter spacing, `--text-2`.
- **Hosting:** both families are embedded from `assets/fonts`, which are the `@fontsource` builds under the SIL Open Font License; the licenses are in that folder. `tools/gen-assets.py` writes the WOFF2 files into `fonts.css` for the page and the TTF files into `pdffonts.js` for the PDF. No font is loaded from Google at runtime.

## 3. Space, shape, density

- **Spacing:** a 4 px grid (`--s1` … `--s10`).
- **Corner radii:** 3, 4, 6 and 8 px. Corners stay small, since the brand is architectural.
- **Controls:** 32 px tall (`--ctl-h`).
- **Table and timeline rows:** 32 px by default, or 27 px in compact density (`body.dense`). The table and the timeline list share one row height so they stay aligned.

## 4. Icons

Lucide (ISC license; see `assets/LUCIDE-LICENSE.txt`), drawn as outlines on a 24 px grid at 1.75 px stroke. `icons.js` holds only the icons in use, plus `icon(name, size, label)`. Icons are decorative unless given a label. A button that shows only an icon must have an `aria-label`. To add an icon, add its name to the list in `tools/gen-assets.py` and rerun the script.

## 5. Components (`ui.css`)

- **Buttons:**
  - `.btn` for default actions.
  - `.btn.primary` for one primary action per view, on `--primary-bg`.
  - `.btn.ghost` and `.btn.quiet` for secondary actions.
  - `.btn.icon` for icon-only buttons.
  - `.ib` for in-row icon buttons.
- **Segmented control:** `.seg` with `aria-pressed` on each option.
- **Menus:** `.menu`, opened from a button with `aria-haspopup` and `aria-expanded`. Escape closes the menu.
- **Dialogs:** `.scrim` and `.dlg`. Each dialog traps focus, closes on Escape and returns focus to where it came from. The export workspace (`.xw`) is a full-window dialog.
- **Drawers:** the inspector `.drawer` sits beside the table or timeline, and overlays it below 860 px.
- **Toast:** `#toast`, which can carry one action such as Undo.
- **Banners:** `.banner.info`, `.warn` and `.err`.
- **Impact card:** `.impact`, shown after an edit. It docks full-width at the bottom on phones.

## 6. Logo

- **Size:** never narrower than 1 inch (72 pt) in print.
- **Clear space:** on all sides, equal to the height of the "ARC" letters, which is about 29% of the logo width (`LOGO_CLEAR`).
- **Placement in exports:** top right, inside its clear space. The saved and printed lines align with the bottom of the logo.
- **Restrictions:** it is never recolored, stretched or placed on a busy fill. In the app it appears only in the side bar.

## 7. Exports

- **Fonts and colors:** the same fonts, embedded in the PDF as real text, and the same brand colors.
- **Heading:** the title in Roboto Condensed 700, Nexus Blue, uppercase. The project line sits under it in `--text-2`, and a thin Nexus Blue rule closes the heading.
- **Phase bands (executive and client):** the main sequence of activities becomes full-height bands, shaded light to dark through the project as on page 11 of the guide. Overlapping work sits on thin lines beneath the bands. Milestones are diamonds on dashed lines, with their labels set on a white knockout so a line never runs through text.
- **Bars (all audiences):** one row per activity. With "Color by audience" on, each bar takes its audience's solid color, and the legend lists them.

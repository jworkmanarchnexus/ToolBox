/* ===== Arch Nexus brand palette for schedule graphics =====
   Adds the brand colors to the engine's preset list (the engine itself is unchanged).
   Older schedules keep the colors they saved; new schedules start with brand colors. */
const BRAND_PRESETS = {
  'nexus':       { label: 'Nexus Blue',          light: '#0099D8', dark: '#0099D8', print: '#0099D8', brand: true },
  'nexus-t20':   { label: 'Nexus Blue 20%',      light: '#BEDAEC', dark: '#5D7F95', print: '#BEDAEC', brand: true },
  'nexus-t40':   { label: 'Nexus Blue 40%',      light: '#87BEDE', dark: '#5E9CC0', print: '#87BEDE', brand: true },
  'nexus-t70':   { label: 'Nexus Blue 70%',      light: '#6FAFE0', dark: '#6FAFE0', print: '#6FAFE0', brand: true },
  'nexus-d20':   { label: 'Nexus Blue, shade 1', light: '#0084BA', dark: '#2B9FD1', print: '#0084BA', brand: true },
  'nexus-d40':   { label: 'Nexus Blue, shade 2', light: '#006B97', dark: '#2C9AD0', print: '#006B97', brand: true },
  'nexus-d60':   { label: 'Nexus Blue, shade 3', light: '#005175', dark: '#3F8FBF', print: '#005175', brand: true },
  'nexus-light': { label: 'Light Blue',          light: '#99D6EF', dark: '#99D6EF', print: '#99D6EF', brand: true },
  'bluegray':    { label: 'Blue Gray',           light: '#778390', dark: '#9AA6B2', print: '#778390', brand: true },
  'darkgray':    { label: 'Dark Gray',           light: '#504F51', dark: '#9A99A0', print: '#504F51', brand: true },
  'brand-orange':{ label: 'Orange (accent)',     light: '#F18A00', dark: '#F5A33A', print: '#F18A00', brand: true },
  'brand-green': { label: 'Green (accent)',      light: '#93D500', dark: '#A8DB4D', print: '#93D500', brand: true },
};
Object.assign(PRESETS, BRAND_PRESETS);
for (const k of Object.keys(PRESETS)) if (!PRESETS[k].brand) PRESETS[k].extra = true; // older generic hues: kept, offered under "Other colors"
/* new schedules: Nexus Blue for the client view, a deeper shade for the design team, blue gray for internal */
DEFAULT_COLORS.client = 'nexus';
DEFAULT_COLORS.design = 'nexus-d40';
DEFAULT_COLORS.internal = 'bluegray';
/* the progression from page 11 of the brand guide: light to dark through a project */
const PHASE_SHADES = ['nexus-t20', 'nexus-t40', 'nexus-t70', 'nexus', 'nexus-d20', 'nexus-d40', 'nexus-d60'];
const BRAND_COLORS = ['nexus', 'nexus-t20', 'nexus-t40', 'nexus-t70', 'nexus-d20', 'nexus-d40', 'nexus-d60', 'nexus-light', 'bluegray', 'darkgray', 'brand-orange', 'brand-green'];
/* the Arch Nexus palette in one click, for schedules made before it existed */
const BRAND_AUDIENCE = { client: 'nexus', design: 'nexus-d40', internal: 'bluegray' };

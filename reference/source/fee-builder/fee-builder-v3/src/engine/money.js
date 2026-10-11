/*
 * Fee Builder engine: money and rounding.
 *
 * Policy (see docs/CALCULATIONS.md, "Rounding"):
 *  - Every calculation runs at full floating-point precision in dollars.
 *  - Rounding happens once, in the presentation layer, to the proposal's rounding
 *    increment ($1 by default).
 *  - Allocations are rounded with largest-remainder so the parts always add up to
 *    the rounded whole. Matrices are rounded with controlled rounding so every row,
 *    every column, and the grand total reconcile exactly.
 */
(function (root) {
  'use strict';
  const FB = root.FB || (root.FB = {});
  const EPS = 1e-9;

  /** Parse a user-entered number. Accepts "$1,250", "5%", "15m", "250k", "(500)". Blank -> ''. */
  function parse(input) {
    if (typeof input === 'number') return Number.isFinite(input) ? input : '';
    if (input === null || input === undefined) return '';
    let s = String(input).trim().toLowerCase();
    if (!s) return '';
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[$,%\s]/g, '');
    let mult = 1;
    const m = s.match(/^(-?[0-9]*\.?[0-9]+)([km])$/);
    if (m) { s = m[1]; mult = m[2] === 'k' ? 1e3 : 1e6; }
    if (s === '' || s === '-' || s === '.') return '';
    if (!/^-?[0-9]*\.?[0-9]+(e-?[0-9]+)?$/.test(s)) return '';
    const n = parseFloat(s) * mult;
    if (!Number.isFinite(n)) return '';
    return neg ? -n : n;
  }

  /** Numeric value of a stored field; blank or invalid -> 0. */
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const p = parse(v);
    return p === '' ? 0 : p;
  }

  /** True when a stored field holds a real number (including 0). */
  function has(v) {
    if (typeof v === 'number') return Number.isFinite(v);
    return parse(v) !== '';
  }

  /** Round half away from zero to a multiple of inc. */
  function roundTo(x, inc) {
    inc = inc > 0 ? inc : 1;
    const q = x / inc;
    const r = Math.sign(q) * Math.round(Math.abs(q) + EPS);
    return r * inc === 0 ? 0 : r * inc;
  }

  function sum(arr, f) {
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += f ? f(arr[i], i) : arr[i];
    return s;
  }

  /**
   * Largest-remainder rounding. Returns integers (in units of inc, already multiplied
   * back to dollars) that sum exactly to `target` (which must be a multiple of inc).
   * When target is omitted it is the rounded exact sum.
   */
  function largestRemainder(values, inc, target) {
    inc = inc > 0 ? inc : 1;
    const units = values.map(v => v / inc);
    const T = target === undefined ? Math.round(sum(units) + EPS * Math.sign(sum(units))) : Math.round(target / inc);
    const floors = units.map(u => Math.floor(u + EPS));
    let need = T - sum(floors);
    const order = units.map((u, i) => ({ i, rem: u - floors[i] })).sort((a, b) => (b.rem - a.rem) || (a.i - b.i));
    const out = floors.slice();
    if (need >= 0) {
      for (let k = 0; k < order.length && need > 0; k++) { out[order[k].i] += 1; need--; }
      // need may still be > 0 only if target exceeds what rounding can reach; put the rest on the largest value.
      if (need > 0) out[largestIndex(units)] += need;
    } else {
      // Target below the floors (should not happen for proper roundings); take from smallest remainders.
      for (let k = order.length - 1; k >= 0 && need < 0; k--) { out[order[k].i] -= 1; need++; }
    }
    return out.map(u => (u * inc === 0 ? 0 : u * inc));
  }

  function largestIndex(a) {
    let bi = 0;
    for (let i = 1; i < a.length; i++) if (Math.abs(a[i]) > Math.abs(a[bi])) bi = i;
    return bi;
  }

  /**
   * Controlled rounding of a 2D table (rows x cols) to multiples of inc.
   * Guarantees: each cell moves to an adjacent multiple (floor or ceil), each row sums
   * to its largest-remainder row target, each column sums to its column target, and
   * both sum to the rounded grand total. Solved as a small max-flow problem.
   * If the joint targets are not reachable (rare), column totals are kept exact and
   * rows absorb the difference; `exactRows` reports which happened.
   */
  function controlledRound(matrix, inc) {
    inc = inc > 0 ? inc : 1;
    const R = matrix.length;
    const C = R ? matrix[0].length : 0;
    if (!R || !C) return { cells: matrix.map(r => r.slice()), rowTotals: [], colTotals: [], total: 0, exactRows: true };
    const u = matrix.map(r => r.map(v => v / inc));
    const rowExact = u.map(r => sum(r));
    const colExact = [];
    for (let j = 0; j < C; j++) colExact.push(sum(u, r => r[j]));
    const G = Math.round(sum(rowExact) + EPS * Math.sign(sum(rowExact)));
    const fl = u.map(r => r.map(v => Math.floor(v + EPS)));
    const elig = u.map((r, i) => r.map((v, j) => v - fl[i][j] > EPS));
    const K = G - sum(fl, r => sum(r));
    // Each row/column total may round to the multiple just below or just above its exact
    // value; the flow chooses which, subject to the grand total being G.
    const rowLo = [], rowHi = [], colLo = [], colHi = [];
    for (let i = 0; i < R; i++) {
      const base = sum(fl[i]);
      rowLo.push(Math.floor(rowExact[i] + EPS) - base);
      rowHi.push(Math.ceil(rowExact[i] - EPS) - base);
    }
    for (let j = 0; j < C; j++) {
      const base = sum(fl, r => r[j]);
      colLo.push(Math.floor(colExact[j] + EPS) - base);
      colHi.push(Math.ceil(colExact[j] - EPS) - base);
    }
    const up = boundedAssign(rowLo, rowHi, colLo, colHi, elig, K);
    const feasible = !!up;
    const colT = largestRemainder(colExact, 1, G);
    let cells;
    let exactRows = true;
    if (feasible) {
      cells = fl.map((r, i) => r.map((v, j) => (v + (up[i][j] ? 1 : 0)) * inc));
    } else {
      // Fallback: keep column totals exact, round each column with largest remainder.
      exactRows = false;
      cells = u.map(r => r.map(() => 0));
      for (let j = 0; j < C; j++) {
        const col = largestRemainder(u.map(r => r[j]), 1, colT[j]);
        for (let i = 0; i < R; i++) cells[i][j] = col[i] * inc;
      }
    }
    cells = cells.map(r => r.map(v => (v === 0 ? 0 : v)));
    const rowTotals = cells.map(r => sum(r));
    const colTotals = [];
    for (let j = 0; j < C; j++) colTotals.push(sum(cells, r => r[j]));
    return { cells, rowTotals, colTotals, total: sum(rowTotals), exactRows };
  }

  // Choose which eligible cells round up. Row i must receive between rowLo[i] and rowHi[i]
  // ups, column j between colLo[j] and colHi[j], and the total must be exactly K.
  // Solved as a circulation with lower bounds (Edmonds-Karp on a small dense graph).
  function boundedAssign(rowLo, rowHi, colLo, colHi, elig, K) {
    const R = rowLo.length, C = colLo.length;
    if (K < 0) return null;
    for (let i = 0; i < R; i++) if (rowLo[i] < 0 || rowHi[i] < rowLo[i]) return null;
    for (let j = 0; j < C; j++) if (colLo[j] < 0 || colHi[j] < colLo[j]) return null;
    // Nodes: rows 0..R-1, cols R..R+C-1, S=R+C, T=S+1, S2=S+2, T2=S+3
    const S = R + C, T = S + 1, S2 = S + 2, T2 = S + 3, N = S + 4;
    const cap = Array.from({ length: N }, () => new Array(N).fill(0));
    const excess = new Array(N).fill(0);
    const edge = (x, y, lo, hi) => { cap[x][y] += hi - lo; excess[y] += lo; excess[x] -= lo; };
    for (let i = 0; i < R; i++) edge(S, i, rowLo[i], rowHi[i]);
    for (let j = 0; j < C; j++) edge(R + j, T, colLo[j], colHi[j]);
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) if (elig[i][j]) edge(i, R + j, 0, 1);
    edge(T, S, K, K);
    let demand = 0;
    for (let v = 0; v < S2; v++) {
      if (excess[v] > 0) { cap[S2][v] += excess[v]; demand += excess[v]; }
      else if (excess[v] < 0) cap[v][T2] += -excess[v];
    }
    let flow = 0;
    for (;;) {
      const prev = new Array(N).fill(-1);
      prev[S2] = S2;
      const q = [S2];
      for (let h = 0; h < q.length && prev[T2] < 0; h++) {
        const x = q[h];
        for (let y = 0; y < N; y++) if (prev[y] < 0 && cap[x][y] > 0) { prev[y] = x; q.push(y); }
      }
      if (prev[T2] < 0) break;
      let f = Infinity;
      for (let y = T2; y !== S2; y = prev[y]) f = Math.min(f, cap[prev[y]][y]);
      for (let y = T2; y !== S2; y = prev[y]) { cap[prev[y]][y] -= f; cap[y][prev[y]] += f; }
      flow += f;
    }
    if (flow !== demand) return null;
    // A cell edge (cap 1, lower 0) carries flow iff its residual capacity dropped to 0.
    return elig.map((r, i) => r.map((e, j) => e && cap[i][R + j] === 0));
  }

  FB.money = { EPS, parse, num, has, roundTo, sum, largestRemainder, controlledRound };
})(typeof globalThis !== 'undefined' ? globalThis : this);

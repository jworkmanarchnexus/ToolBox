/* Minimal test harness: no dependencies. */
'use strict';
const path = require('path');
const ENGINE = ['money', 'model', 'calc', 'analysis', 'exporter'];
ENGINE.forEach(f => require(path.join(__dirname, '..', 'logic', f + '.js')));
const FB = globalThis.FB;
const results = { pass: 0, fail: 0, failures: [] };
let current = '';
function test(name, fn) {
  current = name;
  try { fn(); results.pass++; }
  catch (e) { results.fail++; results.failures.push(name + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e)); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }
function near(a, b, tol, msg) { tol = tol === undefined ? 0.005 : tol; if (!(Math.abs(a - b) <= tol)) throw new Error((msg || 'near') + ': expected ' + b + ' ±' + tol + ', got ' + a); }
function ok(c, msg) { if (!c) throw new Error(msg || 'expected truthy'); }
function noNaN(obj, where) {
  const seen = new Set();
  (function walk(o, p) {
    if (typeof o === 'number' && !Number.isFinite(o)) throw new Error('Non-finite number at ' + (where || '') + p);
    if (!o || typeof o !== 'object' || seen.has(o)) return;
    seen.add(o);
    for (const k of Object.keys(o)) { if (typeof o[k] === 'function') continue; walk(o[k], p + '.' + k); }
  })(obj, '');
}
module.exports = { FB, test, eq, near, ok, noNaN, results };

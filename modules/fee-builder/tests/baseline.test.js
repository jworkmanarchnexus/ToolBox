'use strict';
/* Fee Builder's existing engine suite, run unchanged. The count is the baseline recorded in docs/DECISIONS.md:
   if it drops, tests were lost. (The interface tests are in ui.test.js, rebuilt for the Toolbox shell.) */
const test = require('node:test');
const assert = require('node:assert');
const { results } = require('./harness');
require('./engine.test.js');

test('engine suite: 64 checks, none failing', () => {
  assert.deepStrictEqual(results.failures, []);
  assert.strictEqual(results.pass, 64);
});

/* Runs every *.test.js file. Exit code 1 on any failure. */
'use strict';
const fs = require('fs');
const path = require('path');
const { results } = require('./harness');
const only = process.argv[2];
fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') && (!only || f.includes(only))).sort().forEach(f => require(path.join(__dirname, f)));
const done = () => {
  results.failures.forEach(f => console.log('FAIL ' + f));
  console.log(`\n${results.pass} passed, ${results.fail} failed`);
  process.exit(results.fail ? 1 : 0);
};
if (results.pending) results.pending.then(done); else done();

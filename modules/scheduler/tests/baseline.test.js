'use strict';
/* The Scheduler's existing suites, run as they were before the port. The counts are the baseline recorded in
   docs/DECISIONS.md: if a count drops, assertions were lost, which the plain "exit 0" would not notice. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const run = (file) => execFileSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8' });

test('engine suite: 53 checks', () => assert.match(run('engine.test.js'), /passed 53 checks/));
test('merge suite: 80 checks', () => assert.match(run('merge.test.js'), /merge tests passed 80/));
test('other pure modules (templates, commitments, impact, permissions, duplicate): 199 checks', () => assert.match(run('units.test.js'), /unit tests passed 199/));

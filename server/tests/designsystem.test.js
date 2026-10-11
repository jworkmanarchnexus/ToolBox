'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../../design-system/tools/build_css');

const OUT = path.join(__dirname, '..', '..', 'shared', 'design-system');

test('shared/design-system is generated from design-system/project (run: node design-system/tools/build_css.js)', () => {
  for (const [name, buf] of build()) {
    const file = path.join(OUT, name);
    assert.ok(fs.existsSync(file), `${name} is missing`);
    assert.ok(fs.readFileSync(file).equals(buf), `${name} is out of date`);
  }
});

test('shell and shared UI CSS use tokens only: no hex colors', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'shell', 'shell.css'), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(css, /var\(--nx-/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../permissions.js');
const F = require('./fixtures/permissions.json');

test('effectiveAccess fixtures', () => {
  for (const c of F.effectiveAccess) {
    const input = Object.assign({}, F.base, { user: c.user });
    if (c.extraOverrides) input.overrides = input.overrides.concat(c.extraOverrides);
    assert.strictEqual(P.effectiveAccess(input), c.expect, c.name);
  }
});
test('canDo fixtures', () => {
  for (const c of F.canDo) assert.strictEqual(P.canDo(c.level, c.action, c.opts), c.expect, JSON.stringify(c));
});
test('canDeny fixtures', () => {
  for (const c of F.canDeny) assert.strictEqual(P.canDeny(F.base, c.actor, c.target), c.expect, JSON.stringify(c));
});
test('canDuplicate fixtures', () => {
  for (const c of F.canDuplicate) assert.strictEqual(P.canDuplicate(c.src, c.dest, c.destArchived), c.expect, JSON.stringify(c));
});

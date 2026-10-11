'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

test('binds to loopback only', async () => {
  const dbmod = require('../db/db');
  const { createServer } = require('../app');
  const s = createServer(dbmod.open(':memory:'));
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  assert.strictEqual(s.address().address, '127.0.0.1');
  s.close();
});

test('health endpoint and shell page respond', async () => {
  const t = await start();
  assert.deepStrictEqual((await t.api().get('/api/health')).body, { ok: true });
  const page = await fetch(t.base + '/');
  assert.strictEqual(page.status, 200);
  assert.match(await page.text(), /Archnexus Toolbox/);
  await t.close();
});

test('does not serve files outside shell/, shared/ and modules/', async () => {
  const t = await start();
  const paths = ['/package.json', '/server/index.js', '/server/db/schema.sql', '/server/db/toolbox.sqlite', '/%2e%2e/package.json', '/shell/../package.json', '/shell/..%2fpackage.json', '/docs/CONTRACT.md'];
  for (const p of paths) assert.strictEqual((await fetch(t.base + p)).status, 404, p);
  await t.close();
});

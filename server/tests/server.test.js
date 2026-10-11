'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createServer } = require('../app');

function listen() {
  return new Promise(resolve => {
    const s = createServer().listen(0, '127.0.0.1', () => resolve(s));
  });
}

test('binds to loopback only', async () => {
  const s = await listen();
  assert.strictEqual(s.address().address, '127.0.0.1');
  s.close();
});

test('health endpoint and shell page respond', async () => {
  const s = await listen();
  const base = `http://127.0.0.1:${s.address().port}`;
  const health = await (await fetch(base + '/api/health')).json();
  assert.deepStrictEqual(health, { ok: true });
  const page = await fetch(base + '/');
  assert.strictEqual(page.status, 200);
  assert.match(await page.text(), /Archnexus Toolbox/);
  s.close();
});

test('does not serve files outside shell/ and shared/', async () => {
  const s = await listen();
  const base = `http://127.0.0.1:${s.address().port}`;
  for (const p of ['/package.json', '/server/index.js', '/%2e%2e/package.json', '/shell/../package.json']) {
    assert.strictEqual((await fetch(base + p)).status, 404, p);
  }
  s.close();
});

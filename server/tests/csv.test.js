'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseCsv } = require('../csv');

test('parses headers, quotes, doubled quotes, commas, CRLF and a BOM', () => {
  const rows = parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,,\r\n');
  assert.deepStrictEqual(rows, [{ a: '1', b: 'x, y', c: 'say "hi"' }, { a: '2', b: '', c: '' }]);
});
test('empty input gives no rows', () => assert.deepStrictEqual(parseCsv(''), []));
test('a final line without a newline still counts', () => assert.deepStrictEqual(parseCsv('a,b\n1,2'), [{ a: '1', b: '2' }]));

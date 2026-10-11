'use strict';
/* House rules from CLAUDE.md, checked by machine so they stay true. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MODULES = path.join(__dirname, '..', '..', 'modules');
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'dist' || e.name === 'node_modules' || e.name === 'tests') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};
const files = (ext) => fs.readdirSync(MODULES).flatMap(m => walk(path.join(MODULES, m))).filter(f => f.endsWith(ext));
const DATA_FILES = /pdffonts\.js$|logo\.js$|logopng|\.b64$|assets-[a-z]+\.js$/; // embedded font, image and document-style data

test('rule 1: modules never call the server or browser storage themselves', () => {
  const bad = [];
  for (const f of files('.js').filter(f => !DATA_FILES.test(f))) {
    const src = fs.readFileSync(f, 'utf8').split('\n');
    src.forEach((line, i) => {
      if (/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|window\.claude|\bindexedDB\b|navigator\.sendBeacon/.test(line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, ''))) {
        bad.push(`${path.relative(MODULES, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      }
    });
  }
  assert.deepStrictEqual(bad, []);
});

test('rule 4: module CSS uses tokens, never hex colors or raw brand values (tokens.css defines module tokens)', () => {
  const bad = [];
  for (const f of files('.css').filter(f => !/tokens\.css$/.test(f))) {
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/#[0-9a-fA-F]{3,8}\b|var\(--nx-[a-z0-9]+\)/g)) bad.push(`${path.relative(MODULES, f)}: ${m[0]}`);
  }
  assert.deepStrictEqual(bad, []);
});

test('every module has a bundle.json that lists files which exist', () => {
  for (const m of fs.readdirSync(MODULES)) {
    const cfg = path.join(MODULES, m, 'bundle.json');
    if (!fs.existsSync(cfg)) continue;
    const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    for (const f of [...c.files, ...(c.css || []), c.pages].filter(Boolean)) assert.ok(fs.existsSync(path.resolve(MODULES, m, f)), `${m}: ${f} is missing`);
  }
});

test('every style variable a module uses is defined by the design system or the module’s own tokens.css', () => {
  const T = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'design-system', 'project', 'tokens.json'), 'utf8'));
  const system = new Set(['--f-ui', '--f-cond', '--font-ui', '--font-cond', '--side-w', '--row-h']);
  for (const sec of ['color', 'shadow', 'fontsize', 'spacing', 'radius', 'size']) for (const t of T[sec].tokens) system.add('--' + t.name);
  const RUNTIME = new Set(['--hold-w', '--tl-head', '--tl-list', '--tl-w']); // set from script while drawing the timeline
  for (const m of fs.readdirSync(MODULES)) {
    const tokensFile = path.join(MODULES, m, 'ui', 'tokens.css');
    const own = new Set(fs.existsSync(tokensFile) ? [...fs.readFileSync(tokensFile, 'utf8').matchAll(/(--[a-z0-9-]+)\s*:/g)].map(x => x[1]) : []);
    const bad = new Set();
    for (const f of walk(path.join(MODULES, m)).filter(f => /\.(css|js)$/.test(f) && !DATA_FILES.test(f))) {
      for (const x of fs.readFileSync(f, 'utf8').matchAll(/var\((--[a-z0-9-]+)/g)) if (!x[1].endsWith('-') && !system.has(x[1]) && !own.has(x[1]) && !RUNTIME.has(x[1])) bad.add(`${m}: ${x[1]}`);
    }
    assert.deepStrictEqual([...bad], []);
  }
});

test('module token files add tokens; they never redefine or shadow a design-system token', () => {
  const T = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'design-system', 'project', 'tokens.json'), 'utf8'));
  const system = new Set(['--f-ui', '--f-cond']);
  for (const sec of ['color', 'shadow', 'fontsize', 'spacing', 'radius', 'size']) for (const t of T[sec].tokens) system.add('--' + t.name);
  for (const m of fs.readdirSync(MODULES)) {
    const f = path.join(MODULES, m, 'ui', 'tokens.css');
    if (!fs.existsSync(f)) continue;
    const own = [...fs.readFileSync(f, 'utf8').matchAll(/(--[a-z0-9-]+)\s*:/g)].map(x => x[1]);
    assert.deepStrictEqual(own.filter(n => system.has(n)), [], `${m}/ui/tokens.css redefines a design-system token`);
  }
});

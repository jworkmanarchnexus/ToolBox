/* Build: concatenates engine + UI into two single-file pages.
 *   dist/fee-builder.html             fragment published as a Claude artifact
 *   dist/fee-builder-standalone.html  complete page for any browser (user testing)
 * Run: node build.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const ENGINE = ['money', 'model', 'calc', 'analysis', 'exporter', 'sample'].map(f => `src/engine/${f}.js`);
const UI = ['util', 'store', 'views', 'app'].map(f => `src/ui/${f}.js`);
const assets = `/* ---- shared assets ---- */\n(function (r) { (r.FB || (r.FB = {})).assets = { logo: ${JSON.stringify(R('src/shared/toolbox-logo.dataurl').trim())} }; })(typeof globalThis !== 'undefined' ? globalThis : this);\n`;
const js = assets + ENGINE.concat(UI).map(f => `/* ---- ${f} ---- */\n` + R(f)).join('\n');
// Shared Toolbox design language (copied from the Scheduler; see src/shared/README.md), then Fee Builder's own rules.
const css = ['src/shared/toolbox-fonts.css', 'src/shared/toolbox-base.css', 'src/shared/toolbox-shell-narrow.css', 'src/ui/styles.css'].map(R).join('\n');
const fonts = ''; // Lato and Roboto Condensed are embedded in the shared CSS (SIL Open Font License), so nothing loads from the network
const _unusedFonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700&family=Roboto+Condensed:wght@400;700&display=swap">';
const boot = `\nFB.app.start(document.getElementById('app'));\n`;
const body = `<div id="app"></div>\n<script>\n${js}${boot}</script>\n`;
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
const fragment = `<title>Toolbox · Fee Builder</title>\n${fonts}\n<style>\n${css}</style>\n${body}`;
fs.writeFileSync(path.join(__dirname, 'dist/fee-builder.html'), fragment);
const standalone = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<title>Toolbox · Fee Builder</title>\n${fonts}\n<style>\n${css}</style></head><body>\n${body}</body></html>\n`;
fs.writeFileSync(path.join(__dirname, 'dist/fee-builder-standalone.html'), standalone);
console.log('dist/fee-builder.html', fragment.length, 'bytes');
console.log('dist/fee-builder-standalone.html', standalone.length, 'bytes');

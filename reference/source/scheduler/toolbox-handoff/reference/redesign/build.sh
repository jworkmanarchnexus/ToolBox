#!/bin/sh
# Builds the single-file preview: one HTML page with the styles and one script inlined.
# Production should serve these files separately (see docs/PLATFORM-SEAM.md).
set -e
cd "$(dirname "$0")"
mkdir -p dist
{
  cat head.html
  echo "<style>"; cat fonts.css tokens.css ui.css shell.css editor.css; echo "</style>"
  cat body.html
  echo "<script>"
  echo "(function () {"
  echo "'use strict';"
  cat engine.js merge.js brand.js icons.js templates.js commit.js impact.js permissions.js dup.js \
      app-core.js data.js app-ui.js gantt.js app-task.js app-order.js logo.js pdffonts.js app-export.js export-draw.js export-ui.js \
      browser.js tpl-store.js tpl-ui.js shell.js main.js
  echo "boot();"
  echo "})();"
  echo "</script>"
} > dist/index.html
wc -c dist/index.html

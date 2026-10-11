#!/bin/sh
cd "$(dirname "$0")"
mkdir -p dist
{
  cat head.html
  echo "<style>"; cat style.css; echo "</style>"
  cat body.html
  echo "<script>"
  echo "(function () {"
  echo "'use strict';"
  cat engine.js merge.js app-core.js app-ui.js app-task.js app-order.js logo.js app-export.js
  echo "})();"
  echo "</script>"
} > dist/index.html
wc -c dist/index.html

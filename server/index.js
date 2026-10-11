'use strict';
const { createServer } = require('./app');

const PORT = Number(process.env.PORT) || 5280;
const HOST = '127.0.0.1'; // local only: never bind to another interface (CLAUDE.md rule 6)

createServer().listen(PORT, HOST, () => {
  console.log(`Toolbox running at http://localhost:${PORT} (this computer only). Ctrl+C to stop.`);
});

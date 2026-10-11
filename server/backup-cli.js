'use strict';
/* npm run backup: writes a full backup JSON to backups/ (git-ignored). */
const fs = require('node:fs');
const path = require('node:path');
const dbmod = require('./db/db');
const { exportBackup } = require('./backup');

const db = dbmod.open();
const admin = db.get("SELECT id FROM people WHERE firm_role = 'admin' ORDER BY username");
const backup = exportBackup(db, admin ? admin.id : 'cli');
const dir = path.join(__dirname, '..', 'backups');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `toolbox-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(file, JSON.stringify(backup, null, 2));
console.log(`Backup written to ${file}`);
db.close();

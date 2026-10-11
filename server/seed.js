'use strict';
/* Resets the local database to the made-up seed data (server/db/seed/*.csv). */
const fs = require('node:fs');
const path = require('node:path');
const dbmod = require('./db/db');
const vp = require('./vp');

const SEED = path.join(__dirname, 'db', 'seed');
const read = f => fs.readFileSync(path.join(SEED, f), 'utf8');
const TABLES = ['locks', 'records', 'firm_settings', 'access_overrides', 'project_team', 'projects', 'people'];

function seed(db) {
  db.tx(() => { for (const t of TABLES) db.run(`DELETE FROM ${t}`); });
  vp.importEmployees(db, read('employees.csv'));
  vp.importProjects(db, read('projects.csv'));
  vp.importTeam(db, read('team.csv'));
  vp.importFirmRoles(db, read('firm_roles.csv'));
}

module.exports = { seed };

if (require.main === module) {
  const db = dbmod.open();
  seed(db);
  const n = t => db.get(`SELECT COUNT(*) AS n FROM ${t}`).n;
  console.log(`Seeded: ${n('people')} people, ${n('projects')} projects, ${n('project_team')} team assignments.`);
  db.close();
}

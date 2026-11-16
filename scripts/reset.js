'use strict';

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

for (const file of ['app.db', 'app.db-wal', 'app.db-shm']) {
  const target = path.join(dataDir, file);
  if (!fs.existsSync(target)) continue;
  try {
    fs.rmSync(target);
    console.log(`[reset] removed data/${file}`);
  } catch (error) {
    console.error(`[reset] cannot remove data/${file}: ${error.message}`);
    console.error('[reset] stop the running server first, then try again.');
    process.exit(1);
  }
}

const { getDb, applySchema, closeDb } = require('../server/db');
const { seedDatabase } = require('../server/seed');

const db = getDb();
applySchema(db);
const result = seedDatabase(db);
console.log(`[reset] demo data restored (${result.tenants} tenants)`);
closeDb();

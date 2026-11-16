'use strict';

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

for (const file of ['app.db', 'app.db-wal', 'app.db-shm']) {
  const target = path.join(dataDir, file);
  if (fs.existsSync(target)) {
    fs.rmSync(target);
    console.log(`[reset] removed data/${file}`);
  }
}

const { getDb, applySchema, closeDb } = require('../server/db');
const { seedDatabase } = require('../server/seed');

const db = getDb();
applySchema(db);
const result = seedDatabase(db);
console.log(`[reset] demo data restored (${result.tenants} tenants)`);
closeDb();

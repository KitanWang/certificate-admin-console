'use strict';

const { getDb, applySchema, closeDb } = require('../server/db');
const { seedDatabase } = require('../server/seed');

const db = getDb();
applySchema(db);

const result = seedDatabase(db);
console.log(
  result.seeded
    ? `[seed] demo data created for ${result.tenants} tenants`
    : `[seed] demo data already present (${result.tenants} tenants), nothing to do`,
);

closeDb();

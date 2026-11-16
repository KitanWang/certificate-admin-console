'use strict';

const { getDb, applySchema, dbPath } = require('../server/db');

const db = getDb();
applySchema(db);
db.close();

console.log(`[migrate] schema applied to ${dbPath()}`);

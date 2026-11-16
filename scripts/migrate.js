'use strict';

const { getDb, applySchema, closeDb, dbPath } = require('../server/db');

const db = getDb();
applySchema(db);
closeDb();

console.log(`[migrate] schema applied to ${dbPath()}`);

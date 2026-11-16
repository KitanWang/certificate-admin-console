'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'app.db');

let instance = null;

function dbPath() {
  return process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : DEFAULT_DB_PATH;
}

/**
 * Single process-wide SQLite handle.
 *
 * WAL is required for the export requirement: a long streaming read must not
 * block concurrent list requests. busy_timeout keeps short write bursts from
 * surfacing "database is locked" to the client.
 */
function getDb() {
  if (instance) return instance;

  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 10000');

  instance = db;
  return db;
}

function applySchema(db) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
}

function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}

module.exports = { getDb, applySchema, closeDb, dbPath, DEFAULT_DB_PATH };

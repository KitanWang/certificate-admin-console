'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
process.chdir(root);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args, label) {
  const result = spawnSync(npm, args, {
    stdio: 'inherit',
    cwd: root,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`[start] ${label} failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

function dependenciesPresent() {
  try {
    require.resolve('express', { paths: [root] });
    require.resolve('better-sqlite3', { paths: [root] });
    require.resolve('vite', { paths: [root] });
    return true;
  } catch {
    return false;
  }
}

if (!dependenciesPresent()) {
  console.log('[start] installing declared dependencies...');
  run(['install', '--no-audit', '--no-fund'], 'dependency installation');
}

const { getDb, applySchema, dbPath } = require('../server/db');
const { seedDatabase } = require('../server/seed');

const db = getDb();
applySchema(db);
const result = seedDatabase(db);
console.log(
  result.seeded
    ? `[start] initialized demo data in ${dbPath()}`
    : `[start] existing database reused (${result.tenants} tenants)`,
);
db.close();

const dist = path.join(root, 'web', 'dist', 'index.html');
if (!fs.existsSync(dist)) {
  console.log('[start] building web client...');
  run(['run', 'build:web'], 'web build');
}

require('../server/index');

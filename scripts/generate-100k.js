'use strict';

/**
 * Generates 100,000 certificates for the East tenant.
 *
 * This is opt-in and never runs during `npm start`, so the quick-start dataset
 * stays small and reviewable. The script is re-runnable: it clears its own
 * previously generated rows first. `npm run reset` drops everything and
 * restores the small demo dataset.
 */

const { getDb, applySchema, closeDb, dbPath } = require('../server/db');
const { localDate } = require('../server/time');

const LEARNER_COUNT = 20000;
const DISTINCT_NAMES = 5000;
const COURSE_TITLES = ['Bulk Load 01', 'Bulk Load 02', 'Bulk Load 03', 'Bulk Load 04', 'Bulk Load 05'];
const EXPECTED_ROWS = LEARNER_COUNT * COURSE_TITLES.length;

const db = getDb();
applySchema(db);

const tenant = db.prepare("SELECT id, slug, timezone FROM tenants WHERE slug = 'east'").get();
if (!tenant) {
  console.error('[gen:100k] the east tenant is missing. Run `npm run seed` first.');
  process.exit(1);
}

const stampPool = [];
for (let day = 0; day < 30; day += 1) {
  for (const hour of [3, 9, 15, 21]) {
    const iso = new Date(Date.UTC(2026, 1, 1 + day, hour, 30, 0)).toISOString().replace('.000Z', 'Z');
    stampPool.push({ iso, local: localDate(iso, tenant.timezone) });
  }
}

const started = Date.now();

const run = db.transaction(() => {
  db.prepare(
    "DELETE FROM certificates WHERE tenant_id = ? AND serial LIKE 'EAS-B%'",
  ).run(tenant.id);
  db.prepare(
    "DELETE FROM learners WHERE tenant_id = ? AND email LIKE 'bulk.%@east.test'",
  ).run(tenant.id);

  const courseIds = COURSE_TITLES.map((title) => {
    const existing = db
      .prepare('SELECT id FROM courses WHERE tenant_id = ? AND title = ?')
      .get(tenant.id, title);
    if (existing) return existing.id;
    return db
      .prepare('INSERT INTO courses (tenant_id, title) VALUES (?, ?)')
      .run(tenant.id, title).lastInsertRowid;
  });

  const insertLearner = db.prepare(
    'INSERT INTO learners (tenant_id, name, email) VALUES (?, ?, ?)',
  );
  const insertCert = db.prepare(
    `INSERT INTO certificates
       (tenant_id, course_id, learner_id, serial, issued_at_utc, issued_local_date, status, batch_id)
     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', NULL)`,
  );

  let sequence = 0;

  for (let i = 0; i < LEARNER_COUNT; i += 1) {
    // Names repeat on purpose: the export must stay deterministic when many
    // rows share the same sort key.
    const displayName = `Bulk Learner ${String((i % DISTINCT_NAMES) + 1).padStart(5, '0')}`;
    const learnerId = insertLearner.run(tenant.id, displayName, `bulk.${i}@east.test`).lastInsertRowid;

    for (const courseId of courseIds) {
      const stamp = stampPool[(i * 7 + sequence) % stampPool.length];
      sequence += 1;
      insertCert.run(
        tenant.id,
        courseId,
        learnerId,
        `EAS-B${String(sequence).padStart(6, '0')}`,
        stamp.iso,
        stamp.local,
      );
    }
  }

  return sequence;
});

const written = run();
const total = db
  .prepare('SELECT COUNT(*) AS n FROM certificates WHERE tenant_id = ?')
  .get(tenant.id).n;

console.log(`[gen:100k] inserted ${written} certificates (expected ${EXPECTED_ROWS}) for tenant east`);
console.log(`[gen:100k] east now holds ${total} certificates`);
console.log(`[gen:100k] database: ${dbPath()}`);
console.log(`[gen:100k] elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log('[gen:100k] verify with: npm run verify:export');

closeDb();

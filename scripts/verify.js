'use strict';

/**
 * Acceptance checks for A1-A7.
 *
 * Runs against a throw-away database so it never touches the demo dataset you
 * are reviewing. `--with-export` additionally generates 100k rows and exercises
 * the streaming export (slower, roughly 10-20 seconds).
 *
 *   npm run verify
 *   npm run verify:export
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const withExport = process.argv.includes('--with-export');
const dbFile = path.join(os.tmpdir(), `cac-verify-${Date.now()}.db`);
process.env.DB_PATH = dbFile;

const ALICE = 'tok_east_alice';
const BOB = 'tok_west_bob';

const results = [];

function pass(id, title, detail) {
  results.push({ id, title, ok: true, detail });
  console.log(`  PASS  ${id} ${title}${detail ? ` — ${detail}` : ''}`);
}

function fail(id, title, error) {
  results.push({ id, title, ok: false, detail: error.message });
  console.log(`  FAIL  ${id} ${title} — ${error.message}`);
}

async function check(id, title, fn) {
  try {
    const detail = await fn();
    pass(id, title, detail);
  } catch (error) {
    fail(id, title, error);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeep(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`);
}

async function main() {
  console.log('[verify] preparing isolated database');
  const { getDb, applySchema, closeDb } = require('../server/db');
  const { seedDatabase } = require('../server/seed');

  {
    const db = getDb();
    applySchema(db);
    seedDatabase(db);
    closeDb();
  }

  if (withExport) {
    console.log('[verify] generating 100,000 rows for the export checks');
    const generated = spawnSync(process.execPath, [path.join(__dirname, 'generate-100k.js')], {
      env: { ...process.env, DB_PATH: dbFile },
      stdio: 'inherit',
    });
    if (generated.status !== 0) {
      console.error('[verify] row generation failed');
      process.exit(1);
    }
  }

  const { createApp } = require('../server/app');
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const reader = new Database(dbFile, { readonly: true });
  const countCerts = () => reader.prepare('SELECT COUNT(*) AS n FROM certificates').get().n;
  const countAudits = () => reader.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
  const countIssueAudits = (certificateId) =>
    reader
      .prepare("SELECT COUNT(*) AS n FROM audit_events WHERE certificate_id = ? AND action = 'ISSUE'")
      .get(certificateId).n;
  const countRevokeAudits = (certificateId) =>
    reader
      .prepare("SELECT COUNT(*) AS n FROM audit_events WHERE certificate_id = ? AND action = 'REVOKE'")
      .get(certificateId).n;

  const courseId = (tenantSlug, title) =>
    reader
      .prepare(
        `SELECT c.id FROM courses c JOIN tenants t ON t.id = c.tenant_id
         WHERE t.slug = ? AND c.title = ?`,
      )
      .get(tenantSlug, title).id;

  const certIdBySerial = (serial) =>
    reader.prepare('SELECT id FROM certificates WHERE serial = ?').get(serial).id;

  async function api(pathname, { token = ALICE, method = 'GET', body, key } = {}) {
    const headers = { 'X-Actor-Token': token };
    if (body) headers['Content-Type'] = 'application/json';
    if (key) headers['Idempotency-Key'] = key;
    const response = await fetch(`${base}${pathname}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text, headers: response.headers };
  }

  const eastSafety = courseId('east', 'Safety 101');
  const eastManual = courseId('east', 'Manual Handling');
  const eastFire = courseId('east', 'Fire Safety');
  const eastPrimaryCert = certIdBySerial('EAS-000001');
  const westPrimaryCert = certIdBySerial('WES-000013');

  console.log('\n[verify] A1 tenant isolation');

  await check('A1', 'list is scoped to the acting tenant', async () => {
    const res = await api('/api/certificates?pageSize=50', { token: BOB });
    assertEqual(res.status, 200, 'status');
    assert(res.json.total > 0, 'west should own certificates');
    const foreign = res.json.items.filter((item) => !item.serial.startsWith('WES-'));
    assertEqual(foreign.length, 0, 'west list leaked foreign rows');
    return `${res.json.total} rows, all WES-*`;
  });

  await check('A1', 'cross-tenant detail returns 404', async () => {
    const res = await api(`/api/certificates/${eastPrimaryCert}`, { token: BOB });
    assertEqual(res.status, 404, 'status');
    assert(!res.text.includes('EAS-'), 'response must not reveal the serial');
    return 'HTTP 404 without payload leakage';
  });

  await check('A1', 'cross-tenant export returns only own rows', async () => {
    const res = await api('/api/certificates/export', { token: BOB });
    assertEqual(res.status, 200, 'status');
    assert(!res.text.includes('EAS-'), 'west export contained east serials');
    assert(res.text.includes('WES-'), 'west export should contain west serials');
    return 'no EAS-* serials present';
  });

  await check('A1', 'cross-tenant bulk issue is rejected with no side effects', async () => {
    const before = { certs: countCerts(), audits: countAudits() };
    const res = await api('/api/bulk-issue', {
      token: BOB,
      method: 'POST',
      key: 'a1-cross-tenant',
      body: { courseId: eastSafety },
    });
    assertEqual(res.status, 404, 'status');
    assertEqual(countCerts(), before.certs, 'certificate count changed');
    assertEqual(countAudits(), before.audits, 'audit count changed');
    return 'HTTP 404, zero certificates, zero audit events';
  });

  console.log('\n[verify] A4 learner outcomes');

  const beforeSafety = countCerts();
  let safetyBatch = null;

  await check('A4', 'only eligible learners receive a certificate', async () => {
    const res = await api('/api/bulk-issue', {
      method: 'POST',
      key: 'a4-outcomes',
      body: { courseId: eastSafety },
    });
    assertEqual(res.status, 200, 'status');
    safetyBatch = res.json;

    assertDeep(res.json.counts, { issued: 3, skipped: 2, failed: 0, total: 5 }, 'counts');
    assertEqual(countCerts() - beforeSafety, 3, 'certificates written');

    const byName = Object.fromEntries(res.json.results.map((row) => [row.learnerName, row]));
    assertEqual(byName['Alex Lee'].outcome, 'skipped', 'Alex Lee outcome');
    assertEqual(byName['Alex Lee'].reason, 'already_certified', 'Alex Lee reason');
    assertEqual(byName['Tom Becker'].outcome, 'skipped', 'Tom Becker outcome');
    assertEqual(byName['Tom Becker'].reason, 'enrolment_not_completed', 'Tom Becker reason');
    assertEqual(byName['Priya Nair'].outcome, 'issued', 'Priya Nair outcome');
    return '3 issued, 2 skipped with distinct reasons';
  });

  console.log('\n[verify] A2 retry safety');

  await check('A2', 'sequential retry replays the same operation', async () => {
    const certsBefore = countCerts();
    const auditsBefore = countAudits();
    const replay = await api('/api/bulk-issue', {
      method: 'POST',
      key: 'a4-outcomes',
      body: { courseId: eastSafety },
    });
    assertEqual(replay.status, 200, 'status');
    assertEqual(replay.json.batchId, safetyBatch.batchId, 'batch id');
    assertEqual(JSON.stringify(replay.json), JSON.stringify(safetyBatch), 'response body');
    assertEqual(countCerts(), certsBefore, 'no extra certificates');
    assertEqual(countAudits(), auditsBefore, 'no extra audit events');
    return 'identical body, no side effects';
  });

  await check('A2', 'concurrent retry yields one logical operation', async () => {
    const certsBefore = countCerts();
    const auditsBefore = countAudits();
    const key = 'a2-concurrent';

    const [first, second] = await Promise.all([
      api('/api/bulk-issue', { method: 'POST', key, body: { courseId: eastFire } }),
      api('/api/bulk-issue', { method: 'POST', key, body: { courseId: eastFire } }),
    ]);

    assertEqual(first.status, 200, 'first status');
    assertEqual(second.status, 200, 'second status');
    assertEqual(first.json.batchId, second.json.batchId, 'shared batch id');
    assertEqual(JSON.stringify(first.json), JSON.stringify(second.json), 'identical outcome');

    assertEqual(countCerts() - certsBefore, 3, 'certificates written');
    assertEqual(countAudits() - auditsBefore, 3, 'audit events written');

    for (const row of first.json.results.filter((item) => item.outcome === 'issued')) {
      assertEqual(countIssueAudits(row.certificateId), 1, `ISSUE audits for ${row.serial}`);
    }
    return '3 certificates, 3 audit events for 2 callers';
  });

  console.log('\n[verify] A3 key misuse');

  await check('A3', 'reusing a key with a different payload returns 409', async () => {
    const certsBefore = countCerts();
    const res = await api('/api/bulk-issue', {
      method: 'POST',
      key: 'a4-outcomes',
      body: { courseId: eastManual },
    });
    assertEqual(res.status, 409, 'status');
    assertEqual(countCerts(), certsBefore, 'no certificates written');

    const original = await api('/api/bulk-issue', {
      method: 'POST',
      key: 'a4-outcomes',
      body: { courseId: eastSafety },
    });
    assertEqual(original.json.batchId, safetyBatch.batchId, 'first result was overwritten');
    return 'HTTP 409, original result preserved';
  });

  console.log('\n[verify] A5 tenant-local date');

  await check('A5', 'east certificate renders in Sydney time', async () => {
    const res = await api(`/api/certificates/${eastPrimaryCert}`);
    assertEqual(res.status, 200, 'status');
    assertEqual(res.json.issuedAtUtc, '2026-01-10T13:30:00Z', 'utc timestamp');
    assertEqual(res.json.issuedLocalDate, '2026-01-11', 'local date');
    assertEqual(res.json.issuedLocalDateTime, '2026-01-11 00:30', 'local datetime');
    return '2026-01-11 00:30 (UTC+11)';
  });

  await check('A5', 'west certificate renders in Perth time', async () => {
    const res = await api(`/api/certificates/${westPrimaryCert}`, { token: BOB });
    assertEqual(res.status, 200, 'status');
    assertEqual(res.json.issuedAtUtc, '2026-01-10T13:30:00Z', 'utc timestamp');
    assertEqual(res.json.issuedLocalDate, '2026-01-10', 'local date');
    assertEqual(res.json.issuedLocalDateTime, '2026-01-10 21:30', 'local datetime');
    return '2026-01-10 21:30 (UTC+8)';
  });

  await check('A5', 'list sort and CSV use the local calendar date', async () => {
    // Query by serial so the assertion is independent of how many rows the
    // dataset holds (the 100k generator adds rows dated later than this one).
    const list = await api('/api/certificates?q=EAS-000001&sort=issued_date&dir=desc&pageSize=5');
    const target = list.json.items.find((item) => item.serial === 'EAS-000001');
    assert(target, 'EAS-000001 missing from list');
    assertEqual(target.issuedLocalDate, '2026-01-11', 'list local date');

    const csv = await api('/api/certificates/export?q=EAS-000001&sort=issued_date&dir=desc');
    const row = csv.text.split('\n').find((line) => line.includes('EAS-000001'));
    assert(row, 'EAS-000001 missing from export');
    assert(row.endsWith('2026-01-11'), `CSV date wrong: ${row}`);
    return 'CSV row uses 2026-01-11';
  });

  console.log('\n[verify] A7 revocation audit');

  await check('A7', 'revocation is idempotent and audits once', async () => {
    const issued = safetyBatch.results.find((row) => row.outcome === 'issued' && row.serial);
    const targetId = issued.certificateId;

    const first = await api(`/api/certificates/${targetId}/revoke`, { method: 'POST' });
    assertEqual(first.status, 200, 'first status');
    assertEqual(first.json.status, 'REVOKED', 'first status value');
    assertEqual(first.json.alreadyRevoked, false, 'first response flagged as new');
    assert(first.json.auditEventId, 'first response should return an audit id');
    assertEqual(countRevokeAudits(targetId), 1, 'revoke audits after first call');

    const second = await api(`/api/certificates/${targetId}/revoke`, { method: 'POST' });
    assertEqual(second.status, 200, 'second status');
    assertEqual(second.json.alreadyRevoked, true, 'second response flagged as repeat');
    assertEqual(countRevokeAudits(targetId), 1, 'revoke audits after repeat');

    const detail = await api(`/api/certificates/${targetId}`);
    assertEqual(detail.json.status, 'REVOKED', 'detail status');
    assertEqual(
      detail.json.auditEvents.filter((event) => event.action === 'REVOKE').length,
      1,
      'revoke events in detail',
    );
    return 'one REVOKE audit event across two calls';
  });

  if (withExport) {
    console.log('\n[verify] A6 export growth');

    const eastTotal = reader
      .prepare(
        `SELECT COUNT(*) AS n FROM certificates c
         JOIN tenants t ON t.id = c.tenant_id WHERE t.slug = 'east'`,
      )
      .get().n;

    await check('A6', '100k export completes quickly and matches the list order', async () => {
      const startedAt = Date.now();
      const exportRes = await fetch(`${base}/api/certificates/export?sort=learner&dir=asc`, {
        headers: { 'X-Actor-Token': ALICE },
      });
      assertEqual(exportRes.status, 200, 'export status');

      // While the export is streaming, an unrelated list request must still be
      // served. This is the check that a synchronous full-table scan fails.
      const listStartedAt = Date.now();
      const listRes = await api('/api/certificates?sort=learner&dir=asc&pageSize=20');
      const listLatency = Date.now() - listStartedAt;
      assertEqual(listRes.status, 200, 'list status during export');
      assert(listLatency < 5000, `list took ${listLatency}ms during export`);

      const csv = await exportRes.text();
      const elapsed = Date.now() - startedAt;
      assert(elapsed < 60000, `export took ${elapsed}ms`);

      const rows = csv.trimEnd().split('\n');
      assertEqual(rows[0], 'learner_name,course_title,serial_number,issue_date', 'header');
      assertEqual(rows.length - 1, eastTotal, 'row count');

      const firstTwenty = rows.slice(1, 21).map((line) => line.split(',')[0]);
      const listNames = listRes.json.items.map((item) => item.learnerName);
      assertDeep(firstTwenty, listNames, 'export order vs list order');

      return `${eastTotal} rows in ${elapsed}ms, list served in ${listLatency}ms`;
    });

    await check('A6', 'repeated export is byte-identical for equal sort keys', async () => {
      const [first, second] = await Promise.all([
        api('/api/certificates/export?q=Bulk%20Learner&sort=learner&dir=asc').then((r) => r.text),
        api('/api/certificates/export?q=Bulk%20Learner&sort=learner&dir=asc').then((r) => r.text),
      ]);
      assert(first.length > 0, 'export was empty');
      assertEqual(first.length, second.length, 'length');
      assertEqual(first, second, 'byte comparison');

      const matching = reader
        .prepare(
          `SELECT COUNT(*) AS n FROM certificates c
           JOIN learners l ON l.id = c.learner_id
           JOIN tenants t ON t.id = c.tenant_id
           WHERE t.slug = 'east' AND l.name LIKE 'Bulk Learner%'`,
        )
        .get().n;
      assertEqual(first.trimEnd().split('\n').length - 1, matching, 'filtered row count');
      return `${matching} rows, identical across two runs`;
    });
  }

  reader.close();
  await new Promise((resolve) => server.close(resolve));
  closeDb();

  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${dbFile}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\n[verify] ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('[verify] failed:');
    for (const item of failed) console.log(`  - ${item.id} ${item.title}: ${item.detail}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[verify] crashed:', error);
  process.exit(1);
});

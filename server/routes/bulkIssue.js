'use strict';

const express = require('express');
const { createHash, randomUUID } = require('crypto');
const { insertCertificate, insertAudit } = require('../lib/certificates');
const { nowUtcIso } = require('../time');

const WAIT_TIMEOUT_MS = 10000;
const WAIT_INTERVAL_MS = 25;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function hashRequest(courseId, body) {
  const rest = { ...(body || {}) };
  delete rest.courseId;
  return createHash('sha256')
    .update(JSON.stringify({ courseId, rest: canonicalize(rest) }))
    .digest('hex');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Per-learner classification. Eligibility is derived from the enrolment plus
 * the live-certificate unique index, so the same rules apply whether the
 * learner is reached through the UI, a retry or a concurrent duplicate.
 */
function collectOutcomes(db, actor, course, batchId, issuedAt) {
  const rows = db
    .prepare(
      `SELECT e.learner_id, e.status, l.name AS learner_name,
              (SELECT c.id FROM certificates c
                WHERE c.tenant_id = e.tenant_id
                  AND c.learner_id = e.learner_id
                  AND c.course_id = e.course_id
                  AND c.status = 'ACTIVE') AS active_certificate_id
       FROM enrollments e
       JOIN learners l ON l.id = e.learner_id
       WHERE e.tenant_id = ? AND e.course_id = ?
       ORDER BY l.name ASC, l.id ASC`,
    )
    .all(actor.tenantId, course.id);

  const results = [];
  const counts = { issued: 0, skipped: 0, failed: 0, total: rows.length };

  for (const row of rows) {
    const base = {
      learnerId: row.learner_id,
      learnerName: row.learner_name,
    };

    if (row.status !== 'completed') {
      results.push({ ...base, outcome: 'skipped', reason: 'enrolment_not_completed' });
      counts.skipped += 1;
      continue;
    }

    if (row.active_certificate_id) {
      results.push({
        ...base,
        outcome: 'skipped',
        reason: 'already_certified',
        certificateId: row.active_certificate_id,
      });
      counts.skipped += 1;
      continue;
    }

    try {
      // Certificate and audit event are written together so an issuance can
      // never exist without exactly one audit trail entry.
      const created = db.transaction(() => {
        const certificate = insertCertificate(db, {
          tenantId: actor.tenantId,
          courseId: course.id,
          learnerId: row.learner_id,
          issuedAtUtc: issuedAt,
          timezone: actor.timezone,
          batchId,
          serialPrefix: actor.serialPrefix,
        });

        insertAudit(db, {
          tenantId: actor.tenantId,
          certificateId: certificate.id,
          action: 'ISSUE',
          actorEmail: actor.email,
          batchId,
          createdAtUtc: issuedAt,
          detail: 'Bulk issuance',
        });

        return certificate;
      })();

      results.push({
        ...base,
        outcome: 'issued',
        reason: null,
        certificateId: created.id,
        serial: created.serial,
      });
      counts.issued += 1;
    } catch (error) {
      results.push({ ...base, outcome: 'failed', reason: 'issue_failed', detail: error.code });
      counts.failed += 1;
    }
  }

  return { counts, results };
}

function createBulkIssueRoutes(db) {
  const router = express.Router();

  const selectBatch = db.prepare(
    'SELECT * FROM bulk_batches WHERE tenant_id = ? AND idempotency_key = ?',
  );

  const insertBatch = db.prepare(
    `INSERT INTO bulk_batches
       (id, tenant_id, idempotency_key, request_hash, course_id, status, result_json,
        actor_email, created_at_utc, completed_at_utc)
     VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', NULL, ?, ?, NULL)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
  );

  const completeBatch = db.prepare(
    `UPDATE bulk_batches
     SET status = 'COMPLETED', result_json = ?, completed_at_utc = ?
     WHERE id = ?`,
  );

  async function awaitCompletion(batchId) {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const row = db.prepare('SELECT status, result_json FROM bulk_batches WHERE id = ?').get(batchId);
      if (row && row.status === 'COMPLETED') return row.result_json;
      await sleep(WAIT_INTERVAL_MS);
    }
    return null;
  }

  router.post('/', async (req, res) => {
    const actor = req.actor;
    const key = (req.get('idempotency-key') || '').trim();

    if (!key) {
      return res.status(400).json({
        error: 'missing_idempotency_key',
        message: 'Bulk issuance requires an Idempotency-Key header.',
      });
    }

    const courseId = Number.parseInt(req.body?.courseId, 10);
    if (!Number.isInteger(courseId)) {
      return res.status(400).json({ error: 'invalid_course_id' });
    }

    // Tenant scoping happens before anything is written. A cross-tenant course
    // id must leave no batch row, certificate or audit event behind.
    const course = db
      .prepare('SELECT id, title FROM courses WHERE id = ? AND tenant_id = ?')
      .get(courseId, actor.tenantId);

    if (!course) {
      return res.status(404).json({ error: 'course_not_found' });
    }

    const requestHash = hashRequest(course.id, req.body);
    const batchId = randomUUID();
    const startedAt = nowUtcIso();

    const claim = insertBatch.run(
      batchId,
      actor.tenantId,
      key,
      requestHash,
      course.id,
      actor.email,
      startedAt,
    );

    if (claim.changes === 0) {
      const existing = selectBatch.get(actor.tenantId, key);

      if (existing.request_hash !== requestHash) {
        return res.status(409).json({
          error: 'idempotency_key_reused',
          message:
            'This idempotency key was already used with a different request payload. Use a new key for a new operation.',
          originalBatchId: existing.id,
        });
      }

      if (existing.status === 'COMPLETED') {
        res.set('X-Idempotent-Replay', 'true');
        return res.status(200).type('application/json').send(existing.result_json);
      }

      // The winner is still running. Wait for it instead of starting a second
      // operation, then answer with the same stored outcome.
      const settled = await awaitCompletion(existing.id);
      if (settled) {
        res.set('X-Idempotent-Replay', 'true');
        return res.status(200).type('application/json').send(settled);
      }

      return res.status(409).json({
        error: 'operation_in_progress',
        message: 'The original operation with this key is still in progress.',
        originalBatchId: existing.id,
      });
    }

    const issuedAt = nowUtcIso();
    const { counts, results } = collectOutcomes(db, actor, course, batchId, issuedAt);

    const payload = {
      batchId,
      courseId: course.id,
      courseTitle: course.title,
      idempotencyKey: key,
      createdAtUtc: issuedAt,
      counts,
      results,
    };

    // The snapshot is what every later caller receives, byte for byte.
    const body = JSON.stringify(payload);
    completeBatch.run(body, nowUtcIso(), batchId);

    return res.status(200).type('application/json').send(body);
  });

  return router;
}

module.exports = { createBulkIssueRoutes };

'use strict';

const express = require('express');
const { localDateTime, nowUtcIso } = require('../time');
const { buildListQuery, normalizeSort, normalizeDir } = require('../lib/query');
const { insertAudit } = require('../lib/certificates');

const CERT_COLUMNS = `c.id, c.serial, c.status, c.issued_at_utc, c.issued_local_date,
                      c.revoked_at_utc, c.course_id, c.learner_id, c.batch_id,
                      l.name AS learner_name, co.title AS course_title`;

const CERT_FROM = `
  FROM certificates c
  JOIN learners l ON l.id = c.learner_id
  JOIN courses co ON co.id = c.course_id
`;

function mapCertificate(row, timezone) {
  return {
    id: row.id,
    serial: row.serial,
    learnerId: row.learner_id,
    learnerName: row.learner_name,
    courseId: row.course_id,
    courseTitle: row.course_title,
    status: row.status,
    issuedAtUtc: row.issued_at_utc,
    issuedLocalDate: row.issued_local_date,
    issuedLocalDateTime: localDateTime(row.issued_at_utc, timezone),
    revokedAtUtc: row.revoked_at_utc || null,
    revokedLocalDateTime: row.revoked_at_utc ? localDateTime(row.revoked_at_utc, timezone) : null,
  };
}

function createCertificateRoutes(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const actor = req.actor;
    const search = (req.query.q || '').trim();
    const query = buildListQuery({
      tenantId: actor.tenantId,
      search,
      sort: req.query.sort,
      dir: req.query.dir,
    });

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 10));

    const total = db.prepare(query.countSql).get(...query.where.params).total;
    const rows = db
      .prepare(query.rowsSql)
      .all(...query.where.params, pageSize, (page - 1) * pageSize);

    res.json({
      items: rows.map((row) => mapCertificate(row, actor.timezone)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      sort: query.sortKey,
      dir: normalizeDir(query.sortKey, req.query.dir).toLowerCase(),
      query: search,
      tenant: { slug: actor.tenantSlug, name: actor.tenantName, timezone: actor.timezone },
    });
  });

  router.get('/:id', (req, res) => {
    const actor = req.actor;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(404).json({ error: 'certificate_not_found' });
    }

    const row = db
      .prepare(`SELECT ${CERT_COLUMNS} ${CERT_FROM} WHERE c.id = ? AND c.tenant_id = ?`)
      .get(id, actor.tenantId);

    // A certificate owned by another tenant must be indistinguishable from one
    // that does not exist.
    if (!row) {
      return res.status(404).json({ error: 'certificate_not_found' });
    }

    const audits = db
      .prepare(
        `SELECT id, action, actor_email, batch_id, created_at_utc, detail
         FROM audit_events
         WHERE certificate_id = ? AND tenant_id = ?
         ORDER BY id ASC`,
      )
      .all(id, actor.tenantId);

    res.json({
      ...mapCertificate(row, actor.timezone),
      batchId: row.batch_id,
      auditEvents: audits.map((event) => ({
        id: event.id,
        action: event.action,
        actorEmail: event.actor_email,
        batchId: event.batch_id,
        createdAtUtc: event.created_at_utc,
        createdAtLocal: localDateTime(event.created_at_utc, actor.timezone),
        detail: event.detail,
      })),
      tenant: { slug: actor.tenantSlug, name: actor.tenantName, timezone: actor.timezone },
    });
  });

  router.post('/:id/revoke', (req, res) => {
    const actor = req.actor;
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(404).json({ error: 'certificate_not_found' });
    }

    const existing = db
      .prepare('SELECT id, status, revoked_at_utc FROM certificates WHERE id = ? AND tenant_id = ?')
      .get(id, actor.tenantId);

    if (!existing) {
      return res.status(404).json({ error: 'certificate_not_found' });
    }

    if (existing.status === 'REVOKED') {
      // Revocation is idempotent: a repeat must not append a second audit event.
      return res.json({
        id,
        status: 'REVOKED',
        revokedAtUtc: existing.revoked_at_utc,
        revokedAtLocal: existing.revoked_at_utc
          ? localDateTime(existing.revoked_at_utc, actor.timezone)
          : null,
        alreadyRevoked: true,
        auditEventId: null,
      });
    }

    const revokedAt = nowUtcIso();

    const apply = db.transaction(() => {
      // The guard on status makes the state transition the single source of
      // truth: only the request that actually flips ACTIVE -> REVOKED writes
      // the audit event.
      const update = db
        .prepare(
          `UPDATE certificates
           SET status = 'REVOKED', revoked_at_utc = ?
           WHERE id = ? AND tenant_id = ? AND status = 'ACTIVE'`,
        )
        .run(revokedAt, id, actor.tenantId);

      if (update.changes !== 1) return null;

      const auditEventId = insertAudit(db, {
        tenantId: actor.tenantId,
        certificateId: id,
        action: 'REVOKE',
        actorEmail: actor.email,
        createdAtUtc: revokedAt,
        detail: 'Certificate revoked by tenant admin',
      });

      return { auditEventId };
    });

    const result = apply();
    if (!result) {
      const current = db
        .prepare('SELECT status, revoked_at_utc FROM certificates WHERE id = ? AND tenant_id = ?')
        .get(id, actor.tenantId);
      return res.json({
        id,
        status: current.status,
        revokedAtUtc: current.revoked_at_utc,
        revokedAtLocal: current.revoked_at_utc
          ? localDateTime(current.revoked_at_utc, actor.timezone)
          : null,
        alreadyRevoked: true,
        auditEventId: null,
      });
    }

    res.json({
      id,
      status: 'REVOKED',
      revokedAtUtc: revokedAt,
      revokedAtLocal: localDateTime(revokedAt, actor.timezone),
      alreadyRevoked: false,
      auditEventId: result.auditEventId,
    });
  });

  return router;
}

module.exports = { createCertificateRoutes, mapCertificate };

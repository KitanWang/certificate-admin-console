'use strict';

const { randomUUID } = require('crypto');
const { localDate } = require('../time');

function serialPrefixFor(slug) {
  return slug.toUpperCase().slice(0, 3);
}

const INSERT_CERT = `
  INSERT INTO certificates
    (tenant_id, course_id, learner_id, serial, issued_at_utc, issued_local_date, status, batch_id)
  VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
`;

const UPDATE_SERIAL = 'UPDATE certificates SET serial = ? WHERE id = ?';

const INSERT_AUDIT = `
  INSERT INTO audit_events
    (tenant_id, certificate_id, action, actor_email, batch_id, created_at_utc, detail)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;

/**
 * Inserts a certificate and, unless an explicit serial is supplied, derives the
 * serial from the row id. The row id is the only allocation source that stays
 * unique under concurrency inside SQLite, so the serial is patched in the same
 * transaction instead of being pre-computed with MAX(id) + 1.
 */
function insertCertificate(db, params) {
  const {
    tenantId,
    courseId,
    learnerId,
    issuedAtUtc,
    timezone,
    batchId = null,
    serialPrefix,
    explicitSerial = null,
  } = params;

  const localDateStr = localDate(issuedAtUtc, timezone);
  const serial = explicitSerial || `TMP-${randomUUID()}`;

  const info = db
    .prepare(INSERT_CERT)
    .run(tenantId, courseId, learnerId, serial, issuedAtUtc, localDateStr, batchId);

  const id = info.lastInsertRowid;
  if (explicitSerial) return { id, serial: explicitSerial };

  const finalSerial = `${serialPrefix}-${String(id).padStart(6, '0')}`;
  db.prepare(UPDATE_SERIAL).run(finalSerial, id);
  return { id, serial: finalSerial };
}

function insertAudit(db, params) {
  const {
    tenantId,
    certificateId,
    action,
    actorEmail,
    batchId = null,
    createdAtUtc,
    detail = null,
  } = params;

  const info = db
    .prepare(INSERT_AUDIT)
    .run(tenantId, certificateId, action, actorEmail, batchId, createdAtUtc, detail);

  return info.lastInsertRowid;
}

module.exports = { insertCertificate, insertAudit, serialPrefixFor };

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id        INTEGER PRIMARY KEY,
  slug      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  timezone  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id        INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  email     TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  token     TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS courses (
  id        INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  title     TEXT NOT NULL,
  UNIQUE (tenant_id, title)
);

CREATE TABLE IF NOT EXISTS learners (
  id        INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name      TEXT NOT NULL,
  email     TEXT NOT NULL,
  UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS ix_learners_tenant_name ON learners (tenant_id, name, id);

CREATE TABLE IF NOT EXISTS enrollments (
  id           INTEGER PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id),
  course_id    INTEGER NOT NULL REFERENCES courses(id),
  learner_id   INTEGER NOT NULL REFERENCES learners(id),
  status       TEXT NOT NULL CHECK (status IN ('completed', 'in_progress')),
  completed_at TEXT,
  UNIQUE (course_id, learner_id)
);

CREATE INDEX IF NOT EXISTS ix_enrollments_course ON enrollments (tenant_id, course_id, learner_id);

CREATE TABLE IF NOT EXISTS certificates (
  id                INTEGER PRIMARY KEY,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id),
  course_id         INTEGER NOT NULL REFERENCES courses(id),
  learner_id        INTEGER NOT NULL REFERENCES learners(id),
  serial            TEXT NOT NULL,
  issued_at_utc     TEXT NOT NULL,
  issued_local_date TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  revoked_at_utc    TEXT,
  batch_id          TEXT,
  UNIQUE (tenant_id, serial)
);

-- Guarantees at most one live certificate per learner per course, while still
-- allowing a new certificate after a revocation.
CREATE UNIQUE INDEX IF NOT EXISTS ux_certificates_active
  ON certificates (tenant_id, learner_id, course_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS ix_certificates_tenant_date
  ON certificates (tenant_id, issued_local_date, id);

CREATE INDEX IF NOT EXISTS ix_certificates_tenant_learner
  ON certificates (tenant_id, learner_id, id);

CREATE INDEX IF NOT EXISTS ix_certificates_serial
  ON certificates (tenant_id, serial);

CREATE TABLE IF NOT EXISTS audit_events (
  id             INTEGER PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id),
  certificate_id INTEGER REFERENCES certificates(id),
  action         TEXT NOT NULL CHECK (action IN ('ISSUE', 'REVOKE')),
  actor_email    TEXT NOT NULL,
  batch_id       TEXT,
  created_at_utc TEXT NOT NULL,
  detail         TEXT
);

CREATE INDEX IF NOT EXISTS ix_audit_certificate ON audit_events (certificate_id, action);

CREATE TABLE IF NOT EXISTS bulk_batches (
  id                TEXT PRIMARY KEY,
  tenant_id         INTEGER NOT NULL REFERENCES tenants(id),
  idempotency_key   TEXT NOT NULL,
  request_hash      TEXT NOT NULL,
  course_id         INTEGER NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  result_json       TEXT,
  actor_email       TEXT NOT NULL,
  created_at_utc    TEXT NOT NULL,
  completed_at_utc  TEXT,
  UNIQUE (tenant_id, idempotency_key)
);

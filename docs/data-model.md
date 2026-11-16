# Data model

SQLite schema lives in `server/schema.sql` and is applied idempotently at every
startup, so there is no separate migration history to maintain for this scope.

## Entities

### tenants

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INTEGER PK | |
| `slug` | TEXT UNIQUE | `east`, `west`; also drives the serial prefix |
| `name` | TEXT | `East Training`, `West Training` |
| `timezone` | TEXT | IANA identifier, e.g. `Australia/Sydney` |

The time zone is a tenant attribute, not a constant: every date the console shows
or exports is derived from this column.

### admins

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INTEGER PK | |
| `tenant_id` | FK tenants | |
| `email` | TEXT UNIQUE | `alice@east.test`, `bob@west.test` |
| `name` | TEXT | |
| `token` | TEXT UNIQUE | Value of the `X-Actor-Token` header |

One admin per tenant. `token` is the whole authentication story, by design.

### courses / learners

Both are tenant-scoped and carry `UNIQUE (tenant_id, title)` /
`UNIQUE (tenant_id, email)`.

Both tenants own a course titled `Safety 101` and a learner named `Alex Lee`.
That duplication is intentional: a buggy implementation that filters by name or
title instead of by tenant will look correct on a single-tenant dataset and fail
immediately here.

`learners` has an index on `(tenant_id, name, id)` because the default learner
sort and the search both start with the name.

### enrollments

| Column | Type | Notes |
| --- | --- | --- |
| `status` | TEXT | `completed` \| `in_progress` (CHECK) |
| `completed_at` | TEXT | NULL unless completed |

`UNIQUE (course_id, learner_id)` — a learner is enrolled in a course once.
Eligibility for issuance is `status = 'completed'` **and** no active
certificate.

### certificates

| Column | Type | Notes |
| --- | --- | --- |
| `serial` | TEXT | `EAS-000123`, unique per tenant |
| `issued_at_utc` | TEXT | ISO-8601 UTC instant, the only stored time |
| `issued_local_date` | TEXT | `YYYY-MM-DD` in the tenant zone, materialised |
| `status` | TEXT | `ACTIVE` \| `REVOKED` |
| `revoked_at_utc` | TEXT | NULL unless revoked |
| `batch_id` | TEXT | Links back to `bulk_batches.id` |

Constraints:

```sql
UNIQUE (tenant_id, serial)

CREATE UNIQUE INDEX ux_certificates_active
  ON certificates (tenant_id, learner_id, course_id)
  WHERE status = 'ACTIVE';
```

The partial unique index is the load-bearing constraint of the whole product:

- it makes "at most one certificate per learner per course" a database fact
  rather than an application convention,
- it still allows a new certificate after a revocation,
- it is what makes concurrent bulk issue safe when two callers disagree about
  eligibility.

Indexes: `(tenant_id, issued_local_date, id)` for date sorting, export and
pagination; `(tenant_id, learner_id, id)` for per-learner lookups;
`(tenant_id, serial)` for serial search.

### audit_events

| Column | Type | Notes |
| --- | --- | --- |
| `action` | TEXT | `ISSUE` \| `REVOKE` (CHECK) |
| `actor_email` | TEXT | Who performed the operation |
| `batch_id` | TEXT | Set for bulk issuance |
| `created_at_utc` | TEXT | |

Write rules:

- An `ISSUE` event is inserted in the same transaction as its certificate.
- A `REVOKE` event is inserted only when the guarded
  `UPDATE ... WHERE status = 'ACTIVE'` reported exactly one changed row, so a
  repeated revocation cannot append a second event.

### bulk_batches

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | UUID, returned as `batchId` |
| `idempotency_key` | TEXT | Client-supplied |
| `request_hash` | TEXT | SHA-256 over course id + canonicalised body |
| `status` | TEXT | `IN_PROGRESS` \| `COMPLETED` \| `FAILED` |
| `result_json` | TEXT | Full response snapshot, replayed verbatim |
| `actor_email` | TEXT | |

`UNIQUE (tenant_id, idempotency_key)`. Keys are namespaced per tenant, so two
tenants may independently use the same key string without interfering.

## Lifecycle

```
enrollment(completed)
        |
        | bulk issue, no active certificate
        v
   certificate ACTIVE  --audit ISSUE-->  audit_events
        |
        | revoke (guarded update)
        v
   certificate REVOKED --audit REVOKE--> audit_events
        |
        | bulk issue again
        v
   new certificate ACTIVE (new serial)
```

## Why `issued_local_date` is stored

The CSV column, the list sort and the "tenant-local issue date" acceptance
check all need a calendar date in the tenant's zone. SQLite has no IANA time
zone database, so the alternative would be to load 100k rows and convert in the
application — which would defeat both the 60-second budget and index-backed
sorting.

Storing the derived date keeps the read path trivial. The cost is that changing
a tenant's time zone does not rewrite history, which is recorded as a known
limitation in `docs/decisions.md`.

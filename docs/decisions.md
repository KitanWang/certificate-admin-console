# Decision record

Short ADRs for choices that a reviewer would otherwise have to reverse-engineer.
Each entry states the context, the decision, and what it costs.

---

## D1 — Node + Express + SQLite instead of PostgreSQL

**Context.** The app must start with one command on a reviewer's machine, and
the storage may not be in-memory.

**Decision.** A single Node process serving both the API and the built client,
backed by a SQLite file in WAL mode.

**Consequences.**

- No Docker, no service to install, no credentials. `npm start` is genuinely the
  whole setup.
- WAL gives concurrent readers, which the export requirement depends on.
- Writes are serialised. Acceptable: bulk issue touches tens of rows, not
  thousands.
- Migration to PostgreSQL is a driver swap plus replacing the materialised date
  with `AT TIME ZONE`. Nothing in the routing or UI layer assumes SQLite.

---

## D2 — Synchronous driver, asynchronous export

**Context.** `better-sqlite3` blocks the event loop while a statement runs. A
naive `SELECT` over 100,000 rows into memory would make the list endpoint
unresponsive for the duration, which A6 explicitly tests.

**Decision.** Keep the synchronous driver for transactional clarity, and make
only the export path cooperative: iterate with a prepared statement, flush every
200 rows, and `await setImmediate` between chunks, respecting `drain`.

**Consequences.**

- Certificate and audit writes stay inside one plain function call, so they
  cannot interleave.
- The export is correct at the cost of one microtask per 200 rows; measured
  100,018 rows in ~600 ms with the list answering in 46 ms.
- A single export still occupies the process. Documented as a limitation; a
  multi-instance deployment would need sticky routing or an async job.

---

## D3 — Materialised local date (trade-off)

**Context.** The CSV column, the list sort and the DST scenario all need a
calendar date in the tenant's zone. SQLite has no IANA database, so an SQL
expression cannot account for daylight saving.

**Decision.** Compute `issued_local_date` once at write time using `Intl` with
the tenant's IANA zone, store it, and index it. Render the wall-clock string per
request from `issued_at_utc`.

**Consequences.**

- Sorting and export run on an indexed column; no per-row conversion at read
  time.
- Correct across the DST boundary: `2026-01-10T13:30:00Z` is `2026-01-11` in
  Sydney and `2026-01-10` in Perth.
- **Cost:** changing a tenant's time zone does not rewrite historical rows. A
  deployment that supports tenant time-zone changes would need a backfill job or
  a stored `zone_at_issue` column. Accepted for this scope.

---

## D4 — `404` for cross-tenant reads

**Context.** A `403` confirms that the resource exists and belongs to somebody
else. That is itself a leak.

**Decision.** Every lookup resolves within the actor's tenant scope. A miss and a
foreign row are indistinguishable: `404 {"error":"certificate_not_found"}`.

**Consequences.** Slightly worse operator ergonomics when debugging a mistaken
URL; correct information disclosure behaviour.

---

## D5 — Idempotency as a state machine with a stored snapshot

**Context.** The same key may arrive sequentially or concurrently, and every
caller must receive the outcome of the *same* logical operation.

**Decision.** A `bulk_batches` row is claimed with
`INSERT ... ON CONFLICT DO NOTHING` against `UNIQUE (tenant_id, key)`. The
winner executes and stores the serialised response in `result_json`; later
callers receive that exact string. A request hash over the resolved course id
and the canonicalised body detects key reuse with a different payload.

**Consequences.**

- Replay is byte-identical by construction, not by convention.
- `409` on hash mismatch without a second execution or an overwrite.
- Batch rows accumulate; a retention policy is required before production
  (listed in the README as a known defect).
- A crashed `IN_PROGRESS` batch blocks its key until manual intervention; there
  is no lease/expiry yet.

---

## D6 — One query builder for list and export

**Context.** "The CSV contains exactly the matching rows in the requested order"
is easy to satisfy once and easy to break later, because the list and the export
naturally grow separate filter code.

**Decision.** `server/lib/query.js` produces the `WHERE`, `ORDER BY`, count SQL
and row SQL for both endpoints. The export ignores pagination but shares the
order clause, including the mandatory `, c.id ASC` tiebreaker.

**Consequences.** The two paths cannot drift. Adding a sort key means editing
one map, and both endpoints gain it.

---

## D7 — React without a component library

**Context.** Visual polish is explicitly not scored; core behaviour is.

**Decision.** React 18 + Vite, one hand-written stylesheet, no component
library, no router, no state manager.

**Consequences.**

- ~50 kB gzipped bundle, no upgrade path to maintain.
- Loading, empty and error states are implemented explicitly per view rather
  than inherited from a library.
- Any future feature that needs tables with virtualisation or complex forms would
  justify a library; this scope does not.

---

## D8 — Partial unique index for live certificates

**Context.** Eligibility can be computed in application code, but two concurrent
requests can both decide a learner is eligible.

**Decision.**

```sql
CREATE UNIQUE INDEX ux_certificates_active
  ON certificates (tenant_id, learner_id, course_id)
  WHERE status = 'ACTIVE';
```

**Consequences.**

- "At most one certificate per learner per course" becomes a database fact, so
  the concurrent case in A2 is safe even if the application logic is wrong.
- A revocation frees the slot, which is what allows re-issue.
- A violation surfaces as `failed` with `issue_failed` in the per-learner
  outcome list rather than as a 500.

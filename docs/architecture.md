# Architecture and technology choices

This document records what was chosen, what was rejected, and why. It is meant
to be read before the code: every non-obvious structure in the repository exists
because of one of the constraints below.

## 1. Constraints that drive the design

| Constraint | Consequence |
| --- | --- |
| One command must install, initialise and start | No external services, no Docker, no second process |
| Storage must be a real database | SQLite is the lowest-friction option that satisfies this |
| Vue 3 or React | React 18, matching the bundler already needed for the API host |
| 100,000-row CSV export under 60 s, list must stay responsive | Streaming writer plus an event-loop yielding policy |
| Same idempotency key, concurrent callers | Unique constraint plus stored response snapshot |
| Tenant-local dates across a DST boundary | IANA time zone conversion, materialised local date |
| No login UI, no cloud, no notifications | Scope control: the token header is the whole auth story |

## 2. Runtime: Node.js + Express

**Chosen.** Node removes the language boundary between API and client, which
matters when the whole product must be built in one sitting: one `package.json`,
one dependency tree, one build step, one process to serve both the API and the
built client.

**Rejected — Go.** Better runtime characteristics and a stricter concurrency
model, but it doubles the toolchain (Go modules plus npm), and the UI is still
JavaScript. The scheduling benefit only pays off at a scale far beyond this
assessment.

**Rejected — Python/FastAPI.** Equally productive, but streaming a 100k CSV with
backpressure is less natural, and the frontend would still need Node tooling.
Two runtimes for one small product is unjustified.

Express 4 rather than Fastify: the request volume is trivial, and Express's
middleware ordering makes the routing constraints (export before `/:id`)
explicit and easy to audit.

## 3. Storage: SQLite with WAL

**Chosen.** SQLite satisfies "a real database" with zero operational surface: a
single file, no server, no port, no credentials. WAL mode is not optional here —
it lets a long streaming read run concurrently with other reads, which is
exactly what A6 demands.

Concurrency safety is delegated to the database rather than to application code:

- `UNIQUE (tenant_id, learner_id, course_id) WHERE status = 'ACTIVE'` is the
  hard guarantee behind "at most one certificate per learner".
- `UNIQUE (tenant_id, idempotency_key)` is the hard guarantee behind "one
  logical operation".
- Both survive a multi-process deployment, unlike an in-process lock.

**Rejected — in-memory store.** Explicitly disallowed, and would not survive the
idempotency and audit requirements.

**Rejected — PostgreSQL.** Genuinely better for this workload (real server-side
cursor streaming, `AT TIME ZONE`, concurrent writers), but it requires Docker or
a local install before the app can start. That breaks the one-command
requirement for a reviewer on a clean machine. The migration path is documented
in `docs/decisions.md`.

## 4. Driver: better-sqlite3, and its one real trap

`better-sqlite3` is synchronous. That is an advantage for correctness (a
transaction is a plain function call, so certificate and audit rows cannot drift
apart) and a hazard for latency (a long synchronous scan blocks every other
request in the process).

The export writer therefore:

1. iterates rows with a prepared statement iterator,
2. flushes every 200 rows,
3. awaits `setImmediate` between chunks to release the event loop,
4. respects `res.write()` backpressure by awaiting `drain`.

Without step 3 the list endpoint would be unresponsive for the duration of the
export, which is precisely what A6 checks. Measured result: list served in 46 ms
while a 100,018-row export was streaming.

`node:sqlite` was considered as a zero-dependency alternative, but it is still
flagged experimental on Node 22 and unavailable on Node 20, so it would shift
risk onto the reviewer's machine.

## 5. Time handling

Instants are stored once, as UTC (`issued_at_utc`). Two derived values exist:

- `issued_local_date` (`YYYY-MM-DD`) is materialised at write time and indexed.
- The wall-clock string (`YYYY-MM-DD HH:mm`) is rendered per request from the
  tenant's IANA zone.

Why materialise the date instead of computing it in SQL: SQLite ships no IANA
database, so a `CASE`/offset expression would be wrong across a DST boundary.
Computing the date in the application at write time is cheaper and keeps sorting
and export on a plain indexed column.

Why not compute the local date in application code at read time for sorting:
sorting 100k rows would then require an unindexed expression, and the sort key is
also the CSV column, so both paths must agree anyway. `docs/decisions.md`
records the trade-off this creates.

Verification: `2026-01-10T13:30:00Z` renders as `2026-01-11 00:30` for Sydney
(UTC+11 in January) and `2026-01-10 21:30` for Perth (UTC+8). A fixed +10 offset
would fail this by an hour.

## 6. Idempotency

Modelled as an explicit state machine rather than a cache:

```
(tenant, key) absent  --INSERT-->  IN_PROGRESS  --result stored-->  COMPLETED
                                      |
                                      +-- different request hash --> 409
```

- The claim is an `INSERT ... ON CONFLICT DO NOTHING`. `changes === 0` means
  somebody else owns the key.
- The request hash covers the resolved course id plus the canonicalised request
  body, so a different course *or* a different payload is a conflict.
- The winner stores the full response body in `result_json`. Every later caller
  receives that exact string, so "all callers receive the outcome of the same
  logical operation" is a property of the storage, not of the handler.
- A loser that finds `IN_PROGRESS` polls every 25 ms for up to 10 s.
- Certificates and their `ISSUE` audit event are written in the same
  transaction, so "exactly one audit event per actual issuance" holds even under
  partial failure.

## 7. Tenant isolation

`actorMiddleware` resolves the token to an admin **and** its tenant, and attaches
`req.actor.tenantId`. Every statement filters on it; there is no code path that
accepts a tenant id from the client.

Cross-tenant reads return `404`, not `403`, so the response does not confirm that
the resource exists in another tenant. Cross-tenant bulk issue is rejected by
resolving the course inside the tenant scope *before* the idempotency claim, so a
rejected request writes no batch row, no certificate and no audit event.

## 8. Export design

- Filter and sort SQL is built by one shared module (`server/lib/query.js`) for
  both the list and the export. Duplicating that logic is the classic way to end
  up with an export whose order drifts from the list.
- A unique tiebreaker (`c.id ASC`) is always appended. Without it, SQLite may
  return equal sort keys in a different physical order between executions, which
  breaks both "stable across repeated exports" and "matches the list".
- `X-Total-Rows` is emitted before streaming so a client can check completeness
  without parsing the body.
- On a mid-stream failure the response is destroyed rather than finished, so a
  truncated file is never presented as a success.

## 9. Frontend

React 18 with Vite, no UI framework, no state library, no router.

- The screen is one page; a router would add nothing.
- One hand-written stylesheet keeps the bundle at ~50 kB gzipped and avoids a
  component-library upgrade path in a throw-away deliverable.
- The build output is served by Express, so the reviewer opens one URL and there
  is no dev-server/proxy to misconfigure.
- Duplicate submission is prevented three ways: the button is disabled while in
  flight, a `useRef` guard rejects re-entry, and the idempotency key is held in
  a ref so a retry after a transport error replays instead of re-issuing.

## 10. Startup sequence

`npm start` → `scripts/start.js`:

1. resolve `express`, `better-sqlite3` and `vite`; run `npm install` if any are
   missing,
2. open the database and apply the idempotent schema,
3. seed demo data only when `tenants` is empty,
4. close the handle, build the client if `web/dist` is absent,
5. `require('../server/index')`, which reopens the database and listens.

Step 4 closing the handle matters: the database module caches a single
connection, so the server must build its own after the seeding connection is
closed, otherwise it inherits a closed handle.

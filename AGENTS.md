# AGENTS.md

Instructions for any AI assistant working in this repository. These are the
rules that keep the acceptance behaviour intact; breaking one of them is a
regression even if the code still runs.

## Ground rules

- All code, comments, documentation, commit messages and UI copy are in English.
- Do not add a dependency without stating what it replaces. The runtime is
  Node + Express + better-sqlite3; the build is Vite.
- Do not introduce authentication, cloud deployment, notifications or any
  feature outside the assessment scope.
- Every change to behaviour must keep `npm run verify` green, and
  `npm run verify:export` green when touching the query, sort or export path.

## Invariants

1. **Tenant scope is never client-supplied.** Every SQL statement filters on
   `req.actor.tenantId`. There is no endpoint parameter that names a tenant.
2. **Cross-tenant access is `404`.** Never `403`, never a partial payload, never
   a hint that the row exists elsewhere.
3. **A rejected cross-tenant bulk issue writes nothing.** Resolve the course
   inside the tenant scope *before* claiming the idempotency key.
4. **Time zones come from the IANA database.** `Intl` with the tenant's
   `timezone` column. Never a fixed UTC offset, never `+10`/`+11` arithmetic.
5. **`issued_local_date` is materialised at write time** via
   `server/time.js`. Do not recompute it in SQL and do not sort on
   `issued_at_utc` for the `issued_date` sort key.
6. **Sorting always ends with `, c.id ASC`.** Equal sort keys must keep a stable
   relative order across repeated queries.
7. **List and export share `server/lib/query.js`.** Never write a second filter
   or sort builder; the two paths must not be able to diverge.
8. **The export yields to the event loop every 200 rows.** better-sqlite3 is
   synchronous; removing the `setImmediate` makes the list endpoint block for
   the whole export.
9. **A certificate and its `ISSUE` audit event are written in one transaction.**
   Same for the guarded revoke update and its `REVOKE` event.
10. **The idempotency response is stored, not recomputed.** `result_json` is the
    body returned to every caller; do not rebuild it per request.

## Where things live

| Concern | File |
| --- | --- |
| Schema and constraints | `server/schema.sql` |
| Time zone conversion | `server/time.js` |
| Actor resolution | `server/scope.js` |
| Shared filter/sort SQL | `server/lib/query.js` |
| Certificate and audit writes | `server/lib/certificates.js` |
| Bulk issue and idempotency | `server/routes/bulkIssue.js` |
| Streaming CSV | `server/routes/export.js` |
| Demo dataset | `server/seed.js` |
| Acceptance checks | `scripts/verify.js` |

## Working style

- Prefer a small, explicit transaction over implicit multi-statement writes.
- A test that passes on the small dataset and fails on the 100k dataset is a
  real failure. Run `npm run verify:export` for anything touching queries.
- When a fix depends on a judgement call, record it in `docs/decisions.md`
  rather than leaving it implicit in code.
- Keep the README's "Known defects" section honest. If a change removes a
  limitation, delete the entry; if it adds one, add it.

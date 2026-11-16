'use strict';

/**
 * Shared list/export query construction.
 *
 * The CSV export must return exactly the rows the list shows, in exactly the
 * same order. Both paths therefore build their SQL here instead of duplicating
 * filter and sort logic, which is what keeps the two in sync.
 */

const SORTS = {
  learner: { column: 'l.name', defaultDir: 'asc' },
  course: { column: 'co.title', defaultDir: 'asc' },
  serial: { column: 'c.serial', defaultDir: 'asc' },
  issued_date: { column: 'c.issued_local_date', defaultDir: 'desc' },
};

const SORT_ALIASES = {
  issued: 'issued_date',
  date: 'issued_date',
  name: 'learner',
  title: 'course',
};

const BASE_FROM = `
  FROM certificates c
  JOIN learners l ON l.id = c.learner_id
  JOIN courses co ON co.id = c.course_id
`;

function normalizeSort(value) {
  if (!value) return 'issued_date';
  const key = SORT_ALIASES[value] || value;
  return SORTS[key] ? key : 'issued_date';
}

function normalizeDir(sortKey, value) {
  if (value === 'asc') return 'ASC';
  if (value === 'desc') return 'DESC';
  return SORTS[sortKey].defaultDir.toUpperCase();
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * c.id is always appended as the final sort term. Without a unique tiebreaker
 * SQLite may return equal sort keys in a different physical order between two
 * executions, which would break both the "repeated export is stable" and the
 * "export matches the list" requirements.
 */
function orderByClause(sortKey, dir) {
  return `${SORTS[sortKey].column} ${dir}, c.id ASC`;
}

function whereClause(tenantId, search) {
  const clauses = ['c.tenant_id = ?'];
  const params = [tenantId];

  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    clauses.push(`(l.name LIKE ? ESCAPE '\\' OR c.serial LIKE ? ESCAPE '\\')`);
    params.push(pattern, pattern);
  }

  return { sql: `WHERE ${clauses.join(' AND ')}`, params };
}

function buildListQuery({ tenantId, search, sort, dir }) {
  const sortKey = normalizeSort(sort);
  const direction = normalizeDir(sortKey, dir);
  const where = whereClause(tenantId, search);

  return {
    sortKey,
    direction,
    from: BASE_FROM,
    where,
    orderBy: orderByClause(sortKey, direction),
    countSql: `SELECT COUNT(*) AS total ${BASE_FROM} ${where.sql}`,
    rowsSql: `SELECT c.id, c.serial, c.status, c.issued_at_utc, c.issued_local_date,
                     c.revoked_at_utc, c.course_id, c.learner_id,
                     l.name AS learner_name, co.title AS course_title
              ${BASE_FROM} ${where.sql}
              ORDER BY ${orderByClause(sortKey, direction)}
              LIMIT ? OFFSET ?`,
    allRowsSql: `SELECT c.id, c.serial, c.status, c.issued_at_utc, c.issued_local_date,
                        l.name AS learner_name, co.title AS course_title
                 ${BASE_FROM} ${where.sql}
                 ORDER BY ${orderByClause(sortKey, direction)}`,
  };
}

module.exports = { buildListQuery, normalizeSort, normalizeDir, SORTS };

'use strict';

const express = require('express');

function createActorsRoutes(db) {
  const router = express.Router();

  // No login UI is in scope. This endpoint exists so the console can render an
  // actor switcher; the token is what the browser then sends on every request.
  router.get('/', (req, res) => {
    const rows = db
      .prepare(
        `SELECT a.email, a.name, a.token, t.slug, t.name AS tenant_name, t.timezone
         FROM admins a
         JOIN tenants t ON t.id = a.tenant_id
         ORDER BY t.id ASC, a.id ASC`,
      )
      .all();

    res.json(
      rows.map((row) => ({
        email: row.email,
        name: row.name,
        token: row.token,
        tenantSlug: row.slug,
        tenantName: row.tenant_name,
        timezone: row.timezone,
      })),
    );
  });

  return router;
}

function createCoursesRoutes(db) {
  const router = express.Router();

  const statement = db.prepare(
    `SELECT co.id, co.title,
            (SELECT COUNT(*) FROM enrollments e
              WHERE e.tenant_id = co.tenant_id AND e.course_id = co.id) AS enrolments,
            (SELECT COUNT(*) FROM enrollments e
              WHERE e.tenant_id = co.tenant_id AND e.course_id = co.id
                AND e.status = 'completed') AS completed,
            (SELECT COUNT(*) FROM enrollments e
              WHERE e.tenant_id = co.tenant_id AND e.course_id = co.id
                AND e.status = 'completed'
                AND NOT EXISTS (
                  SELECT 1 FROM certificates c
                  WHERE c.tenant_id = e.tenant_id
                    AND c.learner_id = e.learner_id
                    AND c.course_id = e.course_id
                    AND c.status = 'ACTIVE'
                )) AS eligible
     FROM courses co
     WHERE co.tenant_id = ?
     ORDER BY co.title ASC`,
  );

  router.get('/', (req, res) => {
    const rows = statement.all(req.actor.tenantId);
    res.json(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        enrolments: row.enrolments,
        completed: row.completed,
        eligible: row.eligible,
      })),
    );
  });

  return router;
}

module.exports = { createActorsRoutes, createCoursesRoutes };

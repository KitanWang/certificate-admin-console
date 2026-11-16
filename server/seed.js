'use strict';

const { insertCertificate, insertAudit, serialPrefixFor } = require('./lib/certificates');

/**
 * Demo dataset.
 *
 * Two tenants deliberately share a course title ("Safety 101") and a learner
 * name ("Alex Lee") so that tenant isolation cannot be faked by filtering on
 * names. Each tenant also contains completed, in-progress and already
 * certified enrolments so the bulk issue outcomes are reproducible.
 *
 * The two certificates dated 2026-01-10T13:30:00Z are the fixed samples for
 * the DST check: Sydney is UTC+11 in January, Perth is UTC+8.
 */
const TENANTS = [
  {
    slug: 'east',
    name: 'East Training',
    timezone: 'Australia/Sydney',
    admin: { email: 'alice@east.test', name: 'Alice Nguyen', token: 'tok_east_alice' },
    courses: ['Safety 101', 'Manual Handling', 'Fire Safety'],
    enrolments: [
      ['Alex Lee', 'alex.lee', 'Safety 101', 'completed', '2026-01-10T13:30:00Z'],
      ['Priya Nair', 'priya.nair', 'Safety 101', 'completed', null],
      ['Mei Chen', 'mei.chen', 'Safety 101', 'completed', null],
      ['Sam Okafor', 'sam.okafor', 'Safety 101', 'completed', null],
      ['Tom Becker', 'tom.becker', 'Safety 101', 'in_progress', null],
      ['Hana Ito', 'hana.ito', 'Manual Handling', 'completed', '2026-02-02T04:15:00Z'],
      ['Omar Haddad', 'omar.haddad', 'Manual Handling', 'completed', '2026-02-02T04:15:00Z'],
      ['Lena Fischer', 'lena.fischer', 'Manual Handling', 'completed', null],
      ['Ravi Menon', 'ravi.menon', 'Manual Handling', 'completed', null],
      ['Ines Moreau', 'ines.moreau', 'Manual Handling', 'in_progress', null],
      ['Kenji Sato', 'kenji.sato', 'Fire Safety', 'completed', '2026-03-05T22:00:00Z'],
      ['Nina Roy', 'nina.roy', 'Fire Safety', 'completed', '2026-03-05T22:00:00Z'],
      ['Pavel Novak', 'pavel.novak', 'Fire Safety', 'completed', '2026-03-06T01:20:00Z'],
      ['Zara Khan', 'zara.khan', 'Fire Safety', 'completed', '2026-03-06T01:20:00Z'],
      ['Diego Alvarez', 'diego.alvarez', 'Fire Safety', 'completed', '2026-03-07T09:00:00Z'],
      ['Mia Novak', 'mia.novak', 'Fire Safety', 'completed', '2026-03-07T09:00:00Z'],
      ['Lily Chen', 'lily.chen', 'Fire Safety', 'completed', '2026-03-08T12:45:00Z'],
      ['Noah Berg', 'noah.berg', 'Fire Safety', 'completed', '2026-03-08T12:45:00Z'],
      ['Yara Haddad', 'yara.haddad', 'Fire Safety', 'completed', '2026-03-09T23:10:00Z'],
      ['Amara Diallo', 'amara.diallo', 'Fire Safety', 'completed', null],
      ['Theo Brandt', 'theo.brandt', 'Fire Safety', 'completed', null],
      ['Sofia Rossi', 'sofia.rossi', 'Fire Safety', 'completed', null],
    ],
  },
  {
    slug: 'west',
    name: 'West Training',
    timezone: 'Australia/Perth',
    admin: { email: 'bob@west.test', name: 'Bob Carter', token: 'tok_west_bob' },
    courses: ['Safety 101', 'Food Hygiene', 'Fire Safety'],
    enrolments: [
      ['Alex Lee', 'alex.lee', 'Safety 101', 'completed', '2026-01-10T13:30:00Z'],
      ['Dana White', 'dana.white', 'Safety 101', 'completed', null],
      ['Luis Ortega', 'luis.ortega', 'Safety 101', 'in_progress', null],
      ['Grace Park', 'grace.park', 'Food Hygiene', 'completed', '2026-01-12T02:00:00Z'],
      ['Marcus Reed', 'marcus.reed', 'Food Hygiene', 'completed', null],
      ['Ivy Chen', 'ivy.chen', 'Food Hygiene', 'completed', null],
      ['Noah Field', 'noah.field', 'Fire Safety', 'completed', '2026-01-15T05:30:00Z'],
      ['Rita Osei', 'rita.osei', 'Fire Safety', 'completed', null],
      ['Hugo Lind', 'hugo.lind', 'Fire Safety', 'completed', null],
    ],
  },
];

function seedDatabase(db) {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM tenants').get().n;
  if (existing > 0) {
    return { seeded: false, tenants: existing };
  }

  const run = db.transaction(() => {
    for (const tenant of TENANTS) {
      const tenantId = db
        .prepare('INSERT INTO tenants (slug, name, timezone) VALUES (?, ?, ?)')
        .run(tenant.slug, tenant.name, tenant.timezone).lastInsertRowid;

      db.prepare('INSERT INTO admins (tenant_id, email, name, token) VALUES (?, ?, ?, ?)').run(
        tenantId,
        tenant.admin.email,
        tenant.admin.name,
        tenant.admin.token,
      );

      const courseIds = new Map();
      for (const title of tenant.courses) {
        const id = db
          .prepare('INSERT INTO courses (tenant_id, title) VALUES (?, ?)')
          .run(tenantId, title).lastInsertRowid;
        courseIds.set(title, id);
      }

      const prefix = serialPrefixFor(tenant.slug);

      for (const [name, local, courseTitle, status, certIssuedAt] of tenant.enrolments) {
        let learnerId = db
          .prepare('SELECT id FROM learners WHERE tenant_id = ? AND email = ?')
          .get(tenantId, `${local}@${tenant.slug}.test`)?.id;

        if (!learnerId) {
          learnerId = db
            .prepare('INSERT INTO learners (tenant_id, name, email) VALUES (?, ?, ?)')
            .run(tenantId, name, `${local}@${tenant.slug}.test`).lastInsertRowid;
        }

        db.prepare(
          `INSERT INTO enrollments (tenant_id, course_id, learner_id, status, completed_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(
          tenantId,
          courseIds.get(courseTitle),
          learnerId,
          status,
          status === 'completed' ? certIssuedAt || '2026-01-05T00:00:00Z' : null,
        );

        if (!certIssuedAt) continue;

        const cert = insertCertificate(db, {
          tenantId,
          courseId: courseIds.get(courseTitle),
          learnerId,
          issuedAtUtc: certIssuedAt,
          timezone: tenant.timezone,
          serialPrefix: prefix,
        });

        insertAudit(db, {
          tenantId,
          certificateId: cert.id,
          action: 'ISSUE',
          actorEmail: tenant.admin.email,
          createdAtUtc: certIssuedAt,
          detail: 'Seeded demo certificate',
        });
      }
    }
  });

  run();

  const tenants = db.prepare('SELECT COUNT(*) AS n FROM tenants').get().n;
  return { seeded: true, tenants };
}

module.exports = { seedDatabase, TENANTS };

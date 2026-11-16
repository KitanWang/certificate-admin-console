'use strict';

const { serialPrefixFor } = require('./lib/certificates');

/**
 * Actor resolution. There is no login UI by design: the console identifies the
 * acting admin from a token header and derives the tenant scope from that
 * record. Every downstream query must filter on req.actor.tenantId.
 */
function actorMiddleware(db) {
  const lookup = db.prepare(`
    SELECT a.email, a.name, t.id AS tenant_id, t.slug, t.name AS tenant_name, t.timezone
    FROM admins a
    JOIN tenants t ON t.id = a.tenant_id
    WHERE a.token = ?
  `);

  return function resolveActor(req, res, next) {
    const token = req.get('x-actor-token');
    if (!token) {
      return res.status(401).json({
        error: 'missing_actor_token',
        message: 'Send the X-Actor-Token header to identify the acting admin.',
      });
    }

    const row = lookup.get(token);
    if (!row) {
      return res.status(401).json({
        error: 'unknown_actor',
        message: 'The supplied actor token does not belong to any admin.',
      });
    }

    req.actor = {
      email: row.email,
      name: row.name,
      tenantId: row.tenant_id,
      tenantSlug: row.slug,
      tenantName: row.tenant_name,
      timezone: row.timezone,
      serialPrefix: serialPrefixFor(row.slug),
    };

    return next();
  };
}

module.exports = { actorMiddleware };

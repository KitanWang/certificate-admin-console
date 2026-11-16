'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const { getDb, applySchema } = require('./db');
const { actorMiddleware } = require('./scope');
const { createCertificateRoutes } = require('./routes/certificates');
const { createExportRoutes } = require('./routes/export');
const { createBulkIssueRoutes } = require('./routes/bulkIssue');
const { createActorsRoutes, createCoursesRoutes } = require('./routes/catalog');

function createApp() {
  const db = getDb();
  applySchema(db);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  const requireActor = actorMiddleware(db);

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  // The actor list is intentionally unauthenticated: there is no login UI and
  // the switcher needs to know which identities exist.
  app.use('/api/actors', createActorsRoutes(db));

  // The export path must be mounted before the certificate router so that
  // "/api/certificates/export" is not captured by "/api/certificates/:id".
  app.use('/api/certificates/export', requireActor, createExportRoutes(db));
  app.use('/api/certificates', requireActor, createCertificateRoutes(db));
  app.use('/api/bulk-issue', requireActor, createBulkIssueRoutes(db));
  app.use('/api/courses', requireActor, createCoursesRoutes(db));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  const dist = path.join(__dirname, '..', 'web', 'dist');
  const indexHtml = path.join(dist, 'index.html');

  if (fs.existsSync(indexHtml)) {
    app.use(express.static(dist, { index: false }));
    app.get('*', (req, res) => res.sendFile(indexHtml));
  } else {
    app.get('*', (req, res) =>
      res
        .status(503)
        .type('text/plain')
        .send('Web client has not been built yet. Run: npm run build:web'),
    );
  }

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    console.error('[api] unhandled error:', error);
    if (res.headersSent) return res.destroy();
    return res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

module.exports = { createApp };

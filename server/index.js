'use strict';

const { createApp } = require('./app');

const port = Number(process.env.PORT || 4000);
const app = createApp();

const server = app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
});

module.exports = server;

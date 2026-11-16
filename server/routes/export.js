'use strict';

const express = require('express');
const { once } = require('events');
const { buildListQuery } = require('../lib/query');

const CSV_HEADER = 'learner_name,course_title,serial_number,issue_date';
const CHUNK_ROWS = 200;

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsvLine(row) {
  return [
    csvCell(row.learner_name),
    csvCell(row.course_title),
    csvCell(row.serial),
    csvCell(row.issued_local_date),
  ].join(',');
}

function createExportRoutes(db) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const actor = req.actor;
    const search = (req.query.q || '').trim();
    const query = buildListQuery({
      tenantId: actor.tenantId,
      search,
      sort: req.query.sort,
      dir: req.query.dir,
    });

    const total = db.prepare(query.countSql).get(...query.where.params).total;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="certificates-${actor.tenantSlug}.csv"`,
    );
    res.setHeader('X-Total-Rows', String(total));
    res.setHeader('Cache-Control', 'no-store');
    res.flushHeaders();

    let closed = false;
    res.on('close', () => {
      closed = true;
    });

    const writeChunk = async (chunk) => {
      if (res.writableEnded || res.destroyed) throw new Error('client_disconnected');
      if (!res.write(chunk)) await once(res, 'drain');
    };

    let buffer = `${CSV_HEADER}\n`;
    let rowsInBuffer = 0;

    try {
      const iterator = db.prepare(query.allRowsSql).iterate(...query.where.params);

      for (const row of iterator) {
        buffer += `${toCsvLine(row)}\n`;
        rowsInBuffer += 1;

        if (rowsInBuffer >= CHUNK_ROWS) {
          await writeChunk(buffer);
          buffer = '';
          rowsInBuffer = 0;

          // better-sqlite3 is synchronous. Yielding to the event loop between
          // chunks is what keeps list and detail requests responsive while a
          // 100k row export is streaming.
          await new Promise((resolve) => setImmediate(resolve));
        }

        if (closed) {
          iterator.return();
          return;
        }
      }

      if (buffer) await writeChunk(buffer);
      res.end();
    } catch (error) {
      if (closed || res.destroyed) return;
      // Headers are already on the wire, so the only honest signal left is to
      // terminate the response rather than emit a truncated file as success.
      console.error('[export] aborted:', error.message);
      res.destroy(error);
    }
  });

  return router;
}

module.exports = { createExportRoutes };

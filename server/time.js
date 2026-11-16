'use strict';

/**
 * Tenant-local time helpers.
 *
 * All instants are stored in UTC. Conversion always goes through the IANA
 * time zone database via Intl, never through a fixed UTC offset, because the
 * tenants span a DST boundary (Australia/Sydney is UTC+11 in January, UTC+10
 * in July). Hard-coding an offset produces wrong dates twice a year.
 */

const formatterCache = new Map();

function formatterFor(timeZone) {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

function partsOf(utcIso, timeZone) {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcIso));
  const out = {};
  for (const part of parts) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  // Some ICU builds emit 24 for midnight even with hourCycle h23.
  if (out.hour === '24') out.hour = '00';
  return out;
}

/** Calendar date in the tenant time zone, formatted as YYYY-MM-DD. */
function localDate(utcIso, timeZone) {
  const p = partsOf(utcIso, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Local wall-clock time in the tenant time zone, formatted as YYYY-MM-DD HH:mm. */
function localDateTime(utcIso, timeZone) {
  const p = partsOf(utcIso, timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function nowUtcIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

module.exports = { localDate, localDateTime, nowUtcIso };

/**
 * Times in the reader's own time zone (ui-pudl#252, clientjs#7). The front ends' servers say times
 * in the zone named by the `bcn-tz` cookie, and in UTC without one. This puts the browser's zone in
 * the cookie, so the next page is said in it, and says again in it each time drawn in another zone,
 * so even a first visit reads local. It is the part ui-pudl's bcn-time.js and ui-primate's
 * client/zone.ts had twice.
 *
 * Each site keeps its wording: how a time reads ([localize]'s `said` and `tooltip`), to match how
 * its server writes it; and when to localize (a page shown, a window opened).
 *
 * The markup:
 *
 * - `<time datetime="…" data-local="<form>">`: its text is `said(date, form, zone)`;
 * - `<time datetime="…" data-local-title>`: its title is `tooltip(date, zone)`;
 * - a date field shown in another zone: `<input type="datetime-local" data-zone-field="<name>"
 *   data-instant="<the instant, in UTC>">`, where `<name>` names the form's hidden input that
 *   carries the zone the field is read in; and `[data-zone-label="<the field's id>"]`, which says
 *   that zone. The field is moved to this zone's clock (unless the reader has typed in it: its value
 *   no longer equals its `data-shown`), and the hidden input says this zone, so what's saved is
 *   what the reader saw.
 *
 * Each element done is marked `data-local-zone` with the zone, and skipped after.
 *
 * @module
 */

/** The cookie the servers read the reader's zone from. */
export const COOKIE = 'bcn-tz';

const YEAR = 365 * 24 * 60 * 60;
/* A zone's name as a cookie value, as it is: letters, digits, '/', '_', '+' and '-'. */
const SAFE = /^[A-Za-z0-9/_+-]+$/;

/**
 * The browser's time zone, such as "America/New_York", or null if it won't say.
 *
 * @returns {string | null}
 */
export function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Puts [zone] in the `bcn-tz` cookie for a year, unless it's there already. The value is the
 * zone's name as it is, not encoded, which both servers read; a name with anything else in it is
 * left out.
 *
 * @param {string | null} zone the zone, from [browserZone].
 * @param {Document} [doc] the document whose cookie to set.
 * @returns {boolean} true when the cookie says [zone] now.
 */
export function rememberZone(zone, doc = globalThis.document) {
  if (!zone || !SAFE.test(zone)) return false;
  const now = doc.cookie.match(/(?:^|;\s*)bcn-tz=([^;]*)/);
  if (!now || now[1] !== zone) doc.cookie = `${COOKIE}=${zone}; path=/; max-age=${YEAR}; SameSite=Lax`;
  return true;
}

/**
 * [date]'s parts in [zone], as `Intl.DateTimeFormat`'s `formatToParts` gives them, by type:
 * `{ year, month, day, hour, minute, second, dayPeriod, timeZoneName, … }`.
 *
 * @param {Date} date the instant.
 * @param {Intl.DateTimeFormatOptions} options which parts, and how (en-US names).
 * @param {string} zone the zone to read it in.
 * @returns {Record<string, string>}
 */
export function parts(date, options, zone) {
  const out = {};
  for (const p of new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone }).formatToParts(date)) out[p.type] = p.value;
  return out;
}

/**
 * [date] on [zone]'s wall clock, as a datetime-local field's value: "2026-10-20T10:30".
 *
 * @param {Date} date
 * @param {string} zone
 * @returns {string}
 */
export function wallClock(date, zone) {
  const p = parts(date, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, zone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * [zone]'s short name at [date], such as "EDT" or "GMT+3".
 *
 * @param {Date} date
 * @param {string} zone
 * @returns {string}
 */
export function zoneName(date, zone) {
  return parts(date, { timeZoneName: 'short' }, zone).timeZoneName || zone;
}

function instant(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/**
 * Says again in [options.zone] each time under [root] drawn in another zone, and moves each date
 * field shown in another zone to it. Safe to call as often as content arrives.
 *
 * @param {ParentNode} root where to look: a document, a window, a fragment just drawn.
 * @param {object} options
 * @param {string} options.zone the reader's zone, from [browserZone].
 * @param {(date: Date, form: string, zone: string) => string} options.said how a `time[data-local]`
 *   reads; `form` is its `data-local` value.
 * @param {(date: Date, zone: string) => string} [options.tooltip] how a `time[data-local-title]`'s
 *   title reads; such times are left alone without it.
 */
export function localize(root, options) {
  const { zone, said, tooltip } = options;
  for (const time of root.querySelectorAll('time[data-local]')) {
    if (time.getAttribute('data-local-zone') === zone) continue;
    const date = instant(time.getAttribute('datetime'));
    time.setAttribute('data-local-zone', zone);
    if (date) time.textContent = said(date, time.getAttribute('data-local') || '', zone);
  }
  if (tooltip) {
    for (const time of root.querySelectorAll('time[data-local-title]')) {
      if (time.getAttribute('data-local-zone') === zone) continue;
      const date = instant(time.getAttribute('datetime'));
      time.setAttribute('data-local-zone', zone);
      if (date) time.title = tooltip(date, zone);
    }
  }
  for (const field of root.querySelectorAll('input[data-zone-field]')) {
    const form = field.form || field.closest('form');
    const sent = form && form.querySelector(`input[name="${field.getAttribute('data-zone-field')}"]`);
    if (!sent || sent.value === zone) continue;
    const date = instant(field.getAttribute('data-instant'));
    const shown = field.getAttribute('data-shown');
    if (date && (shown === null || field.value === shown)) field.value = wallClock(date, zone);
    field.setAttribute('data-shown', field.value);
    field.setAttribute('data-local-zone', zone);
    sent.value = zone;
    const doc = field.ownerDocument;
    const label = field.id ? doc.querySelector(`[data-zone-label="${field.id}"]`) : null;
    if (label) label.textContent = zone;
  }
}

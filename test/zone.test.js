import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { COOKIE, browserZone, localize, parts, rememberZone, wallClock, zoneName } from '../src/zone.js';

const AT = new Date('2026-10-20T14:30:05Z');
const NY = 'America/New_York';

function page(html = '') {
  return new JSDOM(`<!doctype html><body>${html}</body>`, { url: 'https://example.com/' }).window.document;
}

const said = (date, form, zone) => `${form}: ${wallClock(date, zone)} ${zoneName(date, zone)}`;
const tooltip = (date, zone) => `Your time: ${wallClock(date, zone)}`;

describe('the zone', () => {
  it('is the browser\'s', () => {
    assert.equal(browserZone(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('is said on its own clock, with its short name', () => {
    assert.equal(wallClock(AT, NY), '2026-10-20T10:30');
    assert.equal(wallClock(AT, 'UTC'), '2026-10-20T14:30');
    assert.equal(wallClock(AT, 'Asia/Kolkata'), '2026-10-20T20:00');
    assert.equal(zoneName(AT, NY), 'EDT');
    assert.equal(zoneName(new Date('2026-01-20T14:30:00Z'), NY), 'EST');
    assert.equal(zoneName(AT, 'Europe/Istanbul'), 'GMT+3');
  });

  it('gives the parts a site words its times with', () => {
    const p = parts(AT, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }, NY);
    assert.deepEqual([p.month, p.day, p.year, p.hour, p.minute, p.dayPeriod], ['October', '20', '2026', '10', '30', 'AM']);
  });

  it('reads midnight as 00, not 24', () => {
    assert.equal(wallClock(new Date('2026-10-20T04:00:00Z'), NY), '2026-10-20T00:00');
  });
});

describe('the cookie', () => {
  it('names the zone as it is, for a year', () => {
    const doc = page();
    assert.equal(rememberZone(NY, doc), true);
    assert.equal(doc.cookie, `${COOKIE}=America/New_York`);
  });

  it('isn\'t written again when it already says the zone, and is when it says another', () => {
    const doc = page();
    let writes = 0;
    const real = Object.getOwnPropertyDescriptor(doc.defaultView.Document.prototype, 'cookie');
    Object.defineProperty(doc, 'cookie', { get: () => real.get.call(doc), set: (v) => { writes++; real.set.call(doc, v); } });
    rememberZone(NY, doc);
    rememberZone(NY, doc);
    assert.equal(writes, 1);
    rememberZone('Europe/Istanbul', doc);
    assert.equal(writes, 2);
    assert.equal(doc.cookie, `${COOKIE}=Europe/Istanbul`);
  });

  it('is left alone for a name with anything else in it, or none', () => {
    const doc = page();
    assert.equal(rememberZone('Bad; zone=x', doc), false);
    assert.equal(rememberZone(null, doc), false);
    assert.equal(doc.cookie, '');
  });
});

describe('localize', () => {
  it('says each time again in the zone, in the site\'s words, once', () => {
    const doc = page('<time datetime="2026-10-20T14:30:05Z" data-local="short">20 Oct 2026, 14:30 UTC</time>');
    let calls = 0;
    const counted = (...a) => { calls++; return said(...a); };
    localize(doc, { zone: NY, said: counted });
    const time = doc.querySelector('time');
    assert.equal(time.textContent, 'short: 2026-10-20T10:30 EDT');
    assert.equal(time.getAttribute('data-local-zone'), NY);
    localize(doc, { zone: NY, said: counted });
    assert.equal(calls, 1);
  });

  it('gives a log line its tooltip in the zone, and leaves it without a tooltip function', () => {
    const doc = page('<time datetime="2026-10-20T14:30:05Z" data-local-title title="14:30:05 UTC">14:30</time>');
    localize(doc, { zone: NY, said });
    assert.equal(doc.querySelector('time').title, '14:30:05 UTC');
    localize(doc, { zone: NY, said, tooltip });
    assert.equal(doc.querySelector('time').title, 'Your time: 2026-10-20T10:30');
    assert.equal(doc.querySelector('time').textContent, '14:30');
  });

  it('marks a time it can\'t read, and leaves its text', () => {
    const doc = page('<time datetime="not a date" data-local>as drawn</time>');
    localize(doc, { zone: NY, said });
    assert.equal(doc.querySelector('time').textContent, 'as drawn');
    assert.equal(doc.querySelector('time').getAttribute('data-local-zone'), NY);
  });

  const FIELD = `<form><input type="hidden" name="zone" value="UTC">
    <input type="datetime-local" id="when" name="publishAt" value="2026-10-20T14:30" data-zone-field="zone" data-instant="2026-10-20T14:30:00Z">
    <span data-zone-label="when">UTC</span></form>`;

  it('moves a date field to the zone, with the zone it\'s read in, so what\'s saved is what was seen', () => {
    const doc = page(FIELD);
    localize(doc, { zone: NY, said });
    assert.equal(doc.getElementById('when').value, '2026-10-20T10:30');
    assert.equal(doc.querySelector('input[name=zone]').value, NY);
    assert.equal(doc.querySelector('[data-zone-label]').textContent, NY);
  });

  it('keeps what the reader typed in a field, and does a field once', () => {
    const doc = page(FIELD.replace('data-zone-field', 'data-shown="2026-10-20T14:30" data-zone-field'));
    const field = doc.getElementById('when');
    field.value = '2026-12-01T09:00';
    localize(doc, { zone: NY, said });
    assert.equal(field.value, '2026-12-01T09:00');
    assert.equal(doc.querySelector('input[name=zone]').value, NY);
    field.value = '2026-12-02T09:00';
    localize(doc, { zone: NY, said });
    assert.equal(field.value, '2026-12-02T09:00');
  });

  it('leaves a field alone when its zone is already the reader\'s, or it has no zone input', () => {
    const doc = page(FIELD.replace('value="UTC"', `value="${NY}"`) + '<input type="datetime-local" id="lone" value="2026-01-01T00:00" data-zone-field="none" data-instant="2026-10-20T14:30:00Z">');
    localize(doc, { zone: NY, said });
    assert.equal(doc.getElementById('when').value, '2026-10-20T14:30');
    assert.equal(doc.getElementById('lone').value, '2026-01-01T00:00');
  });

  it('works on part of the page: a window or a fragment just drawn', () => {
    const doc = page('<time id="out" datetime="2026-10-20T14:30:05Z" data-local>a</time><section><time id="in" datetime="2026-10-20T14:30:05Z" data-local>b</time></section>');
    localize(doc.querySelector('section'), { zone: NY, said });
    assert.equal(doc.getElementById('in').textContent, ': 2026-10-20T10:30 EDT');
    assert.equal(doc.getElementById('out').textContent, 'a');
  });
});

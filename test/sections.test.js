import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { follow, link, reach, sectionFor } from '../src/sections.js';
import { textModel } from '../src/anchors.js';

const POST = `<main id="comments-host"><article class="article-body">
  <p>Intro.</p>
  <h2 id="section-why-it-matters">Why it <em>matters</em></h2><p>Because.</p>
  <h3 id="section-going-nowhere">Going nowhere</h3><p>The end.</p>
  <h2 id="section-comments">Comments</h2>
  <h2>No id</h2>
  <h5 id="section-deep">Deep</h5>
</article><section id="comments"></section></main>`;

function page(hash = '') {
  const dom = new JSDOM(`<!doctype html><body>${POST}</body>`, { url: `https://example.com/posts/a${hash}` });
  dom.window.HTMLElement.prototype.scrollIntoView = function () { dom.window.scrolled = this.id; };
  return dom.window;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('a bare #name', () => {
  it('finds the heading whose id is section-<name>', () => {
    const win = page();
    assert.equal(sectionFor('#going-nowhere', win.document).id, 'section-going-nowhere');
    assert.equal(sectionFor('going-nowhere', win.document).id, 'section-going-nowhere');
  });

  it('reads an encoded name', () => {
    const win = page();
    win.document.querySelector('h2').id = 'section-caf\u00e9';
    assert.equal(sectionFor('#caf%C3%A9', win.document).id, 'section-caf\u00e9');
  });

  it('leaves alone a name the page has itself, a full section id, and a name with no heading', () => {
    const win = page();
    assert.equal(sectionFor('#comments', win.document), null);
    assert.equal(sectionFor('#section-comments', win.document), null);
    assert.equal(sectionFor('#nothing', win.document), null);
    assert.equal(sectionFor('', win.document), null);
    assert.equal(sectionFor('#%E0%A4%A', win.document), null);
  });

  it('becomes the section\'s address when reached, so :target and copied links are the real ones', async () => {
    const win = page('#going-nowhere');
    assert.equal(reach(win), true);
    await tick();
    assert.equal(win.location.hash, '#section-going-nowhere');
    assert.equal(win.document.querySelector(':target').id, 'section-going-nowhere');
  });

  it('is not added to the history', async () => {
    const win = page('#going-nowhere');
    const before = win.history.length;
    reach(win);
    await tick();
    assert.equal(win.history.length, before);
  });

  it('is left alone by reach when it names nothing', () => {
    const win = page('#comments');
    assert.equal(reach(win), false);
    assert.equal(win.location.hash, '#comments');
  });

  it('is followed on load and each time the hash changes, until stopped', async () => {
    const win = page('#why-it-matters');
    const stop = follow(win);
    await tick();
    assert.equal(win.location.hash, '#section-why-it-matters');

    win.location.hash = '#going-nowhere';
    await tick();
    await tick();
    assert.equal(win.location.hash, '#section-going-nowhere');

    stop();
    win.location.hash = '#why-it-matters';
    await tick();
    await tick();
    assert.equal(win.location.hash, '#why-it-matters');
  });
});

describe('section links', () => {
  it('go on each h2 to h4 with a section id, to that id, named for screen readers', () => {
    const win = page();
    const body = win.document.querySelector('.article-body');
    assert.equal(link(body), 3);
    const links = [...body.querySelectorAll('a.section-link')];
    assert.deepEqual(links.map((a) => a.getAttribute('href')), ['#section-why-it-matters', '#section-going-nowhere', '#section-comments']);
    assert.deepEqual(links.map((a) => a.textContent), ['#', '#', '#']);
    assert.equal(links[0].getAttribute('aria-label'), 'Link to the section: Why it matters');
    assert.equal(links[0].parentElement.tagName, 'H2');
    assert.equal(links[0].parentElement.lastElementChild, links[0]);
  });

  it('are added once, however often drawn', () => {
    const win = page();
    const body = win.document.querySelector('.article-body');
    link(body);
    assert.equal(link(body), 0);
    assert.equal(body.querySelectorAll('a.section-link').length, 3);
  });

  it('take a site\'s class and heading levels', () => {
    const win = page();
    const body = win.document.querySelector('.article-body');
    assert.equal(link(body, { className: 'pudl-link', headings: 'h2' }), 2);
    assert.equal(body.querySelectorAll('a.section-link.pudl-link').length, 2);
  });

  it('are not part of the text comment anchors match', () => {
    const win = page();
    const body = win.document.querySelector('.article-body');
    const before = textModel(body).text;
    link(body);
    assert.equal(textModel(body, { ignore: '.section-link' }).text, before);
  });
});

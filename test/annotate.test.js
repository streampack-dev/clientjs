import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { annotate } from '../src/annotate.js';

/* The interface on a page with no layout (jsdom): sizes are faked where the choice between
   callouts and markers needs them. The real layout and selections are the sites' browser tests'. */

const POST = '<p>Alpha has the first quoted words in it.</p><p>Gamma is plain, with <a href="#x">a link</a>.</p>' +
  '<p>Beta says second and third close together.</p><p>Delta ends the post.</p>';

function comment(id, author, words, anchor) {
  const data = anchor
    ? `<span class="comment-anchor-data" hidden data-exact="${anchor.exact}" data-prefix="" data-suffix="" data-found="${anchor.found !== false}"></span>`
    : '';
  const quote = anchor ? `<blockquote class="comment-anchor"><p>${anchor.exact}</p></blockquote>` : '';
  return `<li class="comment" id="comment-${id}">${data}<p class="comment-meta"><span class="comment-author">${author}</span> at noon</p>` +
    `<div class="comment-body">${quote}<p>${words}</p></div></li>`;
}

const COMMENTS = [
  comment('a1', 'Ann', 'One of two on this.', { exact: 'first quoted words' }),
  comment('a2', 'Bea', 'The second on it.', { exact: 'first quoted words' }),
  comment('a3', 'Cy', 'About second.', { exact: 'second' }),
  comment('a4', 'Ed', 'Gone.', { exact: 'words an edit removed', found: false }),
  comment('a5', 'Flo', 'No quote.'),
].join('');

const SIGNED_IN = `
  <p class="anchor-ask" hidden><button type="button" data-anchor-ask>Comment on this passage</button></p>
  <form class="comment-new">
    <input type="hidden" name="anchorExact" data-anchor-field="exact">
    <input type="hidden" name="anchorPrefix" data-anchor-field="prefix">
    <input type="hidden" name="anchorSuffix" data-anchor-field="suffix">
    <div data-comment-quote hidden><blockquote><p data-comment-quote-text></p></blockquote>
      <button type="button" data-comment-quote-remove>Don't quote it</button></div>
    <textarea name="markdownSource"></textarea>
  </form>`;

let dom;
let doc;
let refusals;

function page({ signedIn = true, comments = COMMENTS, wide = true, articles = 1 } = {}) {
  const one = (n) => `<div class="article" id="art-${n}"><div class="article-body">${POST}</div>` +
    `${signedIn ? SIGNED_IN : ''}<section class="comments"><ol>${comments}</ol></section></div>`;
  dom = new JSDOM(`<!doctype html><body><main id="stage">${Array.from({ length: articles }, (_, i) => one(i)).join('')}</main></body>`, { pretendToBeVisual: true });
  doc = dom.window.document;
  const win = dom.window;
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.Range.prototype.getBoundingClientRect = function () { return { top: 100, bottom: 120, left: 10, right: 60, width: 50, height: 20 }; };
  win.Range.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
  // The stage is 1400px; the article 700px, centred: 350px (21.9rem) beside it, or 0 when narrow.
  const stage = doc.getElementById('stage');
  stage.getBoundingClientRect = () => ({ top: 0, left: 0, right: wide ? 1400 : 700, width: wide ? 1400 : 700, height: 900, bottom: 900 });
  for (const a of doc.querySelectorAll('.article')) {
    a.getBoundingClientRect = () => ({ top: 0, left: wide ? 350 : 0, right: wide ? 1050 : 700, width: 700, height: 900, bottom: 900 });
  }
  refusals = [];
  return page.last = annotate({
    container: '.article',
    body: ':scope > .article-body',
    comment: '.comments li.comment',
    form: 'form.comment-new',
    meta: ':scope > .comment-meta',
    author: ':scope > .comment-meta .comment-author',
    linkClass: 'extra',
    refuse: (container, message) => refusals.push([container.id, message]),
    document: doc,
  });
}

const frames = () => new Promise((resolve) => setTimeout(resolve, 60));
const art = (n = 0) => doc.getElementById(`art-${n}`);

function select(from, to = from) {
  const body = art().querySelector('.article-body');
  const walker = doc.createTreeWalker(body, dom.window.NodeFilter.SHOW_TEXT);
  let start;
  let end;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!start && n.data.includes(from)) start = [n, n.data.indexOf(from)];
    if (start && n.data.includes(to)) { end = [n, n.data.indexOf(to) + to.length]; break; }
  }
  const range = doc.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  const sel = doc.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  doc.dispatchEvent(new dom.window.Event('selectionchange'));
}

afterEach(() => dom && dom.window.close());

describe('reading, with room beside the post', () => {
  beforeEach(async () => {
    page().setUp(art());
    await frames();
  });

  it('gives each passage still in the post one callout, in the margin', () => {
    const callouts = art().querySelectorAll('.anchor-margin > aside.anchor-callout');
    assert.deepEqual([...callouts].map((c) => c.id), ['anchor-callout-a1', 'anchor-callout-a3']);
    assert.equal(art().querySelectorAll('.anchor-marker').length, 0);
  });

  it('shares a callout among the comments on one passage, with their count', () => {
    const one = doc.getElementById('anchor-callout-a1');
    assert.equal(one.getAttribute('aria-label'), '2 comments on a passage');
    assert.deepEqual([...one.querySelectorAll('.anchor-callout-link')].map((l) => l.textContent), ['Ann One of two on this.', 'Bea The second on it.']);
    assert.equal(one.querySelector('.anchor-callout-count').textContent, '2 comments');
    assert.equal(doc.getElementById('anchor-callout-a3').querySelector('.anchor-callout-count'), null);
    assert.equal(doc.getElementById('anchor-callout-a3').getAttribute('aria-label'), '1 comment on a passage');
  });

  it('leaves out a comment whose passage is gone, and one that quotes nothing', () => {
    for (const id of ['a4', 'a5']) {
      assert.equal(doc.getElementById(`anchor-callout-${id}`), null);
      assert.equal(doc.querySelector(`#comment-${id} .comment-anchor-link`), null);
      assert.equal(doc.getElementById(`comment-${id}`).classList.contains('anchor-callout-shown'), false);
    }
  });

  it('marks a comment whose callout shows its quote, and links it back', () => {
    const c = doc.getElementById('comment-a2');
    assert.ok(c.classList.contains('anchor-callout-shown'));
    const link = c.querySelector(':scope > .comment-meta > a.comment-anchor-link.extra');
    assert.equal(link.textContent, 'Show the passage');
    assert.equal(link.getAttribute('href'), '#anchor-callout-a1');
  });

  it('links a callout and its comments each way, moving focus without changing the address', () => {
    doc.querySelector('#anchor-callout-a3 .anchor-callout-link').click();
    assert.equal(doc.activeElement.id, 'comment-a3');
    doc.querySelector('#comment-a2 .comment-anchor-link').click();
    assert.equal(doc.activeElement.id, 'anchor-callout-a1');
    doc.querySelector('#anchor-callout-a1 .anchor-callout-count').click();
    assert.equal(doc.activeElement.id, 'comment-a1');
    assert.equal(dom.window.location.hash, '');
  });

  it('places callouts that would overlap one under the other', () => {
    const tops = [...art().querySelectorAll('.anchor-callout')].map((c) => parseFloat(c.style.top));
    // Both passages are at 100px here (faked), so the second goes below the first, with a gap.
    assert.equal(tops[0], 100);
    assert.ok(tops[1] >= tops[0] + 8, `second at ${tops[1]}`);
  });

  it('draws them once, however often it is set up', async () => {
    const again = annotate({ container: '.article', body: ':scope > .article-body', comment: '.comments li.comment', form: 'form.comment-new', meta: ':scope > .comment-meta', document: doc });
    again.setUp(art());
    await frames();
    assert.equal(art().querySelectorAll('.anchor-callout').length, 2);
    assert.equal(doc.querySelectorAll('#comment-a1 .comment-anchor-link').length, 1);
  });
});

describe('long comments in callouts', () => {
  const LONG_A = 'To be fair to Zig, it has a commitment to its definition of correctness, and feels that its ' +
    'users would rather be correct than incorrect, which is a choice that has costs and benefits both.';
  const LONG_C = 'This one is long too, long enough that a fixed cut would land in the middle of a word, but it ' +
    'is the last callout in the margin, so there is room below it for every word it has.';

  beforeEach(async () => {
    page({
      comments: [
        comment('a1', 'Ann', LONG_A, { exact: 'first quoted words' }),
        comment('a3', 'Cy', LONG_C, { exact: 'second' }),
      ].join(''),
    });
    // jsdom has no layout: a callout is 20px a line of 30 characters, and the margin is 900px.
    Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        if (this.classList.contains('anchor-margin')) return 900;
        if (this.classList.contains('anchor-callout')) return Math.ceil(this.textContent.length / 30) * 20;
        return 0;
      },
    });
  });

  async function drawn() {
    page.last.setUp(art());
    await frames();
  }

  it('cuts a comment that would reach the next callout\'s place at a word, and says so', async () => {
    await drawn();
    const link = doc.querySelector('#anchor-callout-a1 .anchor-callout-link');
    const shown = link.textContent.replace(/^Ann /, '');
    assert.ok(shown.endsWith('…'), shown);
    const kept = shown.slice(0, -1);
    assert.ok(LONG_A.startsWith(kept), shown);
    assert.match(LONG_A[kept.length], /\s/, `cut mid-word: ${shown}`);
    assert.equal(link.getAttribute('title'), LONG_A);
    const more = doc.querySelector('#anchor-callout-a1 .anchor-callout-more');
    assert.equal(more.textContent, 'Read the rest');
    assert.equal(more.getAttribute('href'), '#comment-a1');
  });

  it('shows a comment whole when its callout fits before the next one\'s place', async () => {
    await drawn();
    const link = doc.querySelector('#anchor-callout-a3 .anchor-callout-link');
    assert.equal(link.textContent, `Cy ${LONG_C}`);
    assert.equal(link.getAttribute('title'), null);
    assert.equal(doc.querySelector('#anchor-callout-a3 .anchor-callout-more'), null);
  });

  it('keeps the links between a cut callout and its comment', async () => {
    await drawn();
    doc.querySelector('#comment-a1 .comment-anchor-link').click();
    assert.equal(doc.activeElement.id, 'anchor-callout-a1');
    doc.querySelector('#anchor-callout-a1 .anchor-callout-more').click();
    assert.equal(doc.activeElement.id, 'comment-a1');
  });
});

describe('reading, without room', () => {
  beforeEach(async () => {
    page({ wide: false }).setUp(art());
    await frames();
  });

  it('puts a marker after each passage\'s paragraph, counting its comments', () => {
    const markers = [...art().querySelectorAll('.article-body .anchor-marker')];
    assert.deepEqual(markers.map((m) => m.textContent), ['2', '1']);
    assert.equal(markers[0].previousElementSibling.textContent, 'Alpha has the first quoted words in it.');
    assert.equal(markers[0].getAttribute('aria-label'), '2 comments on the passage “first quoted words”');
    assert.equal(art().querySelector('.anchor-margin'), null);
  });

  it('keeps the quotes in the thread, and links markers and comments each way', () => {
    assert.equal(art().querySelectorAll('.anchor-callout-shown').length, 0);
    doc.getElementById('anchor-marker-a1').click();
    assert.equal(doc.activeElement.id, 'comment-a1');
    doc.querySelector('#comment-a3 .comment-anchor-link').click();
    assert.equal(doc.activeElement.id, 'anchor-marker-a3');
  });

  it('switches to callouts when there is room again, and back', async () => {
    const ann = annotate({ container: '.article', body: ':scope > .article-body', comment: '.comments li.comment', form: 'form.comment-new', meta: ':scope > .comment-meta', document: doc });
    doc.getElementById('stage').getBoundingClientRect = () => ({ right: 1400 });
    art().getBoundingClientRect = () => ({ top: 0, right: 1050, width: 700 });
    ann.redraw(art());
    await frames();
    assert.equal(art().querySelectorAll('.anchor-marker').length, 0);
    assert.equal(art().querySelectorAll('.anchor-callout').length, 2);
    // The links aren't doubled by drawing again.
    assert.equal(doc.querySelectorAll('#comment-a1 .comment-anchor-link').length, 1);
  });
});

describe('resizing', () => {
  it('draws again when the room or the body changes, and not when nothing has', async () => {
    let fire;
    const watched = [];
    const ann = page({ wide: false });
    dom.window.ResizeObserver = class {
      constructor(callback) { fire = callback; }
      observe(el) { watched.push(el); }
      disconnect() { watched.length = 0; }
    };
    ann.setUp(art());
    await frames();
    assert.deepEqual(watched.map((el) => el.className || el.id), ['article-body', 'article', 'stage']);
    assert.equal(art().querySelectorAll('.anchor-marker').length, 2);

    // The stage grows: the next callback finds a new key, and the post gets callouts.
    Object.defineProperty(doc.getElementById('stage'), 'clientWidth', { value: 1400, configurable: true });
    doc.getElementById('stage').getBoundingClientRect = () => ({ right: 1400 });
    art().getBoundingClientRect = () => ({ top: 0, right: 1050, width: 700 });
    fire();
    await frames();
    assert.equal(art().querySelectorAll('.anchor-callout').length, 2);

    // The same key again draws nothing new: a marker put back by hand stays.
    art().querySelector('.article-body').insertAdjacentHTML('beforeend', '<button class="anchor-marker" id="kept"></button>');
    fire();
    await frames();
    assert.ok(doc.getElementById('kept'));

    // A post taken off the page stops being watched.
    art().remove();
    fire();
    assert.equal(watched.length, 0);
  });
});

describe('marks', () => {
  it('marks every post\'s passages at once, and drops a post that has gone', async () => {
    const highlights = new Map();
    globalThis.CSS = { highlights };
    globalThis.Highlight = class { constructor(...ranges) { this.size = ranges.length; } };
    try {
      const ann = page({ articles: 2 });
      ann.setUp(art(0));
      ann.setUp(art(1));
      await frames();
      assert.equal(highlights.get('comment-anchor').size, 4);
      art(1).remove();
      ann.redraw(art(0));
      await frames();
      assert.equal(highlights.get('comment-anchor').size, 2);
    } finally {
      delete globalThis.CSS;
      delete globalThis.Highlight;
    }
  });

  it('sets up a post with nothing quoted later, once a comment quotes something', async () => {
    const ann = page({ comments: comment('b1', 'Gus', 'Plain.') });
    ann.setUp(art());
    await frames();
    assert.equal(art().querySelector('.anchor-callout'), null);
    art().querySelector('ol').insertAdjacentHTML('beforeend', comment('b2', 'Hal', 'Now.', { exact: 'Delta' }));
    ann.setUp(art());
    await frames();
    assert.equal(art().querySelectorAll('.anchor-callout').length, 1);
  });
});

describe('writing', () => {
  it('offers the button beside a selection in the post', async () => {
    page().setUp(art());
    select('plain', 'link');
    await frames();
    const ask = art().querySelector('.anchor-ask');
    assert.equal(ask.hidden, false);
    assert.equal(ask.style.top, '124px');
  });

  it('offers for a selection made before it was set up', async () => {
    dom = new JSDOM(`<!doctype html><body><main id="stage"><div class="article" id="art-0"><div class="article-body">${POST}</div>${SIGNED_IN}</div></main></body>`, { pretendToBeVisual: true });
    doc = dom.window.document;
    dom.window.Range.prototype.getBoundingClientRect = () => ({ top: 100, bottom: 120, left: 10, right: 60 });
    dom.window.Range.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
    const range = doc.createRange();
    range.selectNodeContents(doc.querySelector('.article-body p'));
    doc.getSelection().addRange(range);
    annotate({ container: '.article', body: ':scope > .article-body', comment: 'li.comment', form: 'form.comment-new', meta: '.meta', document: doc });
    await frames();
    assert.equal(doc.querySelector('.anchor-ask').hidden, false);
  });

  it('quotes the selection in the form and moves to the box', async () => {
    page().setUp(art());
    select('plain', 'link');
    await frames();
    doc.querySelector('[data-anchor-ask]').click();
    const form = art().querySelector('form');

    assert.equal(form.querySelector('[data-anchor-field="exact"]').value, 'plain, with a link');
    assert.match(form.querySelector('[data-anchor-field="prefix"]').value, /Gamma is $/);
    assert.match(form.querySelector('[data-anchor-field="suffix"]').value, /^\. Beta/);
    assert.equal(form.querySelector('[data-comment-quote]').hidden, false);
    assert.equal(form.querySelector('[data-comment-quote-text]').textContent, 'plain, with a link');
    assert.equal(doc.activeElement.name, 'markdownSource');
    assert.equal(art().querySelector('.anchor-ask').hidden, true);
  });

  it('leaves a heading\'s section link out of the quote', async () => {
    page().setUp(art());
    const link = doc.createElement('a');
    link.className = 'section-link';
    link.href = '#section-gamma';
    link.textContent = '#';
    art().querySelector('.article-body p:nth-child(2)').append(link);
    select('plain', 'Beta');
    await frames();
    doc.querySelector('[data-anchor-ask]').click();

    assert.equal(art().querySelector('[data-anchor-field="exact"]').value, 'plain, with a link. Beta');
  });

  it('takes the quote out again', async () => {
    page().setUp(art());
    select('Delta');
    await frames();
    doc.querySelector('[data-anchor-ask]').click();
    doc.querySelector('[data-comment-quote-remove]').click();
    const form = art().querySelector('form');

    assert.equal(form.querySelector('[data-anchor-field="exact"]').value, '');
    assert.equal(form.querySelector('[data-comment-quote]').hidden, true);
    assert.equal(doc.activeElement.name, 'markdownSource');
  });

  it('says why a selection is too long to quote, and clears it when the offer goes', async () => {
    page().setUp(art());
    const body = art().querySelector('.article-body');
    body.insertAdjacentHTML('beforeend', `<p>Start ${'word '.repeat(120)}end.</p>`);
    select('Start', 'end.');
    await frames();
    doc.querySelector('[data-anchor-ask]').click();
    assert.match(refusals.at(-1)[1], /^Select at most 500 characters to quote; this is \d+\.$/);
    assert.equal(art().querySelector('[data-anchor-field="exact"]').value, '');

    doc.getSelection().removeAllRanges();
    doc.dispatchEvent(new dom.window.Event('selectionchange'));
    await frames();
    assert.deepEqual(refusals.at(-1), ['art-0', '']);
  });

  it('keeps the selection when the button is pressed', async () => {
    page().setUp(art());
    select('Delta');
    await frames();
    const press = new dom.window.Event('pointerdown', { bubbles: true, cancelable: true });
    doc.querySelector('[data-anchor-ask]').dispatchEvent(press);
    assert.equal(press.defaultPrevented, true);
  });

  it('stays offered while the button has focus, the keyboard\'s way to it', async () => {
    page().setUp(art());
    select('Delta');
    await frames();
    doc.querySelector('[data-anchor-ask]').focus();
    doc.getSelection().removeAllRanges();
    doc.dispatchEvent(new dom.window.Event('selectionchange'));
    await frames();
    assert.equal(art().querySelector('.anchor-ask').hidden, false);
  });

  it('offers nothing for a selection outside the post, or to a reader who isn\'t signed in', async () => {
    page().setUp(art());
    const r = doc.createRange();
    r.selectNodeContents(doc.querySelector('.comment-body'));
    doc.getSelection().removeAllRanges();
    doc.getSelection().addRange(r);
    doc.dispatchEvent(new dom.window.Event('selectionchange'));
    await frames();
    assert.equal(art().querySelector('.anchor-ask').hidden, true);

    page({ signedIn: false }).setUp(art());
    select('Delta');
    await frames();
    assert.equal(art().querySelector('.anchor-ask'), null);
  });
});

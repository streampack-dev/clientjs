import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  MAX_CONTEXT, MAX_EXACT, anchorFrom, collapse, locate, mark, place, rangeFor, textModel, textOf, unmark,
} from '../src/anchors.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/text.json', import.meta.url), 'utf8'));
const POST = fixtures.cases[0].html;

/** A post body holding [html], in a document of its own. */
function body(html) {
  const { document } = new JSDOM('<!doctype html><body><article class="post-body"></article></body>').window;
  const root = document.querySelector('.post-body');
  root.innerHTML = html;
  return root;
}

/** A Range over the text from the start of [from] (or its [nth] occurrence) to the end of [to]. */
function select(root, from, to = from, nth = 0) {
  const { text, starts, ends } = textModel(root);
  let a = -1;
  for (let i = 0; i <= nth; i++) a = text.indexOf(from, a + 1);
  const b = text.indexOf(to, a) + to.length;
  assert.ok(a >= 0 && b > a, `"${from}"…"${to}" is in the text`);
  const range = root.ownerDocument.createRange();
  range.setStart(...starts[a]);
  range.setEnd(...ends[b - 1]);
  return range;
}

describe('the post\'s text is what streampack\'s html_text() makes of it', () => {
  for (const { name, html, text } of fixtures.cases) {
    it(name, () => assert.equal(textOf(body(html)), text));
  }

  it('leaves out what the ignore selector matches', () => {
    const root = body('<pre><button class="copy">Copy</button><code>x = 1</code></pre><p>after</p>');
    // A button is inline, so its words run into the code's, as they would on the server.
    assert.equal(textOf(root), 'Copyx = 1 after');
    assert.equal(textOf(root, { ignore: '.copy' }), 'x = 1 after');
  });

  it('is empty for a post with no text', () => {
    assert.equal(textOf(body('<p> </p><hr>')), '');
  });

  it('gives each character a start and an end', () => {
    const model = textModel(body(POST));
    assert.equal(model.starts.length, model.text.length);
    assert.equal(model.ends.length, model.text.length);
  });

  it('collapses a string as it collapses the text', () => {
    assert.equal(collapse('  a\n\n\tb\u3000c\u00a0 '), 'a b c');
    assert.equal(collapse('10\u202fkm'), '10\u202fkm');
  });
});

describe('anchorFrom', () => {
  it('quotes a selection in one paragraph, with its context', () => {
    const root = body(POST);
    assert.deepEqual(anchorFrom(select(root, 'quick', 'fox.'), root), {
      anchor: {
        exact: 'quick brown fox.',
        prefix: 'The ',
        suffix: ' Tom & Jerry use <b> tags. first item second item',
      },
    });
  });

  it('quotes across paragraphs and list items with one space between', () => {
    const root = body(POST);
    assert.equal(anchorFrom(select(root, 'fox.', 'Tom'), root).anchor.exact, 'fox. Tom');
    assert.equal(anchorFrom(select(root, 'first', 'second'), root).anchor.exact, 'first item second');
  });

  it('quotes what a browser selection covers, set on text nodes', () => {
    const root = body(POST);
    const em = root.querySelector('em').firstChild; // "brown"
    const range = root.ownerDocument.createRange();
    range.setStart(em, 0);
    range.setEnd(root.querySelectorAll('p')[1].firstChild, 3); // "Tom"
    assert.equal(anchorFrom(range, root).anchor.exact, 'brown fox. Tom');
  });

  it('trims the spaces at the ends of a selection', () => {
    const root = body('<p>one two three</p>');
    const t = root.querySelector('p').firstChild;
    const range = root.ownerDocument.createRange();
    range.setStart(t, 3); // " two "
    range.setEnd(t, 8);
    assert.deepEqual(anchorFrom(range, root).anchor, { exact: 'two', prefix: 'one ', suffix: ' three' });
  });

  it('gives null context at the post\'s ends', () => {
    const root = body('<p>only</p>');
    assert.deepEqual(anchorFrom(select(root, 'only'), root).anchor, { exact: 'only', prefix: null, suffix: null });
  });

  it('keeps the context to MAX_CONTEXT characters', () => {
    const root = body(`<p>${'a'.repeat(100)} middle ${'b'.repeat(100)}</p>`);
    const { prefix, suffix } = anchorFrom(select(root, 'middle'), root).anchor;
    assert.equal(prefix.length, MAX_CONTEXT);
    assert.equal(suffix.length, MAX_CONTEXT);
    assert.ok(prefix.endsWith('a ') && suffix.startsWith(' b'));
  });

  it('never cuts a two-unit character in half at the context\'s ends', () => {
    // 63 code units, then an emoji (two units) across the 64-unit edge.
    const root = body(`<p>😀${'a'.repeat(62)} middle ${'b'.repeat(62)}😀</p>`);
    const { prefix, suffix } = anchorFrom(select(root, 'middle'), root).anchor;
    assert.ok(!/[\udc00-\udfff]/.test(prefix[0]), 'prefix starts on a whole character');
    assert.ok(!/[\ud800-\udbff]/.test(suffix.at(-1)), 'suffix ends on a whole character');
    assert.equal(prefix, 'a'.repeat(62) + ' ');
  });

  it('refuses an empty selection, or one of only spaces', () => {
    const root = body('<p>one</p><p>two</p>');
    const range = root.ownerDocument.createRange();
    range.setStart(root.firstChild.firstChild, 1);
    assert.deepEqual(anchorFrom(range, root), { refused: 'empty' });
    // The space between the paragraphs, alone.
    range.setStart(root, 1);
    range.setEnd(root, 1);
    assert.deepEqual(anchorFrom(range, root), { refused: 'empty' });
  });

  it('refuses a quote longer than MAX_EXACT, and says how long it is', () => {
    const root = body(`<p>${'a'.repeat(MAX_EXACT)}</p><p>b</p>`);
    assert.ok(anchorFrom(select(root, 'a'), root).anchor, 'exactly MAX_EXACT is accepted');
    assert.deepEqual(anchorFrom(select(root, 'a', 'b'), root), { refused: 'too-long', length: MAX_EXACT + 2 });
  });

  it('takes only the part of a range inside the root', () => {
    const root = body('<p>inside</p>');
    const doc = root.ownerDocument;
    root.insertAdjacentHTML('beforebegin', '<p>outside</p>');
    const range = doc.createRange();
    range.setStart(doc.body, 0);
    range.setEnd(root.firstChild.firstChild, 3);
    assert.equal(anchorFrom(range, root).anchor.exact, 'ins');
  });

  it('refuses a range in another document', () => {
    const root = body('<p>here</p>');
    const other = body('<p>there</p>');
    assert.deepEqual(anchorFrom(select(other, 'there'), root), { refused: 'empty' });
  });
});

describe('locate', () => {
  const twice = '<p>the cat sat.</p><p>the dog sat.</p><p>the cat ran.</p>';

  it('finds a passage, as a Range over it', () => {
    const root = body(POST);
    const range = rangeFor({ exact: 'quick brown' }, root);
    assert.equal(range.toString(), 'quick brown');
  });

  it('chooses between repeats by the prefix and suffix', () => {
    const root = body(twice);
    const text = textOf(root);
    const first = locate([{ id: 'a', anchor: { exact: 'the cat', suffix: ' sat.' } }], root).found[0];
    const last = locate([{ id: 'b', anchor: { exact: 'the cat', suffix: ' ran.' } }], root).found[0];
    assert.equal(first.start, text.indexOf('the cat'));
    assert.equal(last.start, text.lastIndexOf('the cat'));
    const byPrefix = locate([{ id: 'c', anchor: { exact: 'sat.', prefix: 'dog ' } }], root).found[0];
    assert.equal(byPrefix.start, text.indexOf('dog sat.') + 4);
  });

  it('takes the first of equal repeats', () => {
    const root = body(twice);
    assert.equal(locate([{ id: 'a', anchor: { exact: 'sat.' } }], root).found[0].start, textOf(root).indexOf('sat.'));
  });

  it('groups comments on the same passage, and orders passages as the post does', () => {
    const root = body(twice);
    const { found, orphans } = locate([
      { id: '3', anchor: { exact: 'cat ran.' } },
      { id: '1', anchor: { exact: 'the dog', prefix: 'sat. ' } },
      { id: '2', anchor: { exact: 'the dog', prefix: 'something else ' } },
    ], root);
    assert.deepEqual(found.map((p) => p.ids), [['1', '2'], ['3']]);
    assert.deepEqual(orphans, []);
  });

  it('calls a quote that isn\'t in the post an orphan', () => {
    const root = body(twice);
    const { found, orphans } = locate([
      { id: 'gone', anchor: { exact: 'the bird' } },
      { id: 'blank', anchor: { exact: '  ' } },
      { id: 'here', anchor: { exact: 'the dog' } },
    ], root);
    assert.deepEqual(orphans, ['gone', 'blank']);
    assert.deepEqual(found.map((p) => p.ids), [['here']]);
    assert.equal(rangeFor({ exact: 'the bird' }, root), null);
  });

  it('collapses a quote\'s whitespace before it looks', () => {
    const root = body(POST);
    assert.ok(rangeFor({ exact: 'fox.\n\nTom' }, root));
  });

  it('finds again every quote that anchorFrom makes, in every fixture', () => {
    for (const { name, html } of fixtures.cases) {
      const root = body(html);
      const words = textOf(root).split(' ').filter(Boolean);
      for (let i = 0; i < words.length; i++) {
        for (let j = i; j < Math.min(words.length, i + 4); j++) {
          const made = anchorFrom(select(root, words[i], words[j], 0), root);
          if (!made.anchor) continue;
          const again = locate([{ id: 'x', anchor: made.anchor }], root).found[0];
          assert.ok(again, `${name}: "${made.anchor.exact}" is found again`);
          assert.equal(textOf(root).slice(again.start, again.end), made.anchor.exact, name);
        }
      }
    }
  });
});

describe('place', () => {
  it('leaves callouts that don\'t overlap where they want to be', () => {
    assert.deepEqual(place([{ key: 'a', top: 0, height: 10 }, { key: 'b', top: 100, height: 10 }]), [
      { key: 'a', top: 0, shift: 0 },
      { key: 'b', top: 100, shift: 0 },
    ]);
  });

  it('moves an overlapping callout down below the one above it, with the gap', () => {
    const out = place([{ key: 'a', top: 10, height: 50 }, { key: 'b', top: 20, height: 30 }, { key: 'c', top: 30, height: 5 }]);
    assert.deepEqual(out, [
      { key: 'a', top: 10, shift: 0 },
      { key: 'b', top: 68, shift: 48 },
      { key: 'c', top: 106, shift: 76 },
    ]);
  });

  it('takes callouts in the order of where they want to be, and answers in the order given', () => {
    const out = place([{ key: 'low', top: 50, height: 40 }, { key: 'high', top: 40, height: 20 }], { gap: 0 });
    assert.deepEqual(out, [{ key: 'low', top: 60, shift: 10 }, { key: 'high', top: 40, shift: 0 }]);
  });

  it('keeps callouts below the top it is given', () => {
    assert.deepEqual(place([{ key: 'a', top: -20, height: 10 }], { top: 5 }), [{ key: 'a', top: 5, shift: 25 }]);
  });

  it('places nothing for nothing', () => {
    assert.deepEqual(place([]), []);
  });
});

describe('mark', () => {
  let saved;
  beforeEach(() => {
    saved = { CSS: globalThis.CSS, Highlight: globalThis.Highlight };
  });
  afterEach(() => {
    globalThis.CSS = saved.CSS;
    globalThis.Highlight = saved.Highlight;
  });

  it('says false where the browser has no Custom Highlight API', () => {
    delete globalThis.CSS;
    delete globalThis.Highlight;
    assert.equal(mark([]), false);
    unmark(); // Does nothing, and doesn't throw.
  });

  it('marks the ranges under the name, and removes them', () => {
    const highlights = new Map();
    globalThis.CSS = { highlights };
    globalThis.Highlight = class { constructor(...ranges) { this.ranges = ranges; } };
    const root = body(POST);
    const range = rangeFor({ exact: 'brown' }, root);

    assert.equal(mark([range]), true);
    assert.deepEqual(highlights.get('comment-anchor').ranges, [range]);
    mark([], 'other');
    assert.ok(highlights.has('other'));
    unmark();
    assert.ok(!highlights.has('comment-anchor'));
  });
});

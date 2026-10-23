import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { NETWORKS, network, pageFor, shareText, shareTo, wire } from '../src/share.js';

const URL_ = 'https://bytecode.news/posts/2026/10/debounce-apis';
const DEK = 'Angular gets debounce APIs. When to use them, and when not to.';
const TEXT = `From BCN:\n\n${DEK}\n\n${URL_}`;

/* A window whose clipboard and window.open are recorded, in the order they happen. */
function fakeWindow({ clipboard = 'works', execCommand = false } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://bytecode.news/' });
  const win = dom.window;
  const events = [];
  let resolveCopy;
  const writes = new Promise((r) => { resolveCopy = r; });
  if (clipboard === 'missing') {
    Object.defineProperty(win.navigator, 'clipboard', { value: undefined, configurable: true });
  } else {
    Object.defineProperty(win.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(text) {
          events.push(['copy', text]);
          resolveCopy(text);
          if (clipboard === 'throws') throw new Error('not allowed');
          return clipboard === 'refuses' ? Promise.reject(new Error('Document is not focused')) : Promise.resolve();
        },
      },
    });
  }
  win.document.execCommand = (command) => {
    events.push(['execCommand', command, win.document.activeElement && win.document.activeElement.value]);
    return execCommand;
  };
  win.open = (...args) => { events.push(['open', ...args]); return null; };
  return { win, events, writes };
}

describe('the text', () => {
  it('is BCN\'s format: From BCN, the dek, the address', () => {
    assert.equal(shareText({ dek: DEK, url: URL_ }), TEXT);
  });

  it('keeps the dek as it is, however long', () => {
    const long = 'word '.repeat(80).trim();
    assert.equal(shareText({ dek: long, url: URL_ }), `From BCN:\n\n${long}\n\n${URL_}`);
  });

  it('without a dek, is the frame and the address', () => {
    for (const dek of [undefined, null, '', '   ']) {
      assert.equal(shareText({ dek, url: URL_ }), `From BCN:\n\n${URL_}`);
    }
  });

  it('can name another site', () => {
    assert.equal(shareText({ dek: DEK, url: URL_ }, { from: 'Enigma Station' }), `From Enigma Station:\n\n${DEK}\n\n${URL_}`);
  });
});

describe('the networks', () => {
  it('are X, LinkedIn and Facebook, in that order', () => {
    assert.deepEqual(NETWORKS.map((n) => [n.id, n.name]), [['x', 'X'], ['linkedin', 'LinkedIn'], ['facebook', 'Facebook']]);
    assert.equal(network('linkedin').name, 'LinkedIn');
    assert.equal(network('myspace'), null);
  });

  it('give X the whole text, encoded', () => {
    const page = pageFor('x', TEXT, URL_);
    assert.equal(page, `https://x.com/intent/post?text=${encodeURIComponent(TEXT)}`);
    assert.equal(new URL(page).searchParams.get('text'), TEXT);
  });

  it('give LinkedIn and Facebook the address only', () => {
    const linkedin = new URL(pageFor('linkedin', TEXT, URL_));
    assert.equal(linkedin.origin + linkedin.pathname, 'https://www.linkedin.com/sharing/share-offsite/');
    assert.deepEqual([...linkedin.searchParams], [['url', URL_]]);
    const facebook = new URL(pageFor('facebook', TEXT, URL_));
    assert.equal(facebook.origin + facebook.pathname, 'https://www.facebook.com/sharer/sharer.php');
    assert.deepEqual([...facebook.searchParams], [['u', URL_]]);
  });

  it('encode what an address can\'t carry as it is', () => {
    const odd = 'https://bytecode.news/posts/a?b=1&c=2#x';
    assert.equal(new URL(pageFor('facebook', '', odd)).searchParams.get('u'), odd);
    assert.equal(new URL(pageFor('x', 'a & b #tag 100%', odd)).searchParams.get('text'), 'a & b #tag 100%');
  });

  it('refuse an unknown network', () => {
    assert.throws(() => pageFor('myspace', TEXT, URL_), /myspace/);
  });
});

describe('sharing', () => {
  it('starts the copy, then opens the page in a new tab without waiting for it', async () => {
    const { win, events } = fakeWindow();
    const copied = shareTo('https://x.com/intent/post?text=hi', TEXT, win);
    assert.deepEqual(events, [['copy', TEXT], ['open', 'https://x.com/intent/post?text=hi', '_blank', 'noopener']]);
    assert.equal(await copied, true);
  });

  it('falls back to a selected textarea when the clipboard refuses', async () => {
    const { win, events } = fakeWindow({ clipboard: 'refuses', execCommand: true });
    assert.equal(await shareTo('https://example.com/', TEXT, win), true);
    assert.deepEqual(events.map((e) => e[0]), ['copy', 'open', 'execCommand']);
    assert.deepEqual(events[2], ['execCommand', 'copy', TEXT]);
    assert.equal(win.document.querySelector('textarea'), null, 'the textarea is taken away');
  });

  it('gives the focus back after copying by selection', async () => {
    const { win } = fakeWindow({ clipboard: 'missing', execCommand: true });
    win.document.body.innerHTML = '<button id="b">X</button>';
    win.document.getElementById('b').focus();
    await shareTo('https://example.com/', TEXT, win);
    assert.equal(win.document.activeElement.id, 'b');
  });

  it('copies by selection, before opening, without a clipboard API', async () => {
    const { win, events } = fakeWindow({ clipboard: 'missing', execCommand: true });
    assert.equal(await shareTo('https://example.com/', TEXT, win), true);
    assert.deepEqual(events.map((e) => e[0]), ['execCommand', 'open']);
  });

  it('says it didn\'t copy when nothing works, and still opens the page', async () => {
    const { win, events } = fakeWindow({ clipboard: 'throws', execCommand: false });
    assert.equal(await shareTo('https://example.com/', TEXT, win), false);
    assert.ok(events.some((e) => e[0] === 'open'));
  });
});

describe('the menu', () => {
  function menu(win, textTag = 'textarea') {
    const doc = win.document;
    const text = textTag === 'textarea' ? `<textarea data-share-text>${TEXT}</textarea>` : `<pre data-share-text>${TEXT}</pre>`;
    doc.body.innerHTML = `<div data-share>${text}${NETWORKS.map((n) =>
      `<a data-share-to="${n.id}" href="${pageFor(n.id, TEXT, URL_)}" target="_blank" rel="noopener">${n.name}</a>`).join('')}</div>
      <a data-share-to="x" href="https://x.com/elsewhere" id="stray">X</a>`;
    return doc;
  }

  /* Dispatches a click and says whether the menu took it (defaultPrevented); a click left to the
     browser is stopped after that, as jsdom can't follow a link. */
  function click(win, el, init = {}) {
    const e = new win.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    let taken;
    win.addEventListener('click', (ev) => { taken = ev.defaultPrevented; ev.preventDefault(); }, { once: true });
    el.dispatchEvent(e);
    return { defaultPrevented: taken };
  }

  it('copies the text and opens the link\'s own page, and says so', async () => {
    const { win, events } = fakeWindow();
    const doc = menu(win);
    const results = [];
    let done;
    const told = new Promise((r) => { done = r; });
    wire(doc, { onShare: (r) => { results.push(r); done(); } });
    const e = click(win, doc.querySelector('[data-share-to="linkedin"]'));
    assert.equal(e.defaultPrevented, true);
    await told;
    assert.deepEqual(events[0], ['copy', TEXT]);
    assert.deepEqual(events[1], ['open', pageFor('linkedin', TEXT, URL_), '_blank', 'noopener']);
    assert.deepEqual(results, [{ network: 'linkedin', copied: true, text: TEXT }]);
  });

  it('copies what the reader changed in the box', async () => {
    const { win, events, writes } = fakeWindow();
    const doc = menu(win);
    doc.querySelector('textarea').value = 'Shorter.';
    wire(doc);
    click(win, doc.querySelector('[data-share-to="x"]'));
    assert.equal(await writes, 'Shorter.');
    assert.deepEqual(events[0], ['copy', 'Shorter.']);
  });

  it('reads the text from any element', async () => {
    const { win, writes } = fakeWindow();
    const doc = menu(win, 'pre');
    wire(doc);
    click(win, doc.querySelector('[data-share-to="facebook"]'));
    assert.equal(await writes, TEXT);
  });

  it('leaves modified clicks, and links outside a menu, to the browser', () => {
    const { win, events } = fakeWindow();
    const doc = menu(win);
    wire(doc);
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      assert.equal(click(win, doc.querySelector('[data-share-to="x"]'), init).defaultPrevented, false);
    }
    assert.equal(click(win, doc.getElementById('stray')).defaultPrevented, false);
    assert.deepEqual(events, []);
  });

  it('stops when asked', () => {
    const { win, events } = fakeWindow();
    const doc = menu(win);
    const stop = wire(doc);
    stop();
    assert.equal(click(win, doc.querySelector('[data-share-to="x"]')).defaultPrevented, false);
    assert.deepEqual(events, []);
  });
});

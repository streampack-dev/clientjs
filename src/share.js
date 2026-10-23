/**
 * A post's "Share to" menu (clientjs#15): the text to share, in BCN's format, and buttons that copy
 * it and open a network's own share page, where the reader pastes it and edits it into shape. No
 * accounts, tokens or network APIs: each network's page is a plain address.
 *
 * The text is:
 *
 * ```
 * From BCN:
 *
 * {dek}
 *
 * {url}
 * ```
 *
 * The dek is the post's excerpt, as it is: it is never shortened for a network.
 *
 * The markup a site writes, so the buttons are plain links to the networks' pages without script:
 *
 * - a container, `[data-share]`, holding the text in `[data-share-text]` (a `<textarea>`, a
 *   `<pre>`, anything with the text in it);
 * - in it, one `<a data-share-to="<network id>" href="<the network's page>" target="_blank"
 *   rel="noopener">` per network, the href from [pageFor].
 *
 * [wire] makes each such link copy the text before it opens the page.
 *
 * @module
 */

/**
 * The networks, in the order a menu lists them. Each `page` makes the network's share page for
 * the text and the post's address. LinkedIn's and Facebook's pages take only the address, so the
 * copied text is what the reader pastes there; X's takes the text, address and all.
 *
 * @type {ReadonlyArray<{ id: string, name: string, page: (text: string, url: string) => string }>}
 */
export const NETWORKS = Object.freeze([
  Object.freeze({ id: 'x', name: 'X', page: (text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}` }),
  Object.freeze({ id: 'linkedin', name: 'LinkedIn', page: (_, url) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` }),
  Object.freeze({ id: 'facebook', name: 'Facebook', page: (_, url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` }),
]);

/**
 * The text to share: "From BCN:", the dek, and the address, a blank line between each. Without a
 * dek (none, or only spaces), it is "From BCN:" and the address.
 *
 * @param {{ dek?: string | null, url: string }} post the post's excerpt and its plain address.
 * @param {{ from?: string }} [options] the name after "From"; "BCN" unless a site says otherwise.
 * @returns {string}
 */
export function shareText(post, options = {}) {
  const from = options.from || 'BCN';
  const dek = (post.dek || '').trim();
  return [`From ${from}:`, ...(dek ? [dek] : []), post.url].join('\n\n');
}

/**
 * The network with the id, or null.
 *
 * @param {string} id such as "x".
 * @returns {{ id: string, name: string, page: (text: string, url: string) => string } | null}
 */
export function network(id) {
  return NETWORKS.find((n) => n.id === id) || null;
}

/**
 * The share page of the network with the id, for the text and the address.
 *
 * @param {string} id the network's id.
 * @param {string} text from [shareText].
 * @param {string} url the post's plain address.
 * @returns {string}
 * @throws {Error} for an id that isn't one of [NETWORKS].
 */
export function pageFor(id, text, url) {
  const n = network(id);
  if (!n) throw new Error(`no network "${id}"`);
  return n.page(text, url);
}

/* Copies with a selected, hidden textarea: the old way, for a browser without the clipboard API.
   The focus goes back where it was, so a keyboard reader stays on the button they pressed. */
function copyBySelection(text, doc) {
  const before = doc.activeElement;
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  doc.body.append(area);
  try {
    area.focus();
    area.select();
    return typeof doc.execCommand === 'function' && doc.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    area.remove();
    if (before && typeof before.focus === 'function') before.focus();
  }
}

/**
 * Copies the text, then opens the page in a new tab. Call it in the click itself: browsers let a
 * page open a tab, or write to the clipboard, only while a click is being handled. The copy starts
 * first, while this page still has the focus; the tab opens straight after, without waiting for it.
 *
 * @param {string} page the network's share page, from [pageFor].
 * @param {string} text the text to copy.
 * @param {Window} [win] the window to copy and open from.
 * @returns {Promise<boolean>} whether the text was copied.
 */
export function shareTo(page, text, win = globalThis.window) {
  const clipboard = win.navigator && win.navigator.clipboard;
  let copied;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      copied = clipboard.writeText(text).then(() => true, () => copyBySelection(text, win.document));
    } catch {
      copied = Promise.resolve(copyBySelection(text, win.document));
    }
  } else {
    copied = Promise.resolve(copyBySelection(text, win.document));
  }
  win.open(page, '_blank', 'noopener');
  return copied;
}

/**
 * Makes each `a[data-share-to]` under the root, inside a `[data-share]` with a
 * `[data-share-text]`, copy that text and open its own href in a new tab. A click with a modifier
 * key or another button is left to the browser, as is a link outside such a container. One
 * listener on the root, so links drawn later work too.
 *
 * @param {Document | Element} root where the menus are, or will be.
 * @param {{ onShare?: (result: { network: string, copied: boolean, text: string }) => void }} [options]
 *   told after each share, to say whether the text was copied.
 * @returns {() => void} stops it.
 */
export function wire(root, options = {}) {
  const doc = root.ownerDocument || root;
  const win = doc.defaultView;
  function onClick(e) {
    const link = e.target && e.target.closest && e.target.closest('a[data-share-to][href]');
    if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const box = link.closest('[data-share]');
    const source = box && box.querySelector('[data-share-text]');
    if (!source) return;
    e.preventDefault();
    const text = 'value' in source && typeof source.value === 'string' ? source.value : source.textContent;
    const id = link.getAttribute('data-share-to');
    shareTo(link.href, text, win).then((copied) => {
      if (options.onShare) options.onShare({ network: id, copied, text });
    });
  }
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

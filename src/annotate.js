/**
 * Comments on a passage, as the reader sees and makes them (ui-pudl#252, clientjs#4), built on
 * [anchors](./anchors.js). It is the part ui-pudl's bcn-anchors.js and ui-primate's
 * client/annotate.ts had twice:
 *
 * - **Writing.** A selection in a post shows "Comment on this passage" beside it: a real button,
 *   after the post in the tab order, that keeps the selection when pressed. It puts the passage in
 *   the comment form's hidden fields, shows the quote above the box, and moves focus to the box.
 *   "Don't quote it" takes the quote out again.
 * - **Reading.** Each comment on a passage still in the post gets a light mark on the passage.
 *   Where there's room beside the post, it gets a callout there, level with the passage; comments on
 *   one passage share a callout that says how many there are. Where there isn't, a marker after the
 *   passage's paragraph goes to its comments. The callout or marker and the comment link to each
 *   other, and the comment's own quote is hidden where its callout shows it. The post never moves
 *   or rewraps for them.
 *
 * Each site keeps its markup, its styles, how a refusal is shown, and when to set up (a window
 * opening, a page shown): it calls [annotate] once with its selectors, then `setUp` for each post.
 *
 * The markup this expects, inside each post's container:
 *
 * - `.anchor-ask[hidden]` holding `button[data-anchor-ask]`, for signed-in readers;
 * - in the new-comment form: `[data-anchor-field="exact"|"prefix"|"suffix"]` hidden inputs, and
 *   `[data-comment-quote][hidden]` holding `[data-comment-quote-text]` and
 *   `button[data-comment-quote-remove]`;
 * - in each top-level comment, a direct child `.comment-anchor-data` with `data-exact`,
 *   `data-prefix`, `data-suffix` and `data-found` ("true" when the passage is still in the post).
 *
 * What it adds: `.anchor-margin` holding `aside.anchor-callout` (`a.anchor-callout-link`, an
 * `a.anchor-callout-more` "Read the rest" after a link whose comment is cut, and
 * `a.anchor-callout-count`), or `button.anchor-marker` after a block; `a.comment-anchor-link` in a
 * comment's meta line; and the class `anchor-callout-shown` on a comment whose callout shows.
 *
 * @module
 */
import { MAX_EXACT, anchorFrom, locate, mark, place, textOf } from './anchors.js';

/* A callout shows a comment whole when it fits before the next callout's own place (or the end
   of the margin). One that doesn't is cut to about this many characters, at a word. */
const EXCERPT = 140;

/**
 * Sets up comments on a passage for a site. Call it once; then `setUp(container)` for each post.
 *
 * @param {object} options
 * @param {string} options.container a selector for a post's container: the element that holds
 *   its body, its comments and the comment form, and that the button and callouts are placed in
 *   (it should be `position: relative`).
 * @param {string} options.body a selector, within the container, for the post's body.
 * @param {string} options.comment a selector, within the container, for a top-level comment
 *   (an element with an id `comment-<id>`).
 * @param {string} options.form a selector, within the container, for the new-comment form.
 * @param {string} options.meta a selector, within a comment, for its meta line.
 * @param {string} [options.author] a selector, within a comment, for its author's name.
 * @param {string} [options.ignore] a selector for what the site adds to a post's body that
 *   isn't its text (`.anchor-marker` and `.section-link` are always left out).
 * @param {number} [options.marginRem] the room, in rem, the callouts need to the right of the
 *   post's container: 16 if not given.
 * @param {string} [options.linkClass] classes to add to "Show the passage" links.
 * @param {(container: HTMLElement, message: string) => void} [options.refuse] shows why a
 *   selection can't be quoted; called with "" when the offer goes away, so a message can be cleared.
 * @param {Document} [options.document] the document; the global one if not given.
 * @returns {{ setUp(container: HTMLElement): void, redraw(container: HTMLElement): void }}
 */
export function annotate(options) {
  const doc = options.document || globalThis.document;
  const win = doc.defaultView || globalThis;
  const ignore = ['.anchor-marker', '.section-link', options.ignore].filter(Boolean).join(', ');
  const marginRem = options.marginRem ?? 16;
  const refuse = options.refuse || (() => {});
  const authorSel = options.author || null;
  const linkClass = ['comment-anchor-link', options.linkClass].filter(Boolean).join(' ');

  const remPx = () => parseFloat(win.getComputedStyle(doc.documentElement).fontSize) || 16;
  const textArea = (form) => form.querySelector('textarea[name="markdownSource"]');

  /* ---- Writing: from a selection to the comment form ---- */

  let asking = null; // { container, body, range } while the button is offered

  function placeOf(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const container = el && el.closest(options.container);
    const body = container && container.querySelector(options.body);
    return body && body.contains(el) ? { container, body } : null;
  }

  function hideAsk() {
    if (!asking) return;
    const ask = asking.container.querySelector('.anchor-ask');
    if (ask) ask.hidden = true;
    refuse(asking.container, '');
    asking = null;
  }

  function offer() {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      // Focus on the button itself (the keyboard's way to it) keeps the offer open.
      const focused = doc.activeElement;
      if (!(focused && focused.matches && focused.matches('[data-anchor-ask]'))) hideAsk();
      return;
    }
    const range = sel.getRangeAt(0);
    const start = placeOf(range.startContainer);
    const end = placeOf(range.endContainer);
    if (!start || !end || start.body !== end.body) return void hideAsk();
    const ask = start.container.querySelector('.anchor-ask');
    if (!ask || !start.container.querySelector(options.form)) return;
    if (asking && asking.container !== start.container) hideAsk();
    if (asking) refuse(asking.container, '');
    asking = { container: start.container, body: start.body, range: range.cloneRange() };
    const rects = range.getClientRects();
    const last = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    const box = start.container.getBoundingClientRect();
    ask.hidden = false;
    ask.style.top = `${last.bottom - box.top + 4}px`;
    const left = Math.min(last.right - box.left, box.width - ask.offsetWidth);
    ask.style.left = `${Math.max(0, left - ask.offsetWidth / 2)}px`;
  }

  let offerQueued = false;
  const offerSoon = () => {
    if (offerQueued) return;
    offerQueued = true;
    win.requestAnimationFrame(() => { offerQueued = false; offer(); });
  };
  doc.addEventListener('selectionchange', offerSoon);
  // A site may load this after the reader has already selected something: offer for that too.
  offerSoon();

  // Pressing the button mustn't clear the selection it's about.
  doc.addEventListener('pointerdown', (e) => {
    if (e.target.closest && e.target.closest('[data-anchor-ask]')) e.preventDefault();
  });

  function setQuote(form, anchor) {
    for (const k of ['exact', 'prefix', 'suffix']) {
      const field = form.querySelector(`[data-anchor-field="${k}"]`);
      if (field) field.value = anchor ? (anchor[k] || '') : '';
    }
    const quote = form.querySelector('[data-comment-quote]');
    if (!quote) return;
    quote.hidden = !anchor;
    const text = quote.querySelector('[data-comment-quote-text]');
    if (text) text.textContent = anchor ? anchor.exact : '';
  }

  doc.addEventListener('click', (e) => {
    const target = e.target;
    if (target.closest && target.closest('[data-anchor-ask]') && asking) {
      const at = asking;
      const made = anchorFrom(at.range, at.body, { ignore });
      if (made.refused) {
        refuse(at.container, made.refused === 'empty'
          ? "Select some of the post's text to comment on."
          : `Select at most ${MAX_EXACT} characters to quote; this is ${made.length}.`);
        return;
      }
      const form = at.container.querySelector(options.form);
      setQuote(form, made.anchor);
      hideAsk();
      form.scrollIntoView({ block: 'center' });
      const box = textArea(form);
      if (box) box.focus({ preventScroll: true });
      return;
    }
    const remove = target.closest && target.closest('[data-comment-quote-remove]');
    if (remove) {
      const form = remove.closest('form');
      setQuote(form, null);
      const box = textArea(form);
      if (box) box.focus();
    }
  });

  /* ---- Reading: marks, callouts and markers ---- */

  const marked = new Map(); // container -> its passages' ranges
  const watched = new WeakSet();

  function commentsOn(container) {
    return [...container.querySelectorAll(options.comment)].filter((c) => {
      const data = c.querySelector(':scope > .comment-anchor-data');
      return data && data.getAttribute('data-found') === 'true';
    });
  }

  function anchorOf(comment) {
    const data = comment.querySelector(':scope > .comment-anchor-data');
    return {
      exact: data.getAttribute('data-exact') || '',
      prefix: data.getAttribute('data-prefix') || null,
      suffix: data.getAttribute('data-suffix') || null,
    };
  }

  /* The comment's own words, without its quote, on one line. */
  function wordsOf(comment) {
    const body = comment.querySelector(':scope > .comment-body');
    if (!body) return '';
    const copy = body.cloneNode(true);
    const quote = copy.querySelector(':scope > blockquote.comment-anchor');
    if (quote) quote.remove();
    return (copy.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /* [text] cut to EXCERPT characters or fewer, at the end of a word, with "…"; or null when it
     is short enough already. A single word longer than that is cut where it must be. */
  function cut(text) {
    if (text.length <= EXCERPT) return null;
    const space = text.lastIndexOf(' ', EXCERPT - 1);
    const end = space > 0 ? space : EXCERPT - 1;
    return `${text.slice(0, end).trimEnd()}…`;
  }

  function authorOf(comment) {
    const a = authorSel && comment.querySelector(authorSel);
    return (a && a.textContent.trim()) || 'A reader';
  }

  const countLabel = (n) => (n === 1 ? '1 comment' : `${n} comments`);
  const idOf = (comment) => comment.id.replace(/^comment-/, '');

  /* Moves to [el] and focuses it, without changing the address. */
  function go(el) {
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
  }

  function linkTo(target, className) {
    const link = doc.createElement('a');
    link.className = className;
    link.href = `#${target.id}`;
    link.addEventListener('click', (e) => { e.preventDefault(); go(target); });
    return link;
  }

  function clear(container) {
    container.querySelectorAll('.anchor-margin, .anchor-marker, .comment-anchor-link').forEach((el) => el.remove());
    container.querySelectorAll('.anchor-callout-shown').forEach((c) => c.classList.remove('anchor-callout-shown'));
  }

  function linkBack(comment, target) {
    const link = linkTo(target, linkClass);
    link.textContent = 'Show the passage';
    const meta = comment.querySelector(options.meta);
    if (meta) meta.append(' ', link);
  }

  /* The comments shown in a passage's callout: the first two. */
  const shownIn = (group) => group.slice(0, 2);

  /* Whether a callout for [group] would be shorter cut. */
  const cuttable = (group) => shownIn(group).some((comment) => cut(wordsOf(comment)) !== null);

  /* A passage's callout. [short] cuts each long comment at a word, with its whole text as the
     link's title and a "Read the rest" link to it, so that a cut is plainly a cut. */
  function callout(passage, group, short = false) {
    const aside = doc.createElement('aside');
    aside.className = 'anchor-callout';
    aside.id = `anchor-callout-${passage.ids[0]}`;
    aside.setAttribute('aria-label', `${countLabel(group.length)} on a passage`);
    for (const comment of shownIn(group)) {
      const link = linkTo(comment, 'anchor-callout-link');
      const who = doc.createElement('strong');
      who.textContent = authorOf(comment);
      const words = wordsOf(comment);
      const shortened = short ? cut(words) : null;
      link.append(who, ` ${shortened ?? words}`);
      aside.append(link);
      if (shortened) {
        link.title = words;
        const more = linkTo(comment, 'anchor-callout-more');
        more.textContent = 'Read the rest';
        aside.append(' ', more);
      }
    }
    if (group.length > 1) {
      const count = linkTo(group[0], 'anchor-callout-count');
      count.textContent = countLabel(group.length);
      aside.append(count);
    }
    return aside;
  }

  function marker(passage, exact, group) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'anchor-marker';
    button.id = `anchor-marker-${passage.ids[0]}`;
    button.setAttribute('aria-label', `${countLabel(group.length)} on the passage “${exact}”`);
    button.textContent = String(group.length);
    button.addEventListener('click', () => go(group[0]));
    return button;
  }

  /* The block in [body] that the passage ends in, for its marker to follow. */
  function blockOf(range, body) {
    let block = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
    while (block && block.parentElement !== body) block = block.parentElement;
    return block || body.lastElementChild;
  }

  /* Every container's marks at once: the page has one set of highlights. */
  function markAll() {
    let all = [];
    for (const [container, ranges] of marked) {
      if (container.isConnected) all = all.concat(ranges);
      else marked.delete(container);
    }
    mark(all);
  }

  function draw(container) {
    const body = container.querySelector(options.body);
    if (!body) return;
    clear(container);
    const comments = commentsOn(container);
    const byId = new Map(comments.map((c) => [idOf(c), c]));
    const passages = locate(comments.map((c) => ({ id: idOf(c), anchor: anchorOf(c) })), body, { ignore }).found;
    marked.set(container, passages.map((p) => p.range));
    markAll();
    if (!passages.length) return;

    const text = textOf(body, { ignore });
    const groupOf = (p) => p.ids.map((id) => byId.get(id));
    const parent = container.parentElement;
    const beside = parent ? parent.getBoundingClientRect().right - container.getBoundingClientRect().right : 0;
    if (beside >= marginRem * remPx()) {
      const margin = doc.createElement('div');
      margin.className = 'anchor-margin';
      container.append(margin);
      const gap = remPx() / 2;
      const top = margin.getBoundingClientRect().top;
      const items = passages.map((p) => {
        const group = groupOf(p);
        const el = callout(p, group);
        margin.append(el);
        return { p, group, el, wants: p.range.getBoundingClientRect().top - top };
      });
      // Each callout shows its comments whole if it ends before the next callout's own place (or
      // the margin's end); otherwise it's drawn again with the long ones cut.
      const order = items.map((it, i) => i).sort((x, y) => items[x].wants - items[y].wants || x - y);
      order.forEach((i, k) => {
        const it = items[i];
        const next = k + 1 < order.length ? items[order[k + 1]].wants - gap : margin.offsetHeight;
        if (it.el.offsetHeight > next - it.wants && cuttable(it.group)) {
          const short = callout(it.p, it.group, true);
          it.el.replaceWith(short);
          it.el = short;
        }
      });
      for (const it of items) {
        for (const comment of it.group) {
          comment.classList.add('anchor-callout-shown');
          linkBack(comment, it.el);
        }
      }
      const spots = place(items.map((it, i) => ({ key: String(i), top: it.wants, height: it.el.offsetHeight })), { gap });
      spots.forEach((s, i) => { items[i].el.style.top = `${s.top}px`; });
    } else {
      for (const p of passages) {
        const group = groupOf(p);
        const el = marker(p, text.slice(p.start, p.end), group);
        const block = blockOf(p.range, body);
        if (block) block.insertAdjacentElement('afterend', el);
        for (const comment of group) linkBack(comment, el);
      }
    }
  }

  const redraws = new Map();
  function redraw(container) {
    if (redraws.has(container)) return;
    redraws.set(container, win.requestAnimationFrame(() => {
      redraws.delete(container);
      if (container.isConnected) draw(container);
    }));
  }

  function setUp(container) {
    if (!container || watched.has(container)) return;
    const body = container.querySelector(options.body);
    if (!body) return;
    if (!container.querySelector('.comment-anchor-data')) {
      // No comment here quotes anything (yet: it's asked again next time); marks from a post no
      // longer shown go.
      markAll();
      return;
    }
    watched.add(container);
    redraw(container);
    // The room beside the post decides callouts or markers; the body's place and height move the
    // passages. What's above the body (the title, the tags) can grow as fonts load and push it down.
    if (win.ResizeObserver) {
      let last = '';
      const watcher = new win.ResizeObserver(() => {
        if (!container.isConnected) return void watcher.disconnect();
        const parent = container.parentElement;
        const key = [parent ? parent.clientWidth : 0, body.offsetTop, body.offsetHeight].join(' ');
        if (key === last) return;
        last = key;
        redraw(container);
      });
      watcher.observe(body);
      watcher.observe(container);
      if (container.parentElement) watcher.observe(container.parentElement);
    }
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(() => redraw(container));
  }

  return { setUp, redraw };
}

/**
 * Links to a post's sections (streampack#274, clientjs#13). streampack gives each heading in a
 * post an id that starts with `section-` (streampack#270), so that no heading can take the name of
 * something else on the page, such as `#comments`. A reader who writes `#going-nowhere` expects the
 * heading "Going nowhere", which is `#section-going-nowhere`. This part finds it, and gives each
 * heading a `#` link to its own address.
 *
 * The links are not part of the post's text: `annotate` leaves out `.section-link`, so comment
 * anchors still match the text the server makes.
 *
 * @module
 */

/** What every section's id starts with, as streampack makes it. */
export const PREFIX = 'section-';

/** The class of each heading's link, unless a site gives more. */
export const LINK_CLASS = 'section-link';

/**
 * The heading that a bare name in an address means, or null. It is null when the name is empty,
 * when an element on the page has the name as its id (the browser goes there itself), when the name
 * is already a section's id, and when no section has it.
 *
 * @param {string} hash the address's hash, with or without its "#", encoded or not.
 * @param {Document} [doc] the document to look in.
 * @returns {HTMLElement | null}
 */
export function sectionFor(hash, doc = globalThis.document) {
  let name = (hash || '').replace(/^#/, '');
  try {
    name = decodeURIComponent(name);
  } catch {
    return null;
  }
  if (!name || name.startsWith(PREFIX) || doc.getElementById(name)) return null;
  return doc.getElementById(PREFIX + name);
}

/**
 * Goes to the section that the window's address names by its bare name, if there is one. The
 * address becomes the section's own, in place of the one in the history, so `:target` applies and a
 * copied address is the real one. Call it again after drawing a post into a page that is already
 * shown.
 *
 * @param {Window} [win] the window.
 * @returns {boolean} true when it went to a section.
 */
export function reach(win = globalThis.window) {
  const section = sectionFor(win.location.hash, win.document);
  if (!section) return false;
  win.location.replace(`#${encodeURIComponent(section.id)}`);
  return true;
}

/**
 * Calls [reach] now, or when the document has loaded, and each time the address's hash changes.
 *
 * @param {Window} [win] the window.
 * @returns {() => void} stops following.
 */
export function follow(win = globalThis.window) {
  const go = () => reach(win);
  if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', go, { once: true });
  else go();
  win.addEventListener('hashchange', go);
  return () => {
    win.document.removeEventListener('DOMContentLoaded', go);
    win.removeEventListener('hashchange', go);
  };
}

/**
 * Puts a `#` link at the end of each heading under [body] whose id starts with `section-`. The
 * link goes to the heading's id, and its label names the heading for screen readers. A heading
 * that has its link already is skipped, so it is safe to call each time the body is drawn. The site
 * styles the link: for example, shown when the heading is hovered or the link has focus.
 *
 * @param {ParentNode} body the element that holds the post's HTML.
 * @param {{className?: string, headings?: string}} [options] `className` adds classes to
 *   `section-link`; `headings` is the selector for the headings to link: "h2, h3, h4" if not given.
 * @returns {number} how many links it added.
 */
export function link(body, options = {}) {
  const headings = options.headings || 'h2, h3, h4';
  const classes = [LINK_CLASS, options.className].filter(Boolean).join(' ');
  let added = 0;
  for (const heading of body.querySelectorAll(headings)) {
    if (!heading.id.startsWith(PREFIX) || heading.querySelector(`:scope > a.${LINK_CLASS}`)) continue;
    const a = heading.ownerDocument.createElement('a');
    a.className = classes;
    a.href = `#${encodeURIComponent(heading.id)}`;
    a.setAttribute('aria-label', `Link to the section: ${heading.textContent.replace(/\s+/g, ' ').trim()}`);
    a.textContent = '#';
    heading.append(a);
    added++;
  }
  return added;
}

/**
 * Mermaid diagrams drawn in the browser into the markup streampack's API writes (ui-pudl#252,
 * clientjs#3). The API draws a published post's diagrams when it's saved (streampack#252); an
 * editor's preview is rendered by the front end, so its ```mermaid blocks are still code, and this
 * draws them the same way: with Pele, the API's options, and the API's fonts, into
 * `<figure class="mermaid">` (the SVG, and the source in a closed `<details>`) or, for a diagram
 * Pele refuses, `<figure class="mermaid mermaid-refused">` (the source and a caption saying why).
 * streampack's `docs/reference/diagram-html.md` describes that markup.
 *
 * Pele isn't a dependency: the caller passes it in, so each site loads it its own way (a vendored
 * script, or an import) and pins the version streampack bundles. Finding the blocks, and noticing
 * new ones, is the site's as well.
 *
 * @module
 */

/** Pele's options, as the API calls it: links and images off, the same limits, IBM Plex. */
export const OPTIONS = Object.freeze({
  limit: 20000,
  outputLimit: 1000000,
  links: false,
  images: false,
  fontFamily: '"IBM Plex Sans", sans-serif',
  fontFamilyMono: '"IBM Plex Mono", monospace',
});

/** The faces the API measures labels in, which the browser must measure them in too. */
export const FACES = Object.freeze([
  '16px "IBM Plex Sans"', 'bold 16px "IBM Plex Sans"', 'italic 16px "IBM Plex Sans"', 'italic bold 16px "IBM Plex Sans"',
  '16px "IBM Plex Mono"', 'bold 16px "IBM Plex Mono"', 'italic 16px "IBM Plex Mono"', 'italic bold 16px "IBM Plex Mono"',
]);

/** The most diagrams drawn in one body, as the API draws at most fifty in one post. */
export const MAX_DIAGRAMS = 50;

let drawn = 0;

/**
 * Waits for the faces in [FACES]. A face that won't load is skipped: its labels are then measured
 * in the fallback, and the diagram is still drawn.
 *
 * @param {Document} [doc] the document whose fonts to wait for.
 * @returns {Promise<void>}
 */
export function fontsReady(doc = globalThis.document) {
  const fonts = doc && doc.fonts;
  if (!fonts || typeof fonts.load !== 'function') return Promise.resolve();
  return Promise.all(FACES.map((face) => fonts.load(face).catch(() => undefined))).then(() => undefined);
}

/**
 * Pele's error as one line, as the API gives it: where it went wrong, then what was expected.
 *
 * @param {unknown} error what Pele threw.
 * @returns {string}
 */
export function reason(error) {
  const lines = String((error && /** @type {Error} */ (error).message) || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return "It isn't a diagram Pele can draw.";
  const first = lines[0].replace(/^PeleError: /, '');
  return lines.length < 3 ? first : `${first.replace(/:$/, '')}: ${lines[lines.length - 1]}`;
}

function codeBlock(doc, source) {
  const pre = doc.createElement('pre');
  const code = doc.createElement('code');
  code.className = 'language-mermaid';
  code.setAttribute('data-mermaid', 'source');
  code.textContent = source;
  pre.append(code);
  return pre;
}

function drawnFigure(doc, svgText, source) {
  const Parser = doc.defaultView ? doc.defaultView.DOMParser : globalThis.DOMParser;
  const parsed = new Parser().parseFromString(svgText, 'image/svg+xml').documentElement;
  if (!parsed || parsed.nodeName.toLowerCase() !== 'svg') return null;
  const svg = doc.importNode(parsed, true);
  if (!svg.hasAttribute('aria-labelledby') && !svg.hasAttribute('aria-label')) {
    svg.setAttribute('aria-label', `Diagram (${svg.getAttribute('aria-roledescription') || 'diagram'})`);
  }
  const figure = doc.createElement('figure');
  figure.className = 'mermaid';
  const details = doc.createElement('details');
  const summary = doc.createElement('summary');
  summary.textContent = 'Diagram source';
  details.append(summary, codeBlock(doc, source));
  figure.append(svg, details);
  return figure;
}

function refusedFigure(doc, source, why) {
  const figure = doc.createElement('figure');
  figure.className = 'mermaid mermaid-refused';
  const caption = doc.createElement('figcaption');
  caption.textContent = `This diagram wasn't drawn: ${why}`;
  figure.append(codeBlock(doc, source), caption);
  return figure;
}

/**
 * The figure for one diagram: drawn, or refused with the reason.
 *
 * @param {{ render(source: string, options: object): { svg: string } }} pele Pele, as loaded.
 * @param {string} source the diagram's Mermaid source.
 * @param {string} idPrefix what the SVG's element ids start with, unique on the page.
 * @param {Document} [doc] the document to make the figure in.
 * @returns {HTMLElement}
 */
export function figureFor(pele, source, idPrefix, doc = globalThis.document) {
  try {
    const result = pele.render(source.trimEnd(), { ...OPTIONS, idPrefix });
    return drawnFigure(doc, result.svg, source) || refusedFigure(doc, source, 'The drawing was empty.');
  } catch (error) {
    if (error && /** @type {Error} */ (error).name === 'PeleError') return refusedFigure(doc, source, reason(error));
    globalThis.console?.error('clientjs/mermaid', error);
    return refusedFigure(doc, source, 'The renderer failed.');
  }
}

/**
 * Draws the blocks: each `<pre><code class="language-mermaid">` is replaced by its figure.
 *
 * The blocks are claimed first (`data-mermaid="pending"`), so a second call while Pele loads
 * doesn't take them again, and a block already inside a figure is left alone. Past [MAX_DIAGRAMS]
 * in one body, a block is marked `skipped` and stays as code. If Pele won't load, every block is
 * marked `unavailable` and stays as code.
 *
 * @param {Iterable<HTMLElement>} blocks the `code` elements to draw.
 * @param {() => Promise<{ render(source: string, options: object): { svg: string } }>} loadPele
 *   loads Pele, the first time it's needed.
 * @param {{ bodyOf?: (code: HTMLElement) => Element | null, prefix?: string }} [options] what a
 *   block's body is, for counting the limit (the whole document if not given); and what ids start
 *   with ("preview" if not given).
 * @returns {Promise<void>} when the blocks are drawn, or marked.
 */
export async function draw(blocks, loadPele, options = {}) {
  const bodyOf = options.bodyOf || ((code) => code.ownerDocument.documentElement);
  const prefix = options.prefix || 'preview';
  const claimed = [...blocks].filter((code) => !code.hasAttribute('data-mermaid') && !code.closest('figure.mermaid'));
  if (!claimed.length) return;
  claimed.forEach((code) => code.setAttribute('data-mermaid', 'pending'));
  let pele;
  try {
    [pele] = await Promise.all([loadPele(), fontsReady(claimed[0].ownerDocument)]);
  } catch {
    claimed.forEach((code) => code.setAttribute('data-mermaid', 'unavailable'));
    return;
  }
  const counts = new Map();
  claimed.forEach((code) => {
    const pre = code.parentElement;
    if (!pre || !pre.isConnected) return;
    const body = bodyOf(code);
    const index = counts.get(body) || 0;
    counts.set(body, index + 1);
    if (index >= MAX_DIAGRAMS) return void code.setAttribute('data-mermaid', 'skipped');
    pre.replaceWith(figureFor(pele, code.textContent || '', `${prefix}-${++drawn}-${index}`, code.ownerDocument));
  });
}

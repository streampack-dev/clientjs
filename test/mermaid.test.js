import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as pele from 'pele';
import { FACES, MAX_DIAGRAMS, OPTIONS, draw, figureFor, fontsReady, reason } from '../src/mermaid.js';

/* The API's own rendering of a drawn diagram and a refused one (streampack's MermaidRenderer, Pele
   1.6.0), as ui-primate's test/fixtures/mermaid/published.html has it. */
const published = readFileSync(new URL('./fixtures/mermaid/published.html', import.meta.url), 'utf8');

const DIAGRAM = 'flowchart LR\n  accTitle: How a post ships\n  A[Write] --> B{Reviewed?}\n  B -->|yes| C[Publish]\n  B -->|no| A\n';
const BROKEN = 'flowchart LR\n  A -->\n';

function page(html = '') {
  return new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
}

/* A figure's shape: its elements' names and classes, its texts, and the source, not the SVG's
   insides (the browser measures labels, so its numbers differ from the server's). */
function shape(figure) {
  const svg = figure.querySelector(':scope > svg');
  return {
    classes: figure.className,
    children: [...figure.children].map((c) => c.tagName.toLowerCase()),
    svgClass: svg ? svg.getAttribute('class') : null,
    svgLabelled: svg ? !!(svg.getAttribute('aria-labelledby') || svg.getAttribute('aria-label')) : null,
    summary: figure.querySelector(':scope > details > summary')?.textContent ?? null,
    source: figure.querySelector('pre > code.language-mermaid')?.textContent ?? null,
    caption: figure.querySelector(':scope > figcaption')?.textContent ?? null,
  };
}

function blocks(doc, ...sources) {
  const body = doc.createElement('div');
  body.className = 'body';
  for (const source of sources) {
    const pre = doc.createElement('pre');
    const code = doc.createElement('code');
    code.className = 'language-mermaid';
    code.textContent = source;
    pre.append(code);
    body.append(pre);
  }
  doc.body.append(body);
  return body;
}

describe('the markup', () => {
  const api = page(published);
  const [apiDrawn, apiRefused] = api.querySelectorAll('figure.mermaid');

  it('of a drawn diagram is the API\'s', () => {
    const ours = figureFor(pele, DIAGRAM, 'test', page());
    assert.deepEqual(shape(ours), shape(apiDrawn));
    assert.equal(shape(ours).children.join(' '), 'svg details');
  });

  it('of a refused diagram is the API\'s, the reason in the same words', () => {
    const ours = figureFor(pele, BROKEN, 'test', page());
    assert.deepEqual(shape(ours), shape(apiRefused));
    assert.equal(shape(ours).caption, "This diagram wasn't drawn: Parse error on line 3: Expecting 'NODE_STRING', got 'EOF'");
  });

  it('marks the source it keeps, so it isn\'t taken for a block to draw', () => {
    const ours = figureFor(pele, DIAGRAM, 'test', page());
    assert.equal(ours.querySelector('pre > code').getAttribute('data-mermaid'), 'source');
  });

  it('names an untitled diagram by its kind, and leaves a titled one its title', () => {
    const untitled = figureFor(pele, 'sequenceDiagram\n  A->>B: hi\n', 'test', page());
    assert.equal(untitled.querySelector('svg').getAttribute('aria-label'), 'Diagram (sequence)');
    const titled = figureFor(pele, DIAGRAM, 'test', page()).querySelector('svg');
    assert.ok(titled.getAttribute('aria-labelledby'));
    assert.equal(titled.getAttribute('aria-label'), null);
  });

  it('draws with links and images off, and the ids it\'s given', () => {
    const svg = figureFor(pele, 'flowchart LR\n  A[x]\n  click A "https://example.com/"\n', 'mine-1', page()).querySelector('svg');
    assert.equal(svg.querySelector('a'), null);
    assert.equal(svg.querySelector('image'), null);
    assert.ok([...svg.querySelectorAll('[id]')].every((e) => e.id.startsWith('mine-1')));
  });

  it('says so when the drawing is empty, or the renderer fails', () => {
    const empty = figureFor({ render: () => ({ svg: '<nothing/>' }) }, DIAGRAM, 'x', page());
    assert.equal(empty.querySelector('figcaption').textContent, "This diagram wasn't drawn: The drawing was empty.");
    const quiet = console.error;
    console.error = () => {};
    try {
      const failed = figureFor({ render: () => { throw new TypeError('boom'); } }, DIAGRAM, 'x', page());
      assert.equal(failed.querySelector('figcaption').textContent, "This diagram wasn't drawn: The renderer failed.");
    } finally {
      console.error = quiet;
    }
  });
});

describe('reason', () => {
  it('is where it went wrong, then what was expected', () => {
    assert.equal(reason(new Error("Parse error on line 3:\n\n^\nExpecting 'NODE_STRING', got 'EOF'")), "Parse error on line 3: Expecting 'NODE_STRING', got 'EOF'");
  });
  it('is a short message as it is, without "PeleError: "', () => {
    assert.equal(reason(new Error('PeleError: Unknown diagram type')), 'Unknown diagram type');
  });
  it('says something when there\'s nothing to say', () => {
    assert.equal(reason(new Error('')), "It isn't a diagram Pele can draw.");
    assert.equal(reason(undefined), "It isn't a diagram Pele can draw.");
  });
});

describe('the options and fonts', () => {
  it('are the API\'s', () => {
    assert.deepEqual({ ...OPTIONS }, {
      limit: 20000, outputLimit: 1000000, links: false, images: false,
      fontFamily: '"IBM Plex Sans", sans-serif', fontFamilyMono: '"IBM Plex Mono", monospace',
    });
    assert.equal(FACES.length, 8);
    assert.ok(Object.isFrozen(OPTIONS) && Object.isFrozen(FACES));
  });

  it('are waited for, and a face that won\'t load doesn\'t stop the drawing', async () => {
    const asked = [];
    const doc = { fonts: { load: (f) => { asked.push(f); return f.includes('Mono') ? Promise.reject(new Error('no')) : Promise.resolve([]); } } };
    await fontsReady(doc);
    assert.deepEqual(asked, [...FACES]);
  });

  it('are not waited for where the document has no font loading', async () => {
    await fontsReady({});
    await fontsReady(undefined);
  });
});

describe('draw', () => {
  it('replaces each block with its figure', async () => {
    const doc = page();
    const body = blocks(doc, DIAGRAM, BROKEN);
    await draw(body.querySelectorAll('code'), async () => pele);

    assert.equal(body.querySelectorAll('figure.mermaid').length, 2);
    assert.equal(body.querySelectorAll('figure.mermaid-refused').length, 1);
    assert.equal(body.querySelector(':scope > pre'), null);
  });

  it('loads Pele once a body has a block, and not at all without one', async () => {
    let loads = 0;
    const load = async () => { loads++; return pele; };
    await draw([], load);
    assert.equal(loads, 0);
    const doc = page();
    await draw(blocks(doc, DIAGRAM).querySelectorAll('code'), load);
    assert.equal(loads, 1);
  });

  it('doesn\'t take a claimed block twice, or a figure\'s own source', async () => {
    const doc = page();
    const body = blocks(doc, DIAGRAM);
    let release;
    const slow = new Promise((resolve) => { release = resolve; });
    const first = draw(body.querySelectorAll('code'), () => slow);
    assert.equal(body.querySelector('code').getAttribute('data-mermaid'), 'pending');
    let second = 0;
    await draw(body.querySelectorAll('code'), async () => { second++; return pele; });
    release(pele);
    await first;
    assert.equal(second, 0);

    await draw(body.querySelectorAll('code'), async () => { second++; return pele; });
    assert.equal(second, 0);
    assert.equal(body.querySelectorAll('figure.mermaid').length, 1);
  });

  it('stops at fifty a body, counting each body on its own', async () => {
    const doc = page();
    const one = blocks(doc, ...Array(MAX_DIAGRAMS + 2).fill('flowchart LR\n  A --> B\n'));
    const two = blocks(doc, 'flowchart LR\n  A --> B\n');
    await draw(doc.querySelectorAll('code.language-mermaid'), async () => pele, { bodyOf: (code) => code.closest('.body') });

    assert.equal(one.querySelectorAll('figure.mermaid').length, MAX_DIAGRAMS);
    assert.deepEqual([...one.querySelectorAll(':scope > pre > code')].map((c) => c.getAttribute('data-mermaid')), ['skipped', 'skipped']);
    assert.equal(two.querySelectorAll('figure.mermaid').length, 1);
  });

  it('leaves the blocks as code, marked, when Pele won\'t load', async () => {
    const doc = page();
    const body = blocks(doc, DIAGRAM);
    await draw(body.querySelectorAll('code'), () => Promise.reject(new Error('offline')));

    assert.equal(body.querySelector('figure'), null);
    assert.equal(body.querySelector('code').getAttribute('data-mermaid'), 'unavailable');
  });

  it('gives each figure ids of its own, with the prefix asked for', async () => {
    const doc = page();
    const body = blocks(doc, DIAGRAM, DIAGRAM);
    await draw(body.querySelectorAll('code'), async () => pele, { prefix: 'win' });
    const ids = [...body.querySelectorAll('svg [id]')].map((e) => e.id);

    assert.ok(ids.length > 0 && ids.every((id) => id.startsWith('win-')));
    assert.equal(new Set(ids).size, ids.length);
  });

  it('skips a block taken off the page while Pele loaded', async () => {
    const doc = page();
    const body = blocks(doc, DIAGRAM);
    const code = body.querySelector('code');
    await draw([code], async () => { body.remove(); return pele; });
    assert.equal(body.querySelector('figure'), null);
  });
});

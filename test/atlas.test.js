import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { MAX_K, MIN_K, atlas, overlap, parseBox } from '../src/atlas.js';

/* The map on a page with no layout (jsdom): the SVG is faked as 1000×500 pixels on screen, and its
   world as 0 0 1000 500, so it starts at one pixel a unit. Reduced motion makes fly land at once. */

const MAP = `<div data-atlas>
  <div class="atlas-zoom" hidden>
    <button data-atlas-zoom="in">+</button><button data-atlas-zoom="out">−</button><button data-atlas-zoom="fit">Whole map</button>
  </div>
  <details class="atlas-key-box" open><summary>Key</summary></details>
  <form class="atlas-find"><input name="at"><button>Find</button></form>
  <p class="atlas-missed">No place on the map is called “qwerty”.</p>
  <svg class="atlas-map" viewBox="0 0 1000 500" data-world="0 0 1000 500">
    <text class="region-name" data-size="10">Big</text>
    <text class="region-name" data-size="5">Small</text>
    <text class="region-name" data-size="2">Apart</text>
    <a class="place" href="/tags/java" data-tag="Java" data-x="100" data-y="100"><circle/></a>
    <a class="place" href="/tags/kotlin" data-tag="kotlin" data-x="800" data-y="400"><circle/></a>
    <g class="pins" data-for="Java"><a class="pin" href="/posts/1" data-tag="Java"><circle/></a></g>
    <g class="pins" data-for="kotlin"></g>
  </svg>
</div>
<a id="new" href="/atlas?at=kotlin" data-atlas-frame="kotlin">at kotlin</a>`;

let dom;
let doc;
let chosen;

function page({ width = 1000, height = 500, motion = 'reduce' } = {}) {
  dom = new JSDOM(`<!doctype html><body>${MAP}</body>`, { url: 'https://example.com/atlas', pretendToBeVisual: true });
  doc = dom.window.document;
  const win = dom.window;
  win.matchMedia = (q) => ({ matches: motion === 'reduce' && q.includes('reduce') });
  const svg = doc.querySelector('svg');
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: height, width, height });
  // Big and Small overlap; Apart is clear of both.
  const boxes = { Big: [0, 0, 100, 20], Small: [50, 5, 100, 20], Apart: [500, 300, 50, 20] };
  for (const t of doc.querySelectorAll('.region-name')) {
    const [x, y, w, h] = boxes[t.textContent];
    t.getBBox = () => ({ x, y, width: w, height: h });
  }
  for (const a of doc.querySelectorAll('a.place')) a.getBoundingClientRect = () => ({ left: 10, top: 10, right: 20, bottom: 20 });
  chosen = [];
  const map = atlas({ document: doc, onChoose: (place) => chosen.push(place.getAttribute('href')) });
  map.start();
  return map;
}

const svg = () => doc.querySelector('svg');
const view = () => parseBox(svg().getAttribute('viewBox'));

function pointer(type, target, { x = 0, y = 0, id = 1, button = 0 } = {}) {
  const e = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button });
  Object.defineProperty(e, 'pointerId', { value: id });
  (type === 'pointermove' || type === 'pointerup' ? dom.window : target).dispatchEvent(e);
  return e;
}

afterEach(() => dom && dom.window.close());

describe('the pieces', () => {
  it('reads a box with spaces or commas, and nothing else', () => {
    assert.deepEqual(parseBox('1 2 3 4'), { x: 1, y: 2, w: 3, h: 4 });
    assert.deepEqual(parseBox(' 1,2, 3 ,4 '), { x: 1, y: 2, w: 3, h: 4 });
    assert.equal(parseBox('1 2 3'), null);
    assert.equal(parseBox('1 2 x 4'), null);
    assert.equal(parseBox(null), null);
  });

  it('says when boxes overlap, with room to spare', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    assert.equal(overlap(a, { x: 5, y: 5, width: 10, height: 10 }), true);
    assert.equal(overlap(a, { x: 12, y: 0, width: 10, height: 10 }), false);
    assert.equal(overlap(a, { x: 12, y: 0, width: 10, height: 10 }, 3), true);
  });
});

describe('starting', () => {
  it('shows the zoom buttons and says how much shows at one pixel a unit', () => {
    page();
    assert.equal(doc.querySelector('.atlas-zoom').hidden, false);
    assert.equal(svg().getAttribute('data-zoom'), 'mid');
    assert.equal(svg().style.getPropertyValue('--u'), '1.000px');
    assert.equal(svg().hasAttribute('data-tiny'), false);
  });

  it('folds the key on a phone, once, and leaves it open on a wide screen', () => {
    page({ width: 400, height: 300 });
    const key = doc.querySelector('details');
    assert.equal(key.open, false);
    key.open = true;
    const again = atlas({ document: doc });
    again.start();
    assert.equal(key.open, true);

    page();
    assert.equal(doc.querySelector('details').open, true);
  });

  it('does nothing where there\'s no map', () => {
    dom = new JSDOM('<!doctype html><body><p>No map.</p></body>');
    const map = atlas({ document: dom.window.document });
    map.start();
    assert.equal(map.svg, null);
    map.resize();
  });

  it('starts again on the same map only when asked', () => {
    const map = page();
    const centre = () => { const b = view(); return b.x + b.w / 2; };
    // The page gives the same map a new view (a navigation in place): without force, the view it
    // works from is still the old one, so the next zoom is about the old view's middle.
    svg().setAttribute('viewBox', '10 10 100 50');
    map.start();
    doc.querySelector('[data-atlas-zoom="in"]').click();
    assert.ok(Math.abs(centre() - 500) < 0.5, `centre ${centre()}`);
    svg().setAttribute('viewBox', '10 10 100 50');
    map.start(true);
    doc.querySelector('[data-atlas-zoom="in"]').click();
    assert.ok(Math.abs(centre() - 60) < 0.5, `centre ${centre()}`);
  });
});

describe('names', () => {
  it('leaves out a region name that would overlap a bigger region\'s', () => {
    page();
    const crowded = [...doc.querySelectorAll('.region-name.crowded')].map((t) => t.textContent);
    assert.deepEqual(crowded, ['Small']);
  });

  it('places them again after a resize', () => {
    const map = page();
    doc.querySelector('.region-name.crowded').classList.remove('crowded');
    map.resize();
    assert.equal(doc.querySelectorAll('.region-name.crowded').length, 1);
  });
});

describe('zoom', () => {
  it('zooms in and out about the middle with the buttons, and frames the world with "fit"', () => {
    page();
    doc.querySelector('[data-atlas-zoom="in"]').click();
    const zoomedIn = view();
    assert.ok(Math.abs(zoomedIn.w - 1000 / 1.6) < 0.2, `w ${zoomedIn.w}`);
    assert.ok(Math.abs(zoomedIn.x + zoomedIn.w / 2 - 500) < 0.2, 'centred');
    assert.equal(svg().getAttribute('data-zoom'), 'near');
    doc.querySelector('[data-atlas-zoom="out"]').click();
    assert.ok(Math.abs(view().w - 1000) < 0.2);
    doc.querySelector('[data-atlas-zoom="in"]').click();
    doc.querySelector('[data-atlas-zoom="fit"]').click();
    assert.deepEqual(view(), { x: 0, y: 0, w: 1000, h: 500 });
  });

  it('zooms with the wheel about the point under it, keeping that point still', () => {
    page();
    const e = new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -200, clientX: 250, clientY: 125 });
    svg().dispatchEvent(e);
    assert.equal(e.defaultPrevented, true);
    const b = view();
    // The world point at (250, 125) stays at (250, 125) on screen.
    const k = 500 / b.h;
    assert.ok(Math.abs(b.x + 250 / k - 250) < 0.5 && Math.abs(b.y + 125 / k - 125) < 0.5, JSON.stringify(b));
  });

  it('stays within its limits', () => {
    page();
    for (let i = 0; i < 40; i++) doc.querySelector('[data-atlas-zoom="in"]').click();
    assert.ok(Math.abs(500 / view().h - MAX_K) < 0.05, `k ${500 / view().h}`);
    assert.equal(svg().hasAttribute('data-close'), true);
    for (let i = 0; i < 80; i++) doc.querySelector('[data-atlas-zoom="out"]').click();
    assert.ok(Math.abs(500 / view().h - MIN_K) < 0.005, `k ${500 / view().h}`);
    assert.equal(svg().getAttribute('data-zoom'), 'far');
    assert.equal(svg().hasAttribute('data-tiny'), true);
  });

  it('pinches about the middle of two fingers', () => {
    page();
    pointer('pointerdown', svg(), { x: 400, y: 250, id: 1 });
    pointer('pointerdown', svg(), { x: 600, y: 250, id: 2 });
    pointer('pointermove', svg(), { x: 300, y: 250, id: 1 });
    pointer('pointermove', svg(), { x: 700, y: 250, id: 2 });
    // The fingers went from 200px apart to 400px: twice the zoom.
    assert.ok(Math.abs(view().w - 500) < 1, `w ${view().w}`);
    pointer('pointerup', svg(), { id: 1 });
    pointer('pointerup', svg(), { id: 2 });
  });
});

describe('pan', () => {
  it('drags the view, and the drag doesn\'t follow the link it ended on', () => {
    page();
    const place = doc.querySelector('a.place');
    pointer('pointerdown', place, { x: 100, y: 100 });
    pointer('pointermove', place, { x: 150, y: 120 });
    assert.deepEqual(view(), { x: -50, y: -20, w: 1000, h: 500 });
    assert.equal(svg().classList.contains('dragging'), true);
    pointer('pointerup', place);
    assert.equal(svg().classList.contains('dragging'), false);
    const click = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    place.dispatchEvent(click);
    assert.equal(click.defaultPrevented, true);
    assert.deepEqual(chosen, []);
  });

  it('takes a twitch of under 4px as a click', () => {
    page();
    const place = doc.querySelector('a.place');
    pointer('pointerdown', place, { x: 100, y: 100 });
    pointer('pointermove', place, { x: 102, y: 101 });
    pointer('pointerup', place);
    assert.deepEqual(view(), { x: 0, y: 0, w: 1000, h: 500 });
    place.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.deepEqual(chosen, ['/tags/java']);
  });

  it('ignores a button other than the main one', () => {
    page();
    pointer('pointerdown', svg(), { x: 100, y: 100, button: 2 });
    pointer('pointermove', svg(), { x: 200, y: 200 });
    assert.deepEqual(view(), { x: 0, y: 0, w: 1000, h: 500 });
  });
});

describe('places', () => {
  it('marks a place clicked as the one in hand, with its pins, and tells the site', () => {
    page();
    doc.querySelector('a.place').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.ok(doc.querySelector('a.place[data-tag="Java"]').classList.contains('here'));
    assert.ok(doc.querySelector('g.pins[data-for="Java"]').classList.contains('here'));
    assert.deepEqual(chosen, ['/tags/java']);
  });

  it('tells the site of a pin clicked, without marking a place', () => {
    page();
    doc.querySelector('a.pin').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.deepEqual(chosen, ['/posts/1']);
    assert.equal(doc.querySelectorAll('.here').length, 0);
  });

  it('shows a place\'s pins while it\'s pointed at, and puts them away for another', () => {
    page();
    doc.querySelector('a.place[data-tag="Java"]').dispatchEvent(new dom.window.MouseEvent('pointerover', { bubbles: true }));
    assert.ok(doc.querySelector('g.pins[data-for="Java"]').classList.contains('shown'));
    doc.querySelector('a.place[data-tag="kotlin"]').dispatchEvent(new dom.window.MouseEvent('pointerover', { bubbles: true }));
    assert.equal(doc.querySelector('g.pins[data-for="Java"]').classList.contains('shown'), false);
    assert.ok(doc.querySelector('g.pins[data-for="kotlin"]').classList.contains('shown'));
  });

  it('brings a place tabbed to into view when it\'s off screen, and not when it isn\'t', () => {
    page();
    const kotlin = doc.querySelector('a.place[data-tag="kotlin"]');
    kotlin.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true }));
    assert.deepEqual(view(), { x: 0, y: 0, w: 1000, h: 500 });
    kotlin.getBoundingClientRect = () => ({ left: 1100, top: 10, right: 1110, bottom: 20 });
    kotlin.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true }));
    const b = view();
    assert.ok(Math.abs(b.x + b.w / 2 - 800) < 0.5 && Math.abs(b.y + b.h / 2 - 400) < 0.5, JSON.stringify(b));
  });
});

describe('find, and What\'s new', () => {
  it('frames the place found, any case, focuses it, notes it in the address, and drops the "no place" note', () => {
    page();
    const form = doc.querySelector('form.atlas-find');
    form.querySelector('input').value = 'JAVA';
    const submit = new dom.window.Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);
    assert.equal(submit.defaultPrevented, true);
    const b = view();
    assert.ok(Math.abs(b.x + b.w / 2 - 100) < 0.5 && Math.abs(500 / b.h - 1.6) < 0.01, JSON.stringify(b));
    assert.equal(doc.activeElement.getAttribute('data-tag'), 'Java');
    assert.equal(dom.window.location.search, '?at=Java');
    assert.equal(doc.querySelector('.atlas-missed'), null);
  });

  it('leaves a name that isn\'t on the map to the server', () => {
    page();
    const form = doc.querySelector('form.atlas-find');
    form.querySelector('input').value = 'cobol';
    const submit = new dom.window.Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);
    assert.equal(submit.defaultPrevented, false);
    assert.ok(doc.querySelector('.atlas-missed'));
  });

  it('frames What\'s new\'s place in place, and leaves a click with a key held to the browser', () => {
    page();
    const link = doc.getElementById('new');
    const held = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    link.dispatchEvent(held);
    assert.equal(held.defaultPrevented, false);
    const click = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    assert.equal(click.defaultPrevented, true);
    assert.ok(doc.querySelector('a.place[data-tag="kotlin"]').classList.contains('here'));
    assert.equal(dom.window.location.search, '?at=kotlin');
  });
});

describe('fly', () => {
  it('eases to the box over frames, and stops for a new map', async () => {
    const map = page({ motion: 'no-preference' });
    map.fly({ x: 100, y: 50, w: 500, h: 250 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.deepEqual(view(), { x: 100, y: 50, w: 500, h: 250 });

    map.fly({ x: 0, y: 0, w: 1000, h: 500 });
    svg().replaceWith(svg().cloneNode(true));
    const fresh = doc.querySelector('svg');
    fresh.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500 });
    for (const t of fresh.querySelectorAll('.region-name')) t.getBBox = () => ({ x: 0, y: 0, width: 1, height: 1 });
    map.start();
    const before = fresh.getAttribute('viewBox');
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(fresh.getAttribute('viewBox'), before);
  });
});

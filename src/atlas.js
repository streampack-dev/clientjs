/**
 * The Atlas's map, moved about (ui-pudl#184, ui-pudl#252, clientjs#8). The server draws the whole
 * map as SVG, each place a link to its tag's page and each pin to its post or factoid; without
 * script it's a picture with links in it. This is the part ui-pudl's bcn-atlas.js and ui-primate's
 * client/atlas.ts had twice:
 *
 * - **zoom:** the wheel, a pinch, or the + and − buttons (`[data-atlas-zoom="in"|"out"|"fit"]`);
 *   "fit" frames the whole world.
 * - **pan:** dragging the map. A drag never follows the link it started on.
 * - **find:** the `form.atlas-find` frames the place its `at` field names, focuses it, and drops any
 *   `.atlas-missed` note, without a reload. A name that isn't on the map is left to the server,
 *   which says so.
 * - **focus:** tabbing to a place off screen brings it into view.
 * - **names:** region names (`.region-name`, biggest `data-size` first) never overlap. One that
 *   would is marked `.crowded` until zooming in makes room.
 * - **pins:** the framed (`.here`) or pointed-at (`.shown`) place's `g.pins[data-for]` show.
 * - **new:** a link with `data-atlas-frame="<tag>"` frames the place on the map instead of loading.
 * - **remember:** after a find or such a link, the address's `at` names the place, so a reload or a
 *   shared link frames it too.
 *
 * The map is `[data-atlas] svg.atlas-map` with a `viewBox` and a `data-world` (the whole map's
 * box). Each place is `a.place[data-tag][data-x][data-y]`. Labels keep their size in pixels: `--u`
 * on the SVG is one screen pixel in world units, and `data-zoom` (far, mid, near), `data-tiny` and
 * `data-close` say how much shows.
 *
 * Each site keeps its hookup: when a map arrives (`start`), what happens when a place is chosen
 * (`onChoose`, before its link is followed), and anything of its own built on the controller (ui-pudl
 * puts a place's window beside it).
 *
 * @module
 */

/** Pixels per world unit at which more of the map shows: near, mid, and tiny below; close above. */
export const NEAR = 1.5;
export const MID = 0.9;
export const TINY = 0.3;
export const CLOSE = 3;
/** The least and most pixels per world unit a zoom goes to. */
export const MIN_K = 0.05;
export const MAX_K = 6;

/**
 * [s] ("x y w h", spaces or commas) as a box, or null.
 *
 * @param {string | null} s
 * @returns {{ x: number, y: number, w: number, h: number } | null}
 */
export function parseBox(s) {
  const n = (s || '').trim().split(/[\s,]+/).map(Number);
  return n.length === 4 && n.every(Number.isFinite) ? { x: n[0], y: n[1], w: n[2], h: n[3] } : null;
}

/**
 * Whether two boxes overlap, with [pad] to spare.
 *
 * @param {{ x: number, y: number, width: number, height: number }} a
 * @param {{ x: number, y: number, width: number, height: number }} b
 * @param {number} [pad]
 * @returns {boolean}
 */
export function overlap(a, b, pad = 0) {
  return a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad;
}

/**
 * Sets up the Atlas for a site: the listeners, once. Then `start()` when a map is on the page.
 *
 * @param {object} [options]
 * @param {(place: Element, event: MouseEvent) => void} [options.onChoose] called when a place or pin
 *   (`a.place`, `a.pin`) is clicked, not dragged, before its link is followed.
 * @param {Document} [options.document] the document; the global one if not given.
 */
export function atlas(options = {}) {
  const doc = options.document || globalThis.document;
  const win = doc.defaultView || globalThis;
  const onChoose = options.onChoose || (() => {});
  let map = null;

  const reduced = () => !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const escape = (s) => (win.CSS && win.CSS.escape ? win.CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));

  /** Starts on the page's map, if it has one; [force] starts again on the same one (a new view). */
  function start(force = false) {
    const svg = doc.querySelector('[data-atlas] svg.atlas-map');
    if (!svg) { map = null; return; }
    if (map && map.svg === svg && !force) return;
    const box = parseBox(svg.getAttribute('viewBox'));
    if (!box) return;
    const world = parseBox(svg.getAttribute('data-world')) || box;
    map = { svg, box, world, drag: null, pointers: {}, pinch: null, moved: false, declutteredAt: undefined };
    const atlasEl = svg.closest('[data-atlas]');
    const zoom = atlasEl.querySelector('.atlas-zoom');
    if (zoom) zoom.hidden = false;
    // On a phone the key would cover the map: it starts folded, a tap from open, and only once.
    const key = atlasEl.querySelector('details.atlas-key-box');
    if (key && !key.hasAttribute('data-ready')) {
      key.setAttribute('data-ready', '');
      if (svg.getBoundingClientRect().width <= 640) key.open = false;
    }
    apply();
  }

  /** Pixels per world unit, as the SVG fits its box ("meet"), and the SVG's rectangle. */
  function scale() {
    const r = map.svg.getBoundingClientRect();
    return { k: Math.min(r.width / map.box.w, r.height / map.box.h) || 1, r };
  }

  function apply() {
    if (!map) return;
    const b = map.box;
    map.svg.setAttribute('viewBox', [b.x, b.y, b.w, b.h].map((v) => Math.round(v * 10) / 10).join(' '));
    const k = scale().k;
    map.svg.style.setProperty('--u', `${(1 / k).toFixed(3)}px`);
    map.svg.setAttribute('data-zoom', k >= NEAR ? 'near' : k >= MID ? 'mid' : 'far');
    map.svg.toggleAttribute('data-tiny', k < TINY);
    map.svg.toggleAttribute('data-close', k >= CLOSE);
    declutter(k);
  }

  /* Region names keep their size on screen at any zoom, so whether two collide depends on the zoom.
     At each new zoom they're placed biggest region first, and a name that would overlap one already
     placed is left out (.crowded) until zooming in makes room. Panning moves them all alike, so it's
     skipped then. */
  function declutter(k) {
    if (map.declutteredAt === k) return;
    map.declutteredAt = k;
    const names = [...map.svg.querySelectorAll('.region-name')];
    names.forEach((n) => n.classList.remove('crowded'));
    const shown = names.filter((n) => win.getComputedStyle(n).display !== 'none');
    shown.sort((a, b) => (+b.getAttribute('data-size') || 0) - (+a.getAttribute('data-size') || 0));
    const placed = [];
    const pad = 4 / k;
    for (const n of shown) {
      const b = n.getBBox();
      if (placed.some((p) => overlap(b, p, pad))) n.classList.add('crowded');
      else placed.push(b);
    }
  }

  /** The world point under a screen point, and the scale. */
  function toWorld(cx, cy) {
    const s = scale();
    const r = s.r;
    // "meet" centres the box: the slack is split either side.
    const ox = (r.width - map.box.w * s.k) / 2;
    const oy = (r.height - map.box.h * s.k) / 2;
    return { x: map.box.x + (cx - r.left - ox) / s.k, y: map.box.y + (cy - r.top - oy) / s.k, k: s.k };
  }

  /** Zooms by [f] about the screen point (cx, cy), within MIN_K and MAX_K. */
  function zoomAt(f, cx, cy) {
    const p = toWorld(cx, cy);
    const k = Math.max(MIN_K, Math.min(MAX_K, p.k * f));
    const g = p.k / k;
    const b = map.box;
    map.box = { x: p.x - (p.x - b.x) * g, y: p.y - (p.y - b.y) * g, w: b.w * g, h: b.h * g };
    apply();
  }

  /** A box of the world at the map's aspect, centred on (x, y), at [k] pixels a unit. */
  function boxAt(x, y, k) {
    const r = map.svg.getBoundingClientRect();
    const w = r.width / k;
    const h = r.height / k;
    return { x: x - w / 2, y: y - h / 2, w, h };
  }

  /** Moves the view to [to], eased over 450ms, or at once with reduced motion. */
  function fly(to) {
    if (!map) return;
    if (reduced()) { map.box = to; apply(); return; }
    const from = map.box;
    const svg = map.svg;
    const t0 = win.performance.now();
    const step = (t) => {
      if (!map || map.svg !== svg) return;
      const p = Math.min(1, (t - t0) / 450);
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      map.box = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e };
      apply();
      if (p < 1) win.requestAnimationFrame(step);
    };
    win.requestAnimationFrame(step);
  }

  /** The place called [tag] (any case), or null. */
  function placeEl(tag) {
    const want = (tag || '').trim().toLowerCase();
    if (!want || !map) return null;
    for (const a of map.svg.querySelectorAll('a.place[data-tag]')) {
      if (a.getAttribute('data-tag').toLowerCase() === want) return a;
    }
    return null;
  }

  /** A place's point in the world. */
  const at = (el) => ({ x: parseFloat(el.getAttribute('data-x')), y: parseFloat(el.getAttribute('data-y')) });

  /** Marks the place [tag] as the one in hand: named, and its pins shown close up. */
  function here(tag) {
    if (!map) return;
    map.svg.querySelectorAll('.here').forEach((h) => h.classList.remove('here'));
    const el = placeEl(tag);
    if (el) el.classList.add('here');
    const pins = map.svg.querySelector(`g.pins[data-for="${escape(tag)}"]`);
    if (pins) pins.classList.add('here');
  }

  /** Pointing at a place shows its pins, and they stay while the pointer is on them. */
  function shown(tag) {
    map.svg.querySelectorAll('g.pins.shown').forEach((g) => { if (g.getAttribute('data-for') !== tag) g.classList.remove('shown'); });
    const pins = tag && map.svg.querySelector(`g.pins[data-for="${escape(tag)}"]`);
    if (pins) pins.classList.add('shown');
  }

  /** Frames a place close up and marks it as the one asked for. */
  function frame(el) {
    const p = at(el);
    here(el.getAttribute('data-tag'));
    fly(boxAt(p.x, p.y, Math.max(scale().k, 1.6)));
  }

  /** The address says which place is framed, so a reload or a shared link frames it too. */
  function remember(tag) {
    const url = new URL(win.location.href);
    url.searchParams.set('at', tag);
    win.history.replaceState(win.history.state, '', url);
  }

  const inMap = (e) => !!map && e.target && e.target.nodeType && map.svg.contains(e.target);
  const plain = (e) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

  /* ---- zoom and pan ---- */

  doc.addEventListener('wheel', (e) => {
    if (!inMap(e)) return;
    e.preventDefault();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });

  doc.addEventListener('pointerdown', (e) => {
    if (!inMap(e) || e.button !== 0) return;
    map.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    const ids = Object.keys(map.pointers);
    if (ids.length === 1) {
      map.moved = false;
      map.drag = { x: e.clientX, y: e.clientY, box: map.box };
    } else if (ids.length === 2) {
      const a = map.pointers[ids[0]];
      const b = map.pointers[ids[1]];
      map.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), box: map.box };
      map.drag = null;
    }
  });

  doc.addEventListener('pointerover', (e) => {
    if (!inMap(e) || (map.drag && map.moved)) return;
    const a = e.target.closest('a.place, a.pin');
    if (a) shown(a.getAttribute('data-tag'));
  });

  win.addEventListener('pointermove', (e) => {
    if (!map || !map.pointers[e.pointerId]) return;
    const m = map;
    m.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    const ids = Object.keys(m.pointers);
    if (ids.length === 2 && m.pinch) {
      const a = m.pointers[ids[0]];
      const b = m.pointers[ids[1]];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (m.pinch.d > 0 && d > 0) {
        const before = m.box;
        m.box = m.pinch.box;
        zoomAt(d / m.pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
        if (!Number.isFinite(m.box.w)) m.box = before;
      }
      m.moved = true;
      return;
    }
    if (!m.drag) return;
    const dx = e.clientX - m.drag.x;
    const dy = e.clientY - m.drag.y;
    if (!m.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!m.moved) { m.moved = true; m.svg.classList.add('dragging'); }
    const k = scale().k;
    m.box = { x: m.drag.box.x - dx / k, y: m.drag.box.y - dy / k, w: m.drag.box.w, h: m.drag.box.h };
    apply();
  });

  function release(e) {
    if (!map || !map.pointers[e.pointerId]) return;
    delete map.pointers[e.pointerId];
    if (Object.keys(map.pointers).length < 2) map.pinch = null;
    if (!Object.keys(map.pointers).length) { map.drag = null; map.svg.classList.remove('dragging'); }
  }
  win.addEventListener('pointerup', release);
  win.addEventListener('pointercancel', release);

  /* The zoom buttons; a drag that ends on a place doesn't follow it; a click marks it, and is the
     site's to act on. */
  doc.addEventListener('click', (e) => {
    if (!map) return;
    const zoom = e.target.closest && e.target.closest('[data-atlas-zoom]');
    if (zoom && map.svg.closest('[data-atlas]').contains(zoom)) {
      const r = map.svg.getBoundingClientRect();
      const how = zoom.getAttribute('data-atlas-zoom');
      if (how === 'fit') fly(map.world);
      else zoomAt(how === 'in' ? 1.6 : 1 / 1.6, r.left + r.width / 2, r.top + r.height / 2);
      return;
    }
    if (!inMap(e)) return;
    if (map.moved) {
      map.moved = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const chosen = e.target.closest('a.place, a.pin');
    if (!chosen) return;
    if (chosen.classList.contains('place')) here(chosen.getAttribute('data-tag'));
    onChoose(chosen, e);
  }, true);

  /* Tabbing to a place off screen brings it into view. */
  doc.addEventListener('focusin', (e) => {
    if (!inMap(e)) return;
    const el = e.target.closest('a.place');
    if (!el) return;
    const pr = el.getBoundingClientRect();
    const r = map.svg.getBoundingClientRect();
    if (pr.left < r.left || pr.right > r.right || pr.top < r.top || pr.bottom > r.bottom) {
      const p = at(el);
      fly(boxAt(p.x, p.y, Math.max(scale().k, MID)));
    }
  });

  /* ---- find, and What's new's places ---- */

  // On the window, before a framework's own submit listener (Primate draws the page again in place).
  win.addEventListener('submit', (e) => {
    const form = e.target;
    if (!map || !form.classList || !form.classList.contains('atlas-find')) return;
    const el = placeEl(String(new win.FormData(form).get('at') || ''));
    if (!el) return; // the server says no place is called that
    e.preventDefault();
    e.stopPropagation();
    frame(el);
    remember(el.getAttribute('data-tag'));
    const missed = form.closest('[data-atlas]') && form.closest('[data-atlas]').querySelector('.atlas-missed');
    if (missed) missed.remove();
    el.focus({ preventScroll: true });
  }, true);

  win.addEventListener('click', (e) => {
    if (!map || !plain(e)) return;
    const a = e.target.closest && e.target.closest('a[data-atlas-frame]');
    const el = a && placeEl(a.getAttribute('data-atlas-frame'));
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    frame(el);
    remember(el.getAttribute('data-tag'));
    if (map.svg.scrollIntoView) map.svg.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  }, true);

  return {
    start,
    /** Draws the view again for a new size: the names are placed again. */
    resize() { if (map) { map.declutteredAt = undefined; apply(); } },
    /** The map's SVG, or null when there's none. */
    get svg() { return map ? map.svg : null; },
    scale, fly, boxAt, placeEl, at, here, frame,
  };
}

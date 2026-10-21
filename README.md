# clientjs

Browser code that [streampack](https://github.com/streampack-dev/streampack)'s front ends share,
written once: [ui-pudl](https://github.com/streampack-dev/ui-pudl),
[ui-primate](https://github.com/streampack-dev/ui-primate) and whatever comes next. Before this,
each front end kept its own copy, kept matching the others by hand.

Each part is its own module, so a page loads only what it uses. They are plain JavaScript modules
with types (`.d.ts`), with no runtime dependencies and no build step. They draw nothing: each front
end keeps its own markup, styles and forms, and calls these for what must be the same everywhere.

| Part | What it does |
|---|---|
| [`anchors`](#anchors) | The passage of a post that a comment quotes (streampack#256): a selection to an anchor, an anchor back to a Range, and where callouts go. |
| [`annotate`](#annotate) | The comment-on-a-passage interface built on `anchors`: the button beside a selection, the quote in the form, and the callouts or markers, linked both ways. |
| [`atlas`](#atlas) | The Atlas map, moved about: zoom, pan, find, names that never overlap, pins, and framing a place. |
| [`zone`](#zone) | The reader's time zone: the `bcn-tz` cookie, times said again in it, and date fields moved to it, in each site's own words. |
| [`mermaid`](#mermaid) | An editor preview's Mermaid diagrams, drawn with Pele into the markup the API writes (streampack#252). |
| [`sections`](#sections) | Links to a post's sections (streampack#274): a bare `#name` finds its `section-` heading, and each heading gets a `#` link. |

These are the parts [ui-pudl#252](https://github.com/streampack-dev/ui-pudl/issues/252) planned.

## Using it in a front end

The package is `src/`. Releases are published to streampack's Nexus, which anyone can read.

- **A Node front end** routes the scope there in its `.npmrc`,
  `@streampack-dev:registry=https://nexus.streampack.dev/repository/npm-group/`, and depends on
  `"@streampack-dev/clientjs": "^0.1.0"`. It imports a part by its path:
  `import { anchorFrom } from "@streampack-dev/clientjs/anchors"`.
- **A front end serving static files** copies `src/` from a release's GitHub tag, and loads a part
  as a module: `<script type="module">import { anchorFrom } from "/vendor/clientjs/anchors.js"</script>`.

## anchors

A comment can quote the passage of the post that it is about. streampack stores the quote as an
anchor, a W3C Web Annotation [text quote selector](https://www.w3.org/TR/annotation-model/#text-quote-selector):
`{exact, prefix, suffix}`. It checks `exact` against the post's text, so the browser must make the
quote from the same text. This module does.

### The post's text

The text is what streampack's database function `html_text()` makes of the post's HTML:

- each of these elements is a space at its start and its end: `p br hr li ul ol dl dt dd h1`–`h6
  div pre blockquote table thead tbody tr td th figure figcaption section article aside header
  footer details summary`;
- every other element adds nothing, but its text stays. So `<em>x</em>.` is `x.`, and a `<button>`
  inside a code block runs into the code;
- entities are decoded (the DOM has already done this);
- each run of whitespace is one space, and there is no space at either end. Whitespace is what
  PostgreSQL's `\s` matches in the en_US.utf8 locale (ASCII whitespace, U+1680, U+2000–U+2006,
  U+2008–U+200A, U+2028, U+2029, U+205F and U+3000), and U+00A0, which the stored HTML writes as
  `&nbsp;`. U+2007, U+202F, U+200B and U+FEFF are not whitespace.

`test/fixtures/text.json` holds HTML and the text that `html_text()` makes of it. It was made by
running that function in PostgreSQL 18, not written by hand. If the server's rules change, make it
again the same way, and the tests say what moved.

The root is the element that holds the post's HTML and nothing else. If the front end adds to it,
such as a code block's copy button or a heading's link, leave that out with
`{ ignore: ".copy, .heading-link" }`. Otherwise the text won't match the server's.

### Functions

| Function | Gives |
|---|---|
| `anchorFrom(range, root, options?)` | `{anchor}` for a selection, or `{refused: "empty"}`, or `{refused: "too-long", length}` when the quote is over 500 characters. The prefix and suffix are up to 64 characters each, or null at the post's ends. |
| `locate(entries, root, options?)` | For anchored comments `[{id, anchor}]`: `found`, each passage once in the post's order with the `ids` that quote it, its `start` and `end` in the text and a `range`; and `orphans`, the ids whose quote is no longer in the post. Repeats are chosen by the prefix and suffix. |
| `rangeFor(anchor, root, options?)` | A `Range` over one anchor's passage, or null. |
| `place(items, options?)` | Where each callout goes in the margin, so that none overlap: given `[{key, top, height}]`, each callout's `top` and how far it moved down (`shift`). It uses numbers only: measure, call this, then draw. `options.gap` (8) and `options.top` (0). |
| `mark(ranges, name?)` | Marks passages with the CSS Custom Highlight API, styled with `::highlight(comment-anchor)`. False where the browser has no such API; draw your own mark then. `unmark(name?)` removes them. |
| `textOf(root, options?)`, `textModel(root, options?)`, `collapse(value)` | The post's text; the text with each character's DOM position; a string's whitespace collapsed the same way. |

### An example

```js
import { anchorFrom, locate, mark, place } from "@streampack-dev/clientjs/anchors";

const body = document.querySelector(".post-body");

// Writing: the selection becomes the comment's anchor.
const made = anchorFrom(getSelection().getRangeAt(0), body);
if (made.anchor) form.anchor = made.anchor;
else if (made.refused === "too-long") say(`Select at most 500 characters (this is ${made.length}).`);

// Reading: anchored comments, from the API's thread, become marks and callouts.
const anchored = thread.comments.filter((c) => c.anchor && c.anchorFound);
const { found } = locate(anchored.map((c) => ({ id: c.id, anchor: c.anchor })), body);
mark(found.map((p) => p.range));
const spots = place(found.map((p) => ({
  key: p.ids[0],
  top: p.range.getBoundingClientRect().top - margin.getBoundingClientRect().top,
  height: calloutFor(p).offsetHeight,
})));
```

## annotate

The interface for comments on a passage, on top of `anchors`. A site calls `annotate(options)`
once, with its selectors, then `setUp(container)` for each post shown (a page, a window), as
often as it likes.

- **Writing.** A selection in the post's body shows `.anchor-ask` beside it. Its
  `button[data-anchor-ask]` keeps the selection when pressed, stays offered while focused from
  the keyboard, fills the form's `[data-anchor-field]` inputs, shows `[data-comment-quote]`, and
  moves focus to the textarea. `[data-comment-quote-remove]` takes the quote out. A selection
  that's empty or too long goes to `refuse(container, message)`, which is called with `""` when
  the offer goes.
- **Reading.** Each top-level comment's `.comment-anchor-data` (`data-exact`, `data-prefix`,
  `data-suffix`, `data-found`) is found in the body and marked. With `marginRem` (16) of room to the
  right of the container, the passages get callouts in an `.anchor-margin` beside it, placed level
  and apart; without it, a `button.anchor-marker` follows each passage's block. Callouts, markers
  and comments link to one another, and focus moves without changing the address. The container
  never moves for them.
- **Long comments.** A callout shows its comments whole when it ends before the next callout's own
  place (or the margin's end). Otherwise each long comment is cut at a word, near 140 characters,
  with "…"; its link's `title` holds the whole text, and an `a.anchor-callout-more` ("Read the
  rest") after it goes to the comment. A `title` doesn't show on touch or keyboard focus, so the
  visible link is what says the text was cut.

| Option | What it is |
|---|---|
| `container` | A post's container: holds the body, comments and form (`position: relative`). |
| `body` | The post's body, within the container. |
| `comment` | A top-level comment (`id="comment-<id>"`), within the container. |
| `form` | The new-comment form, within the container. |
| `meta`, `author` | A comment's meta line, where "Show the passage" goes, and its author's name. |
| `ignore` | What the site adds to the body that isn't its text. `.anchor-marker` and `.section-link` are always left out. |
| `marginRem`, `linkClass`, `refuse`, `document` | The room callouts need, classes for the links, how a refusal is shown, and the document. |

```js
import { annotate } from "@streampack-dev/clientjs/annotate";

const passages = annotate({
  container: ".post-article", body: ":scope > [data-anchor-body]",
  comment: ".comment-list > article.comment", form: "form.comment-form",
  meta: ":scope > .meta", author: ":scope > .meta .comment-author",
  refuse: (post, message) => { post.querySelector("[data-anchor-note]").textContent = message; },
});
document.querySelectorAll(".post-article").forEach(passages.setUp);
```

## atlas

The servers draw the Atlas as SVG: `[data-atlas] svg.atlas-map`, with a `viewBox` and the whole
map's box in `data-world`. Each place is `a.place[data-tag][data-x][data-y]`, each pin `a.pin`
in a `g.pins[data-for]`, and each region name `text.region-name[data-size]`. Without script it's a
picture with links in it. `atlas(options)` sets up the listeners once and returns a controller;
call `start()` when a map is shown, `start(true)` when the same map gets a new view, and
`resize()` for a new size.

- **Zoom:** the wheel, a pinch, and `[data-atlas-zoom="in"|"out"|"fit"]`, between `MIN_K` and
  `MAX_K` pixels a unit. `--u` on the SVG is one screen pixel in world units, and `data-zoom`
  (`far`, `mid`, `near`), `data-tiny` and `data-close` say how much shows.
- **Pan:** a drag. A drag never follows the link it started on.
- **Names:** placed biggest region first at each zoom. One that would overlap is `.crowded`.
- **Places:** a click marks the place `.here` (and its pins) and calls `onChoose(place, event)`
  before the link is followed. Pointing at one shows its pins (`.shown`). Tabbing to one off
  screen brings it into view.
- **Find:** `form.atlas-find`'s `at` frames the place, focuses it, drops `.atlas-missed`, and
  sets `?at=` in the address, without a reload. A name not on the map is left to the server.
- **What's new:** `a[data-atlas-frame="<tag>"]` frames its place in place, and sets `?at=`.

The controller also gives a site `svg`, `scale()`, `fly(box)`, `boxAt(x, y, k)`, `placeEl(tag)`,
`at(place)`, `here(tag)` and `frame(place)` to build on (ui-pudl opens a place's window beside it).

```js
import { atlas } from "@streampack-dev/clientjs/atlas";

const map = atlas({ onChoose: (place) => console.log("going to", place.getAttribute("href")) });
map.start();
addEventListener("resize", () => map.resize());
```

## zone

The servers say times in the zone the `bcn-tz` cookie names, and in UTC without one. This puts the
browser's zone in the cookie, so the next page is said in it, and says again in it each time drawn
in another zone, so even a first visit reads local. Each site keeps its own wording, to match how
its server writes a time.

| Export | What it is |
|---|---|
| `browserZone()` | The browser's zone, such as `America/New_York`, or null. |
| `rememberZone(zone, doc)` | Puts it in `bcn-tz` for a year, unless it's there: the name as it is, not encoded, and only for names of letters, digits, `/`, `_`, `+` and `-`. |
| `localize(root, { zone, said, tooltip })` | Each `time[data-local]` gets `said(date, form, zone)` as its text (`form` is its `data-local` value), each `time[data-local-title]` gets `tooltip(date, zone)` as its title, and each date field is moved to the zone. Each is marked `data-local-zone` and skipped after, so a server can mark the times it already drew in the reader's zone. |
| `parts(date, options, zone)`, `wallClock(date, zone)`, `zoneName(date, zone)` | A date's parts in a zone, its datetime-local value (`2026-10-20T10:30`), and the zone's short name (`EDT`), for a site's wording. |

A date field shown in another zone is `<input type="datetime-local" data-zone-field="<name>"
data-instant="<UTC instant>">`, where `<name>` is the form's hidden input that carries the zone it's
read in, with `[data-zone-label="<the field's id>"]` saying that zone. The field moves to this zone's
clock, unless the reader has typed in it (its value no longer matches `data-shown`), and the hidden
input says this zone, so what's saved is what the reader saw.

```js
import { browserZone, localize, rememberZone, zoneName } from "@streampack-dev/clientjs/zone";

const zone = browserZone() || "UTC";
rememberZone(zone);
localize(document, { zone, said: (date, form, z) => `${date.toLocaleString("en-US", { timeZone: z })} ${zoneName(date, z)}` });
```

## mermaid

streampack draws a published post's Mermaid diagrams when the post is saved, with [Pele](https://pele.run), and
stores the drawing in the post's HTML. An editor's preview is rendered by the front end, so its
```` ```mermaid ```` blocks are still code. This module draws them the same way: the same Pele
options (links and images off, the same limits), the same fonts (IBM Plex Sans and Mono, waited for
so labels are measured in them), and the same markup, which streampack's
[`docs/reference/diagram-html.md`](https://github.com/streampack-dev/streampack/blob/main/docs/reference/diagram-html.md)
describes:

- a drawn diagram is `<figure class="mermaid">` with the SVG, and the source in a closed `<details>`;
- a refused one is `<figure class="mermaid mermaid-refused">` with the source and a caption,
  "This diagram wasn't drawn: …", in the words the API uses.

Pele isn't a dependency: pass it in, at the version streampack bundles. Finding the preview's
blocks, and noticing new ones, stays the front end's.

| Export | What it is |
|---|---|
| `draw(blocks, loadPele, { bodyOf, prefix })` | Draws the `code.language-mermaid` blocks, each replacing its `<pre>`. `loadPele` is called once there's a block. Blocks are claimed (`data-mermaid="pending"`) so a second call doesn't take them; past 50 in one body (`bodyOf`) they're `skipped`; if Pele won't load they're `unavailable`. Ids start with `prefix` (`preview`). |
| `figureFor(pele, source, idPrefix, doc)` | One diagram's figure, drawn or refused. |
| `reason(error)` | Pele's error as the API's one line. |
| `fontsReady(doc)` | Waits for `FACES`; a face that won't load is skipped. |
| `OPTIONS`, `FACES`, `MAX_DIAGRAMS` | The API's Pele options, the eight Plex faces, and 50. |

```js
import { draw } from "@streampack-dev/clientjs/mermaid";

const blocks = document.querySelectorAll(".preview pre > code.language-mermaid:not([data-mermaid])");
draw(blocks, () => import("pele"), { bodyOf: (code) => code.closest(".preview") });
```

`test/fixtures/mermaid/published.html` is the API's own rendering of a drawn diagram and a refused
one, from streampack's `MermaidRenderer`; the tests check this module's figures have its shape and
its words. When streampack moves to a new Pele, move the dev dependency and the fixture together.

## sections

streampack gives each heading in a post an id that starts with `section-` (streampack#270), so no
heading can take the name of something else on the page, such as `#comments`. A reader who writes
`#going-nowhere` expects the heading "Going nowhere", which is `#section-going-nowhere`.

| Export | What it does |
|---|---|
| `sectionFor(hash, doc)` | The heading a bare name means, or null: null when the page has an element with that id, when the name is already a section's id, and when no section has it. |
| `reach(win)` | Goes to that heading, and replaces the address with the heading's own (no new history entry), so `:target` applies and a copied address is the real one. |
| `follow(win)` | Calls `reach` on load and on each `hashchange`. Returns a function that stops it. |
| `link(body, { className, headings })` | Puts `<a class="section-link" href="#section-x" aria-label="Link to the section: …">#</a>` at the end of each `h2`, `h3` and `h4` with a section id. A heading that has its link is skipped. Returns how many it added. |

```js
import { follow, link, reach } from "@streampack-dev/clientjs/sections";

follow(window);
// Each time a post's body is drawn:
link(body);
reach(window);
```

The site styles `.section-link`, for example shown only while its heading is hovered or the link
has focus. `annotate` always leaves `.section-link` out of a post's text, so comment anchors still
match the text the server makes. A site that reads the text with `anchors` itself passes
`ignore: ".section-link"`.

## Development

`just test` runs the tests (`node:test`, with jsdom for the DOM). `just coverage` reports coverage;
the target is 70% of lines. Real layout and real selections are tested in the front ends' browser
tests.

`just release [patch|minor|major]` releases from `main`: it bumps the version, points this README's
install line at it, tags it, pushes, and publishes to Nexus.

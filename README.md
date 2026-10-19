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

More parts are planned in [ui-pudl#252](https://github.com/streampack-dev/ui-pudl/issues/252):
Mermaid previews, the reader's time zone and the Atlas map.

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

## Development

`just test` runs the tests (`node:test`, with jsdom for the DOM). `just coverage` reports coverage;
the target is 70% of lines. Real layout and real selections are tested in the front ends' browser
tests.

`just release [patch|minor|major]` releases from `main`: it bumps the version, points this README's
install line at it, tags it, pushes, and publishes to Nexus.

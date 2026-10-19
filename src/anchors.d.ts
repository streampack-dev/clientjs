/** A comment's anchor, as streampack's API takes and gives it (streampack#256). */
export type Anchor = {
  /** The quoted text: 1 to MAX_EXACT characters of the post's text. */
  exact: string;
  /** Up to MAX_CONTEXT characters of the post's text just before the quote, or null. */
  prefix?: string | null;
  /** Up to MAX_CONTEXT characters of the post's text just after the quote, or null. */
  suffix?: string | null;
};

/** A boundary point, as a Range takes it: a node and an offset in it. */
export type Point = [Node, number];

/** Options for every function that reads a post's text. */
export type TextOptions = {
  /** A CSS selector for elements to leave out, with everything in them, such as a copy button. */
  ignore?: string;
};

/** The most characters (UTF-16 code units) that a quote can have: 500. */
export const MAX_EXACT: number;

/** The most characters that a prefix or a suffix can have: 64. */
export const MAX_CONTEXT: number;

/** The post's text as streampack's html_text() makes it, with each character's start and end. */
export function textModel(root: Node, options?: TextOptions): { text: string; starts: Point[]; ends: Point[] };

/** The post's text as streampack's html_text() makes it. */
export function textOf(root: Node, options?: TextOptions): string;

/** [value] with each run of whitespace one space, and no space at either end. */
export function collapse(value: string): string;

/** The anchor for a selection in the post, or why there is none. */
export function anchorFrom(
  range: Range,
  root: Node,
  options?: TextOptions,
): { anchor: { exact: string; prefix: string | null; suffix: string | null } } | { refused: "empty" } | { refused: "too-long"; length: number };

/** A passage that one or more comments quote. */
export type Passage = {
  /** The comments that quote it, in the order given. */
  ids: string[];
  /** Where it starts in the post's text. */
  start: number;
  /** Where it ends in the post's text (exclusive). */
  end: number;
  /** A Range over it. */
  range: Range;
};

/** Each comment's passage, grouped, in the order they occur; and the comments whose passage is gone. */
export function locate(
  entries: Array<{ id: string; anchor: Anchor }>,
  root: Node,
  options?: TextOptions,
): { found: Passage[]; orphans: string[] };

/** A Range over an anchor's passage, or null when the post doesn't hold it. */
export function rangeFor(anchor: Anchor, root: Node, options?: TextOptions): Range | null;

/** Where each callout goes so that none overlap: in the order given, with how far each moved down. */
export function place(
  items: Array<{ key: string; top: number; height: number }>,
  options?: { gap?: number; top?: number },
): Array<{ key: string; top: number; shift: number }>;

/** Marks passages with the CSS Custom Highlight API. False when the browser has no such API. */
export function mark(ranges: Iterable<Range>, name?: string): boolean;

/** Removes the marks made with this name. */
export function unmark(name?: string): void;

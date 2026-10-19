/** A site's selectors and choices, for annotate. */
export type AnnotateOptions = {
  /** A post's container: holds its body, comments and form; the button and callouts go in it. */
  container: string;
  /** The post's body, within the container. */
  body: string;
  /** A top-level comment, within the container (id `comment-<id>`). */
  comment: string;
  /** The new-comment form, within the container. */
  form: string;
  /** A comment's meta line, within the comment. */
  meta: string;
  /** A comment's author's name, within the comment. */
  author?: string;
  /** What the site adds to a body that isn't its text (`.anchor-marker` is always left out). */
  ignore?: string;
  /** The room, in rem, the callouts need to the right of the container: 16 if not given. */
  marginRem?: number;
  /** Classes added to "Show the passage" links. */
  linkClass?: string;
  /** Shows why a selection can't be quoted; called with "" when the offer goes away. */
  refuse?: (container: HTMLElement, message: string) => void;
  /** The document; the global one if not given. */
  document?: Document;
};

/** Sets up comments on a passage for a site; then `setUp` each post's container. */
export function annotate(options: AnnotateOptions): {
  /** Draws a post's marks and callouts or markers, and keeps them up to date. Safe to call again. */
  setUp(container: HTMLElement): void;
  /** Draws a post's again, on the next frame. */
  redraw(container: HTMLElement): void;
};

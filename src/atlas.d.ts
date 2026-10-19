/** A box of the world: its corner and size, in world units. */
export type Box = { x: number; y: number; w: number; h: number };

/** Pixels per world unit at which more of the map shows. */
export const NEAR: number;
export const MID: number;
export const TINY: number;
export const CLOSE: number;
/** The least and most pixels per world unit a zoom goes to. */
export const MIN_K: number;
export const MAX_K: number;

/** "x y w h" (spaces or commas) as a box, or null. */
export function parseBox(s: string | null): Box | null;

/** Whether two rectangles overlap, with pad to spare. */
export function overlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  pad?: number,
): boolean;

/** The Atlas's map, moved about: the controller a site starts and builds on. */
export type Atlas = {
  /** Starts on the page's map, if any; force starts again on the same one. */
  start(force?: boolean): void;
  /** Draws the view again for a new size. */
  resize(): void;
  /** The map's SVG, or null. */
  readonly svg: SVGSVGElement | null;
  /** Pixels per world unit, and the SVG's rectangle. */
  scale(): { k: number; r: DOMRect };
  /** Moves the view to a box, eased, or at once with reduced motion. */
  fly(to: Box): void;
  /** A box at the map's aspect, centred on (x, y), at k pixels a unit. */
  boxAt(x: number, y: number, k: number): Box;
  /** The place called tag (any case), or null. */
  placeEl(tag: string | null): SVGAElement | null;
  /** A place's point in the world. */
  at(el: Element): { x: number; y: number };
  /** Marks the place as the one in hand. */
  here(tag: string): void;
  /** Frames a place close up and marks it. */
  frame(el: Element): void;
};

/** Sets up the Atlas for a site: the listeners, once; then start() when a map is shown. */
export function atlas(options?: {
  /** A place or pin clicked, not dragged, before its link is followed. */
  onChoose?: (place: Element, event: MouseEvent) => void;
  document?: Document;
}): Atlas;

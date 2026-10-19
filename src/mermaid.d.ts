/** Pele, as a site loads it: what clientjs calls. */
export type Pele = { render(source: string, options: object): { svg: string } };

/** Pele's options, as the API calls it: links and images off, the same limits, IBM Plex. */
export const OPTIONS: Readonly<{
  limit: number;
  outputLimit: number;
  links: false;
  images: false;
  fontFamily: string;
  fontFamilyMono: string;
}>;

/** The faces the API measures labels in, which the browser must measure them in too. */
export const FACES: readonly string[];

/** The most diagrams drawn in one body: 50, as the API draws in one post. */
export const MAX_DIAGRAMS: number;

/** Waits for the faces in FACES; a face that won't load is skipped. */
export function fontsReady(doc?: Document): Promise<void>;

/** Pele's error as one line, as the API gives it. */
export function reason(error: unknown): string;

/** The figure for one diagram: drawn (`figure.mermaid`), or refused (`figure.mermaid.mermaid-refused`). */
export function figureFor(pele: Pele, source: string, idPrefix: string, doc?: Document): HTMLElement;

/** Draws the blocks (`code.language-mermaid` in a `pre`), each replaced by its figure. */
export function draw(
  blocks: Iterable<HTMLElement>,
  loadPele: () => Promise<Pele>,
  options?: { bodyOf?: (code: HTMLElement) => Element | null; prefix?: string },
): Promise<void>;

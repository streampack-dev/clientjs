/** What every section's id starts with, as streampack makes it: "section-". */
export const PREFIX: string;

/** The class of each heading's link: "section-link". */
export const LINK_CLASS: string;

/** The heading a bare name in an address means (section-<name>), or null. */
export function sectionFor(hash: string, doc?: Document): HTMLElement | null;

/** Goes to the section the address names by its bare name, replacing the address with its own. */
export function reach(win?: Window): boolean;

/** Calls reach on load and on each hashchange; returns a function that stops it. */
export function follow(win?: Window): () => void;

/** Puts a # link to its own id at the end of each section heading; returns how many it added. */
export function link(body: ParentNode, options?: { className?: string; headings?: string }): number;

/** A network a post can be shared to: its id, its name, and its share page for a text and an address. */
export interface Network {
  readonly id: string;
  readonly name: string;
  page(text: string, url: string): string;
}

/** The networks, in menu order: X, LinkedIn, Facebook. */
export const NETWORKS: ReadonlyArray<Network>;

/** "From BCN:", the dek, and the address, a blank line between each; without a dek, no dek. */
export function shareText(post: { dek?: string | null; url: string }, options?: { from?: string }): string;

/** The network with the id, or null. */
export function network(id: string): Network | null;

/** The network's share page for the text and the address; throws for an unknown id. */
export function pageFor(id: string, text: string, url: string): string;

/** Starts copying the text, opens the page in a new tab, and resolves to whether it copied. */
export function shareTo(page: string, text: string, win?: Window): Promise<boolean>;

/** Makes each a[data-share-to] in a [data-share] copy its [data-share-text] and open its href; returns a stop function. */
export function wire(
  root: Document | Element,
  options?: { onShare?: (result: { network: string; copied: boolean; text: string }) => void },
): () => void;

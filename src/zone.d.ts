/** The cookie the servers read the reader's zone from: "bcn-tz". */
export const COOKIE: string;

/** The browser's time zone, such as "America/New_York", or null if it won't say. */
export function browserZone(): string | null;

/** Puts the zone in the bcn-tz cookie, raw, unless it's there; true when the cookie says it now. */
export function rememberZone(zone: string | null, doc?: Document): boolean;

/** The date's parts in the zone, by type, as Intl.DateTimeFormat (en-US) gives them. */
export function parts(date: Date, options: Intl.DateTimeFormatOptions, zone: string): Record<string, string>;

/** The date on the zone's wall clock, as a datetime-local value: "2026-10-20T10:30". */
export function wallClock(date: Date, zone: string): string;

/** The zone's short name at the date, such as "EDT". */
export function zoneName(date: Date, zone: string): string;

/** Says again in the zone each time under root drawn in another, and moves date fields to it. */
export function localize(
  root: ParentNode,
  options: {
    zone: string;
    said: (date: Date, form: string, zone: string) => string;
    tooltip?: (date: Date, zone: string) => string;
  },
): void;

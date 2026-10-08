const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** An ISO datetime from the API in the viewer's locale and time zone. */
export function formatDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

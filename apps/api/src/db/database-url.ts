/** Postgres's own database, for statements that create or drop other databases. */
export const MAINTENANCE_DATABASE = 'postgres';

/** The URL of the named database on the server that serverUrl points at. */
export function databaseUrl(serverUrl: string, name: string): string {
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

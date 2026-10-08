/** A nullable database timestamp as the ISO string a contract expects. */
export function toIsoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

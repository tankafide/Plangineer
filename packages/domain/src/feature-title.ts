const TITLE_MAX = 80;

/** A feature's title: its description's first non-blank line, collapsed and cut to 80 characters. */
export function featureTitle(description: string): string {
  const line =
    description
      .split(/\r?\n/)
      .map((text) => text.trim())
      .find((text) => text.length > 0) ?? '';
  const title = line.replace(/\s+/g, ' ');
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX)}…` : title;
}

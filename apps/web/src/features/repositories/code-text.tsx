/**
 * Plain text whose backtick spans, such as a scan reason's "Found `react` in package.json",
 * render as code. Nothing else in the text is read as markup.
 */
export function CodeText({ text }: { text: string }) {
  return text.split(/(`[^`]+`)/).map((part, index) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
      <code key={index} className="font-mono text-xs">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

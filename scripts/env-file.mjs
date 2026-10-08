function formatValue(value) {
  return value.includes('\n') ? `"${value.replaceAll('\n', '\\n')}"` : value;
}

/** Replaces each key's line in a .env text, or appends it, and returns the text with LF endings. */
export function setEnvValues(text, values) {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${formatValue(value.replaceAll('\r\n', '\n'))}`;
    const index = lines.findIndex((existing) => existing.startsWith(`${key}=`));
    if (index === -1) lines.push(line);
    else lines[index] = line;
  }
  return `${lines.join('\n')}\n`;
}

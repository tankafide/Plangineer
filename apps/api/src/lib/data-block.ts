/** A fenced block of data whose fence is longer than any backtick run inside it. */
export function dataBlock(value: string): string {
  const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${value}\n${fence}`;
}

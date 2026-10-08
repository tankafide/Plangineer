/** File paths or names in mono, one per line, wrapping anywhere so a long path never overflows. */
export function PathList({ paths, label }: { paths: readonly string[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-0.5">
      {paths.map((path) => (
        <li key={path} className="font-mono text-xs break-all">
          {path}
        </li>
      ))}
    </ul>
  );
}

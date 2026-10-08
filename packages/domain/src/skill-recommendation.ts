import type { Recommendation } from '@plangineer/contracts';
import { BASELINE_CATALOG, type Signal } from './baseline-catalog.ts';

export interface RecommendInput {
  /** Every file path in the repository, with forward slashes. */
  paths: readonly string[];
  /** Dependency names read from the repository's package.json files. */
  dependencies: ReadonlySet<string>;
  existingSkillNames: ReadonlySet<string>;
}

type MatchSignal = Extract<Signal, { kind: 'match' }>;

/** The reason a match signal holds, checked in the order directories, file names, extensions, dependencies. */
function matchReason(signal: MatchSignal, input: RecommendInput): string | null {
  const segments = input.paths.map((path) => path.split('/'));
  const directory = signal.directories.find((name) =>
    segments.some((parts) => parts.slice(0, -1).includes(name)),
  );
  if (directory) return `Found a \`${directory}\` folder`;
  const fileName = signal.fileNames.find((name) => segments.some((parts) => parts.at(-1) === name));
  if (fileName) return `Found \`${fileName}\``;
  const extension = signal.extensions.find((ending) =>
    input.paths.some((path) => path.endsWith(ending)),
  );
  if (extension) return `Found \`${extension}\` files`;
  const dependency = signal.dependencies.find((name) => input.dependencies.has(name));
  if (dependency) return `Found \`${dependency}\` in package.json`;
  return null;
}

/** One recommendation per catalog skill the repository does not already have, in catalog order. */
export function recommendSkills(input: RecommendInput): Recommendation[] {
  return BASELINE_CATALOG.filter((entry) => !input.existingSkillNames.has(entry.name)).map(
    (entry) => {
      const reason =
        entry.signal.kind === 'always'
          ? 'Every repository needs it'
          : matchReason(entry.signal, input);
      return {
        name: entry.name,
        kind: entry.kind,
        recommended: reason !== null,
        required: entry.required,
        reason: reason ?? 'No signal found',
      };
    },
  );
}

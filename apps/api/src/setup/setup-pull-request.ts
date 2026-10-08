import type { RepositoryScan, SetupJob, SetupSelection } from '@plangineer/contracts';
import { catalogEntry } from '@plangineer/domain';

export const SETUP_PULL_REQUEST_TITLE = 'Set up Plangineer skills';

/** GitHub refuses a pull request body longer than this. */
export const PULL_REQUEST_BODY_MAX = 65_536;
const AUTHORING_NOTES_MAX = 10_000;
const DESCRIPTION_CELL_MAX = 80;
const OUTSIDE_PATHS_MAX = 20;

export interface SetupPullRequestInput {
  scan: RepositoryScan;
  selection: SetupSelection;
  job: SetupJob;
  /** The paths the push changed, which may be the first of more. */
  changedPaths: string[];
  changedPathCount: number;
  /** The setup run's final message, with each skill's sources and review findings. */
  finalMessage: string;
}

const KIND_LABEL = {
  fixed: 'Ships as written',
  template: 'Filled in from your code',
  generated: 'Written from your code',
} as const;

const cell = (text: string) =>
  text.slice(0, DESCRIPTION_CELL_MAX).replaceAll(/\r?\n/g, ' ').replaceAll('|', '\\|');

function table(header: [string, string], rows: [string, string][]): string[] {
  if (rows.length === 0) return ['None.'];
  return [
    `| ${header[0]} | ${header[1]} |`,
    '| --- | --- |',
    ...rows.map(([first, second]) => `| \`${first}\` | ${second} |`),
  ];
}

/** A fenced code block whose fence is longer than any backtick run in its text. */
function codeBlock(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

function changedOutsideSkills(input: SetupPullRequestInput): string[] {
  const outside = input.changedPaths.filter(
    (path) => !path.startsWith('.agents/skills/') && !path.startsWith('.claude/skills/'),
  );
  const mirror = input.changedPaths.some((path) => path.startsWith('.claude/skills/'));
  const lines = outside.slice(0, OUTSIDE_PATHS_MAX).map((path) => `- \`${path}\``);
  if (mirror) {
    lines.unshift('- `.claude/skills/`: the mirror `plangineer-runner skills sync` generates');
  }
  const unlisted =
    input.changedPathCount -
    input.changedPaths.length +
    Math.max(0, outside.length - OUTSIDE_PATHS_MAX);
  if (unlisted > 0) lines.push(`- And ${unlisted} more changed paths`);
  return lines.length === 0 ? ['None.'] : lines;
}

/**
 * The setup pull request's body. The authoring notes are the agent's own text, so they sit in a
 * fenced code block, where GitHub renders no link, image or mention.
 */
export function renderSetupPullRequestBody(input: SetupPullRequestInput): string {
  const { scan, selection, job } = input;
  const added = selection.addSkills.flatMap((name) => {
    const entry = catalogEntry(name);
    return entry === undefined ? [] : [[name, KIND_LABEL[entry.kind]] as [string, string]];
  });
  const reused = scan.skills
    .filter((skill) => selection.reuseSkills.includes(skill.name))
    .map((skill): [string, string] => [skill.name, cell(skill.description ?? 'No description')]);
  const notes = input.finalMessage.slice(0, AUTHORING_NOTES_MAX);
  const body = [
    'This pull request adds the agent skills Plangineer runs its workflow with: the orchestrators that plan, implement and review a change, and the rule skills they route to. Merge it to let Plangineer plan and build features in this repository.',
    '',
    '## Skills added',
    '',
    ...table(['Skill', 'Source'], added),
    '',
    '## Existing skills the orchestrators route to',
    '',
    ...table(['Skill', 'Description'], reused),
    '',
    '## Skills moved unchanged from `.claude/skills/` to `.agents/skills/`',
    '',
    ...(job.moveSkills.length === 0 ? ['None.'] : job.moveSkills.map((name) => `- \`${name}\``)),
    '',
    '## Orchestrators written',
    '',
    ...(selection.orchestrators.length === 0
      ? ['None.']
      : selection.orchestrators.map((name) => `- \`${name}\``)),
    '',
    '## Files outside `.agents/skills/`',
    '',
    ...changedOutsideSkills(input),
    '',
    '## Reviewing the generated skills',
    '',
    'Skills marked "Filled in from your code" and "Written from your code" were drafted by an agent from this repository and public sources, then checked by a second agent. Read each one as you would any change: correct facts it got wrong, and cut rules your team does not follow. Edit the files under `.agents/skills/`, then run `npx plangineer-runner skills sync`.',
    '',
    '## Authoring notes',
    '',
    `The setup agent's final message${notes.length < input.finalMessage.length ? `, cut to ${AUTHORING_NOTES_MAX.toLocaleString('en-US')} characters` : ''}:`,
    '',
    codeBlock(notes),
    '',
  ].join('\n');
  // Every part is bounded, so only a broken bound reaches this.
  if (body.length > PULL_REQUEST_BODY_MAX)
    throw new Error('The setup pull request body is too long');
  return body;
}

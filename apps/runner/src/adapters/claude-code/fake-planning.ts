/**
 * The fake agent's planning turns, for runner tests, `pnpm runner:fake` and the planning journey.
 * It reads `.plangineer-task/inputs.md` as the API renders it and writes `output.json`.
 *
 * The inputs it parses, outside fenced blocks except where noted:
 *
 * - The first line is `# Planning inputs`.
 * - Sections start with `## <heading>`. A heading inside a fenced block is data.
 * - `## Turn` holds the lines `Kind: <guided | section_action | revise_step>`, then
 *   `Section: <section>` and `Action: <expand | simplify | regenerate>` for a section action, or
 *   `Step: <step id>` for a step revision, each on its own line, fenced or not. The first line
 *   with each label counts, so the engineer's instruction after them cannot override one.
 * - `## Questions and answers` holds `None` when no question was answered, fenced or not.
 * - `## Current plan` holds the latest revision's body as JSON inside a fenced block, or `None`.
 *
 * The decisions setting comes from the settings block in the `--append-system-prompt-file` file.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type DraftStep,
  PLANNING_OUTPUT_MAX_BYTES,
  PlanBody,
  PlanningOutput,
  PlanningTurnKind,
  PlanSection,
  SectionAction,
  type SectionPatch,
  WorkflowSettings,
} from '@plangineer/contracts';
import { execa } from 'execa';

const TASK_DIR = '.plangineer-task';
const INPUTS_FILE = path.join(TASK_DIR, 'inputs.md');
const OUTPUT_FILE = path.join(TASK_DIR, 'output.json');
const INPUTS_TITLE = '# Planning inputs';

const SUFFIXES: Record<SectionAction, string> = {
  expand: ' (expanded)',
  simplify: ' (simplified)',
  regenerate: ' (regenerated)',
};

/** Each section's lines by heading, without fence lines, so fenced values read as plain lines. */
function inputSections(markdown: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let lines: string[] | null = null;
  let fence: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    if (fence !== null) {
      if (line.trimEnd() === fence) fence = null;
      else lines?.push(line);
      continue;
    }
    const opening = /^(`{3,})/.exec(line)?.[1];
    const heading = /^## (.+)$/.exec(line)?.[1];
    if (opening !== undefined) fence = opening;
    else if (heading !== undefined) sections.set(heading, (lines = []));
    else lines?.push(line);
  }
  return sections;
}

function section(sections: Map<string, string[]>, heading: string): string[] {
  const lines = sections.get(heading);
  if (lines === undefined) throw new Error(`The planning inputs have no ## ${heading} section`);
  return lines;
}

function turnField(turn: string[], key: string): string {
  const value = turn.map((line) => new RegExp(`^${key}: (.+)$`).exec(line)?.[1]).find(Boolean);
  if (value === undefined) throw new Error(`The ## Turn section has no ${key} line`);
  return value.trim();
}

function isNone(lines: string[]): boolean {
  return lines.join('\n').trim() === 'None';
}

function currentPlan(sections: Map<string, string[]>): PlanBody {
  const lines = section(sections, 'Current plan');
  if (isNone(lines)) throw new Error('This turn needs a current plan, and the inputs have none');
  return PlanBody.parse(JSON.parse(lines.join('\n')));
}

/** The decisions setting from the system prompt file's settings block. */
async function decisionsSetting(): Promise<WorkflowSettings['decisions']> {
  const flag = process.argv.indexOf('--append-system-prompt-file');
  const file = flag === -1 ? undefined : process.argv[flag + 1];
  if (file === undefined) throw new Error('A planning turn needs --append-system-prompt-file');
  const [label, json = ''] = (await readFile(file, 'utf8')).split(/\r?\n/);
  if (label !== 'Workflow settings:') throw new Error(`${file} holds no settings block`);
  return WorkflowSettings.parse(JSON.parse(json)).decisions;
}

function questionsOutput(): PlanningOutput {
  return {
    kind: 'questions',
    questions: [
      {
        section: 'goal',
        prompt: 'Which format should the export support first?',
        choices: [
          { label: 'PDF', detail: 'Matches what reviewers print today.' },
          { label: 'Markdown', detail: 'Cheaper, and pastes into pull requests.' },
        ],
        recommended: 0,
      },
    ],
    decisions: [
      {
        id: 'new-1',
        title: 'Reuse the current API',
        reason: 'It already serves plans.',
        by: 'agent',
      },
    ],
  };
}

const RENDER_STEP: DraftStep = {
  id: 'new-1',
  title: 'Render the export',
  files: ['src/export/render.ts'],
  body: 'Render the plan in the chosen format.',
  doneWhen: [{ id: 'new-2', text: 'A plan renders in the chosen format.' }],
};

const BUTTON_STEP: DraftStep = {
  id: 'new-3',
  title: 'Add the export button',
  files: ['src/export/export-button.tsx'],
  body: 'Add a button that downloads the export.',
  doneWhen: [{ id: 'new-4', text: 'The button downloads the export.' }],
};

/** A ready draft: two steps with files and done-when lines, every row ticked, no blockers. */
function planOutput(): PlanningOutput {
  return {
    kind: 'plan',
    plan: {
      goal: 'Let engineers export a plan.',
      prerequisites: [],
      steps: [RENDER_STEP, BUTTON_STEP],
      decisions: [
        { id: 'new-5', title: 'Render on the server', reason: 'Fonts match.', by: 'agent' },
      ],
      constraints: [],
      coverage: [
        { lineId: 'new-2', ticks: ['unit'] },
        { lineId: 'new-4', ticks: ['component'] },
      ],
      blockers: [],
      verification: { automated: ['pnpm verify'], agentChecks: [], humanChecks: [] },
    },
  };
}

function draftStep({ id, title, files, body, doneWhen }: PlanBody['steps'][number]): DraftStep {
  return { id, title, files, body, doneWhen };
}

/** The items with `change` applied to the first one. */
function changeFirst<T>(items: T[], change: (item: T) => T): T[] {
  return items.map((item, index) => (index === 0 ? change(item) : item));
}

/** The section with the suffix added to its first text. The test plan holds no text, so it stays. */
function sectionPatch(plan: PlanBody, name: PlanSection, suffix: string): SectionPatch {
  const retitle = <T extends { title: string }>(item: T): T => ({
    ...item,
    title: `${item.title}${suffix}`,
  });
  switch (name) {
    case 'goal':
      return { section: name, goal: `${plan.goal}${suffix}` };
    case 'prerequisites':
      return {
        section: name,
        prerequisites: changeFirst(plan.prerequisites, (item) => ({
          ...item,
          item: `${item.item}${suffix}`,
        })),
      };
    case 'steps':
      return { section: name, steps: changeFirst(plan.steps.map(draftStep), retitle) };
    case 'decisions':
      return { section: name, decisions: changeFirst(plan.decisions, retitle) };
    case 'constraints':
      return { section: name, constraints: changeFirst(plan.constraints, retitle) };
    case 'test_plan':
      return {
        section: name,
        coverage: plan.coverage.map(({ lineId, ticks }) => ({ lineId, ticks })),
      };
    case 'verification':
      return {
        section: name,
        verification: {
          ...plan.verification,
          automated: changeFirst(plan.verification.automated, (line) => `${line}${suffix}`),
        },
      };
    default: {
      const unhandled: never = name;
      throw new Error(`Unhandled plan section: ${String(unhandled)}`);
    }
  }
}

function revisedStep(plan: PlanBody, stepId: string): PlanningOutput {
  const step = plan.steps.find((candidate) => candidate.id === stepId);
  if (step === undefined) throw new Error(`The current plan has no step ${stepId}`);
  return { kind: 'step', step: { ...draftStep(step), title: `${step.title} (revised)` } };
}

/** The output the turn in the inputs calls for. */
async function turnOutput(inputs: string): Promise<PlanningOutput> {
  const sections = inputSections(inputs);
  const turn = section(sections, 'Turn');
  const kind = PlanningTurnKind.parse(turnField(turn, 'Kind'));
  switch (kind) {
    case 'guided': {
      const answered = !isNone(section(sections, 'Questions and answers'));
      const mayAsk = (await decisionsSetting()) === 'ask';
      return !answered && mayAsk ? questionsOutput() : planOutput();
    }
    case 'section_action': {
      const name = PlanSection.parse(turnField(turn, 'Section'));
      const suffix = SUFFIXES[SectionAction.parse(turnField(turn, 'Action'))];
      return { kind: 'section', patch: sectionPatch(currentPlan(sections), name, suffix) };
    }
    case 'revise_step':
      return revisedStep(currentPlan(sections), turnField(turn, 'Step'));
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled planning turn kind: ${String(unhandled)}`);
    }
  }
}

/** Whether the working folder holds planning inputs, so the run is a planning turn. */
export async function isPlanningTurn(): Promise<boolean> {
  let inputs: string;
  try {
    inputs = await readFile(INPUTS_FILE, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
  return inputs.split(/\r?\n/, 1)[0] === INPUTS_TITLE;
}

/** Writes the output the inputs' turn calls for, checked against the output schema. */
export async function writePlanningOutput(): Promise<void> {
  const output = PlanningOutput.parse(await turnOutput(await readFile(INPUTS_FILE, 'utf8')));
  await writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));
}

/** Writes text that is not JSON. */
export function writeNotJson(): Promise<void> {
  return writeFile(OUTPUT_FILE, 'The plan is ready.\n');
}

/** Writes a valid questions output padded with whitespace past the size cap. */
export function writeTooBig(): Promise<void> {
  const padding = ' '.repeat(PLANNING_OUTPUT_MAX_BYTES);
  return writeFile(OUTPUT_FILE, `${JSON.stringify(questionsOutput())}${padding}`);
}

/** Writes a step output, which no guided turn may take. */
export function writeStep(): Promise<void> {
  return writeFile(OUTPUT_FILE, JSON.stringify({ kind: 'step', step: RENDER_STEP }));
}

/**
 * Makes the output file a link to a valid output beside it. Git writes the link from its index,
 * so the fake never creates one itself: Windows' Git writes a plain file holding the target's
 * name instead, which is not JSON, and the run fails either way.
 */
export async function writeLink(): Promise<void> {
  const target = 'linked-output.json';
  await writeFile(path.join(TASK_DIR, target), JSON.stringify(planOutput()));
  const blob = (await execa('git', ['hash-object', '-w', '--stdin'], { input: target })).stdout;
  const file = `${TASK_DIR}/output.json`;
  await execa('git', ['update-index', '--add', '--cacheinfo', `120000,${blob.trim()},${file}`]);
  await execa('git', ['checkout-index', '--force', '--', file]);
}

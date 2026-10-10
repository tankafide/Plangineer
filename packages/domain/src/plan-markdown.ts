import {
  type AcceptanceCriterion,
  CoverageColumn,
  type PlanBody,
  type PlanStep,
  type PlanVerification,
} from '@plangineer/contracts';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

const lineLabel = (stepNumber: number, lineIndex: number) =>
  `${stepNumber}${LETTERS.charAt(lineIndex)}`;

/** Each done-when line labelled with its step's number and a letter, such as `2a`, in plan order. */
export function acceptanceCriteria(body: PlanBody): AcceptanceCriterion[] {
  return body.steps.flatMap((step, stepIndex) =>
    step.doneWhen.map((line, lineIndex) => ({
      lineId: line.id,
      label: lineLabel(stepIndex + 1, lineIndex),
      text: line.text,
    })),
  );
}

const COLUMN_TITLES: Record<CoverageColumn, string> = {
  unit: 'Unit',
  integration: 'Integration',
  component: 'Component',
  end_to_end: 'End to end',
  agent_check: 'Agent check',
  human_check: 'Human check',
};

/** Text that sits inside one table cell: one line, with its pipes escaped. */
const cell = (text: string) => text.replaceAll(/\r?\n/g, ' ').replaceAll('|', '\\|');

const tableRow = (cells: string[]) => `| ${cells.join(' | ')} |`;

function prerequisitesSection(body: PlanBody): string[] {
  if (body.prerequisites.length === 0) return [];
  const rows = body.prerequisites.map((item) =>
    tableRow([cell(item.item), cell(item.who), item.status]),
  );
  return [
    '## Prerequisites',
    [tableRow(['Item', 'Who', 'Status']), tableRow(['---', '---', '---']), ...rows].join('\n'),
  ];
}

function stepSection(step: PlanStep, number: number): string[] {
  const files = step.files.map((file) => `\`${file}\``).join(', ');
  const lines = step.doneWhen.map((line, index) => `- ${lineLabel(number, index)}. ${line.text}`);
  return [
    `### ${number}. ${step.title}`,
    ...(files === '' ? [] : [`**Files:** ${files}`]),
    ...(step.body === '' ? [] : [step.body]),
    ...(lines.length === 0 ? [] : ['**Done when:**', lines.join('\n')]),
  ];
}

function decisionsSection(body: PlanBody): string[] {
  const items = body.decisions.map((decision) => `- **${decision.title}.** ${decision.reason}`);
  return ['## Decisions', ...(items.length === 0 ? [] : [items.join('\n')])];
}

function constraintsSection(body: PlanBody): string[] {
  if (body.constraints.length === 0) return [];
  const items = body.constraints.map(
    (constraint) =>
      `- **${constraint.title}.** Target: ${constraint.target} Check: ${constraint.check}`,
  );
  return ['## Constraints', items.join('\n')];
}

function testPlanSection(body: PlanBody): string[] {
  const labels = new Map<string, string>([
    ...acceptanceCriteria(body).map((criterion): [string, string] => [
      criterion.lineId,
      `${criterion.label}. ${criterion.text}`,
    ]),
    ...body.constraints.map((constraint): [string, string] => [constraint.id, constraint.title]),
  ]);
  const labelOf = (lineId: string) => {
    const label = labels.get(lineId);
    if (label === undefined) throw new Error(`Coverage row ${lineId} names no line`);
    return label;
  };
  const columns = CoverageColumn.options;
  const rows = body.coverage.map((row) => {
    const label = `${labelOf(row.lineId)}${row.stale ? ' (stale)' : ''}`;
    const ticks = columns.map((column) => (row.ticks.includes(column) ? '✓' : ''));
    return tableRow([cell(label), ...ticks]);
  });
  const table = [
    tableRow(['Line', ...columns.map((column) => COLUMN_TITLES[column])]),
    tableRow(['---', ...columns.map(() => ':-:')]),
    ...rows,
  ];
  return ['## Test plan', table.join('\n')];
}

function verificationSection(verification: PlanVerification): string[] {
  const groups: [string, string[]][] = [
    ['Automated', verification.automated],
    ['Agent checks', verification.agentChecks],
    ['Human checks', verification.humanChecks],
  ];
  return [
    '## Verification',
    ...groups
      .filter(([, items]) => items.length > 0)
      .flatMap(([title, items]) => [`**${title}**`, items.map((item) => `- ${item}`).join('\n')]),
  ];
}

/**
 * The body as Markdown in the plan-format order, for reading and for the revision diff.
 * Blockers are left out, since the readiness checklist shows them.
 */
export function planMarkdown(body: PlanBody): string {
  const blocks = [
    '## Goal',
    body.goal,
    ...prerequisitesSection(body),
    '## Steps',
    ...body.steps.flatMap((step, index) => stepSection(step, index + 1)),
    ...decisionsSection(body),
    ...constraintsSection(body),
    ...testPlanSection(body),
    ...verificationSection(body.verification),
  ];
  return `${blocks.join('\n\n')}\n`;
}

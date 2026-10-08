import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Orchestrator } from '@plangineer/contracts';
import { describe, expect, it } from 'vitest';
import { BASELINE_CATALOG, type Signal } from './baseline-catalog.ts';

const DOC = readFileSync(
  fileURLToPath(new URL('../../../docs/product/baseline-catalog.md', import.meta.url)),
  'utf8',
).replaceAll('\r\n', '\n');

/** The body rows of the Markdown table whose header row is exactly this. */
function tableRows(header: string): string[][] {
  const lines = DOC.split('\n');
  const start = lines.indexOf(header);
  expect(start, `table ${header}`).toBeGreaterThanOrEqual(0);
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(
      line
        .slice(1, -1)
        .split(' | ')
        .map((cell) => cell.trim()),
    );
  }
  return rows;
}

const code = (names: readonly string[]) => names.map((name) => `\`${name}\``);
const list = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;

/** The doc's text for a signal, such as "Directory `migrations`; file `schema.prisma`". */
function signalText(signal: Signal): string {
  if (signal.kind === 'always') return 'Always';
  const parts = [
    ['Directory', signal.directories],
    ['File', signal.fileNames],
    ['Extension', signal.extensions],
    ['Dependency', signal.dependencies],
  ] as const;
  return parts
    .filter(([, names]) => names.length > 0)
    .map(([label, names], index) => {
      const text = `${label} ${list(code(names))}`;
      return index === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
    })
    .join('; ');
}

const ORCHESTRATOR_NAMES: Record<string, Orchestrator> = {
  plan: 'plan-orchestrator',
  'plan review': 'plan-review-orchestrator',
  implementation: 'implementation-orchestrator',
  'implementation review': 'implementation-review-orchestrator',
};

function orchestrators(cell: string): Orchestrator[] {
  if (cell === 'all four') return Object.values(ORCHESTRATOR_NAMES);
  return cell.split(', ').map((name) => {
    const orchestrator = ORCHESTRATOR_NAMES[name];
    if (!orchestrator) throw new Error(`Unknown orchestrator ${name}`);
    return orchestrator;
  });
}

interface RoutingRow {
  skill: string | undefined;
  orchestrator: string;
}

const routingKey = (row: RoutingRow) => `${row.skill} ${row.orchestrator}`;
const sortRouting = <T extends RoutingRow>(rows: T[]) =>
  rows.toSorted((a, b) => routingKey(a).localeCompare(routingKey(b)));

describe('docs/product/baseline-catalog.md', () => {
  it('lists the catalog skills with their kinds, purposes, signals and required marks', () => {
    const rows = tableRows('| Name | Kind | Purpose | Signal | Required |');
    expect(rows).toEqual(
      BASELINE_CATALOG.map((entry) => [
        `\`${entry.name}\``,
        entry.kind,
        entry.purpose,
        signalText(entry.signal),
        entry.required ? '✓' : '',
      ]),
    );
  });

  it('lists the routing of every catalog skill with its "applies when" text', () => {
    const fromDoc = tableRows('| Skill | Orchestrator | Applies when |').flatMap(
      ([skill, cell, appliesWhen]) =>
        orchestrators(cell ?? '').map((orchestrator) => ({
          skill: skill?.replaceAll('`', ''),
          orchestrator,
          appliesWhen,
        })),
    );
    const fromCode = BASELINE_CATALOG.flatMap((entry) =>
      entry.routing.map(({ orchestrator, appliesWhen }) => ({
        skill: entry.name,
        orchestrator,
        appliesWhen,
      })),
    );
    expect(sortRouting(fromDoc)).toEqual(sortRouting(fromCode));
  });
});

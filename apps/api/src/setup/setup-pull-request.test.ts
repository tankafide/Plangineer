import { BASELINE_CATALOG } from '@plangineer/domain';
import { describe, expect, it } from 'vitest';
import { testScan, testSelection, testSetupJob } from '../test/setup-fixtures.ts';
import {
  PULL_REQUEST_BODY_MAX,
  renderSetupPullRequestBody,
  type SetupPullRequestInput,
} from './setup-pull-request.ts';

function input(overrides: Partial<SetupPullRequestInput> = {}): SetupPullRequestInput {
  return {
    scan: testScan(),
    selection: testSelection(),
    job: testSetupJob(),
    changedPaths: ['.agents/skills/testing/SKILL.md', '.gitattributes'],
    changedPathCount: 2,
    finalMessage: 'Done.',
    ...overrides,
  };
}

describe('renderSetupPullRequestBody', () => {
  it('lists the added skills with their kind, the files outside the skills and the notes', () => {
    const body = renderSetupPullRequestBody(
      input({
        selection: testSelection({
          addSkills: ['testing', 'backend'],
          orchestrators: ['plan-orchestrator'],
        }),
        changedPaths: [
          '.agents/skills/testing/SKILL.md',
          '.claude/skills/testing/SKILL.md',
          '.gitattributes',
          '.github/workflows/plangineer-skills.yml',
        ],
        changedPathCount: 4,
      }),
    );

    expect(body).toContain('| `testing` | Filled in from your code |');
    expect(body).toContain('| `backend` | Written from your code |');
    expect(body).toContain('- `plan-orchestrator`');
    expect(body).toContain('- `.gitattributes`');
    expect(body).toContain('- `.github/workflows/plangineer-skills.yml`');
    expect(body).toContain('`.claude/skills/`: the mirror');
    expect(body).toContain('```text\nDone.\n```');
  });

  it('stays under the GitHub limit for the largest setup, with the notes cut and fenced', () => {
    const skills = Array.from({ length: 200 }, (_, index) => ({
      name: `skill-${String(index).padStart(3, '0')}-${'x'.repeat(54)}`,
      description: 'd'.repeat(1_024),
      location: 'claude' as const,
    }));
    const body = renderSetupPullRequestBody(
      input({
        scan: testScan({ skills }),
        selection: testSelection({
          addSkills: BASELINE_CATALOG.map((entry) => entry.name),
          reuseSkills: skills.map((skill) => skill.name),
        }),
        job: testSetupJob({ moveSkills: skills.map((skill) => skill.name) }),
        finalMessage: 'm'.repeat(65_536),
      }),
    );

    expect(body.length).toBeLessThan(PULL_REQUEST_BODY_MAX);
    expect(body).toContain(`\`\`\`text\n${'m'.repeat(10_000)}\n\`\`\``);
    expect(body).not.toContain('m'.repeat(10_001));
  });

  it('keeps a final message with a run of six backticks inside its fence', () => {
    const body = renderSetupPullRequestBody(
      input({ finalMessage: 'Before\n``````\n[link](https://example.com) @someone' }),
    );

    expect(body).toContain(
      '```````text\nBefore\n``````\n[link](https://example.com) @someone\n```````',
    );
  });
});

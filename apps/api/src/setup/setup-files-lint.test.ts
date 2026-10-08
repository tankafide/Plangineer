import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Orchestrator } from '@plangineer/contracts';
import { BASELINE_CATALOG } from '@plangineer/domain';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testScan } from '../test/setup-fixtures.ts';
import { renderSetupFiles } from './setup-files.ts';

const RUNNER_CLI = fileURLToPath(new URL('../../../runner/src/cli.ts', import.meta.url));
const ORCHESTRATORS: Orchestrator[] = [
  'plan-orchestrator',
  'plan-review-orchestrator',
  'implementation-orchestrator',
  'implementation-review-orchestrator',
];

/** The smallest rule skill the lint accepts, standing in for one the agent writes. */
function generatedSkill(name: string): Record<string, string> {
  return {
    [`.agents/skills/${name}/SKILL.md`]: `---\nname: ${name}\ndescription: Rules for ${name}.\ndisable-model-invocation: true\n---\n\n# ${name}\n`,
    [`.agents/skills/${name}/agents/openai.yaml`]: 'policy:\n  allow_implicit_invocation: false\n',
  };
}

describe('rendered setup files', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'setup-lint-'));
  });

  afterEach(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));

  it("pass the runner's skills lint for a full selection", async () => {
    const rendered = renderSetupFiles(testScan(), {
      reuseSkills: [],
      addSkills: BASELINE_CATALOG.map((entry) => entry.name),
      orchestrators: ORCHESTRATORS,
    });
    const files: Record<string, string> = Object.fromEntries([
      ...rendered.files.map((file) => [file.path, file.content]),
      ...rendered.generateSkills.flatMap((name) => Object.entries(generatedSkill(name))),
    ]);
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(root, ...file.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }

    const result = await execa(process.execPath, [RUNNER_CLI, 'skills', 'lint'], {
      cwd: root,
      reject: false,
    });

    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });
});

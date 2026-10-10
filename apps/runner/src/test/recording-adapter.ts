import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentAccess, AgentAdapter } from '../adapters/agent-adapter.ts';
import { createClaudeCodeAdapter } from '../adapters/claude-code/claude-code-adapter.ts';
import { FAKE_CLAUDE_COMMAND } from './fake-agent.ts';

/** What the agent found when it started. */
export interface AgentStart {
  access: AgentAccess;
  /** The system prompt file, relative to the worktree with `/`, or null for none. */
  systemPromptFile: string | null;
  /** Each file under .plangineer-task, by its `/`-separated path, with its bytes. */
  taskFiles: Map<string, Buffer>;
}

function slashed(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join('/');
}

async function taskFiles(worktree: string): Promise<Map<string, Buffer>> {
  const root = path.join(worktree, '.plangineer-task');
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = new Map<string, Buffer>();
  for (const entry of entries.filter((candidate) => candidate.isFile())) {
    const file = path.join(entry.parentPath, entry.name);
    files.set(slashed(root, file), await readFile(file));
  }
  return files;
}

/** The fake agent, recording into `starts` each start's access and the task folder it finds. */
export function recordingAdapter(starts: AgentStart[]): AgentAdapter {
  const fake = createClaudeCodeAdapter(FAKE_CLAUDE_COMMAND);
  return {
    name: fake.name,
    detect: () => fake.detect(),
    async *run(job, signal) {
      starts.push({
        access: job.access,
        systemPromptFile:
          job.systemPromptFile === null ? null : slashed(job.cwd, job.systemPromptFile),
        taskFiles: await taskFiles(job.cwd),
      });
      yield* fake.run(job, signal);
    },
  };
}

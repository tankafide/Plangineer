import { STDERR_LINE_MAX, STDERR_TAIL_LINES } from '@plangineer/contracts';
import { execa, ExecaError } from 'execa';

const MAX_OUTPUT_BYTES = 1024 ** 3;

/** A git command that failed, with the last lines of its error output. */
export class GitError extends Error {
  readonly stderrTail: string[];

  constructor(args: readonly string[], stderr: string, options: ErrorOptions) {
    const tail = stderr
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .slice(-STDERR_TAIL_LINES)
      .map((line) => line.slice(0, STDERR_LINE_MAX));
    super(`git ${args.join(' ')} failed: ${tail.join('\n')}`, options);
    this.name = 'GitError';
    this.stderrTail = tail;
  }
}

function errorOutput(error: ExecaError): string {
  const stderr = error.stderr instanceof Uint8Array ? Buffer.from(error.stderr).toString() : '';
  return stderr.trim() === '' ? error.shortMessage : stderr;
}

async function run(cwd: string, args: readonly string[], input: string | undefined) {
  try {
    const result = await execa('git', args, {
      cwd,
      encoding: 'buffer',
      maxBuffer: MAX_OUTPUT_BYTES,
      env: { GIT_TERMINAL_PROMPT: '0' },
      ...(input === undefined ? {} : { input }),
    });
    return Buffer.from(result.stdout);
  } catch (error) {
    if (error instanceof ExecaError) throw new GitError(args, errorOutput(error), { cause: error });
    throw error;
  }
}

/**
 * Runs git in `cwd` with an argument array and no prompt for credentials, returning stdout
 * trimmed. Put `--end-of-options` before any ref in `args`.
 */
export async function git(cwd: string, args: readonly string[]): Promise<string> {
  return (await run(cwd, args, undefined)).toString('utf8').trim();
}

/** Runs git like `git`, with `input` on stdin, returning stdout as raw bytes. */
export function gitBytes(cwd: string, args: readonly string[], input: string): Promise<Buffer> {
  return run(cwd, args, input);
}

import { FAILURE_MESSAGE_MAX, type RunnerRunEventBody } from '@plangineer/contracts';

export type RunFailed = Extract<RunnerRunEventBody, { type: 'run.failed' }>;

/** A run's failure the runner found itself, with no exit code and its message cut to fit. */
export function runFailed(
  reason: RunFailed['reason'],
  message: string,
  stderrTail: string[] = [],
): RunFailed {
  return {
    type: 'run.failed',
    reason,
    message: message.slice(0, FAILURE_MESSAGE_MAX),
    exitCode: null,
    stderrTail,
  };
}

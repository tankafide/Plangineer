import type { RunEventBody, RunKind, RunnerRunEventBody } from '@plangineer/contracts';

export type RunFailedBody = Extract<RunnerRunEventBody, { type: 'run.failed' }>;

export function protocolError(message: string): RunFailedBody {
  return { type: 'run.failed', reason: 'protocol_error', message, exitCode: null, stderrTail: [] };
}

/**
 * Why an event cannot be appended to this run, or undefined when the status rules decide. A
 * pre-planning run's answer becomes its context file, so a blank or truncated one is refused. A
 * planning run sends exactly one planning.output, before its run.succeeded.
 */
export function kindMismatch(
  kind: RunKind,
  body: RunEventBody,
  hasPlanningOutput: boolean,
): string | undefined {
  if (body.type === 'setup.pushed' && kind !== 'setup') {
    return `The runner sent setup.pushed for a ${kind} run.`;
  }
  if (body.type === 'planning.output') {
    if (kind !== 'planning') return `The runner sent planning.output for a ${kind} run.`;
    if (hasPlanningOutput) return 'The runner sent a second planning.output.';
  }
  if (body.type === 'run.succeeded' && kind === 'planning' && !hasPlanningOutput) {
    return 'The runner sent run.succeeded for a planning run with no planning.output.';
  }
  if (
    body.type === 'run.succeeded' &&
    kind === 'pre_planning' &&
    (body.truncated || body.resultText.trim() === '')
  ) {
    return 'The runner sent a blank or truncated answer for a pre-planning run.';
  }
  return undefined;
}

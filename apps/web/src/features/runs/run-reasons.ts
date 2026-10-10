import type { RunCancelReason, RunFailureReason } from '@plangineer/contracts';

export const FAILURE_REASON_LABELS: Record<RunFailureReason, string> = {
  agent_error: 'The agent reported an error',
  exit_code: 'The agent exited without a result',
  invalid_output: 'The agent wrote output the runner could not read',
  plan_limit: 'The Claude plan limit was reached',
  cli_unavailable: 'Claude Code is not available on the runner',
  checkout_failed: 'The repository could not be checked out',
  skills_drift: 'The skills mirror is out of sync',
  lease_lost: 'The runner lost the run',
  runner_stopped: 'The runner stopped',
  protocol_error: 'The runner sent an event out of order',
  event_buffer_full: 'The runner could not send its events in time',
  timeout: 'The run took too long',
  setup_invalid_output: 'The setup output broke a skill rule',
  setup_publish_failed: 'The setup branch could not be pushed',
  skill_missing: 'The repository has no codebase-exploration skill',
  attachment_failed: 'An attachment could not be downloaded',
};

export const CANCEL_REASON_LABELS: Record<RunCancelReason, string> = {
  requested: 'Cancelled on request',
  runner_revoked: 'Cancelled because its runner was revoked',
};

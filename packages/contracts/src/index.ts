import { meGet } from './me.ts';
import { runCancel, runCreate, runGet, runList } from './run.ts';
import { runnerCreatePairingCode, runnerList, runnerPair, runnerRevoke } from './runner.ts';

export { MeGetOutput, UserRole } from './me.ts';
export { PageInput } from './pagination.ts';
export {
  GitRef,
  PermissionMode,
  Repository,
  Run,
  RunCancelReason,
  RunCreateInput,
  RunFailureReason,
  RunStatus,
  RunSummary,
  RUN_PROMPT_MAX,
  TERMINAL_RUN_STATUSES,
} from './run.ts';
export {
  AGENT_NAME_MAX,
  AGENT_TEXT_MAX,
  FAILURE_MESSAGE_MAX,
  isTerminalRunEvent,
  RateLimitStatus,
  RUN_EVENTS_PATH,
  RunEvent,
  RunEventBody,
  RunEventType,
  runEventsPath,
  RunnerRunEventBody,
  SKILL_NAME_MAX,
  SKILLS_MAX,
  STDERR_LINE_MAX,
  STDERR_TAIL_LINES,
  TERMINAL_RUN_EVENT_TYPES,
} from './run-event.ts';
export {
  CLAUDE_CODE_MIN_VERSION,
  CliStatus,
  PAIRING_CODE_PATTERN,
  Runner,
  RunnerPlatform,
  RunnerStatus,
} from './runner.ts';
export {
  MAX_ACTIVE_RUNS,
  MAX_EVENTS_MESSAGE_BYTES,
  MAX_EVENTS_PER_MESSAGE,
  MAX_SOCKET_MESSAGE_BYTES,
  RunJob,
  RunnerSocketClose,
  RunnerToServerMessage,
  ServerToRunnerMessage,
} from './runner-protocol.ts';

export const contract = {
  me: { get: meGet },
  runner: {
    createPairingCode: runnerCreatePairingCode,
    pair: runnerPair,
    list: runnerList,
    revoke: runnerRevoke,
  },
  run: { create: runCreate, get: runGet, list: runList, cancel: runCancel },
};

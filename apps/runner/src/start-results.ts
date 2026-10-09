import type { CommandResult } from './command-result.ts';
import type { SocketFatal } from './connection/control-plane-socket.ts';

/** What `start` ends with. Exit code 3 means the runner must be paired before it can run. */
export const STOPPED: CommandResult = { exitCode: 0, message: 'Runner stopped.' };

export const NOT_PAIRED: CommandResult = {
  exitCode: 3,
  message: 'This runner is not paired. Run plangineer-runner login --server <url> first.',
};

export const FATAL_RESULTS: Record<SocketFatal['kind'], CommandResult> = {
  revoked: {
    exitCode: 3,
    message:
      'This runner was revoked or its token is invalid. Pair it again with plangineer-runner login.',
  },
  replaced: {
    exitCode: 1,
    message:
      'Another runner process using this pairing took over. Stop that process, or pair this machine as a second runner.',
  },
  protocol: {
    exitCode: 1,
    message: 'The runner and the control plane disagree on the protocol, so the runner stopped.',
  },
};

/** The result that sends the runner to pair with `serverUrl`, or null when it is paired there. */
export function otherServer(pairedUrl: string, serverUrl: string | null): CommandResult | null {
  if (serverUrl === null) return null;
  const paired = new URL(pairedUrl).origin;
  const requested = new URL(serverUrl).origin;
  if (paired === requested) return null;
  return {
    exitCode: 3,
    message: `This runner is paired with ${paired}, not ${requested}. Pair it again with plangineer-runner login --server ${serverUrl}.`,
  };
}

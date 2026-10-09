import { setTimeout as sleep } from 'node:timers/promises';
import { createORPCClient, ORPCError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { SimpleCsrfProtectionLinkPlugin } from '@orpc/client/plugins';
import type { ContractRouterClient } from '@orpc/contract';
import { ResponseValidationPlugin } from '@orpc/contract/plugins';
import {
  contract,
  RUNNER_LOGIN_MESSAGE_MAX,
  type RunnerLoginEvent,
  RunnerPlatform,
} from '@plangineer/contracts';
import type { CommandResult } from './command-result.ts';
import { writeCredentials } from './config/runner-credentials.ts';
import type { RunnerEnv } from './config/runner-env.ts';
import { runnerPaths } from './config/runner-paths.ts';

export interface LoginOptions {
  serverUrl: string;
  name: string;
  /** Whether to open the approval link in the browser. */
  openBrowser: boolean;
  /** Prints one `RunnerLoginEvent` per line and nothing else, and never opens the browser. */
  json: boolean;
}

/** Opens a URL in the default browser, rejecting when none can be launched. */
export type OpenUrl = (url: string) => Promise<unknown>;

type LoginClient = ContractRouterClient<typeof contract>;
type StartedLogin = Awaited<ReturnType<LoginClient['runner']['startLogin']>>;

/** How `login` tells the person, or the program that runs it, how pairing goes. */
interface LoginReport {
  started(login: StartedLogin): void;
  paired(runnerId: string): CommandResult;
  failed(message: string): CommandResult;
}

function textReport(name: string): LoginReport {
  return {
    started({ approveUrl, userCode }) {
      process.stdout.write(`To pair this machine, approve it in Plangineer: ${approveUrl}\n`);
      process.stdout.write(`Code: ${userCode}\n`);
    },
    paired: () => ({
      exitCode: 0,
      message: `Paired as ${name}. Start the runner with plangineer-runner start.`,
    }),
    failed: (message) => ({ exitCode: 1, message }),
  };
}

function printEvent(event: RunnerLoginEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

const jsonReport: LoginReport = {
  started({ userCode, approveUrl, expiresAt }) {
    printEvent({ event: 'login_started', userCode, approveUrl, expiresAt });
  },
  paired(runnerId) {
    printEvent({ event: 'paired', runnerId });
    return { exitCode: 0, message: null };
  },
  failed(message) {
    printEvent({ event: 'failed', message: message.slice(0, RUNNER_LOGIN_MESSAGE_MAX) });
    return { exitCode: 1, message: null };
  },
};

function createClient(serverUrl: string): LoginClient {
  const link = new RPCLink({
    url: new URL('/rpc', serverUrl).href,
    plugins: [new SimpleCsrfProtectionLinkPlugin(), new ResponseValidationPlugin(contract)],
  });
  return createORPCClient(link);
}

/** The printed link stays usable when the browser does not open, so a failure is not an error. */
async function tryOpen(open: OpenUrl, url: string): Promise<void> {
  try {
    await open(url);
  } catch {
    // The link is already printed.
  }
}

/**
 * `login`: starts a login request, prints its approval link and polls until a signed-in member
 * approves it in the browser. The approving poll returns the runner token, stored in `runner.json`.
 */
export async function loginCommand(
  env: RunnerEnv,
  options: LoginOptions,
  open: OpenUrl,
): Promise<CommandResult> {
  const client = createClient(options.serverUrl);
  const report = options.json ? jsonReport : textReport(options.name);
  try {
    const started = await client.runner.startLogin({
      name: options.name,
      platform: RunnerPlatform.parse(process.platform),
    });
    report.started(started);
    if (options.openBrowser && !options.json) await tryOpen(open, started.approveUrl);

    for (;;) {
      await sleep(started.pollIntervalMs);
      const answer = await client.runner.pollLogin({ deviceSecret: started.deviceSecret });
      switch (answer.status) {
        case 'pending':
          break;
        case 'approved':
          await writeCredentials(runnerPaths(env.PLANGINEER_RUNNER_DATA_DIR).credentials, {
            serverUrl: new URL(options.serverUrl).origin,
            runnerId: answer.runnerId,
            token: answer.token,
          });
          return report.paired(answer.runnerId);
        case 'denied':
          return report.failed('The pairing was denied in Plangineer.');
        case 'expired':
          return report.failed('The pairing request expired. Run plangineer-runner login again.');
      }
    }
  } catch (error) {
    if (error instanceof ORPCError && error.code === 'TOO_MANY_REQUESTS') {
      return report.failed(
        'Too many pairing requests are waiting in Plangineer. Try again in a few minutes.',
      );
    }
    if (error instanceof Error) return report.failed(error.message);
    throw error;
  }
}

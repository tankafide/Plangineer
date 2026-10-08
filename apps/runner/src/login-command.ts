import { setTimeout as sleep } from 'node:timers/promises';
import { createORPCClient, ORPCError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { SimpleCsrfProtectionLinkPlugin } from '@orpc/client/plugins';
import type { ContractRouterClient } from '@orpc/contract';
import { ResponseValidationPlugin } from '@orpc/contract/plugins';
import { contract, RunnerPlatform } from '@plangineer/contracts';
import type { CommandResult } from './command-result.ts';
import { writeCredentials } from './config/runner-credentials.ts';
import type { RunnerEnv } from './config/runner-env.ts';
import { runnerPaths } from './config/runner-paths.ts';

export interface LoginOptions {
  serverUrl: string;
  name: string;
  /** Whether to open the approval link in the browser. */
  openBrowser: boolean;
}

/** Opens a URL in the default browser, rejecting when none can be launched. */
export type OpenUrl = (url: string) => Promise<unknown>;

function createClient(serverUrl: string): ContractRouterClient<typeof contract> {
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
  try {
    const started = await client.runner.startLogin({
      name: options.name,
      platform: RunnerPlatform.parse(process.platform),
    });
    process.stdout.write(`To pair this machine, approve it in Plangineer: ${started.approveUrl}\n`);
    process.stdout.write(`Code: ${started.userCode}\n`);
    if (options.openBrowser) await tryOpen(open, started.approveUrl);

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
          return {
            ok: true,
            message: `Paired as ${options.name}. Start the runner with plangineer-runner start.`,
          };
        case 'denied':
          return { ok: false, message: 'The pairing was denied in Plangineer.' };
        case 'expired':
          return {
            ok: false,
            message: 'The pairing request expired. Run plangineer-runner login again.',
          };
      }
    }
  } catch (error) {
    if (error instanceof ORPCError && error.code === 'TOO_MANY_REQUESTS') {
      return {
        ok: false,
        message: 'Too many pairing requests are waiting in Plangineer. Try again in a few minutes.',
      };
    }
    if (error instanceof Error) return { ok: false, message: error.message };
    throw error;
  }
}

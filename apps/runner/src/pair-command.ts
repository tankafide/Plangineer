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

const REJECTED_MESSAGE = 'That pairing code is invalid or expired. Create a new one in Plangineer.';

export interface PairOptions {
  serverUrl: string;
  code: string;
  name: string;
}

function createClient(serverUrl: string): ContractRouterClient<typeof contract> {
  const link = new RPCLink({
    url: new URL('/rpc', serverUrl).href,
    plugins: [new SimpleCsrfProtectionLinkPlugin(), new ResponseValidationPlugin(contract)],
  });
  return createORPCClient(link);
}

/** `pair`: exchanges a pairing code for a runner token and stores it in `runner.json`. */
export async function pairCommand(env: RunnerEnv, options: PairOptions): Promise<CommandResult> {
  const client = createClient(options.serverUrl);
  let paired: { runnerId: string; token: string };
  try {
    paired = await client.runner.pair({
      code: options.code,
      name: options.name,
      platform: RunnerPlatform.parse(process.platform),
    });
  } catch (error) {
    if (error instanceof ORPCError && error.code === 'PAIRING_CODE_REJECTED') {
      return { ok: false, message: REJECTED_MESSAGE };
    }
    throw error;
  }
  await writeCredentials(runnerPaths(env.PLANGINEER_RUNNER_DATA_DIR).credentials, {
    serverUrl: new URL(options.serverUrl).origin,
    runnerId: paired.runnerId,
    token: paired.token,
  });
  return {
    ok: true,
    message: `Paired as ${options.name}. Start the runner with pnpm runner start.`,
  };
}

import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { SimpleCsrfProtectionLinkPlugin } from '@orpc/client/plugins';
import type { ContractRouterClient } from '@orpc/contract';
import { ResponseValidationPlugin } from '@orpc/contract/plugins';
import { contract } from '@plangineer/contracts';

/** The window session's `fetch`, which sends the signed-in cookie. */
export type SessionFetch = (input: Request, init?: RequestInit) => Promise<Response>;

export type DesktopClient = ContractRouterClient<typeof contract>;

/** An oRPC client that calls the API as the user signed in to the app window. */
export function createDesktopClient(origin: string, fetch: SessionFetch): DesktopClient {
  const link = new RPCLink({
    url: new URL('/rpc', origin).href,
    fetch: (request, init) => fetch(request, init),
    plugins: [new SimpleCsrfProtectionLinkPlugin(), new ResponseValidationPlugin(contract)],
  });
  return createORPCClient(link);
}

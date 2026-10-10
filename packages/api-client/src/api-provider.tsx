import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { SimpleCsrfProtectionLinkPlugin } from '@orpc/client/plugins';
import type { ContractRouterClient } from '@orpc/contract';
import { ResponseValidationPlugin } from '@orpc/contract/plugins';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { contract } from '@plangineer/contracts';
import { createContext, type ReactNode, useContext, useState } from 'react';

function createApiUtils(url: string) {
  const link = new RPCLink({
    url,
    plugins: [new SimpleCsrfProtectionLinkPlugin(), new ResponseValidationPlugin(contract)],
  });
  const client: ContractRouterClient<typeof contract> = createORPCClient(link);
  return createTanstackQueryUtils(client);
}

export type ApiUtils = ReturnType<typeof createApiUtils>;

interface Api {
  utils: ApiUtils;
  /** The RPC endpoint. Routes outside oRPC, such as the run event stream, resolve against it. */
  url: string;
}

const ApiContext = createContext<Api | null>(null);

export function ApiProvider({ url, children }: { url: string; children: ReactNode }) {
  const [api] = useState(() => ({ utils: createApiUtils(url), url }));
  return <ApiContext value={api}>{children}</ApiContext>;
}

function useApi(): Api {
  const api = useContext(ApiContext);
  if (api === null) throw new Error('API hooks must be called inside ApiProvider');
  return api;
}

export function useApiUtils(): ApiUtils {
  return useApi().utils;
}

/** Resolves an API route outside oRPC to its absolute URL, on the RPC endpoint's origin. */
export function useApiRoute(): (path: string) => string {
  const { url } = useApi();
  return (path) => new URL(path, url).href;
}

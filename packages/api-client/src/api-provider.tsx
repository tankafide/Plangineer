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

type ApiUtils = ReturnType<typeof createApiUtils>;

const ApiContext = createContext<ApiUtils | null>(null);

export function ApiProvider({ url, children }: { url: string; children: ReactNode }) {
  const [utils] = useState(() => createApiUtils(url));
  return <ApiContext value={utils}>{children}</ApiContext>;
}

export function useApiUtils(): ApiUtils {
  const utils = useContext(ApiContext);
  if (utils === null) throw new Error('useApiUtils must be called inside ApiProvider');
  return utils;
}

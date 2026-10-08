import type { ServiceDeps } from '../lib/service-deps.ts';

interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface InitialContext extends ServiceDeps {
  session: { user: SessionUser } | null;
}

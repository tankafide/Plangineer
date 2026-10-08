import { contract, UserRole } from '@plangineer/contracts';
import { implement } from '@orpc/server';
import type { Result } from '../lib/result.ts';
import {
  createPairingCode,
  listRunners,
  pairRunner,
  revokeRunner,
} from '../runners/runner-service.ts';
import { cancelRun, createRun, getRun, listRuns } from '../runs/run-service.ts';
import type { InitialContext } from './context.ts';

const os = implement(contract).$context<InitialContext>();

const authed = os.use(({ context, next, errors }) => {
  if (context.session === null) throw errors.UNAUTHORIZED();
  return next({ context: { user: context.session.user } });
});

/** The value of a service result, or the contract error its code names. */
function unwrap<T, E extends string>(result: Result<T, E>, errors: Record<E, () => Error>): T {
  if (result.ok) return result.value;
  throw errors[result.error]();
}

export const router = os.router({
  me: {
    get: authed.me.get.handler(({ context: { user } }) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: UserRole.parse(user.role),
    })),
  },
  runner: {
    createPairingCode: authed.runner.createPairingCode.handler(async ({ context, errors }) =>
      unwrap(await createPairingCode(context, context.user.id), errors),
    ),
    // Public: the runner pairs with a one-time code before it has a token or a session.
    pair: os.runner.pair.handler(async ({ context, input, errors }) =>
      unwrap(await pairRunner(context, input), errors),
    ),
    list: authed.runner.list.handler(({ context, input }) =>
      listRunners(context, context.user.id, input),
    ),
    revoke: authed.runner.revoke.handler(async ({ context, input, errors }) =>
      unwrap(await revokeRunner(context, context.user.id, input.runnerId), errors),
    ),
  },
  run: {
    create: authed.run.create.handler(async ({ context, input, errors }) =>
      unwrap(await createRun(context, context.user.id, input), errors),
    ),
    get: authed.run.get.handler(async ({ context, input, errors }) =>
      unwrap(await getRun(context, context.user.id, input.runId), errors),
    ),
    list: authed.run.list.handler(({ context, input }) =>
      listRuns(context, context.user.id, input),
    ),
    cancel: authed.run.cancel.handler(async ({ context, input, errors }) =>
      unwrap(await cancelRun(context, context.user.id, input.runId), errors),
    ),
  },
});

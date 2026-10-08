import { contract, UserRole } from '@plangineer/contracts';
import { implement } from '@orpc/server';
import type { Result } from '../lib/result.ts';
import {
  addRepository,
  changeRepository,
  getRepository,
  listInstallableRepositories,
  listRepositories,
  removeRepository,
} from '../repositories/repository-service.ts';
import {
  createPairingCode,
  listRunners,
  pairRunner,
  revokeRunner,
} from '../runners/runner-service.ts';
import { cancelRun, createRun, getRun, listRuns } from '../runs/run-service.ts';
import { refreshSetup, scanRepository, startSetup } from '../setup/setup-service.ts';
import type { InitialContext } from './context.ts';

const os = implement(contract).$context<InitialContext>();

const authed = os.use(({ context, next, errors }) => {
  if (context.session === null) throw errors.UNAUTHORIZED();
  return next({ context: { user: context.session.user } });
});

/** A signed-in admin. Every admin procedure is built from it, so its rule shows at the call site. */
const admin = authed.use(({ context, next, errors }) => {
  if (UserRole.parse(context.user.role) !== 'admin') throw errors.FORBIDDEN();
  return next();
});

type ErrorMaker = (options?: { data: unknown }) => Error;

/** oRPC's error constructors take each code's own data type, so the router checks only the shape. */
const isErrorMaker = (value: unknown): value is ErrorMaker => typeof value === 'function';

/**
 * The value of a service result, or the contract error its code names, with any data the
 * service attached. oRPC checks the data against the contract before it reaches the client.
 */
function unwrap<T, E extends string>(result: Result<T, E>, errors: Record<E, unknown>): T {
  if (result.ok) return result.value;
  const make = errors[result.error];
  if (!isErrorMaker(make)) throw new Error(`No contract error ${result.error}`);
  throw make(result.data === undefined ? undefined : { data: result.data });
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
  repository: {
    listInstallable: admin.repository.listInstallable.handler(async ({ context, errors }) =>
      unwrap(await listInstallableRepositories(context), errors),
    ),
    add: admin.repository.add.handler(async ({ context, input, errors }) =>
      unwrap(await addRepository(context, context.user.id, input), errors),
    ),
    list: authed.repository.list.handler(({ context, input }) => listRepositories(context, input)),
    get: authed.repository.get.handler(async ({ context, input, errors }) =>
      unwrap(await getRepository(context, context.user.id, input.repositoryId), errors),
    ),
    update: admin.repository.update.handler(async ({ context, input, errors }) =>
      unwrap(await changeRepository(context, context.user.id, input), errors),
    ),
    remove: admin.repository.remove.handler(async ({ context, input, errors }) =>
      unwrap(await removeRepository(context, input.repositoryId), errors),
    ),
  },
  repositorySetup: {
    scan: admin.repositorySetup.scan.handler(async ({ context, input, errors }) =>
      unwrap(await scanRepository(context, context.user.id, input.repositoryId), errors),
    ),
    start: admin.repositorySetup.start.handler(async ({ context, input, errors }) =>
      unwrap(await startSetup(context, context.user.id, input), errors),
    ),
    refresh: admin.repositorySetup.refresh.handler(async ({ context, input, errors }) =>
      unwrap(await refreshSetup(context, context.user.id, input.repositoryId), errors),
    ),
  },
});

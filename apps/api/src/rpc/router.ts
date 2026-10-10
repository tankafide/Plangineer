import { contract, UserRole } from '@plangineer/contracts';
import { implement } from '@orpc/server';
import {
  completeGithubApp,
  createGithubAppManifest,
  getInstanceStatus,
} from '../instance/instance-service.ts';
import {
  changeContextFile,
  getContextFile,
  removeContextFile,
} from '../features/context-file-service.ts';
import {
  changeFeature,
  createFeature,
  getFeature,
  listFeatures,
  startFeaturePlanning,
} from '../features/feature-service.ts';
import type { Result } from '../lib/result.ts';
import { getPlan, getPlanRevision, listPlanRevisions } from '../planning/plan-service.ts';
import {
  answerPlanQuestion,
  continuePlanning,
  editPlan,
  markPlanReady,
  retryTurn,
  reviseStep,
  runSectionAction,
} from '../planning/plan-write-service.ts';
import {
  addRepository,
  changeRepository,
  getRepository,
  listInstallableRepositories,
  listRepositories,
  removeRepository,
} from '../repositories/repository-service.ts';
import {
  approveLogin,
  denyLogin,
  getLogin,
  pollLogin,
  startLogin,
} from '../runners/runner-login-service.ts';
import { listRunners, revokeRunner } from '../runners/runner-service.ts';
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
  // Public: the setup token guards the two writes, and nobody can sign in before the App exists.
  instance: {
    getStatus: os.instance.getStatus.handler(({ context }) => getInstanceStatus(context)),
    githubAppManifest: os.instance.githubAppManifest.handler(async ({ context, input, errors }) =>
      unwrap(await createGithubAppManifest(context, input.setupToken), errors),
    ),
    completeGithubApp: os.instance.completeGithubApp.handler(async ({ context, input, errors }) =>
      unwrap(await completeGithubApp(context, input), errors),
    ),
  },
  me: {
    get: authed.me.get.handler(({ context: { user } }) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: UserRole.parse(user.role),
    })),
  },
  feature: {
    create: authed.feature.create.handler(async ({ context, input, errors }) =>
      unwrap(await createFeature(context, context.user.id, input), errors),
    ),
    list: authed.feature.list.handler(({ context, input }) =>
      listFeatures(context, context.user.id, input),
    ),
    get: authed.feature.get.handler(async ({ context, input, errors }) =>
      unwrap(await getFeature(context, context.user.id, input.featureId), errors),
    ),
    update: authed.feature.update.handler(async ({ context, input, errors }) =>
      unwrap(await changeFeature(context, context.user.id, input), errors),
    ),
    startPlanning: authed.feature.startPlanning.handler(async ({ context, input, errors }) =>
      unwrap(await startFeaturePlanning(context, context.user.id, input.featureId), errors),
    ),
  },
  plan: {
    get: authed.plan.get.handler(async ({ context, input, errors }) =>
      unwrap(await getPlan(context, context.user.id, input.featureId), errors),
    ),
    answer: authed.plan.answer.handler(async ({ context, input, errors }) =>
      unwrap(await answerPlanQuestion(context, context.user.id, input), errors),
    ),
    continue: authed.plan.continue.handler(async ({ context, input, errors }) =>
      unwrap(await continuePlanning(context, context.user.id, input.featureId), errors),
    ),
    retry: authed.plan.retry.handler(async ({ context, input, errors }) =>
      unwrap(await retryTurn(context, context.user.id, input.featureId), errors),
    ),
    edit: authed.plan.edit.handler(async ({ context, input, errors }) =>
      unwrap(await editPlan(context, context.user.id, input), errors),
    ),
    sectionAction: authed.plan.sectionAction.handler(async ({ context, input, errors }) =>
      unwrap(await runSectionAction(context, context.user.id, input), errors),
    ),
    reviseStep: authed.plan.reviseStep.handler(async ({ context, input, errors }) =>
      unwrap(await reviseStep(context, context.user.id, input), errors),
    ),
    markReady: authed.plan.markReady.handler(async ({ context, input, errors }) =>
      unwrap(await markPlanReady(context, context.user.id, input), errors),
    ),
    revisions: authed.plan.revisions.handler(async ({ context, input, errors }) =>
      unwrap(await listPlanRevisions(context, context.user.id, input), errors),
    ),
    revision: authed.plan.revision.handler(async ({ context, input, errors }) =>
      unwrap(
        await getPlanRevision(context, context.user.id, input.featureId, input.number),
        errors,
      ),
    ),
  },
  contextFile: {
    get: authed.contextFile.get.handler(async ({ context, input, errors }) =>
      unwrap(await getContextFile(context, context.user.id, input.contextFileId), errors),
    ),
    update: authed.contextFile.update.handler(async ({ context, input, errors }) =>
      unwrap(await changeContextFile(context, context.user.id, input), errors),
    ),
    delete: authed.contextFile.delete.handler(async ({ context, input, errors }) =>
      unwrap(await removeContextFile(context, context.user.id, input.contextFileId), errors),
    ),
  },
  runner: {
    // startLogin and pollLogin are public: a runner has no token or session until it is paired.
    startLogin: os.runner.startLogin.handler(async ({ context, input, errors }) =>
      unwrap(await startLogin(context, input), errors),
    ),
    pollLogin: os.runner.pollLogin.handler(({ context, input }) =>
      pollLogin(context, input.deviceSecret),
    ),
    getLogin: authed.runner.getLogin.handler(async ({ context, input, errors }) =>
      unwrap(await getLogin(context, input.userCode), errors),
    ),
    approveLogin: authed.runner.approveLogin.handler(async ({ context, input, errors }) =>
      unwrap(await approveLogin(context, context.user.id, input.userCode), errors),
    ),
    denyLogin: authed.runner.denyLogin.handler(async ({ context, input, errors }) =>
      unwrap(await denyLogin(context, input.userCode), errors),
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

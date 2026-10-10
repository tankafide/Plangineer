import { contextFileDelete, contextFileGet, contextFileUpdate } from './context-file.ts';
import {
  featureCreate,
  featureGet,
  featureList,
  featureStartPlanning,
  featureUpdate,
} from './feature.ts';
import {
  instanceCompleteGithubApp,
  instanceGetStatus,
  instanceGithubAppManifest,
} from './instance.ts';
import { meGet } from './me.ts';
import {
  planAnswer,
  planContinue,
  planEdit,
  planGet,
  planMarkReady,
  planRetry,
  planReviseStep,
  planRevision,
  planRevisions,
  planSectionAction,
} from './plan.ts';
import {
  repositoryAdd,
  repositoryGet,
  repositoryList,
  repositoryListInstallable,
  repositoryRemove,
  repositorySetupRefresh,
  repositorySetupScan,
  repositorySetupStart,
  repositoryUpdate,
} from './repository.ts';
import { runCancel, runCreate, runGet, runList } from './run.ts';
import {
  runnerApproveLogin,
  runnerDenyLogin,
  runnerGetLogin,
  runnerList,
  runnerPollLogin,
  runnerRevoke,
  runnerStartLogin,
} from './runner.ts';

/** Every procedure the API serves, by router path. */
export const contract = {
  instance: {
    getStatus: instanceGetStatus,
    githubAppManifest: instanceGithubAppManifest,
    completeGithubApp: instanceCompleteGithubApp,
  },
  me: { get: meGet },
  feature: {
    create: featureCreate,
    list: featureList,
    get: featureGet,
    update: featureUpdate,
    startPlanning: featureStartPlanning,
  },
  plan: {
    get: planGet,
    answer: planAnswer,
    continue: planContinue,
    retry: planRetry,
    edit: planEdit,
    sectionAction: planSectionAction,
    reviseStep: planReviseStep,
    markReady: planMarkReady,
    revisions: planRevisions,
    revision: planRevision,
  },
  contextFile: { get: contextFileGet, update: contextFileUpdate, delete: contextFileDelete },
  runner: {
    startLogin: runnerStartLogin,
    pollLogin: runnerPollLogin,
    getLogin: runnerGetLogin,
    approveLogin: runnerApproveLogin,
    denyLogin: runnerDenyLogin,
    list: runnerList,
    revoke: runnerRevoke,
  },
  run: { create: runCreate, get: runGet, list: runList, cancel: runCancel },
  repository: {
    listInstallable: repositoryListInstallable,
    add: repositoryAdd,
    list: repositoryList,
    get: repositoryGet,
    update: repositoryUpdate,
    remove: repositoryRemove,
  },
  repositorySetup: {
    scan: repositorySetupScan,
    start: repositorySetupStart,
    refresh: repositorySetupRefresh,
  },
};

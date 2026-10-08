import type { Orchestrator } from '@plangineer/contracts';

export interface Routing {
  orchestrator: Orchestrator;
  appliesWhen: string;
}

const PLAN = 'plan-orchestrator';
const PLAN_REVIEW = 'plan-review-orchestrator';
const IMPLEMENTATION = 'implementation-orchestrator';
const IMPLEMENTATION_REVIEW = 'implementation-review-orchestrator';

function routes(orchestrators: Orchestrator[], appliesWhen: string): Routing[] {
  return orchestrators.map((orchestrator) => ({ orchestrator, appliesWhen }));
}

/** The plan and implementation rows most stack skills share. */
function designRouting(subject: string): Routing[] {
  return [
    ...routes([PLAN, PLAN_REVIEW], `The plan ${subject}`),
    ...routes([IMPLEMENTATION], `The change ${subject}`),
    ...routes([IMPLEMENTATION_REVIEW], `The diff ${subject}, or the recorded decisions cover it`),
  ];
}

/** The implementation rows of a skill that only implementation and its review route. */
function buildRouting(change: string, diff: string): Routing[] {
  return [
    ...routes([IMPLEMENTATION], `The change ${change}`),
    ...routes([IMPLEMENTATION_REVIEW], `The diff ${diff}`),
  ];
}

/** Which orchestrators route each catalog skill, and the "applies when" text of each row. */
export const CATALOG_ROUTING: Readonly<Record<string, Routing[]>> = {
  'codebase-exploration': [
    ...routes(
      [PLAN],
      'No exploration context files were provided. Run explore mode in a subagent unless the exploration is trivial',
    ),
    ...routes([PLAN_REVIEW], 'Always, in verify mode, in a subagent unless the check is trivial'),
    ...routes(
      [IMPLEMENTATION],
      'No plan, and the area is unfamiliar or large. Run explore mode in a subagent, with the work branch as the base when it already has commits',
    ),
  ],
  'plan-format': [
    ...routes([PLAN], 'Drafting the plan and checking it for blockers'),
    ...routes(
      [PLAN_REVIEW],
      'Checking the plan\'s structure, "done when" lines and blocker checklist, and updating the plan',
    ),
  ],
  'writing-style': [
    ...routes([PLAN], "Drafting and revising the plan's prose"),
    ...routes(
      [PLAN_REVIEW],
      "Checking the plan's prose, and updating the plan. Style breaks are nits",
    ),
    ...routes([IMPLEMENTATION], 'Writing the pull request description'),
  ],
  'finding-verification': routes(
    [PLAN_REVIEW, IMPLEMENTATION_REVIEW],
    'Always, in a subagent, before the engineer sees any finding',
  ),
  'plan-conformance': routes([IMPLEMENTATION_REVIEW], 'Always when there is a plan'),
  'project-stack': routes(
    [PLAN, PLAN_REVIEW, IMPLEMENTATION, IMPLEMENTATION_REVIEW],
    "Always: the repository's stack, layout, commands and conventions",
  ),
  'architecture-design': designRouting(
    'adds or moves code, adds a package or module, or changes dependencies',
  ),
  testing: [
    ...routes([PLAN], 'Filling the test plan grid, once the "done when" lines are settled'),
    ...routes([PLAN_REVIEW], 'Checking that the test plan covers every "done when" line'),
    ...routes([IMPLEMENTATION], 'Writing tests, once per phase'),
    ...routes([IMPLEMENTATION_REVIEW], 'The diff adds or changes tests, or changes behavior'),
  ],
  'code-quality': routes([IMPLEMENTATION_REVIEW], 'Always'),
  debugging: [
    ...routes([IMPLEMENTATION], 'The request is a bug fix'),
    ...routes([IMPLEMENTATION_REVIEW], 'Fixing a selected defect that is a bug'),
  ],
  security: [
    ...routes(
      [PLAN_REVIEW],
      'The plan adds a trust boundary, such as authentication, a webhook or untrusted input',
    ),
    ...routes(
      [IMPLEMENTATION_REVIEW],
      'The diff touches a trust boundary, secrets or untrusted input',
    ),
  ],
  performance: [
    ...routes(
      [PLAN_REVIEW],
      'The plan adds queries, lists, realtime delivery or heavy frontend work',
    ),
    ...routes(
      [IMPLEMENTATION_REVIEW],
      'The diff touches queries, lists, realtime delivery or heavy frontend work',
    ),
  ],
  'data-model-design': designRouting('adds or changes a table, constraint, index or migration'),
  'api-contract-design': designRouting('adds or changes a contract, procedure or event'),
  backend: buildRouting(
    'is in server handlers, middleware, configuration or logging',
    'touches server handlers, middleware, configuration or logging',
  ),
  'database-access': buildRouting(
    'writes queries, transactions or seed data',
    'touches queries, transactions or seed data',
  ),
  frontend: buildRouting('is in components or routes', 'touches components or routes'),
  'frontend-data': buildRouting(
    'touches server state, caching or realtime updates in the client',
    'touches server state, caching or realtime updates in the client',
  ),
  'design-system': [
    ...routes([PLAN, PLAN_REVIEW], 'The plan touches screens or components'),
    ...buildRouting('touches screens or components', 'touches screens or components'),
  ],
  auth: buildRouting('touches sign-in, sessions or roles', 'touches sign-in, sessions or roles'),
  'tooling-and-ci': buildRouting(
    'touches the workspace, scripts, hooks, CI or check configuration',
    'touches the workspace, scripts, hooks, CI or check configuration',
  ),
};

import { AgentRole, type RepositoryDetail, type ReviewRounds } from '@plangineer/contracts';
import type { ReactNode } from 'react';
import {
  FINDINGS_LABELS,
  PLAN_CHECK_IN_LABELS,
  REVIEWS,
  ROLE_LABELS,
  ROLE_RUNTIME,
  ROUNDS_LABELS,
} from './settings-labels';

function roundsText(rounds: ReviewRounds): string {
  switch (rounds.mode) {
    case 'ask':
      return ROUNDS_LABELS.ask;
    case 'fixed':
      return `${ROUNDS_LABELS.fixed}, ${rounds.count}`;
    case 'adaptive':
      return `${ROUNDS_LABELS.adaptive}, up to ${rounds.max}`;
    default: {
      const unknownRounds: never = rounds;
      throw new Error(`Unknown rounds ${JSON.stringify(unknownRounds)}`);
    }
  }
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** The repository's settings as text, for members, who cannot change them. */
export function RepositorySettingsView({ repository }: { repository: RepositoryDetail }) {
  const { roleSettings, workflowSettings } = repository;
  return (
    <dl className="flex flex-col gap-3">
      <Fact term="Description">{repository.description}</Fact>
      {AgentRole.options.map((role) => (
        <Fact key={role} term={ROLE_LABELS[role]}>
          <span className="flex flex-col">
            <span>{ROLE_RUNTIME}</span>
            <span className="font-mono text-xs">{roleSettings[role].model ?? 'Default model'}</span>
          </span>
        </Fact>
      ))}
      <Fact term="Plan check-in">{PLAN_CHECK_IN_LABELS[workflowSettings.planCheckIn]}</Fact>
      {REVIEWS.map(({ key, title }) => (
        <Fact key={key} term={title}>
          {`Findings: ${FINDINGS_LABELS[workflowSettings[key].findings]}. Rounds: ${roundsText(workflowSettings[key].rounds)}.`}
        </Fact>
      ))}
    </dl>
  );
}

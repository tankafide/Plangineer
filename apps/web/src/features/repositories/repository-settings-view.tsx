import { AgentRole, type RepositoryDetail } from '@plangineer/contracts';
import type { ReactNode } from 'react';
import { RUN_MODE_HINTS, RUN_MODE_LABELS } from '@/lib/run-modes';
import { ROLE_LABELS, ROLE_RUNTIME } from './settings-labels';

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
  const { roleSettings, defaultRunMode } = repository;
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
      <Fact term="Default run mode">
        <span className="flex flex-col">
          <span>{RUN_MODE_LABELS[defaultRunMode]}</span>
          <span className="text-muted-foreground">{RUN_MODE_HINTS[defaultRunMode]}</span>
        </span>
      </Fact>
    </dl>
  );
}

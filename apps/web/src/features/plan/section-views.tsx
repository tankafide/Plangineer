import type { PlanBody, PlanDecision, PlanSection } from '@plangineer/contracts';
import { Badge } from '@/components/ui/badge';
import { REVISION_SOURCE_LABELS } from './plan-labels';

/** The sections shown read only. Steps and the test plan have their own editors. */
export type ReadOnlySection = Exclude<PlanSection, 'steps' | 'test_plan'>;

function Lines({ label, lines }: { label: string; lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-medium">{label}</h3>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {lines.map((line, index) => (
          // Lines are plain text that may repeat, and the list never reorders.
          <li key={index} className="break-words">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Decisions with who made each, the agent or the engineer. */
export function DecisionList({ decisions }: { decisions: readonly PlanDecision[] }) {
  if (decisions.length === 0) return <p className="text-muted-foreground">No decisions yet.</p>;
  return (
    <ul aria-label="Decisions" className="flex flex-col gap-3">
      {decisions.map((decision) => (
        <li key={decision.id} className="flex min-w-0 flex-col gap-1">
          <p className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 font-medium break-words">{decision.title}</span>
            <Badge variant="outline">{REVISION_SOURCE_LABELS[decision.by]}</Badge>
          </p>
          <p className="break-words whitespace-pre-wrap text-muted-foreground">{decision.reason}</p>
        </li>
      ))}
    </ul>
  );
}

/** A section the engineer reads and changes only through the section actions. */
export function SectionView({ section, body }: { section: ReadOnlySection; body: PlanBody }) {
  switch (section) {
    case 'goal':
      return <p className="break-words whitespace-pre-wrap">{body.goal}</p>;
    case 'prerequisites':
      if (body.prerequisites.length === 0) {
        return <p className="text-muted-foreground">No prerequisites.</p>;
      }
      return (
        <ul className="flex flex-col gap-2">
          {body.prerequisites.map((item) => (
            <li key={item.id} className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 break-words">{item.item}</span>
              <span className="text-muted-foreground">{item.who}</span>
              <Badge variant={item.status === 'open' ? 'warning' : 'success'}>
                {item.status === 'open' ? 'Open' : 'Resolved'}
              </Badge>
            </li>
          ))}
        </ul>
      );
    case 'decisions':
      return <DecisionList decisions={body.decisions} />;
    case 'constraints':
      return (
        <ul className="flex flex-col gap-3">
          {body.constraints.map((constraint) => (
            <li key={constraint.id} className="flex min-w-0 flex-col gap-1">
              <span className="font-medium break-words">{constraint.title}</span>
              <span className="break-words">Target: {constraint.target}</span>
              <span className="break-words text-muted-foreground">Check: {constraint.check}</span>
            </li>
          ))}
        </ul>
      );
    case 'verification':
      return (
        <div className="flex flex-col gap-3">
          <Lines label="Automated" lines={body.verification.automated} />
          <Lines label="Agent checks" lines={body.verification.agentChecks} />
          <Lines label="Human checks" lines={body.verification.humanChecks} />
        </div>
      );
    default: {
      const unhandled: never = section;
      throw new Error(`Unhandled plan section: ${String(unhandled)}`);
    }
  }
}

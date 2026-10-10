import { useSectionAction } from '@plangineer/api-client';
import { type PlanSection, SectionAction } from '@plangineer/contracts';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { PlanActionError } from './plan-action-error';
import { SECTION_ACTION_LABELS, SECTION_LABELS } from './plan-labels';

/** The anchor the section rail links to. */
export const sectionAnchor = (section: PlanSection) => `section-${section}`;

/**
 * One plan section: its content and the actions that ask the agent to expand, simplify or
 * regenerate it. The actions are disabled, with the reason, while the plan cannot change.
 */
export function SectionCard({
  featureId,
  revision,
  section,
  blockedReason,
  children,
}: {
  featureId: string;
  revision: number;
  section: PlanSection;
  blockedReason: string | null;
  children: ReactNode;
}) {
  const sectionAction = useSectionAction();
  const send = (action: SectionAction) =>
    sectionAction.mutate({ featureId, revision, section, action });

  return (
    <Card id={sectionAnchor(section)} className="min-w-0 scroll-mt-4">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">{SECTION_LABELS[section]}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">{children}</CardContent>
      <CardFooter className="flex flex-col items-stretch gap-3">
        {sectionAction.isError && (
          <PlanActionError
            error={sectionAction.error}
            onRetry={() => sectionAction.mutate(sectionAction.variables)}
          />
        )}
        <div className="flex flex-wrap gap-2">
          {SectionAction.options.map((action) => (
            <Button
              key={action}
              variant="outline"
              disabled={blockedReason !== null || sectionAction.isPending}
              aria-label={`${SECTION_ACTION_LABELS[action]} ${SECTION_LABELS[section]}`}
              onClick={() => send(action)}
            >
              {SECTION_ACTION_LABELS[action]}
            </Button>
          ))}
        </div>
        {blockedReason !== null && <p className="text-muted-foreground">{blockedReason}</p>}
      </CardFooter>
    </Card>
  );
}

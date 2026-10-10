import type { ReadinessItem } from '@plangineer/contracts';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { readinessLabel } from './plan-labels';

/** The checks a plan passes before it can be marked ready, each passed or failing. */
export function ReadinessChecklist({ items }: { items: readonly ReadinessItem[] }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold">Readiness</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul aria-label="Readiness" className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.key} className="flex items-start gap-2">
              {item.ok ? (
                <CircleCheck aria-label="Passed" className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <CircleAlert aria-label="Failing" className="mt-0.5 size-4 shrink-0 text-warning" />
              )}
              <span className="min-w-0 tabular-nums">{readinessLabel(item)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

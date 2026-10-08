import type { RunEvent } from '@plangineer/contracts';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { RunEventRow } from './run-event-row';

/** How many events the list shows at first, and how many more each Show earlier events adds. */
const EVENTS_PER_STEP = 200;

/** The latest events in order, revealing earlier ones from the cache a step at a time. */
export function RunEventList({ events }: { events: readonly RunEvent[] }) {
  const [shown, setShown] = useState(EVENTS_PER_STEP);

  if (events.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No events yet</EmptyTitle>
          <EmptyDescription>Events appear here as the runner sends them.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const hidden = Math.max(0, events.length - shown);
  return (
    <div className="flex flex-col gap-2">
      {hidden > 0 && (
        <Button
          variant="outline"
          className="w-full md:w-auto md:self-center"
          onClick={() => setShown(shown + EVENTS_PER_STEP)}
        >
          Show earlier events
        </Button>
      )}
      <ol aria-label="Run events" className="flex min-w-0 flex-col rounded-xl border bg-card px-4">
        {events.slice(hidden).map((event) => (
          <RunEventRow key={event.id} event={event} />
        ))}
      </ol>
    </div>
  );
}

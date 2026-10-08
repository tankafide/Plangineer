import type { RunEvent } from '@plangineer/contracts';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CANCEL_REASON_LABELS, FAILURE_REASON_LABELS } from './run-reasons';

type TerminalEvent = Extract<RunEvent, { type: 'run.succeeded' | 'run.failed' | 'run.cancelled' }>;

const USD = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
});
const SECONDS = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 tabular-nums">{children}</dd>
    </>
  );
}

function Succeeded({ event }: { event: Extract<TerminalEvent, { type: 'run.succeeded' }> }) {
  return (
    <>
      <p className="break-words whitespace-pre-wrap">{event.resultText}</p>
      {event.truncated && (
        <p className="text-muted-foreground">Truncated: the full result was too long to keep.</p>
      )}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <Fact term="Cost">
          {event.costUsd === null ? 'Not reported' : USD.format(event.costUsd)}
        </Fact>
        <Fact term="Duration">{SECONDS.format(event.durationMs / 1000)} s</Fact>
        <Fact term="Turns">{event.numTurns}</Fact>
      </dl>
    </>
  );
}

function Failed({ event }: { event: Extract<TerminalEvent, { type: 'run.failed' }> }) {
  return (
    <>
      <p className="font-medium">{FAILURE_REASON_LABELS[event.reason]}</p>
      <p className="break-words whitespace-pre-wrap">{event.message}</p>
      {event.exitCode !== null && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
          <Fact term="Exit code">{event.exitCode}</Fact>
        </dl>
      )}
      {event.stderrTail.length > 0 && (
        <pre
          aria-label="Error output"
          className="rounded-lg border bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap"
        >
          {event.stderrTail.join('\n')}
        </pre>
      )}
    </>
  );
}

const TITLES: Record<TerminalEvent['type'], string> = {
  'run.succeeded': 'Result',
  'run.failed': 'Failure',
  'run.cancelled': 'Cancelled',
};

/** How the run ended: the result of a success, the cause of a failure, or why it was cancelled. */
export function RunResultCard({ event }: { event: TerminalEvent }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{TITLES[event.type]}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {event.type === 'run.succeeded' && <Succeeded event={event} />}
        {event.type === 'run.failed' && <Failed event={event} />}
        {event.type === 'run.cancelled' && <p>{CANCEL_REASON_LABELS[event.reason]}</p>}
      </CardContent>
    </Card>
  );
}

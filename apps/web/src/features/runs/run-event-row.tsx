import type { RunEvent } from '@plangineer/contracts';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/date-time';
import { CANCEL_REASON_LABELS, FAILURE_REASON_LABELS } from './run-reasons';

const RATE_LIMIT_LABELS = {
  allowed: 'Within the Claude plan limit',
  allowed_warning: 'Close to the Claude plan limit',
  rejected: 'Claude plan limit reached',
} as const;

function TruncatedNote({ truncated }: { truncated: boolean }) {
  if (!truncated) return null;
  return <p className="text-muted-foreground">Truncated: the full text was too long to keep.</p>;
}

function AgentText({ text }: { text: string }) {
  return <p className="break-words whitespace-pre-wrap">{text}</p>;
}

function EventLabel({ children }: { children: string }) {
  return <p className="font-medium">{children}</p>;
}

function ToolUse({
  name,
  inputJson,
  truncated,
}: {
  name: string;
  inputJson: string;
  truncated: boolean;
}) {
  const [showInput, setShowInput] = useState(false);
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="font-medium">
        Tool use: <span className="font-mono text-xs">{name}</span>
      </p>
      <Button
        variant="outline"
        size="sm"
        aria-expanded={showInput}
        onClick={() => setShowInput(!showInput)}
      >
        {showInput ? 'Hide input' : 'Show input'}
      </Button>
      {showInput && (
        <pre className="w-full rounded-lg border bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
          {inputJson}
        </pre>
      )}
      <TruncatedNote truncated={truncated} />
    </div>
  );
}

/** What one run event says, as text. Agent output is rendered as text, never markup. */
function EventBody({ event }: { event: RunEvent }) {
  switch (event.type) {
    case 'run.queued':
      return <EventLabel>Queued</EventLabel>;
    case 'run.leased':
      return <EventLabel>{`Picked up by the runner, attempt ${event.attempt}`}</EventLabel>;
    case 'run.started':
      return (
        <p className="font-medium">
          Started at <span className="font-mono text-xs">{event.commit.slice(0, 12)}</span> with
          Claude Code {event.cli.version}
        </p>
      );
    case 'agent.session':
      return (
        <EventLabel>{`Session on ${event.model}, Claude Code ${event.cliVersion}, ${event.skills.length} skills`}</EventLabel>
      );
    case 'agent.message':
      return (
        <>
          <AgentText text={event.text} />
          <TruncatedNote truncated={event.truncated} />
        </>
      );
    case 'agent.tool_use':
      return <ToolUse name={event.name} inputJson={event.inputJson} truncated={event.truncated} />;
    case 'agent.tool_result':
      return (
        <>
          <EventLabel>{event.isError ? 'Tool error' : 'Tool result'}</EventLabel>
          <pre className="font-mono text-xs break-all whitespace-pre-wrap">{event.text}</pre>
          <TruncatedNote truncated={event.truncated} />
        </>
      );
    case 'agent.rate_limit':
      return (
        <EventLabel>
          {event.resetsAt === null
            ? RATE_LIMIT_LABELS[event.status]
            : `${RATE_LIMIT_LABELS[event.status]}, resets ${formatDateTime(event.resetsAt)}`}
        </EventLabel>
      );
    case 'agent.other':
      return (
        <>
          <p className="font-medium">
            Other agent event: <span className="font-mono text-xs">{event.vendorType}</span>
          </p>
          <TruncatedNote truncated={event.truncated} />
        </>
      );
    case 'run.cancel_requested':
      return <EventLabel>Cancel requested</EventLabel>;
    case 'run.lease_lost':
      return (
        <EventLabel>
          {event.requeued
            ? `The runner lost attempt ${event.attempt}, so the run was queued again`
            : `The runner lost attempt ${event.attempt}`}
        </EventLabel>
      );
    case 'setup.pushed':
      return (
        <EventLabel>
          {`Pushed ${event.branch} at ${event.commit.slice(0, 7)}, ${event.changedPathCount} files`}
        </EventLabel>
      );
    case 'run.succeeded':
      return <EventLabel>Succeeded</EventLabel>;
    case 'run.failed':
      return <EventLabel>{`Failed: ${FAILURE_REASON_LABELS[event.reason]}`}</EventLabel>;
    case 'run.cancelled':
      return <EventLabel>{CANCEL_REASON_LABELS[event.reason]}</EventLabel>;
    default: {
      const unknownEvent: never = event;
      throw new Error(`Unknown run event ${JSON.stringify(unknownEvent)}`);
    }
  }
}

export function RunEventRow({ event }: { event: RunEvent }) {
  return (
    <li className="flex min-w-0 flex-col gap-1 border-b py-3 last:border-b-0">
      <EventBody event={event} />
    </li>
  );
}

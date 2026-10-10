import { isTerminalRunEvent, RunEvent } from '@plangineer/contracts';
import { type EventSourceMessage, EventSourceParserStream } from 'eventsource-parser/stream';

/** `idle` while the hook is skipped and opens no stream. */
export type RunEventStreamState =
  | { status: 'idle' | 'connecting' | 'live' | 'reconnecting' | 'ended' }
  | { status: 'failed'; error: Error };

const RUN_EVENT_MESSAGE = 'run-event';
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/** The server refused the stream with a 4xx, such as 404 for a run the caller does not own. */
class RunEventStreamRejected extends Error {
  constructor(url: string, status: number) {
    super(`The run event stream ${url} was refused with ${status}`);
  }
}

/** A message that is not a valid RunEvent. Reconnecting would only replay it. */
class InvalidRunEventMessage extends Error {}

interface FollowRunEventsOptions {
  url: string;
  signal: AbortSignal;
  /** The highest event id already applied, sent as Last-Event-ID on each request. */
  lastEventId: () => number;
  onState: (state: RunEventStreamState) => void;
  onEvent: (event: RunEvent) => void;
}

function parseRunEvent(message: EventSourceMessage): RunEvent {
  if (message.event !== RUN_EVENT_MESSAGE) {
    throw new InvalidRunEventMessage(`Unexpected SSE event ${String(message.event)}`);
  }
  try {
    return RunEvent.parse(JSON.parse(message.data));
  } catch (error) {
    throw new InvalidRunEventMessage(`Run event ${message.id ?? '(no id)'} is invalid`, {
      cause: error,
    });
  }
}

/** Reads one request until a terminal event (true) or the end of the body (false). */
async function readOnce(options: FollowRunEventsOptions, onOpen: () => void): Promise<boolean> {
  const request = new AbortController();
  try {
    const response = await fetch(options.url, {
      credentials: 'include',
      headers: { Accept: 'text/event-stream', 'Last-Event-ID': String(options.lastEventId()) },
      signal: AbortSignal.any([options.signal, request.signal]),
    });
    if (response.status >= 400 && response.status < 500) {
      throw new RunEventStreamRejected(options.url, response.status);
    }
    if (!response.ok || response.body === null) return false;
    onOpen();
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream({ onError: 'terminate' }))
      .getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return false;
      const event = parseRunEvent(value);
      options.onEvent(event);
      if (isTerminalRunEvent(event)) return true;
    }
  } finally {
    request.abort();
  }
}

/** Exponential from 1 s, capped at 30 s, with up to 50% added jitter inside the cap. */
function backoffDelay(failures: number): number {
  const exponential = BACKOFF_BASE_MS * 2 ** failures;
  return Math.min(BACKOFF_MAX_MS, exponential * (1 + Math.random() / 2));
}

/** Resolves after the delay, at once when the page becomes visible, or on abort. */
function waitToReconnect(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      signal.removeEventListener('abort', wake);
      resolve();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') wake();
    };
    const timer = setTimeout(wake, delayMs);
    document.addEventListener('visibilitychange', onVisibilityChange);
    signal.addEventListener('abort', wake);
  });
}

/**
 * Follows a run's event stream until a terminal event, a refusal or an invalid event, resuming
 * from the last applied event id after each drop. fetch reports a network failure as a TypeError,
 * so only a TypeError or a body that ends early is retried.
 */
export async function followRunEvents(options: FollowRunEventsOptions): Promise<void> {
  let failures = 0;
  const onOpen = () => {
    failures = 0;
    options.onState({ status: 'live' });
  };
  while (!options.signal.aborted) {
    try {
      if (await readOnce(options, onOpen)) {
        options.onState({ status: 'ended' });
        return;
      }
    } catch (error) {
      if (options.signal.aborted) return;
      if (!(error instanceof Error)) throw error;
      if (!(error instanceof TypeError)) {
        options.onState({ status: 'failed', error });
        return;
      }
    }
    options.onState({ status: 'reconnecting' });
    await waitToReconnect(backoffDelay(failures), options.signal);
    failures += 1;
  }
}

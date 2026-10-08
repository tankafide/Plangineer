import { RunnerSocketClose, type ServerToRunnerMessage } from '@plangineer/contracts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { type NotificationListener, RUNNER_WAKE_CHANNEL } from '../realtime/notifications.ts';
import { planDispatch } from '../runs/dispatch.ts';
import { sweepLapsedLeases } from '../runs/sweeper.ts';
import { findRunnerStatus } from './runner-repository.ts';

/** One runner's socket, as the connections in this process hold it. */
export interface HeldSocket {
  send: (message: ServerToRunnerMessage) => void;
  close: (code: number, reason: string) => void;
}

export interface RunnerConnections {
  /** Holds the socket for its runner, closing an older socket of the same runner with 4002. */
  attach: (runnerId: string, socket: HeldSocket) => void;
  detach: (runnerId: string, socket: HeldSocket) => void;
  /** Sends the runner its new assignments and the cancels its socket has not been told. */
  dispatch: (runnerId: string) => Promise<void>;
  /** Stops the sweeper and closes every held socket with 1001. */
  close: () => Promise<void>;
}

/**
 * The runner sockets this API process holds. A runner_wake for a held runner dispatches it,
 * or closes it with 4001 when the runner was revoked. The sweeper runs here on an interval,
 * then dispatches every held runner, which covers a missed wake and a plan limit that passed.
 */
export function createRunnerConnections({
  deps,
  listener,
}: {
  deps: ServiceDeps;
  listener: NotificationListener;
}): RunnerConnections {
  const { env, logger } = deps;
  const sockets = new Map<string, HeldSocket>();
  /** The cancels already sent on each socket, as run id and attempt. */
  const cancelsSent = new WeakMap<HeldSocket, Set<string>>();

  async function dispatch(runnerId: string): Promise<void> {
    if (!sockets.has(runnerId)) return;
    const { assigned, cancels } = await planDispatch(deps, runnerId);
    // The socket may have been replaced meanwhile; a run sent nowhere waits out its lease.
    const socket = sockets.get(runnerId);
    if (socket === undefined) return;
    for (const { runId, attempt, job } of assigned) {
      socket.send({ type: 'run.assign', runId, attempt, job });
    }
    const sent = cancelsSent.get(socket) ?? new Set();
    cancelsSent.set(socket, sent);
    for (const { runId, attempt } of cancels) {
      const key = `${runId}:${attempt}`;
      if (sent.has(key)) continue;
      sent.add(key);
      socket.send({ type: 'run.cancel', runId, attempt });
    }
  }

  function dispatchInBackground(runnerId: string): void {
    dispatch(runnerId).catch((error: unknown) => {
      logger.error({ err: error, runnerId }, 'Runner dispatch failed');
    });
  }

  async function wake(runnerId: string): Promise<void> {
    const socket = sockets.get(runnerId);
    if (socket === undefined) return;
    if ((await findRunnerStatus(deps.db, runnerId)) === 'revoked') {
      sockets.delete(runnerId);
      socket.close(RunnerSocketClose.revoked, 'Runner revoked');
      return;
    }
    await dispatch(runnerId);
  }

  const unsubscribe = listener.subscribe(RUNNER_WAKE_CHANNEL, {
    onNotify: (runnerId) => {
      wake(runnerId).catch((error: unknown) => {
        logger.error({ err: error, runnerId }, 'Runner wake failed');
      });
    },
    onReconnect: () => {
      for (const runnerId of sockets.keys()) dispatchInBackground(runnerId);
    },
  });

  let tick: Promise<void> | undefined;
  async function sweep(): Promise<void> {
    const handled = await sweepLapsedLeases(deps);
    if (handled > 0) logger.info({ handled }, 'Lapsed run leases handled');
    await Promise.all([...sockets.keys()].map(dispatch));
  }
  const sweeper = setInterval(() => {
    if (tick !== undefined) return;
    tick = sweep()
      .catch((error: unknown) => {
        logger.error({ err: error }, 'Run lease sweep failed');
      })
      .finally(() => {
        tick = undefined;
      });
  }, env.RUN_SWEEP_INTERVAL_MS);

  return {
    attach(runnerId, socket) {
      const previous = sockets.get(runnerId);
      sockets.set(runnerId, socket);
      if (previous !== undefined && previous !== socket) {
        previous.close(RunnerSocketClose.replaced, 'Replaced by a newer connection');
      }
    },
    detach(runnerId, socket) {
      if (sockets.get(runnerId) === socket) sockets.delete(runnerId);
    },
    dispatch,
    async close() {
      clearInterval(sweeper);
      unsubscribe();
      await tick;
      for (const socket of sockets.values()) {
        socket.close(RunnerSocketClose.goingAway, 'Server shutting down');
      }
      sockets.clear();
    },
  };
}

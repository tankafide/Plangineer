import { type SetupStatus, SetupStatus as SetupStatusEnum } from '@plangineer/contracts';
import { describe, expect, it } from 'vitest';
import { nextSetupStatus, type SetupEvent } from './setup-status.ts';

const EVENTS: SetupEvent[] = [
  'scanned',
  'started',
  'pr_opened',
  'generation_failed',
  'pr_merged',
  'pr_closed',
];

/** Every allowed pair, as "status event" to the resulting status. Every other pair is rejected. */
const ALLOWED: Record<string, SetupStatus> = {
  'null scanned': 'scanned',
  'scanned scanned': 'scanned',
  'pr_open scanned': 'scanned',
  'complete scanned': 'scanned',
  'failed scanned': 'scanned',
  'scanned started': 'generating',
  'failed started': 'generating',
  'generating pr_opened': 'pr_open',
  'generating generation_failed': 'failed',
  'pr_open pr_merged': 'complete',
  'pr_open pr_closed': 'failed',
};

const PAIRS = [null, ...SetupStatusEnum.options].flatMap((status) =>
  EVENTS.map((event) => ({ status, event, key: `${status} ${event}` })),
);

describe('nextSetupStatus', () => {
  it.each(PAIRS.filter(({ key }) => key in ALLOWED))(
    'allows $event from $status',
    ({ status, event, key }) => {
      expect(nextSetupStatus(status, event)).toEqual({ ok: true, status: ALLOWED[key] });
    },
  );

  it.each(PAIRS.filter(({ key }) => !(key in ALLOWED)))(
    'rejects $event from $status',
    ({ status, event }) => {
      expect(nextSetupStatus(status, event)).toEqual({ ok: false, reason: 'invalid_transition' });
    },
  );
});

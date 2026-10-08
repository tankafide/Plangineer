import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PageInput, pageOutput } from './pagination.ts';

const CURSOR = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6';

describe('PageInput', () => {
  it('defaults the limit to 50', () => {
    expect(PageInput.parse({})).toEqual({ limit: 50 });
  });

  it('accepts a cursor and a limit at each bound', () => {
    expect(PageInput.parse({ cursor: CURSOR, limit: 1 })).toEqual({ cursor: CURSOR, limit: 1 });
    expect(PageInput.parse({ limit: 100 })).toEqual({ limit: 100 });
  });

  it.each([0, 101, 1.5])('rejects the limit %s', (limit) => {
    expect(PageInput.safeParse({ limit }).success).toBe(false);
  });

  it('rejects a cursor that is not a uuid', () => {
    expect(PageInput.safeParse({ cursor: 'page-2' }).success).toBe(false);
  });

  it('rejects an unknown key', () => {
    expect(PageInput.safeParse({ offset: 10 }).success).toBe(false);
  });
});

describe('pageOutput', () => {
  const Page = pageOutput(z.object({ id: z.uuid() }));

  it('accepts items and a null cursor', () => {
    expect(Page.parse({ items: [{ id: CURSOR }], nextCursor: null })).toEqual({
      items: [{ id: CURSOR }],
      nextCursor: null,
    });
  });

  it('strips an unknown key', () => {
    expect(Page.parse({ items: [], nextCursor: CURSOR, total: 3 })).toEqual({
      items: [],
      nextCursor: CURSOR,
    });
  });
});

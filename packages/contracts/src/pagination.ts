import { z } from 'zod';

/** Keyset paging over uuidv7 ids, newest first. The cursor is the last item's id. */
export const PageInput = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.int().min(1).max(100).default(50),
});
export type PageInput = z.output<typeof PageInput>;

export function pageOutput<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.uuid().nullable() });
}

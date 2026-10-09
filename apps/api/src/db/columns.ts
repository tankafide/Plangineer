import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

export const createdAt = () => timestamp({ withTimezone: true }).defaultNow().notNull();
export const updatedAt = () =>
  timestamp({ withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();
export const id = () =>
  uuid()
    .default(sql`uuidv7()`)
    .primaryKey();

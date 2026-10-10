import { sql } from 'drizzle-orm';
import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

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

/** Raw bytes, which node-postgres reads and writes as a Buffer. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

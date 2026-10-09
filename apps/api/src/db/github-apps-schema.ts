import { sql } from 'drizzle-orm';
import { bigint, boolean, check, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { createdAt, id } from './columns.ts';

/**
 * The deployment's one GitHub App, created through GitHub's manifest flow. It belongs to nothing
 * and the app never deletes it. The client secret and the PKCS#8 key are stored encrypted with
 * BETTER_AUTH_SECRET.
 */
export const githubApps = pgTable(
  'github_apps',
  {
    id: id(),
    singleton: boolean().default(true).notNull(),
    appId: bigint({ mode: 'number' }).notNull(),
    slug: text().notNull(),
    clientId: text().notNull(),
    clientSecretEncrypted: text().notNull(),
    privateKeyEncrypted: text().notNull(),
    ownerLogin: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // Holds the table to one row.
    unique('github_apps_singleton_key').on(table.singleton),
    check('github_apps_singleton_check', sql`${table.singleton}`),
  ],
);

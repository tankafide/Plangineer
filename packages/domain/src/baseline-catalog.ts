import type { CatalogKind, SkillName } from '@plangineer/contracts';
import { CATALOG_ROUTING, type Routing } from './catalog-routing.ts';

export type Signal =
  | { kind: 'always' }
  | {
      kind: 'match';
      directories: string[];
      fileNames: string[];
      extensions: string[];
      dependencies: string[];
    };

export interface CatalogEntry {
  name: SkillName;
  kind: CatalogKind;
  purpose: string;
  routing: Routing[];
  required: boolean;
  signal: Signal;
}

const ALWAYS: Signal = { kind: 'always' };

function match(found: Partial<Omit<Extract<Signal, { kind: 'match' }>, 'kind'>>): Signal {
  return {
    kind: 'match',
    directories: found.directories ?? [],
    fileNames: found.fileNames ?? [],
    extensions: found.extensions ?? [],
    dependencies: found.dependencies ?? [],
  };
}

const BACKEND_FRAMEWORKS = ['express', 'fastify', 'hono', 'koa', '@nestjs/core'];
const ORMS = ['drizzle-orm', 'typeorm', 'sequelize', 'knex', 'mongoose'];

function entry(
  name: SkillName,
  kind: CatalogKind,
  purpose: string,
  required: boolean,
  signal: Signal,
): CatalogEntry {
  const routing = CATALOG_ROUTING[name];
  if (!routing) throw new Error(`No routing for catalog skill ${name}`);
  return { name, kind, purpose, routing, required, signal };
}

/** The skills setup offers. Required entries are chosen whenever anything is, since the templates link to them. */
export const BASELINE_CATALOG: readonly CatalogEntry[] = [
  entry(
    'codebase-exploration',
    'fixed',
    'How to explore the repository before planning, and what a context file holds',
    true,
    ALWAYS,
  ),
  entry('plan-format', 'fixed', 'The plan template and its blocker checklist', true, ALWAYS),
  entry(
    'writing-style',
    'fixed',
    'How plans, pull request descriptions and docs read',
    true,
    ALWAYS,
  ),
  entry(
    'finding-verification',
    'fixed',
    'How the author judges each review finding before fixing it',
    true,
    ALWAYS,
  ),
  entry(
    'plan-conformance',
    'fixed',
    'Matching a diff to its plan, with deviations and extras',
    true,
    ALWAYS,
  ),
  entry(
    'project-stack',
    'template',
    "The repository's context, stack, layout, commands and conventions",
    true,
    ALWAYS,
  ),
  entry(
    'architecture-design',
    'template',
    'Where code belongs and what may import what',
    true,
    ALWAYS,
  ),
  entry(
    'testing',
    'template',
    'Test layers, what each proves, and the fixtures each uses',
    true,
    ALWAYS,
  ),
  entry(
    'code-quality',
    'template',
    'Naming, unit size, types, error handling and dead code',
    true,
    ALWAYS,
  ),
  entry('debugging', 'template', 'Reproducing, isolating and fixing a root cause', true, ALWAYS),
  entry('security', 'template', 'Trust boundaries, input handling and secrets', false, ALWAYS),
  entry(
    'performance',
    'template',
    'Standing performance limits and how each is checked',
    false,
    ALWAYS,
  ),
  entry(
    'data-model-design',
    'template',
    'Tables, constraints, indexes and migrations',
    false,
    match({
      directories: ['migrations'],
      fileNames: ['schema.prisma', 'alembic.ini', 'drizzle.config.ts'],
      dependencies: ['prisma', ...ORMS],
    }),
  ),
  entry(
    'api-contract-design',
    'template',
    'Endpoints, schemas, errors and compatibility',
    false,
    match({
      fileNames: ['openapi.yaml', 'openapi.json'],
      extensions: ['.proto', '.graphql'],
      dependencies: [...BACKEND_FRAMEWORKS, '@trpc/server', '@orpc/server'],
    }),
  ),
  entry(
    'backend',
    'generated',
    'Server layers, request handling, errors, configuration and logging',
    false,
    match({ dependencies: [...BACKEND_FRAMEWORKS, 'next'] }),
  ),
  entry(
    'database-access',
    'generated',
    'Queries, transactions, seed data and database tests',
    false,
    match({ dependencies: ['prisma', '@prisma/client', ...ORMS] }),
  ),
  entry(
    'frontend',
    'generated',
    'Components, routing, forms, screen states and accessibility',
    false,
    match({
      extensions: ['.tsx', '.jsx', '.vue', '.svelte'],
      dependencies: ['react', 'vue', 'svelte', '@angular/core', 'solid-js'],
    }),
  ),
  entry(
    'frontend-data',
    'generated',
    'Server state, caching and realtime updates in the client',
    false,
    match({
      dependencies: ['@tanstack/react-query', 'swr', '@apollo/client', '@reduxjs/toolkit', 'urql'],
    }),
  ),
  entry(
    'design-system',
    'generated',
    'Layout, the component library, tokens and theming',
    false,
    match({
      fileNames: ['components.json', 'tailwind.config.js', 'tailwind.config.ts'],
      dependencies: ['tailwindcss', '@mui/material', '@chakra-ui/react', '@mantine/core'],
    }),
  ),
  entry(
    'auth',
    'generated',
    'Sign-in, sessions, roles and access checks',
    false,
    match({
      dependencies: [
        'better-auth',
        'next-auth',
        '@auth/core',
        'passport',
        'lucia',
        '@clerk/nextjs',
        '@clerk/clerk-react',
      ],
    }),
  ),
  entry(
    'tooling-and-ci',
    'generated',
    'The package manager, workspace, hooks, CI and the parts of the check command',
    false,
    match({
      directories: ['.github'],
      fileNames: [
        'turbo.json',
        'nx.json',
        'pnpm-workspace.yaml',
        'lefthook.yml',
        '.pre-commit-config.yaml',
      ],
    }),
  ),
];

/** The catalog entry with this name, if the catalog has one. */
export function catalogEntry(name: string): CatalogEntry | undefined {
  return BASELINE_CATALOG.find((candidate) => candidate.name === name);
}

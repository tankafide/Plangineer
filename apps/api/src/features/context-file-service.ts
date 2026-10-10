import type { ContextFile, ContextFileUpdateInput } from '@plangineer/contracts';
import { fail, ok, type Result } from '../lib/result.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import {
  deleteContextFile,
  findContextFileForAuthor,
  updateContextFile,
} from './context-file-repository.ts';

export async function getContextFile(
  { db }: ServiceDeps,
  userId: string,
  contextFileId: string,
): Promise<Result<ContextFile, 'NOT_FOUND'>> {
  const file = await findContextFileForAuthor(db, userId, contextFileId);
  return file === undefined ? fail('NOT_FOUND') : ok(file);
}

/** Replaces only the fields the input gives: a rename, an edit or a tick. */
export async function changeContextFile(
  { db }: ServiceDeps,
  userId: string,
  { contextFileId, ...changes }: ContextFileUpdateInput,
): Promise<Result<ContextFile, 'NOT_FOUND'>> {
  if (!(await updateContextFile(db, userId, contextFileId, changes))) return fail('NOT_FOUND');
  const file = await findContextFileForAuthor(db, userId, contextFileId);
  if (file === undefined) throw new Error(`Context file ${contextFileId} vanished`);
  return ok(file);
}

export async function removeContextFile(
  { db }: ServiceDeps,
  userId: string,
  contextFileId: string,
): Promise<Result<{ id: string }, 'NOT_FOUND'>> {
  if (!(await deleteContextFile(db, userId, contextFileId))) return fail('NOT_FOUND');
  return ok({ id: contextFileId });
}

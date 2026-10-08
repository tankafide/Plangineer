import { GitRef, Repository, RunCreateInput } from '@plangineer/contracts';
import { z } from 'zod';

/** A contract message such as "must not start with - or /" as a sentence about its field. */
function fieldSentence(field: string, message: string): string {
  return `${field} ${message}.`;
}

/** "owner/name" typed as one field, checked with the contract's Repository rules. */
const RepositoryField = z.string().transform((value, context) => {
  const parts = value.trim().split('/');
  const [owner, name] = parts;
  if (parts.length !== 2 || owner === undefined || name === undefined) {
    context.addIssue({ code: 'custom', message: 'Enter the repository as owner/name.' });
    return z.NEVER;
  }
  const repository = Repository.safeParse({ owner, name });
  if (!repository.success) {
    for (const issue of repository.error.issues) {
      context.addIssue({
        code: 'custom',
        message: fieldSentence(`The ${String(issue.path[0])}`, issue.message),
      });
    }
    return z.NEVER;
  }
  return repository.data;
});

/** The New test run form. Its output is the run.create input, so the contract checks both. */
export const NewRunFields = z
  .object({
    runnerId: z.string().min(1, 'Choose a runner.'),
    repository: RepositoryField,
    ref: z
      .string()
      .min(1, 'Enter a branch, tag or commit.')
      .superRefine((ref, context) => {
        const result = GitRef.safeParse(ref);
        if (result.success) return;
        for (const issue of result.error.issues) {
          context.addIssue({ code: 'custom', message: fieldSentence('The ref', issue.message) });
        }
      }),
    prompt: z.string().min(1, 'Enter a prompt.'),
  })
  .pipe(RunCreateInput);
export type NewRunInput = z.input<typeof NewRunFields>;
export type NewRunOutput = z.output<typeof NewRunFields>;

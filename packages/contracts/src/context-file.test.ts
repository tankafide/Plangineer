import { describe, expect, it } from 'vitest';
import { CONTEXT_FILE_CONTENT_MAX, ContextFile, ContextFileUpdateInput } from './context-file.ts';

const ID = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6';

const file = {
  id: ID,
  taskId: ID,
  featureId: ID,
  title: 'Feature brief',
  content: '# Feature brief',
  ticked: true,
  updatedAt: '2026-10-09T12:00:00.000Z',
};

describe('ContextFile', () => {
  it('strips an unknown key', () => {
    expect(ContextFile.parse({ ...file, authorId: ID })).toEqual(file);
  });
});

describe('ContextFileUpdateInput', () => {
  it.each([{ title: ' Brief ' }, { content: 'x' }, { ticked: false }])('accepts %o', (change) => {
    expect(ContextFileUpdateInput.safeParse({ contextFileId: ID, ...change }).success).toBe(true);
  });

  it.each([
    ['no field', {}],
    ['empty content', { content: '' }],
    ['content over the cap', { content: 'x'.repeat(CONTEXT_FILE_CONTENT_MAX + 1) }],
    ['a blank title', { title: '  ' }],
    ['a title over 200 characters', { title: 'x'.repeat(201) }],
  ])('rejects %s', (_name, change) => {
    expect(ContextFileUpdateInput.safeParse({ contextFileId: ID, ...change }).success).toBe(false);
  });
});

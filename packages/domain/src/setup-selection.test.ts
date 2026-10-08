import type { RepositoryScan, SetupSelection } from '@plangineer/contracts';
import { describe, expect, it } from 'vitest';
import { BASELINE_CATALOG } from './baseline-catalog.ts';
import { validateSetupSelection } from './setup-selection.ts';

const REQUIRED = BASELINE_CATALOG.filter((entry) => entry.required).map((entry) => entry.name);

function scan(overrides: Partial<RepositoryScan> = {}): RepositoryScan {
  return {
    commit: 'a'.repeat(40),
    defaultBranch: 'main',
    scannedAt: '2026-10-08T12:00:00.000Z',
    skills: [
      { name: 'legacy-rules', description: null, location: 'claude' },
      { name: 'plan-orchestrator', description: null, location: 'agents' },
    ],
    orchestratorReferences: [],
    unmovableContent: [],
    instructionFiles: [],
    recommendations: [],
    ...overrides,
  };
}

function selection(overrides: Partial<SetupSelection> = {}): SetupSelection {
  return {
    reuseSkills: ['legacy-rules'],
    addSkills: [...REQUIRED, 'backend'],
    orchestrators: ['implementation-orchestrator'],
    ...overrides,
  };
}

describe('validateSetupSelection', () => {
  it('accepts a valid selection', () => {
    expect(validateSetupSelection(scan(), selection())).toEqual({ ok: true });
  });

  it('accepts a required skill the repository already has as a reused skill', () => {
    const repository = scan({
      skills: [{ name: 'testing', description: null, location: 'agents' }],
    });
    const chosen = selection({
      reuseSkills: ['testing'],
      addSkills: REQUIRED.filter((name) => name !== 'testing'),
    });
    expect(validateSetupSelection(repository, chosen)).toEqual({ ok: true });
  });

  it.each([
    [
      'unmovable_content',
      scan({ unmovableContent: ['.claude/skills/notes.md'] }),
      selection(),
      ['.claude/skills/notes.md'],
    ],
    ['nothing_chosen', scan(), selection({ addSkills: [], orchestrators: [] }), []],
    ['unknown_skill', scan(), selection({ reuseSkills: ['ghost'] }), ['ghost']],
    ['unknown_skill', scan(), selection({ addSkills: [...REQUIRED, 'kotlin'] }), ['kotlin']],
    [
      'skill_exists',
      scan({ skills: [{ name: 'backend', description: null, location: 'agents' }] }),
      selection({ reuseSkills: [] }),
      ['backend'],
    ],
    [
      'orchestrator_exists',
      scan(),
      selection({ orchestrators: ['plan-orchestrator'] }),
      ['plan-orchestrator'],
    ],
    [
      'required_skill_missing',
      scan(),
      selection({ addSkills: REQUIRED.filter((name) => name !== 'debugging') }),
      ['debugging'],
    ],
    [
      'required_skill_missing',
      scan(),
      selection({ addSkills: ['backend'], orchestrators: [] }),
      REQUIRED,
    ],
  ])('returns %s', (reason, repository, chosen, names) => {
    expect(validateSetupSelection(repository, chosen)).toEqual({ ok: false, reason, names });
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { planBodyFixture, planRevisionFixture } from '@/test/plan-fixtures';
import { RevisionDiff } from './revision-diff';

const before = planRevisionFixture({ number: 1 });
const body = planBodyFixture();
const after = planRevisionFixture({
  number: 2,
  body: {
    ...body,
    steps: body.steps.map((step, index) => (index === 0 ? { ...step, title: 'Render it' } : step)),
  },
});

/** The code cells that show this line, with the diff's marker class on each. */
function cellsOf(line: string) {
  return screen.getAllByRole('cell').filter((cell) => cell.textContent === line);
}

function changedCells() {
  const cells = screen.getAllByRole('cell');
  return {
    removed: cells.filter((cell) => cell.classList.contains('diff-code-delete')),
    added: cells.filter((cell) => cell.classList.contains('diff-code-insert')),
  };
}

describe('RevisionDiff', () => {
  it.each(['split', 'unified'] as const)(
    'shows a changed step title as one removed and one added line in %s view',
    (view) => {
      render(<RevisionDiff from={before} to={after} view={view} />);

      const { removed, added } = changedCells();
      expect(removed.map((cell) => cell.textContent)).toEqual(['### 1. Step 1']);
      expect(added.map((cell) => cell.textContent)).toEqual(['### 1. Render it']);
      expect(cellsOf('## Steps')).toHaveLength(view === 'split' ? 2 : 1);
    },
  );

  it('marks the changed words inside the changed lines', () => {
    const { container } = render(<RevisionDiff from={before} to={after} view="unified" />);

    const edits = [...container.querySelectorAll('.diff-code-edit')].map(
      (edit) => edit.textContent,
    );
    expect(edits).toEqual(['Step 1', 'Render it']);
  });

  it('says two equal revisions are the same', () => {
    render(<RevisionDiff from={before} to={planRevisionFixture({ number: 2 })} view="split" />);

    expect(screen.getByText('These revisions are the same.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

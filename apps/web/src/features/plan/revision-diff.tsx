import type { PlanRevision } from '@plangineer/contracts';
import { planMarkdown } from '@plangineer/domain';
import { createTwoFilesPatch } from 'diff';
import { useMemo } from 'react';
import { Diff, Hunk, markEdits, parseDiff, tokenize, type ViewType } from 'react-diff-view';
import 'react-diff-view/style/index.css';

/** The two revisions' Markdown as one parsed file with its word-level edits, or null when equal. */
function revisionFile(from: PlanRevision, to: PlanRevision) {
  const oldName = `revision-${from.number}`;
  const newName = `revision-${to.number}`;
  const oldText = planMarkdown(from.body);
  const newText = planMarkdown(to.body);
  if (oldText === newText) return null;
  // parseDiff needs the git header, and the names hold no spaces so it can read them.
  const patch = `diff --git a/${oldName} b/${newName}\n${createTwoFilesPatch(oldName, newName, oldText, newText)}`;
  const [file] = parseDiff(patch);
  if (file === undefined) throw new Error(`The diff of ${oldName} and ${newName} did not parse`);
  return { file, tokens: tokenize(file.hunks, { enhancers: [markEdits(file.hunks)] }) };
}

/**
 * Two plan revisions compared as Markdown, split side by side or unified. The colours come from
 * the theme tokens, set over the library's own in theme.css.
 */
export function RevisionDiff({
  from,
  to,
  view,
}: {
  from: PlanRevision;
  to: PlanRevision;
  view: ViewType;
}) {
  const diff = useMemo(() => revisionFile(from, to), [from, to]);
  if (diff === null) return <p className="text-muted-foreground">These revisions are the same.</p>;
  return (
    <Diff
      viewType={view}
      diffType={diff.file.type}
      hunks={diff.file.hunks}
      tokens={diff.tokens}
      className="font-mono text-xs"
    >
      {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
    </Diff>
  );
}

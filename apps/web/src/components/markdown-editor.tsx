import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { minimalSetup } from 'codemirror';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Colours from the theme tokens, so the editor follows the mode and palette. Highlighted spans
 * inherit the text colour: markup keeps its weight and style, but no bundled colour shows.
 */
const TOKEN_THEME = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--foreground)',
    backgroundColor: 'var(--background)',
    borderRadius: 'var(--radius)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--foreground)', padding: '0.5rem 0' },
  '.cm-line': { padding: '0 0.75rem' },
  '.cm-line span': { color: 'inherit' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'color-mix(in oklch, var(--primary) 30%, transparent)' },
  '.cm-specialChar': { color: 'var(--destructive)' },
});

/**
 * A CodeMirror 6 Markdown editor. The view is made once and destroyed on unmount. A new `value`
 * from outside replaces the text in a transaction, and each edit reports the whole text.
 */
export function MarkdownEditor({
  value,
  onChange,
  labelledBy,
  describedBy,
  invalid = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  labelledBy: string;
  describedBy?: string | undefined;
  invalid?: boolean;
  className?: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The text the view starts with. Later values arrive through the sync effect below.
  const [initialValue] = useState(value);
  // The content's ARIA attributes change through a compartment, never by remaking the view.
  const [attributes] = useState(() => new Compartment());
  const reportChange = useEffectEvent((text: string) => onChange(text));

  useEffect(() => {
    const parent = parentRef.current;
    if (parent === null) throw new Error('The editor has no element to mount in');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          minimalSetup,
          markdown(),
          EditorView.lineWrapping,
          attributes.of([]),
          TOKEN_THEME,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) reportChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [initialValue, attributes]);

  useEffect(() => {
    const contentAttributes: Record<string, string> = {
      'aria-labelledby': labelledBy,
      'aria-invalid': String(invalid),
    };
    if (describedBy !== undefined) contentAttributes['aria-describedby'] = describedBy;
    viewRef.current?.dispatch({
      effects: attributes.reconfigure(EditorView.contentAttributes.of(contentAttributes)),
    });
  }, [attributes, labelledBy, describedBy, invalid]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return (
    <div
      ref={parentRef}
      className={cn(
        'min-h-0 overflow-hidden rounded-lg border border-input font-mono text-base focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-[[aria-invalid=true]]:border-destructive md:text-xs',
        className,
      )}
    />
  );
}

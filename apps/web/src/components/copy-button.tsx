import { useState } from 'react';
import { Button } from '@/components/ui/button';

type CopyState = 'idle' | 'copied' | 'failed';

const LABELS: Record<Exclude<CopyState, 'idle'>, string> = {
  copied: 'Copied',
  failed: 'Copy failed',
};

/** Copies a value to the clipboard and says whether it worked. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<CopyState>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={() => void copy()}>
      {state === 'idle' ? label : LABELS[state]}
    </Button>
  );
}

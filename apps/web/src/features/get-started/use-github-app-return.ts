import { githubAppSetupFailure, useCompleteGithubApp } from '@plangineer/api-client';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { clearManifestState, isManifestState } from './manifest-flow';

/** What GitHub's redirect back to /get-started meant for step 1. */
export interface GithubAppReturn {
  /** The redirect carried a state this setup did not post, so nothing was sent. */
  mismatched: boolean;
  pending: boolean;
  /** Why creating the App failed, or null. */
  failure: string | null;
}

type Redirect = { kind: 'none' } | { kind: 'matched'; code: string } | { kind: 'mismatched' };

function readRedirect(code: string | undefined, state: string | undefined): Redirect {
  if (code === undefined) return { kind: 'none' };
  return state !== undefined && isManifestState(state)
    ? { kind: 'matched', code }
    : { kind: 'mismatched' };
}

/**
 * Completes the GitHub App with the code GitHub's redirect carried, once, and only when its state
 * matches the stored one. Then it removes the code, the state and the stored state, so the
 * single-use code leaves the address bar and the history.
 */
export function useGithubAppReturn({
  code,
  state,
  setupToken,
}: {
  code: string | undefined;
  state: string | undefined;
  setupToken: string | null;
}): GithubAppReturn {
  const [redirect] = useState(() => readRedirect(code, state));
  const complete = useCompleteGithubApp();
  const navigate = useNavigate();
  // StrictMode runs mount effects twice. The code is single-use, so it is sent once.
  const handled = useRef(false);

  const handleRedirect = useEffectEvent(() => {
    if (redirect.kind === 'matched' && setupToken !== null) {
      complete.mutate({ setupToken, code: redirect.code });
    }
    clearManifestState();
    void navigate({ to: '/get-started', search: {}, replace: true });
  });

  useEffect(() => {
    if (handled.current || redirect.kind === 'none') return;
    handled.current = true;
    handleRedirect();
  }, [redirect]);

  return {
    mismatched: redirect.kind === 'mismatched',
    pending: complete.isPending,
    failure: complete.isError ? githubAppSetupFailure(complete.error) : null,
  };
}

import { createPrivateKey } from 'node:crypto';
import { z } from 'zod';
import type { GithubAppCredentials } from './github-app-store.ts';
import { GithubError } from './github.ts';

/** GitHub issues a PKCS#1 key, and Octokit signs with PKCS#8. The issue never holds the key. */
const Pkcs8Key = z.string().transform((pem, context) => {
  try {
    return createPrivateKey(pem).export({ type: 'pkcs8', format: 'pem' }).toString();
  } catch {
    context.addIssue({ code: 'custom', message: 'must be a PEM private key' });
    return z.NEVER;
  }
});

const ConvertedApp = z.object({
  id: z.int().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  pem: Pkcs8Key,
  owner: z.object({ login: z.string().min(1) }),
});

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Exchanges the manifest flow's one-time code for the new App's credentials. A failed answer, or
 * one that is not an App, raises a GithubError with GitHub's status.
 */
export async function convertManifestCode(code: string): Promise<GithubAppCredentials> {
  const response = await fetch(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: 'POST',
      headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    },
  );
  const text = await response.text();
  if (!response.ok) throw new GithubError(response.status, text || response.statusText);
  const parsed = ConvertedApp.safeParse(parseJson(text));
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.') || 'body').join(', ');
    throw new GithubError(response.status, `GitHub's App conversion has invalid fields: ${fields}`);
  }
  const app = parsed.data;
  return {
    appId: app.id,
    slug: app.slug,
    clientId: app.client_id,
    clientSecret: app.client_secret,
    privateKey: app.pem,
    ownerLogin: app.owner.login,
  };
}

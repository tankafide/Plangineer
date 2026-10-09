import { createHash } from 'node:crypto';

export interface FakeRepository {
  installationId: number;
  id: number;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  /** The default branch's head commit. */
  commit: string;
  /** File paths to their text. */
  files: Record<string, string>;
  /** Paths whose tree entry reports this size in place of the text's byte length. */
  sizes: Record<string, number>;
  truncated: boolean;
}

export interface FakePullRequest {
  number: number;
  repositoryId: number;
  head: string;
  base: string;
  title: string;
  body: string;
  state: 'open' | 'closed';
  merged: boolean;
}

/** A token request GitHub received, without the token GitHub returned. */
interface TokenRequest {
  /** The App JWT the request was signed with. */
  appJwt: string;
  installationId: number;
  repositoryIds: number[];
  permissions: Record<string, string>;
}

/** A failure to answer on requests whose path matches, a number of times or every time. */
interface FailureRule {
  pathPattern: RegExp;
  status: number;
  message: string;
  headers: Record<string, string>;
  remaining: number;
  /** How many requests the rule answered. */
  hits: number;
}

/** What an issued token reaches: its installation, and one repository when it was scoped. */
interface IssuedToken {
  installationId: number;
  repositoryId: number | null;
}

export const blobSha = (text: string) => createHash('sha1').update(text).digest('hex');

/** A repository for the fake, with an empty tree on main. */
export function fakeRepository(overrides: Partial<FakeRepository> = {}): FakeRepository {
  return {
    installationId: 1,
    id: 1001,
    owner: 'acme',
    name: 'app',
    private: true,
    defaultBranch: 'main',
    commit: 'c'.repeat(40),
    files: {},
    sizes: {},
    truncated: false,
    ...overrides,
  };
}

/** An App GitHub creates from a manifest, as the manifest conversion answers it. */
interface FakeManifestConversion {
  id: number;
  slug: string;
  clientId: string;
  clientSecret: string;
  /** GitHub issues the key in PKCS#1 form. */
  pem: string;
  ownerLogin: string;
}

/** The in-memory GitHub the handlers serve, which a test sets and reads. */
export interface GithubState {
  /** Manifest flow codes to the App each converts into. */
  manifestConversions: Map<string, FakeManifestConversion>;
  repositories: FakeRepository[];
  pullRequests: FakePullRequest[];
  tokenRequests: TokenRequest[];
  blobReads: string[];
  failures: FailureRule[];
  tokens: Map<string, IssuedToken>;
}

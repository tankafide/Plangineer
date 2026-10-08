import { execa } from 'execa';
import { binPath } from './bin-path.mjs';
import { startPostgres } from './db-up.mjs';
import { reportFailure, repoRoot } from './script-entry.mjs';

const options = { cwd: repoRoot, stdio: 'inherit' };

try {
  await startPostgres();
  await execa('pnpm', ['--filter', '@plangineer/api', 'db:migrate'], options);
  await execa(
    process.execPath,
    [binPath('turbo'), 'run', 'dev', '--filter=@plangineer/api', '--filter=@plangineer/web'],
    options,
  );
} catch (error) {
  reportFailure(error);
}

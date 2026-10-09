/** The command that pairs a machine with this deployment. */
export function runnerLoginCommand(): string {
  return `npx plangineer-runner login --server ${window.location.origin}`;
}

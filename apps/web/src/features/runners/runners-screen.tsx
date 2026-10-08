import { AddRunnerCard } from './add-runner-card';
import { RunnerList } from './runner-list';

/** The Runners screen: add a runner, then see and revoke each one. */
export function RunnersScreen() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Runners</h1>
      <AddRunnerCard />
      <section aria-labelledby="your-runners" className="flex flex-col gap-3">
        <h2 id="your-runners" className="text-base font-semibold">
          Your runners
        </h2>
        <RunnerList />
      </section>
    </div>
  );
}

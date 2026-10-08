import { PairRunnerCard } from './pair-runner-card';
import { RunnerList } from './runner-list';

/** The Runners screen: pair a runner, then see and revoke each one. */
export function RunnersScreen() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Runners</h1>
      <PairRunnerCard />
      <section aria-labelledby="your-runners" className="flex flex-col gap-3">
        <h2 id="your-runners" className="text-base font-semibold">
          Your runners
        </h2>
        <RunnerList />
      </section>
    </div>
  );
}

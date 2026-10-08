import { NewRunForm } from './new-run-form';
import { RunList } from './run-list';

/** The Runs screen: start a test run, and see every run. */
export function RunsScreen() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Runs</h1>
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[24rem_minmax(0,1fr)] lg:items-start">
        <NewRunForm />
        <section aria-labelledby="your-runs" className="flex min-w-0 flex-col gap-3">
          <h2 id="your-runs" className="text-base font-semibold">
            Your runs
          </h2>
          <RunList />
        </section>
      </div>
    </div>
  );
}

import { Link } from '@tanstack/react-router';

const LINK_CLASS =
  'inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-out outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none data-[status=active]:bg-muted data-[status=active]:text-foreground';

/** One row of navigation above every signed-in screen. */
export function AppHeader() {
  return (
    <header className="border-b bg-background">
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-1 px-4 py-1"
      >
        <span className="mr-auto hidden text-sm font-semibold md:inline">Plangineer</span>
        <Link to="/features" className={LINK_CLASS}>
          Features
        </Link>
        <Link to="/" activeOptions={{ exact: true }} className={LINK_CLASS}>
          Account
        </Link>
        <Link to="/runners" className={LINK_CLASS}>
          Runners
        </Link>
        <Link to="/repositories" className={LINK_CLASS}>
          Repositories
        </Link>
        <Link to="/runs" className={LINK_CLASS}>
          Runs
        </Link>
      </nav>
    </header>
  );
}

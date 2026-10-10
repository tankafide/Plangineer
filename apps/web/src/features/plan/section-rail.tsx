import type { PlanWorkspace } from '@plangineer/contracts';
import { Badge } from '@/components/ui/badge';
import { SECTION_LABELS, SECTION_STATUS_BADGES } from './plan-labels';
import { sectionAnchor } from './section-card';

/** Links to each section card on the page, with the section's status. */
export function SectionRail({ sections }: { sections: PlanWorkspace['sections'] }) {
  return (
    <nav aria-label="Plan sections" className="rounded-xl bg-card p-2 ring-1 ring-foreground/10">
      <ul className="flex flex-col gap-1">
        {sections.map(({ section, status }) => {
          const badge = SECTION_STATUS_BADGES[status];
          return (
            <li key={section}>
              {/* An in-page jump to the card, which the browser scrolls to. */}
              <a
                href={`#${sectionAnchor(section)}`}
                className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:min-h-9"
              >
                <span className="min-w-0 truncate">{SECTION_LABELS[section]}</span>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

import {
  Orchestrator,
  type RepositoryScan,
  type SetupSelection,
  SkillName,
} from '@plangineer/contracts';
import { z } from 'zod';

/** The setup form: a runner and the ticked names of each checklist. */
export const SetupFields = z.object({
  runnerId: z.string().min(1, 'Choose a runner.'),
  reuseSkills: z.array(SkillName),
  addSkills: z.array(SkillName),
  orchestrators: z.array(Orchestrator),
});
export type SetupFieldsInput = z.input<typeof SetupFields>;
export type SetupFieldsOutput = z.output<typeof SetupFields>;

type Ticks = Pick<SetupFieldsInput, 'addSkills' | 'orchestrators'>;

/** The orchestrators a scan found already in the repository, which setup must not write. */
export function existingOrchestrators(scan: RepositoryScan): ReadonlySet<Orchestrator> {
  const names = new Set(scan.skills.map((skill) => skill.name));
  return new Set(Orchestrator.options.filter((name) => names.has(name)));
}

/**
 * Required skills are locked on while anything else is ticked, because the fixed and template
 * skills link to them.
 */
export function requiredSkillsLocked(scan: RepositoryScan, ticks: Ticks): boolean {
  const required = new Set(scan.recommendations.filter((r) => r.required).map((r) => r.name));
  return ticks.orchestrators.length > 0 || ticks.addSkills.some((name) => !required.has(name));
}

/** The checklists' starting ticks: the last selection, or every skill, recommendation and new orchestrator. */
export function initialTicks(
  scan: RepositoryScan,
  selection: SetupSelection | null,
): Omit<SetupFieldsInput, 'runnerId'> {
  if (selection !== null) return selection;
  const existing = existingOrchestrators(scan);
  return {
    reuseSkills: scan.skills.map((skill) => skill.name),
    addSkills: scan.recommendations.filter((r) => r.recommended).map((r) => r.name),
    orchestrators: Orchestrator.options.filter((name) => !existing.has(name)),
  };
}

/** The selection the ticks stand for, in scan and catalog order, with locked skills included. */
export function selectionFromTicks(
  scan: RepositoryScan,
  ticks: Omit<SetupFieldsOutput, 'runnerId'>,
): SetupSelection {
  const locked = requiredSkillsLocked(scan, ticks);
  return {
    reuseSkills: scan.skills
      .map((skill) => skill.name)
      .filter((name) => ticks.reuseSkills.includes(name)),
    addSkills: scan.recommendations
      .filter((r) => (locked && r.required) || ticks.addSkills.includes(r.name))
      .map((r) => r.name),
    orchestrators: Orchestrator.options.filter((name) => ticks.orchestrators.includes(name)),
  };
}

import type { RepositoryScan, SelectionError, SetupSelection } from '@plangineer/contracts';
import { BASELINE_CATALOG, catalogEntry } from './baseline-catalog.ts';

export type SelectionCheck =
  | { ok: true }
  | { ok: false; reason: Exclude<SelectionError, 'too_large'>; names: string[] };

/** Whether a selection can start a setup of the scanned repository, with the first rule it breaks. */
export function validateSetupSelection(
  scan: RepositoryScan,
  selection: SetupSelection,
): SelectionCheck {
  if (scan.unmovableContent.length > 0) {
    return { ok: false, reason: 'unmovable_content', names: scan.unmovableContent };
  }
  if (selection.addSkills.length === 0 && selection.orchestrators.length === 0) {
    return { ok: false, reason: 'nothing_chosen', names: [] };
  }
  const scanned = new Set(scan.skills.map((skill) => skill.name));
  const unknown = [
    ...selection.reuseSkills.filter((name) => !scanned.has(name)),
    ...selection.addSkills.filter((name) => !catalogEntry(name)),
  ];
  if (unknown.length > 0) return { ok: false, reason: 'unknown_skill', names: unknown };
  const existing = selection.addSkills.filter((name) => scanned.has(name));
  if (existing.length > 0) return { ok: false, reason: 'skill_exists', names: existing };
  const orchestrators = selection.orchestrators.filter((name) => scanned.has(name));
  if (orchestrators.length > 0) {
    return { ok: false, reason: 'orchestrator_exists', names: orchestrators };
  }
  const chosen = new Set([...selection.addSkills, ...selection.reuseSkills]);
  const missing = BASELINE_CATALOG.filter((entry) => entry.required && !chosen.has(entry.name)).map(
    (entry) => entry.name,
  );
  if (missing.length > 0) return { ok: false, reason: 'required_skill_missing', names: missing };
  return { ok: true };
}

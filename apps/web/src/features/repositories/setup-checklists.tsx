import { CodeText } from './code-text.tsx';
import {
  type CatalogKind,
  Orchestrator,
  type RepositoryScan,
  type ScannedSkill,
} from '@plangineer/contracts';
import type { ReactNode } from 'react';
import { type Control, useController, useWatch } from 'react-hook-form';
import { Checkbox } from '@/components/ui/checkbox';
import {
  existingOrchestrators,
  requiredSkillsLocked,
  type SetupFieldsInput,
  type SetupFieldsOutput,
} from './setup-fields';

type SetupControl = Control<SetupFieldsInput, unknown, SetupFieldsOutput>;

const KIND_LABELS: Record<CatalogKind, string> = {
  fixed: 'Ships as written',
  template: 'Filled in from your code',
  generated: 'Written from your code',
};

function toggled<T>(names: readonly T[], name: T, checked: boolean): T[] {
  return checked ? [...names, name] : names.filter((other) => other !== name);
}

function CheckRow({
  id,
  name,
  checked,
  disabled = false,
  onCheckedChange,
  children,
}: {
  id: string;
  name: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <li className="flex min-h-11 min-w-0 items-start gap-3 py-1">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-notes`}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <label id={`${id}-name`} htmlFor={id} className="font-mono text-xs break-all">
          {name}
        </label>
        <div id={`${id}-notes`} className="flex flex-col gap-0.5 text-muted-foreground">
          {children}
        </div>
      </div>
    </li>
  );
}

function Checklist({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">{title}</legend>
      <ul className="flex flex-col">{children}</ul>
    </fieldset>
  );
}

function SkillNotes({ skill }: { skill: ScannedSkill }) {
  return (
    <>
      {skill.location === 'claude' && <p>Moves to .agents/skills</p>}
      {skill.description !== null && <p className="break-words">{skill.description}</p>}
    </>
  );
}

function ExistingSkills({ scan, control }: { scan: RepositoryScan; control: SetupControl }) {
  const { field } = useController({ control, name: 'reuseSkills' });
  if (scan.skills.length === 0) return null;
  return (
    <Checklist title="Existing skills">
      {scan.skills.map((skill) => (
        <CheckRow
          key={skill.name}
          id={`setup-reuse-${skill.name}`}
          name={skill.name}
          checked={field.value.includes(skill.name)}
          onCheckedChange={(checked) => field.onChange(toggled(field.value, skill.name, checked))}
        >
          <SkillNotes skill={skill} />
        </CheckRow>
      ))}
    </Checklist>
  );
}

function SkillsToAdd({ scan, control }: { scan: RepositoryScan; control: SetupControl }) {
  const { field } = useController({ control, name: 'addSkills' });
  const orchestrators = useWatch({ control, name: 'orchestrators' });
  const locked = requiredSkillsLocked(scan, { addSkills: field.value, orchestrators });
  return (
    <Checklist title="Skills to add">
      {scan.recommendations.map((recommendation) => {
        const lockedOn = locked && recommendation.required;
        return (
          <CheckRow
            key={recommendation.name}
            id={`setup-add-${recommendation.name}`}
            name={recommendation.name}
            checked={lockedOn || field.value.includes(recommendation.name)}
            disabled={lockedOn}
            onCheckedChange={(checked) =>
              field.onChange(toggled(field.value, recommendation.name, checked))
            }
          >
            <p>
              <CodeText text={recommendation.reason} />
            </p>
            <p>{KIND_LABELS[recommendation.kind]}</p>
            {lockedOn && <p>Required by every setup</p>}
          </CheckRow>
        );
      })}
    </Checklist>
  );
}

function Orchestrators({ scan, control }: { scan: RepositoryScan; control: SetupControl }) {
  const { field } = useController({ control, name: 'orchestrators' });
  const existing = existingOrchestrators(scan);
  return (
    <Checklist title="Orchestrators">
      {Orchestrator.options.map((name) => (
        <CheckRow
          key={name}
          id={`setup-orchestrator-${name}`}
          name={name}
          checked={!existing.has(name) && field.value.includes(name)}
          disabled={existing.has(name)}
          onCheckedChange={(checked) => field.onChange(toggled(field.value, name, checked))}
        >
          {existing.has(name) && <p>Already in the repository</p>}
        </CheckRow>
      ))}
    </Checklist>
  );
}

/** The three setup checklists: skills to keep routing to, skills to add, and orchestrators. */
export function SetupChecklists({
  scan,
  control,
}: {
  scan: RepositoryScan;
  control: SetupControl;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ExistingSkills scan={scan} control={control} />
      <SkillsToAdd scan={scan} control={control} />
      <Orchestrators scan={scan} control={control} />
    </div>
  );
}

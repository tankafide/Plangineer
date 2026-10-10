import {
  ATTACHMENT_BYTES_MAX,
  ATTACHMENT_NAME_MAX,
  ATTACHMENTS_MAX,
  ATTACHMENTS_TOTAL_BYTES_MAX,
  AttachmentMediaType,
  FEATURE_DESCRIPTION_MAX,
  FeatureCreateInput,
  RESEARCH_TOPICS_MAX,
  ResearchTopic,
  RunMode,
  TicketUrl,
} from '@plangineer/contracts';
import { z } from 'zod';

const MIB = 1024 * 1024;

/** Why one attachment breaks the contract's rules, or null when it keeps them. */
function attachmentProblem(file: File): string | null {
  if (!AttachmentMediaType.safeParse(file.type).success) {
    return `${file.name} is not a PNG, JPEG, GIF, WebP, PDF, text or Markdown file.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > ATTACHMENT_BYTES_MAX) {
    return `${file.name} is larger than ${ATTACHMENT_BYTES_MAX / MIB} MiB.`;
  }
  if (file.name.length > ATTACHMENT_NAME_MAX) {
    return `${file.name.slice(0, 40)}… has a name longer than ${ATTACHMENT_NAME_MAX} characters.`;
  }
  return null;
}

const AttachmentsField = z
  .array(z.file())
  .max(ATTACHMENTS_MAX, `Attach at most ${ATTACHMENTS_MAX} files.`)
  .superRefine((files, context) => {
    for (const file of files) {
      const problem = attachmentProblem(file);
      if (problem !== null) context.addIssue({ code: 'custom', message: problem });
    }
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > ATTACHMENTS_TOTAL_BYTES_MAX) {
      context.addIssue({
        code: 'custom',
        message: `Attach at most ${ATTACHMENTS_TOTAL_BYTES_MAX / MIB} MiB in all.`,
      });
    }
  });

/** One topic per line, with blank lines dropped. */
const ResearchTopicsField = z
  .string()
  .transform((text) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== ''),
  )
  .superRefine((topics, context) => {
    if (topics.length > RESEARCH_TOPICS_MAX) {
      context.addIssue({
        code: 'custom',
        message: `Enter at most ${RESEARCH_TOPICS_MAX} topics.`,
      });
    }
    const long = topics.find((topic) => !ResearchTopic.safeParse(topic).success);
    if (long !== undefined) {
      context.addIssue({
        code: 'custom',
        message: `This topic is too long. Keep each topic to one short line: ${long.slice(0, 40)}…`,
      });
    }
  });

/** The intake form. Its output is the feature.create input, so the contract checks both. */
export const IntakeFields = z
  .object({
    repositoryId: z.string().min(1, 'Choose a repository.'),
    description: z
      .string()
      .trim()
      .min(1, 'Describe the feature.')
      .max(FEATURE_DESCRIPTION_MAX, 'Keep the description to 50,000 characters.'),
    ticketUrl: z
      .string()
      .trim()
      .refine(
        (url) => url === '' || TicketUrl.safeParse(url).success,
        'Enter an https link to the ticket.',
      )
      .transform((url) => (url === '' ? undefined : url)),
    attachments: AttachmentsField,
    exploreCodebase: z.boolean(),
    researchTopics: ResearchTopicsField,
    runMode: RunMode,
  })
  .transform(({ repositoryId, ...intake }): z.input<typeof FeatureCreateInput> => ({
    ...intake,
    repositoryIds: [repositoryId],
  }))
  .pipe(FeatureCreateInput);
export type IntakeInput = z.input<typeof IntakeFields>;
export type IntakeOutput = z.output<typeof IntakeFields>;

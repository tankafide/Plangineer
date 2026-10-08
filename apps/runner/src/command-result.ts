/** What a CLI command ends with: the line to print, on stdout when ok and on stderr otherwise. */
export type CommandResult = { ok: boolean; message: string };

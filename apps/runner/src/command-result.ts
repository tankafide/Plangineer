/**
 * What a CLI command ends with: its exit code, and the line to print, on stdout for 0 and on
 * stderr otherwise. A null message prints nothing. Code 3 means this runner needs pairing.
 */
export type CommandResult = { exitCode: 0 | 1 | 3; message: string | null };

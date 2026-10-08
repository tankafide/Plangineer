/** Resolves to the name of the constraint a failed write broke. */
export async function brokenConstraint(write: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await write.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  const cause = error instanceof Error ? error.cause : undefined;
  return typeof cause === 'object' && cause !== null && 'constraint' in cause
    ? String(cause.constraint)
    : undefined;
}

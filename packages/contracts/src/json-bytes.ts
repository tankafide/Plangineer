/** The UTF-8 byte length of a value serialized as JSON. */
export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

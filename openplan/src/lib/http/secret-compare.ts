import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for shared-secret headers. Returns false for
 * missing/empty values rather than throwing.
 */
export function timingSafeSecretEquals(
  supplied: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!supplied || !expected) {
    return false;
  }

  const suppliedBuffer = Buffer.from(supplied, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

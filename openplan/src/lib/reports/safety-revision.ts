/** Browser-safe comparison of PostgreSQL revision instants, retaining microseconds. */
export function sameSafetyRevision(left: unknown, right: unknown): boolean {
  function key(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) return null;
    const seconds = Date.parse(`${match[1]}${match[3]}`);
    return Number.isFinite(seconds) ? `${seconds}:${(match[2] ?? "").padEnd(6, "0")}` : null;
  }
  const first = key(left);
  return first !== null && first === key(right);
}

/** Compare callback instants without dropping fractional-second precision. */
export function compareCallbackTimes(left: string, right: string): number | null {
  function parts(value: string) {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.([0-9]+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) return null;
    const seconds = Date.parse(match[1] + match[3]);
    if (!Number.isFinite(seconds)) return null;
    return { seconds, fraction: (match[2] ?? "").replace(/0+$/, "") };
  }
  const a = parts(left);
  const b = parts(right);
  if (!a || !b) return null;
  if (a.seconds !== b.seconds) return a.seconds < b.seconds ? -1 : 1;
  const first = a.fraction;
  const second = b.fraction;
  return first === second ? 0 : first < second ? -1 : 1;
}

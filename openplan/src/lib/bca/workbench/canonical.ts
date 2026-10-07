/** Stable identity for the exact document across JSON key order and retained retries. */
export function canonicalBcaJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalBcaJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalBcaJson(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

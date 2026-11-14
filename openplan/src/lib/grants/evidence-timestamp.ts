/**
 * Client-safe, so a screen and an export print the same instant the same way
 * (KI-2026-11-14-116). Evidence appendices, the Safety seed header and the
 * seed report picker all use it.
 */

/**
 * A stored timestamp as a planner reads it: "Nov 3, 2026, 05:42 UTC". A value
 * with no time of day prints as the date alone. A value that is not a date
 * prints as stored, so nothing is invented.
 */
export function formatEvidenceTimestamp(value: string | null | undefined): string {
  const text = value?.trim() ?? "";
  if (!text) return "Not recorded";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const parsed = new Date(dateOnly ? `${text}T00:00:00Z` : text);
  if (Number.isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(text)) return text;
  const day = parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (dateOnly) return day;
  const time = parsed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${day}, ${time} UTC`;
}

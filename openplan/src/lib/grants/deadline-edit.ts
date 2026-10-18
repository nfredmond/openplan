import { dateTimeInputOf, instantFromWallClock } from "@/lib/time/workspace-calendar";
import { validTimeZone } from "@/lib/work/deadlines";

export type RecordedGrantDeadlines = { closesAt: string | null; decisionDueAt: string | null };
export type GrantDeadlineDraft = { closesAt: string; decisionDueAt: string };
export type GrantDeadlinePatch = Partial<RecordedGrantDeadlines>;

export const GRANT_DEADLINE_FIELDS = [
  { name: "closesAt", label: "Application closing deadline" },
  { name: "decisionDueAt", label: "Pursue-or-skip decision deadline" },
] as const;

/** Read the browser's declared zone without a jurisdiction or UTC fallback. */
export function browserDeadlineTimeZone(): string | null {
  try {
    return validTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

/** Display local minutes without replacing the original timestamp strings. */
export function grantDeadlineDraft(recorded: RecordedGrantDeadlines, timeZone: string): GrantDeadlineDraft {
  if (!validTimeZone(timeZone)) throw new Error("The browser time zone could not be read. Reopen the editor to try again.");
  const draft: GrantDeadlineDraft = { closesAt: "", decisionDueAt: "" };
  for (const { name, label } of GRANT_DEADLINE_FIELDS) {
    const value = recorded[name];
    draft[name] = dateTimeInputOf(value, timeZone);
    if (value !== null && !draft[name]) throw new Error(`${label} could not be read. Reload before editing dates.`);
  }
  return draft;
}

/** Omit untouched fields so displaying minutes never rewrites retained precision. */
export function grantDeadlinePatch(
  recorded: RecordedGrantDeadlines,
  draft: GrantDeadlineDraft,
  timeZone: string
): GrantDeadlinePatch {
  const original = grantDeadlineDraft(recorded, timeZone);
  const patch: GrantDeadlinePatch = {};
  for (const { name, label } of GRANT_DEADLINE_FIELDS) {
    const local = draft[name];
    if (local === original[name]) continue;
    if (local === "") {
      patch[name] = null;
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error(`Enter a valid local date and time for ${label.toLowerCase()}.`);
    const instant = instantFromWallClock(local, timeZone);
    // The shared helper advances a nonexistent daylight-saving time. An edit
    // must instead ask the person for a time that exists in the displayed zone.
    if (!instant || dateTimeInputOf(instant, timeZone) !== local) {
      throw new Error(`${label} is not a valid local time in ${timeZone}. Choose another time.`);
    }
    patch[name] = instant;
  }
  return patch;
}

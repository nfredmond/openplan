/**
 * The canonical text form of a uuid: 8-4-4-4-12 hexadecimal digits, either case.
 *
 * WHY A PAGE OR ROUTE CHECKS THIS BEFORE IT QUERIES. A dynamic segment such as
 * `/projects/[projectId]` receives whatever string is in the URL, including
 * `/projects/new`. Handed to `.eq("id", "new")`, Postgres refuses the cast with
 * 22P02 ("invalid input syntax for type uuid"), and a page that correctly reads
 * any non-PGRST116 error as a failed read then tells the planner the record
 * "could not be read", quoting the database. A string that is not a uuid cannot
 * name any record, so the truthful answer is "not found", decided before any
 * query runs. A real failed read still says so, because only this check is new.
 *
 * Deliberately loose about version and variant digits: Postgres accepts any
 * hexadecimal value in this shape, and fixtures and older rows are not all RFC
 * 4122 version 4. Postgres also accepts brace-wrapped and unhyphenated forms;
 * OpenPlan never links to those, so they are treated as malformed here.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a string in canonical uuid text form. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

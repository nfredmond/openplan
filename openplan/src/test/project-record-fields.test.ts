import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROJECT_DEFAULT_DELIVERY_PHASE,
  PROJECT_DEFAULT_STATUS,
  PROJECT_DELIVERY_PHASES,
  PROJECT_DELIVERY_PHASE_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  projectDeliveryPhaseSchema,
  projectNameSchema,
  projectStatusSchema,
} from "@/lib/projects/project-record-fields";

const PROJECTS_MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/20260313000011_projects_module.sql"
);

function checkValues(column: string): string[] {
  const sql = readFileSync(PROJECTS_MIGRATION, "utf8");
  const pattern = new RegExp(`${column}[^,]*?CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, "is");
  const match = sql.match(pattern);
  if (!match) throw new Error(`No CHECK constraint found for ${column} in ${PROJECTS_MIGRATION}`);
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1]);
}

describe("project record fields", () => {
  it("matches the status vocabulary the database enforces", () => {
    expect([...PROJECT_STATUSES].sort()).toEqual(checkValues("status").sort());
  });

  it("matches the delivery-phase vocabulary the database enforces", () => {
    expect([...PROJECT_DELIVERY_PHASES].sort()).toEqual(checkValues("delivery_phase").sort());
  });

  it("defaults to values the database would accept", () => {
    expect(PROJECT_STATUSES).toContain(PROJECT_DEFAULT_STATUS);
    expect(PROJECT_DELIVERY_PHASES).toContain(PROJECT_DEFAULT_DELIVERY_PHASE);
  });

  it("labels every value, so a new one cannot ship unlabelled", () => {
    expect(Object.keys(PROJECT_STATUS_LABELS).sort()).toEqual([...PROJECT_STATUSES].sort());
    expect(Object.keys(PROJECT_DELIVERY_PHASE_LABELS).sort()).toEqual([...PROJECT_DELIVERY_PHASES].sort());
  });

  it("rejects a value outside the vocabulary rather than passing it to Postgres", () => {
    // This is the regression the shared schema fixes: the create route validated
    // status as a free string, so an unrecognized value became a 500 from a
    // CHECK violation rather than a 400 naming the allowed set.
    expect(projectStatusSchema.safeParse("archived").success).toBe(false);
    expect(projectDeliveryPhaseSchema.safeParse("construction").success).toBe(false);
    expect(projectStatusSchema.safeParse("on_hold").success).toBe(true);
  });

  it("trims and bounds the free-text name", () => {
    expect(projectNameSchema.parse("  Main Street Corridor  ")).toBe("Main Street Corridor");
    expect(projectNameSchema.safeParse("   ").success).toBe(false);
    expect(projectNameSchema.safeParse("x".repeat(121)).success).toBe(false);
  });

  it("guards the guard — the migration really does constrain these columns", () => {
    // If the CHECK were ever dropped, checkValues would throw and the parity
    // assertions above would become vacuous rather than failing.
    expect(checkValues("status").length).toBeGreaterThan(1);
    expect(checkValues("delivery_phase").length).toBeGreaterThan(1);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessProjectDelete,
  PROJECT_DELETE_RELATIONS,
} from "@/lib/projects/project-delete-preconditions";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

/**
 * Every table that declares a foreign key to `projects`, read from the
 * migrations rather than from a list someone remembered to update.
 */
function tablesReferencingProjects(): Set<string> {
  const referencing = new Set<string>();

  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql"))) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

    // Inline column definitions: `project_id uuid REFERENCES public.projects(id)`,
    // and the ALTER form used when a link is added to an existing table.
    for (const match of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(([\s\S]*?)\n\);/gi
    )) {
      const [, table, body] = match;
      if (/REFERENCES\s+(?:public\.)?projects\s*\(/i.test(body)) referencing.add(table);
    }

    for (const match of sql.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?([\s\S]*?);/gi
    )) {
      const [, table, body] = match;
      if (/REFERENCES\s+(?:public\.)?projects\s*\(/i.test(body)) referencing.add(table);
    }
  }

  referencing.delete("projects");
  return referencing;
}

describe("project delete preconditions", () => {
  it("knows about every table that references projects", () => {
    const known = new Set(PROJECT_DELETE_RELATIONS.map((relation) => relation.table));
    const missing = [...tablesReferencingProjects()].filter((table) => !known.has(table)).sort();

    expect(
      missing,
      "These tables hold a foreign key to projects but are absent from PROJECT_DELETE_RELATIONS, " +
        "so a project delete would destroy or orphan their rows without the refusal ever mentioning " +
        "them. Add each one with the severity and cascade behaviour its foreign key declares."
    ).toEqual([]);
  });

  it("keeps the inventory honest — no relation that is not a real foreign key", () => {
    const real = tablesReferencingProjects();
    const stale = PROJECT_DELETE_RELATIONS.map((relation) => relation.table)
      .filter((table) => !real.has(table))
      .sort();

    expect(stale, "Listed as referencing projects but no migration declares that foreign key.").toEqual([]);
  });

  it("allows deleting a project that carries nothing", () => {
    const assessment = assessProjectDelete({}, { projectId: "p1" });

    expect(assessment.deletable).toBe(true);
    expect(assessment.blockers).toEqual([]);
    expect(assessment.hasCommitments).toBe(false);
  });

  it("refuses a project that carries work, and says where it lives", () => {
    const assessment = assessProjectDelete({ reports: 2, model_runs: 5 }, { projectId: "p1" });

    expect(assessment.deletable).toBe(false);
    expect(assessment.blockers.map((blocker) => blocker.table)).toEqual(["model_runs", "reports"]);
    expect(assessment.blockers.every((blocker) => blocker.href.length > 0)).toBe(true);
    expect(assessment.alternative).toContain("status to complete");
  });

  it("distinguishes work that would be destroyed from work that would be orphaned", () => {
    const assessment = assessProjectDelete({ reports: 1, model_runs: 1 }, { projectId: "p1" });

    const reports = assessment.blockers.find((blocker) => blocker.table === "reports");
    const runs = assessment.blockers.find((blocker) => blocker.table === "model_runs");

    expect(reports?.behavior).toBe("cascade");
    expect(reports?.reason).toContain("deleted along with the project");
    expect(runs?.behavior).toBe("orphan");
    expect(runs?.reason).toContain("stop being attributed");
  });

  it("treats funder-facing money as a commitment, ranked first and answered differently", () => {
    const assessment = assessProjectDelete(
      { reports: 9, billing_invoice_records: 1 },
      { projectId: "p1" }
    );

    expect(assessment.hasCommitments).toBe(true);
    // Commitments outrank a larger pile of ordinary evidence.
    expect(assessment.blockers[0]?.table).toBe("billing_invoice_records");
    expect(assessment.headline).toContain("meant to outlive");
    // "Delete the children first" is not honest advice for an invoice already
    // sent to a funder, so that sentence must not appear.
    expect(assessment.alternative).not.toContain("remove the attached records");
  });

  it("counts a funding award as a commitment even though its rows would cascade", () => {
    const assessment = assessProjectDelete({ funding_awards: 1 }, { projectId: "p1" });

    expect(assessment.hasCommitments).toBe(true);
    expect(assessment.blockers[0]?.behavior).toBe("cascade");
    expect(assessment.blockers[0]?.reason).toContain("destroyed");
  });

  it("substitutes the project id into module links", () => {
    const assessment = assessProjectDelete({ project_spend_entries: 1 }, { projectId: "abc" });
    expect(assessment.blockers[0]?.href).toBe("/projects/abc");
  });

  it("reads a zero count as empty and a missing count as empty only when told", () => {
    // A relation explicitly counted at zero is not a blocker.
    expect(assessProjectDelete({ reports: 0 }, { projectId: "p1" }).deletable).toBe(true);
    // The route refuses outright when a relation could not be COUNTED at all;
    // that path never reaches this function, which is why absence reads as zero.
    expect(assessProjectDelete({}, { projectId: "p1" }).deletable).toBe(true);
  });

  it("guards the guard — the inventory covers both cascade behaviours and both severities", () => {
    expect(PROJECT_DELETE_RELATIONS.length).toBeGreaterThanOrEqual(30);
    expect(PROJECT_DELETE_RELATIONS.some((r) => r.behavior === "cascade")).toBe(true);
    expect(PROJECT_DELETE_RELATIONS.some((r) => r.behavior === "orphan")).toBe(true);
    expect(PROJECT_DELETE_RELATIONS.some((r) => r.severity === "blocking")).toBe(true);
    expect(PROJECT_DELETE_RELATIONS.some((r) => r.severity === "evidence")).toBe(true);
    // Every relation must be actionable: a blocker a planner cannot navigate to
    // is a dead end.
    expect(PROJECT_DELETE_RELATIONS.every((r) => r.href.startsWith("/"))).toBe(true);
  });
});

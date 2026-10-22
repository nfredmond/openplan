import { describe, expect, it } from "vitest";
import { looksLikePendingSchema, readPendingSchemaMissingColumn } from "@/lib/supabase/pending-schema";

describe("canonical missing-column parser", () => {
  it.each([
    "column jurisdiction_context does not exist",
    "column projects.jurisdiction_context does not exist",
    'column projects."jurisdiction_context" does not exist',
    "column public.projects.jurisdiction_context does not exist",
    "column public.projects.'jurisdiction_context' does not exist",
    "Could not find the 'jurisdiction_context' column of 'projects' in the schema cache",
    'Could not find the "jurisdiction_context" column of "projects" in the schema cache',
  ])("reads the supported missing-column form: %s", message => {
    expect(readPendingSchemaMissingColumn(message, "projects"), "Supported missing column retains its identity").toBe("jurisdiction_context");
  });

  it("uses the supplied relation rather than a project-specific classifier", () => {
    expect(readPendingSchemaMissingColumn("column reports.title does not exist", "reports")).toBe("title");
    expect(readPendingSchemaMissingColumn("Could not find the 'title' column of 'reports' in the schema cache", "reports")).toBe("title");
  });

  it.each([
    "column reports.jurisdiction_context does not exist",
    "Could not find the 'jurisdiction_context' column of 'reports' in the schema cache",
  ])("refuses a different relation: %s", message => {
    expect(readPendingSchemaMissingColumn(message, "projects"), "Named relation must match").toBeNull();
  });

  it.each([
    undefined, null, "", "schema cache unavailable",
    'relation "projects" does not exist',
    "Could not find the table 'projects' in the schema cache",
    "permission denied for table projects", "connection terminated unexpectedly",
    "permission denied: column projects.jurisdiction_context does not exist",
    "column projects.jurisdiction_context does not exist; permission denied",
    "Could not find the 'jurisdiction_context' column of 'projects'",
    "column other.projects.jurisdiction_context does not exist",
    'column "projects".jurisdiction_context does not exist',
    "column p.jurisdiction_context does not exist",
    'column projects."jurisdiction_context\' does not exist',
    "column projects.jurisdiction_context' does not exist",
    'column projects."jurisdiction.context" does not exist',
    "Could not find the 'jurisdiction_context\" column of 'projects' in the schema cache",
  ])("refuses an unrecognized or unsafe message: %s", message => {
    expect(readPendingSchemaMissingColumn(message, "projects"), "Unknown forms must refuse narrowing").toBeNull();
  });

  it.each(["", "public.projects", '"projects"', "projects alias"])("refuses an unsupported relation argument: %s", relation => {
    expect(readPendingSchemaMissingColumn("column jurisdiction_context does not exist", relation), "Relation argument must be a simple name").toBeNull();
  });

  it("preserves quoted column spelling for the caller's exact allowlist", () => {
    expect(readPendingSchemaMissingColumn('column projects."Jurisdiction_Context" does not exist', "projects"), "Quoted names retain case").toBe("Jurisdiction_Context");
  });

  it("leaves the ordinary boolean classifier broader than column parsing", () => {
    for (const message of ['relation "projects" does not exist', "schema cache unavailable"]) {
      expect(looksLikePendingSchema(message), "Existing boolean classification is unchanged").toBe(true);
      expect(readPendingSchemaMissingColumn(message, "projects"), "Boolean classification alone cannot identify a column").toBeNull();
    }
  });
});

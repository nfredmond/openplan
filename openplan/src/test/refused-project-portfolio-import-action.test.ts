/**
 * Bulk project-list import is deliberately human-only.
 *
 * The CSV mapping decides which outside text becomes the agency's project
 * names, descriptions, costs, types, statuses, and phases. A plausible wrong
 * mapping can author an entire portfolio, and an approval card cannot make
 * 2,000 source rows reviewable. The shipped workflow therefore stores the
 * source, previews every row, defaults each row to skip, and requires the
 * planner to confirm the exact preview hash. An assistant may explain that
 * workflow, but it may not bypass it with one bulk action.
 *
 * This remains refused even though the importer is create-only and atomic.
 * Atomicity prevents half an import; it does not make the chosen mapping or
 * 2,000 proposed records trustworthy.
 */
import { describe, expect, it } from "vitest";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";

const NAME_GROUPS = [
  ["import", "project", "list"],
  ["import", "project", "csv"],
  ["import", "portfolio", "csv"],
  ["bulk", "create", "project"],
  ["bulk", "import", "portfolio"],
  ["create", "projects", "csv"],
] as const;

const PROVOKERS = [
  "import_project_list",
  "import_project_csv",
  "import_portfolio_csv",
  "bulk_create_projects",
  "bulk_import_portfolio",
  "create_projects_from_csv",
] as const;

function matches(kind: string, group: readonly string[]): boolean {
  return group.every((word) => kind.includes(word));
}

describe("the assistant remains refused from bulk project import", () => {
  it("registers no action matching a bulk project-list import", () => {
    const registered = Object.keys(ACTION_METADATA);
    const offenders = registered.filter((kind) => NAME_GROUPS.some((group) => matches(kind, group)));
    expect(
      offenders,
      "Bulk project import authors outside content at a scale no approval card can render. Keep the reviewed Projects-page workflow human-only."
    ).toEqual([]);
  });

  it("guards every refusal spelling against its own plausible action name", () => {
    NAME_GROUPS.forEach((group, index) => {
      expect(matches(PROVOKERS[index], group), `${group.join("+")} has a broken provoker`).toBe(true);
    });
  });

  it("does not refuse ordinary one-project or source-storage actions", () => {
    for (const kind of ["create_project", "upload_knowledge_base_document", "create_funding_opportunity"]) {
      expect(NAME_GROUPS.some((group) => matches(kind, group)), kind).toBe(false);
    }
  });
});

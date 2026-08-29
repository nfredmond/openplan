import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildJurisdictionReadinessEvidenceFile } from "@/lib/jurisdiction-readiness/evidence-bundle";

describe("jurisdiction readiness evidence handoff", () => {
  it("freezes the same full-hash claim record into the project bundle", () => {
    const file = buildJurisdictionReadinessEvidenceFile(
      {
        id: "33333333-3333-4333-8333-333333333333",
        place_label: "Puerto Rico",
        place_country_code: "US",
        place_subdivision_code: "PR",
      },
      "c".repeat(64),
    );
    const payload = JSON.parse(file.bytes.toString("utf8"));

    expect(file.path).toBe("project/jurisdiction-readiness.json");
    expect(file.sourceId).toBe("jurisdiction_readiness");
    expect(file.revisionToken).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.registrySha256).toBe("c".repeat(64));
    expect(payload.jurisdiction.id).toBe("US-PR");
    expect(payload.reports.find((report: { job: { id: string } }) => report.job.id === "land-use-plan"))
      .toMatchObject({ status: "unavailable", sources: expect.any(Array) });
  });

  it("freezes an unknown place as unassessed instead of borrowing another jurisdiction", () => {
    const file = buildJurisdictionReadinessEvidenceFile(
      {
        id: "33333333-3333-4333-8333-333333333333",
        place_label: "A Nevada county",
        place_country_code: "US",
        place_subdivision_code: "NV",
      },
      "d".repeat(64),
    );
    const text = file.bytes.toString("utf8");
    const payload = JSON.parse(text);

    expect(payload.reports.every((report: { status: string }) => report.status === "unassessed")).toBe(true);
    expect(text).not.toContain("California");
  });

  it("keeps the readiness file in the generated project bundle assembly", () => {
    const assembly = readFileSync(
      resolve(process.cwd(), "src/lib/project-evidence-bundles/generated-records.ts"),
      "utf8",
    );
    expect(assembly).toMatch(/const jurisdictionReadinessFile = buildJurisdictionReadinessEvidenceFile/);
    expect(assembly).toMatch(/files:\s*\[[\s\S]*jurisdictionReadinessFile,[\s\S]*project\/project\.gpkg/);
  });
});

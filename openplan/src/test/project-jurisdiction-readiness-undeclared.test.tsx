import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectJurisdictionReadiness } from "@/app/(app)/projects/[projectId]/_components/project-jurisdiction-readiness";
import { buildProjectJurisdictionReadinessExportPayload } from "@/lib/jurisdiction-readiness/payload";
import { jurisdictionReadinessRegistrySha256 } from "@/lib/jurisdiction-readiness/custody";

// Rehearsal defect D2: a project created a minute ago was labelled "Legacy
// study-place context" three times. The page now says the jurisdiction is not
// declared. The hashed export keeps its wording, because reports store its
// fingerprint and compare it to decide whether a report is current.
// Blind category: layout and the editor above the panel are not rendered here.

afterEach(() => cleanup());

const PROJECT = {
  id: "11111111-1111-4111-8111-111111111111",
  updated_at: "2026-11-03T00:00:00.000Z",
  jurisdiction_context: null,
  place_label: "Sierra County, CA",
  place_country_code: "US",
  place_subdivision_code: "CA",
};

describe("a project with no declared jurisdiction", () => {
  it("says the jurisdiction is not declared, with no legacy wording", () => {
    const { container } = render(<ProjectJurisdictionReadiness project={PROJECT} />);
    expect(container.textContent).not.toMatch(/legacy/i);
    expect(screen.getByText(/^Jurisdiction not declared\./)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sierra County, CA" })).toBeTruthy();
  });

  it("names a missing study place plainly", () => {
    render(<ProjectJurisdictionReadiness project={{ ...PROJECT, place_label: null, place_country_code: null, place_subdivision_code: null }} />);
    expect(screen.getByRole("heading", { name: "Study place not set" })).toBeTruthy();
  });

  it("keeps the hashed export wording that stored report fingerprints depend on", () => {
    const exported = buildProjectJurisdictionReadinessExportPayload(PROJECT, jurisdictionReadinessRegistrySha256());
    expect(exported.disclosure).toBe("Legacy study-place context only. No separate jurisdiction has been declared. Adopting authority and legal applicability remain unresolved.");
    expect(exported.entries[0]?.assessmentScope).toBe("legacy study-place context");
  });
});

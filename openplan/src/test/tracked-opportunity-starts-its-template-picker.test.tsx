import { render, screen } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * AN OPPORTUNITY TRACKED FROM A CATALOG CARD STARTS ITS TEMPLATE PICKER ON
 * THAT PROGRAM (KI-2026-11-16-035).
 *
 * Tracking from a catalog card copies the program's name and administering
 * agency onto the opportunity. Its application workspace opened on "Custom
 * scaffold", and the planner had to find the program again among the
 * templates. The registry card now reads the program back from those two
 * fields and tells the workspace, which starts the picker there
 * (`funding-opportunity-application-workspace.test.tsx` checks the picker).
 *
 * Blind category: an opportunity whose title or agency the planner edited
 * after tracking (it matches nothing and starts on the custom scaffold, by
 * design), and the screen itself.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/programs/funding-opportunity-decision-controls", () => ({
  FundingOpportunityDecisionControls: () => <div />,
}));

// The application workspace is replaced by a marker that shows the one prop under test.
vi.mock("@/components/grants/funding-opportunity-application-workspace", () => ({
  FundingOpportunityApplicationWorkspace: (props: { trackedCatalogKey?: string | null }) => (
    <div data-testid="application-workspace" data-tracked-catalog-key={props.trackedCatalogKey ?? ""} />
  ),
}));

import { GrantsOpportunityRegistryCard } from "@/components/grants/grants-opportunity-registry-card";
import { catalogKeyTrackedAs } from "@/lib/grants/application-templates";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";

type Opportunity = Parameters<typeof GrantsOpportunityRegistryCard>[0]["opportunity"];

const baseOpportunity = {
  id: "op-1",
  workspace_id: "ws-1",
  program_id: null,
  project_id: null,
  title: "Bridge Replacement HBP",
  opportunity_status: "open",
  decision_state: "pursuing",
  agency_name: "Caltrans",
  owner_label: null,
  cadence_label: null,
  expected_award_amount: null,
  opens_at: null,
  closes_at: null,
  decision_due_at: null,
  fit_notes: null,
  readiness_notes: null,
  decision_rationale: null,
  decided_at: null,
  summary: null,
  updated_at: "2026-03-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  programs: null,
  projects: null,
  program: null,
  project: null,
} as unknown as Opportunity;

describe("an opportunity tracked from a catalog card", () => {
  it("tells the application workspace which catalog program the opportunity was tracked from (KI-2026-11-16-035)", () => {
    const trackedKey = (opportunity: Opportunity) => {
      const { unmount } = render(<GrantsOpportunityRegistryCard opportunity={opportunity} activeFocusedOpportunityId={null} projectGrantModelingEvidence={null} />);
      const key = screen.getByTestId("application-workspace").getAttribute("data-tracked-catalog-key");
      unmount();
      return key;
    };
    // Tracking from a catalog card copies the program's name and administering agency.
    const atp = GRANT_PROGRAM_CATALOG.find((entry) => entry.key === "atp")!;
    expect(trackedKey({ ...baseOpportunity, title: atp.name, agency_name: atp.administeringAgency } as Opportunity)).toBe("atp");
    // Another program's card gives another key: the key is read from the row, not fixed.
    const other = GRANT_PROGRAM_CATALOG.find((entry) => entry.key !== "atp" && catalogKeyTrackedAs({ title: entry.name, agencyName: entry.administeringAgency }) === entry.key)!;
    expect(trackedKey({ ...baseOpportunity, title: other.name, agency_name: other.administeringAgency } as Opportunity)).toBe(other.key);
    // A title a planner typed, or the program's name under another agency, matches nothing.
    expect(trackedKey(baseOpportunity)).toBe("");
    expect(trackedKey({ ...baseOpportunity, title: atp.name, agency_name: "Caltrans" } as Opportunity)).toBe("");
  });

  it("matches a tracked opportunity to a catalog program only on its exact name and agency, and only to a program with a template", () => {
    const atp = GRANT_PROGRAM_CATALOG.find((entry) => entry.key === "atp")!;
    expect(catalogKeyTrackedAs({ title: atp.name, agencyName: atp.administeringAgency })).toBe("atp");
    expect(catalogKeyTrackedAs({ title: `  ${atp.name} `, agencyName: atp.administeringAgency })).toBe("atp");
    expect(catalogKeyTrackedAs({ title: `${atp.name} 2027`, agencyName: atp.administeringAgency })).toBeNull();
    expect(catalogKeyTrackedAs({ title: atp.name, agencyName: null })).toBeNull();
    expect(catalogKeyTrackedAs({ title: null, agencyName: atp.administeringAgency })).toBeNull();
    // Every catalog program is found from its own card's name and agency when it has a template
    // and no other program shares both; otherwise by none. The picker never starts on a guess.
    const found: string[] = [];
    for (const entry of GRANT_PROGRAM_CATALOG) {
      const sameCard = GRANT_PROGRAM_CATALOG.filter((candidate) => candidate.name === entry.name && candidate.administeringAgency === entry.administeringAgency);
      const expected = sameCard.length === 1 && (entry.applicationSections?.length ?? 0) > 0 ? entry.key : null;
      expect(catalogKeyTrackedAs({ title: entry.name, agencyName: entry.administeringAgency }), entry.key).toBe(expected);
      if (expected) found.push(expected);
    }
    // The loop is not vacuous: many programs are found, and they are different programs.
    expect(found.length).toBeGreaterThan(10);
    expect(new Set(found).size).toBe(found.length);
  });
});

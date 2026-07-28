import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { GrantsProgramCatalogSection } from "@/components/grants/program-catalog-section";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";

// The rendered half of the coverage promise: a workspace outside a state bundle's
// jurisdiction must SEE that on the surface, and must still see every program.

describe("GrantsProgramCatalogSection coverage labeling", () => {
  it("tells a workspace outside the registered state bundle that no bundle covers it", () => {
    render(
      <GrantsProgramCatalogSection
        trackedTitles={[]}
        workspaceJurisdiction={{ country: "US", subdivision: "OH" }}
      />
    );

    const disclosure = screen.getByTestId("grants-program-coverage-disclosure");
    expect(disclosure.textContent).toContain("No grant program bundle is registered for US-OH");
    expect(disclosure.textContent).toContain("not this workspace's funding menu");

    // Labeled, not hidden: a consultant may legitimately pursue another state's
    // programs, so every catalog entry is still on the page.
    expect(screen.getAllByText("California — not this workspace's jurisdiction").length).toBeGreaterThan(0);
    for (const program of GRANT_PROGRAM_CATALOG) {
      expect(screen.getByText(program.name)).toBeTruthy();
    }
  });

  it("does not warn a workspace whose own jurisdiction is registered", () => {
    render(
      <GrantsProgramCatalogSection
        trackedTitles={[]}
        workspaceJurisdiction={{ country: "US", subdivision: "CA" }}
      />
    );

    expect(screen.queryByTestId("grants-program-coverage-disclosure")).toBeNull();
    expect(screen.queryByText("California — not this workspace's jurisdiction")).toBeNull();
    // The jurisdiction is still stated on the program itself.
    expect(screen.getAllByText("California").length).toBeGreaterThan(0);
  });

  it("discloses an unset home geography rather than implying the catalog is this workspace's", () => {
    render(<GrantsProgramCatalogSection trackedTitles={[]} workspaceJurisdiction={null} />);

    const disclosure = screen.getByTestId("grants-program-coverage-disclosure");
    expect(disclosure.textContent).toContain("has not said where it works");
    expect(disclosure.textContent).toContain("home geography");
    expect(screen.getAllByText("California — coverage unconfirmed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("United States — coverage unconfirmed").length).toBeGreaterThan(0);
  });
});

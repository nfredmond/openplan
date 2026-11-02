import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
        workspaceJurisdiction={{ country: "US", subdivision: "VT" }}
      />
    );

    const disclosure = screen.getByTestId("grants-program-coverage-disclosure");
    expect(disclosure.textContent).toContain("No grant program bundle is registered for US-VT");
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

describe("tracking a catalog program", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function trackSs4a(focusedProjectId?: string | null) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <GrantsProgramCatalogSection
        trackedTitles={[]}
        workspaceJurisdiction={{ country: "US", subdivision: "CA" }}
        focusedProjectId={focusedProjectId}
      />
    );
    const name = screen.getByText("Safe Streets and Roads for All (SS4A)");
    let row: HTMLElement | null = name as HTMLElement;
    while (row && !within(row).queryByRole("button", { name: /Track as opportunity/ })) row = row.parentElement;
    if (!row) throw new Error("SS4A row not found");
    await act(async () => {
      fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /Track as opportunity/ }));
    });
    return JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, unknown>;
  }

  it("links the opportunity to the project Grants was opened for", async () => {
    const body = await trackSs4a("11111111-1111-4111-8111-111111111111");
    expect(body.title).toBe("Safe Streets and Roads for All (SS4A)");
    expect(body.projectId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("sends no project when Grants was opened for none", async () => {
    const body = await trackSs4a(null);
    expect(body).not.toHaveProperty("projectId");
  });
});

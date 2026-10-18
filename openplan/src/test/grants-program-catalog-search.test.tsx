import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GrantsProgramCatalogSection } from "@/components/grants/program-catalog-section";
import {
  describeGrantProgramCoverage,
  GRANT_PROGRAM_CATALOG,
  type GrantProgramCoverageEntry,
} from "@/lib/grants/program-catalog";
import { filterGrantProgramCatalog } from "@/lib/grants/program-catalog-search";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("program catalog text search", () => {
  it("searches displayed fields in any word order while retaining original entries and order", () => {
    const entry: GrantProgramCoverageEntry = {
      program: {
        key: "hidden-key",
        name: "Harbor connections",
        administeringAgency: "Mobility bureau",
        level: "state",
        eligibleProjectTypes: ["Cycleways", "Ferries"],
        summary: "Interchange access",
        typicalApplicants: "Municipal councils",
        cycleNote: "Verify seasonal notice",
        matchRequirement: "Reviewed contribution",
        bcaNote: "Document benefits",
        url: "https://example.org/hidden-url",
      },
      bundle: {
        key: "hidden-bundle",
        label: "Internal bundle label",
        jurisdiction: { country: "NZ", subdivision: "WGN", label: "Wellington" },
        scope: "unknown_jurisdiction",
        scopeLabel: "Wellington, coverage unconfirmed",
        coversWorkspace: false,
      },
    };
    const other: GrantProgramCoverageEntry = {
      ...entry,
      program: { ...entry.program, key: "other", name: "Another connection", bcaNote: undefined },
    };
    const entries = Object.freeze([entry, other]);
    const original = JSON.stringify(entries);

    for (const query of ["", " \n\t "]) {
      expect(filterGrantProgramCatalog(entries, query)).toBe(entries);
    }
    for (const query of [
      "harbor", "bureau", "cycleways", "ferries", "interchange", "councils",
      "seasonal", "contribution", "benefits", "state", "wellington", "unconfirmed",
      "  BUREAU\tHarbor\n ",
    ]) {
      expect(filterGrantProgramCatalog(entries, query), query).toContain(entry);
    }
    const matches = filterGrantProgramCatalog(entries, "connections harbor");
    expect(matches).toEqual([entry]);
    expect(matches[0]).toBe(entry);
    expect(filterGrantProgramCatalog(entries, "bureau")).toEqual([entry, other]);
    for (const query of ["harbor absent", "hidden-key", "hidden-url", "hidden-bundle", "[.*]"]) {
      expect(filterGrantProgramCatalog(entries, query), query).toEqual([]);
    }
    expect(filterGrantProgramCatalog([], "harbor")).toEqual([]);
    expect(JSON.stringify(entries)).toBe(original);
  });

  it("filters rendered cards, reports the count, and clears without hiding coverage disclosures", () => {
    render(<GrantsProgramCatalogSection trackedTitles={[]} workspaceJurisdiction={null} />);
    const search = screen.getByRole("searchbox", { name: "Search program catalog" });
    const count = screen.getByRole("status");
    const clear = screen.getByRole("button", { name: "Clear search" });
    const disclosure = screen.getByTestId("grants-program-coverage-disclosure");
    const disclosureText = disclosure.textContent;
    const total = GRANT_PROGRAM_CATALOG.length;
    expect(count).toHaveTextContent(`Showing ${total} of ${total} programs`);
    expect(clear).toBeDisabled();
    expect(search).toHaveAccessibleDescription(/Matches do not confirm eligibility or an open call/);
    expect(screen.getAllByRole("link", { name: "Official program page" })).toHaveLength(total);

    fireEvent.change(search, { target: { value: "hsip" } });
    expect(screen.getByText(GRANT_PROGRAM_CATALOG.find((program) => program.key === "hsip")!.name)).toBeInTheDocument();
    expect(screen.queryByText(GRANT_PROGRAM_CATALOG.find((program) => program.key === "atp")!.name)).toBeNull();
    const visibleLinks = screen.getAllByRole("link", { name: "Official program page" });
    expect(visibleLinks.length).toBeLessThan(total);
    expect(count).toHaveTextContent(`Showing ${visibleLinks.length} of ${total} programs`);
    expect(disclosure).toHaveTextContent(disclosureText!);

    fireEvent.change(search, { target: { value: "catalog-no-matches-xyz" } });
    expect(count).toHaveTextContent(`Showing 0 of ${total} programs`);
    expect(screen.getByText(/No catalog programs match your search/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Official program page" })).toBeNull();
    expect(disclosure).toHaveTextContent(disclosureText!);

    fireEvent.click(clear);
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(clear).toBeDisabled();
    expect(count).toHaveTextContent(`Showing ${total} of ${total} programs`);
    for (const program of GRANT_PROGRAM_CATALOG) expect(screen.getByText(program.name)).toBeInTheDocument();
  });

  it("keeps an unsupported jurisdiction disclosure when search has no results", () => {
    render(
      <GrantsProgramCatalogSection
        trackedTitles={[]}
        workspaceJurisdiction={{ country: "NZ", subdivision: "WGN" }}
      />
    );
    const disclosure = screen.getByTestId("grants-program-coverage-disclosure");
    const original = disclosure.textContent;
    expect(original).toContain("No grant program bundle is registered for NZ-WGN");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "catalog-no-matches-xyz" } });
    expect(screen.getByRole("status")).toHaveTextContent(`Showing 0 of ${GRANT_PROGRAM_CATALOG.length} programs`);
    expect(disclosure).toHaveTextContent(original!);
  });

  it("retains tracking state, official links, and the POST payload across search changes", async () => {
    const coverage = describeGrantProgramCoverage(null);
    const program = coverage.programs.find(({ program }) => program.key === "hsip")!.program;
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<GrantsProgramCatalogSection trackedTitles={[]} workspaceJurisdiction={null} />);
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "hsip" } });
    const card = screen.getByText(program.name).closest("div.flex.flex-wrap.items-start")! as HTMLElement;
    expect(within(card).getByRole("link", { name: "Official program page" })).toHaveAttribute("href", program.url);
    const track = within(card).getByRole("button", { name: "Track as opportunity" });
    fireEvent.click(track);
    expect(track).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/funding-opportunities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: program.name,
        agencyName: program.administeringAgency,
        cadenceLabel: program.cycleNote,
        summary: program.summary,
      }),
    });
    fireEvent.change(search, { target: { value: "catalog-no-matches-xyz" } });
    fireEvent.change(search, { target: { value: "hsip" } });
    const pendingCard = screen.getByText(program.name).closest("div.flex.flex-wrap.items-start")! as HTMLElement;
    expect(within(pendingCard).getByRole("button", { name: "Track as opportunity" })).toBeDisabled();
    fireEvent.change(search, { target: { value: "catalog-no-matches-xyz" } });
    await act(async () => { finish(new Response("{}", { status: 201 })); });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    const restoredCard = screen.getByText(program.name).closest("div.flex.flex-wrap.items-start")! as HTMLElement;
    expect(within(restoredCard).getByText("Tracked")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps tracking errors visible outside filtered results and respects already tracked titles", async () => {
    const tracked = GRANT_PROGRAM_CATALOG.find((program) => program.key === "atp")!;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Tracking refused" }), { status: 403 })));
    render(<GrantsProgramCatalogSection trackedTitles={[tracked.name]} workspaceJurisdiction={null} />);
    const search = screen.getByRole("searchbox");
    const trackedCard = screen.getByText(tracked.name).closest("div.flex.flex-wrap.items-start")! as HTMLElement;
    expect(within(trackedCard).queryByRole("button")).toBeNull();
    expect(within(trackedCard).getByText("Tracked")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "hsip" } });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Track as opportunity" })[0]); });
    fireEvent.change(search, { target: { value: "catalog-no-matches-xyz" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Tracking refused");
    expect(refresh).not.toHaveBeenCalled();
  });
});

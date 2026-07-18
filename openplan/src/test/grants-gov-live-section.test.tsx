import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { GrantsGovLiveSection } from "@/components/grants/grants-gov-live-section";
import { GRANTS_GOV_SYNC_CAVEAT } from "@/lib/grants/grants-gov";

const fetchMock = vi.fn();

const OPPORTUNITY = {
  id: "362478",
  number: "693JF725R000010",
  title: "Fiscal Year 2026 United States Marine Highway Program (USMHP)",
  agencyCode: "DOT-MA",
  agencyName: "Maritime Administration",
  openDate: "2026-07-06",
  closeDate: "2099-08-31",
  status: "posted",
  cfdaList: ["20.816"],
  detailUrl: "https://www.grants.gov/search-results-detail/362478",
};

const FACETS = {
  agencyFacets: [
    { label: "DOT - Federal Transit Administration", value: "DOT-FTA", count: 4 },
    { label: "Maritime Administration", value: "DOT-MA", count: 1 },
  ],
  eligibilityFacets: [
    { label: "County governments", value: "01", count: 6 },
    { label: "City or township governments", value: "02", count: 5 },
  ],
};

function loadedPayload(opportunities = [OPPORTUNITY], facets?: typeof FACETS) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      opportunities,
      hitCount: opportunities.length,
      fetchedAt: "2026-07-18T19:00:00.000Z",
      cached: false,
      ...(facets ?? {}),
    }),
  };
}

describe("GrantsGovLiveSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("renders collapsed with the caveat and does not fetch until asked", () => {
    render(<GrantsGovLiveSection trackedTitles={[]} />);
    expect(screen.getByText(GRANTS_GOV_SYNC_CAVEAT)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("grants-gov-offline")).toBeNull();
  });

  it("loads opportunities on demand, passing the keyword", async () => {
    fetchMock.mockResolvedValue(loadedPayload());
    render(<GrantsGovLiveSection trackedTitles={[]} />);

    fireEvent.change(screen.getByLabelText(/Keyword \(optional\)/), {
      target: { value: "marine" },
    });
    fireEvent.click(screen.getByTestId("grants-gov-load"));

    await waitFor(() => {
      expect(screen.getByText(OPPORTUNITY.title)).toBeTruthy();
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/grants-gov/opportunities?keyword=marine");
    expect(screen.getByText("Maritime Administration", { exact: false })).toBeTruthy();
  });

  it("shows facet selects only after a load that returned facets, labeled with counts", async () => {
    fetchMock.mockResolvedValue(loadedPayload([OPPORTUNITY], FACETS));
    render(<GrantsGovLiveSection trackedTitles={[]} />);

    // No selects before the first load — the empty section stays single-action.
    expect(screen.queryByTestId("grants-gov-agency-filter")).toBeNull();
    expect(screen.queryByTestId("grants-gov-eligibility-filter")).toBeNull();

    fireEvent.click(screen.getByTestId("grants-gov-load"));
    await waitFor(() => {
      expect(screen.getByTestId("grants-gov-agency-filter")).toBeTruthy();
    });
    expect(screen.getByTestId("grants-gov-eligibility-filter")).toBeTruthy();

    expect(screen.getByRole("option", { name: "All agencies" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "DOT - Federal Transit Administration (4)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Maritime Administration (1)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "All eligibilities" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "County governments (6)" })).toBeTruthy();
  });

  it("keeps facet selects hidden when the response carries no facet metadata", async () => {
    fetchMock.mockResolvedValue(loadedPayload());
    render(<GrantsGovLiveSection trackedTitles={[]} />);

    fireEvent.click(screen.getByTestId("grants-gov-load"));
    await waitFor(() => {
      expect(screen.getByText(OPPORTUNITY.title)).toBeTruthy();
    });
    expect(screen.queryByTestId("grants-gov-agency-filter")).toBeNull();
    expect(screen.queryByTestId("grants-gov-eligibility-filter")).toBeNull();
  });

  it("re-runs the search with the chosen facets as query params", async () => {
    fetchMock.mockResolvedValue(loadedPayload([OPPORTUNITY], FACETS));
    render(<GrantsGovLiveSection trackedTitles={[]} />);

    fireEvent.change(screen.getByLabelText(/Keyword \(optional\)/), {
      target: { value: "marine" },
    });
    fireEvent.click(screen.getByTestId("grants-gov-load"));
    await waitFor(() => {
      expect(screen.getByTestId("grants-gov-agency-filter")).toBeTruthy();
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/grants-gov/opportunities?keyword=marine");

    fireEvent.change(screen.getByTestId("grants-gov-agency-filter"), {
      target: { value: "DOT-FTA" },
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      "/api/grants-gov/opportunities?keyword=marine&agency=DOT-FTA"
    );

    // Wait for the reload to settle so the next change fires from 'loaded'.
    await waitFor(() => {
      expect((screen.getByTestId("grants-gov-load") as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.change(screen.getByTestId("grants-gov-eligibility-filter"), {
      target: { value: "01" },
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    // The earlier agency choice persists alongside the new eligibility one.
    expect(String(fetchMock.mock.calls[2][0])).toBe(
      "/api/grants-gov/opportunities?keyword=marine&agency=DOT-FTA&eligibility=01"
    );
  });

  it("shows the honest offline state when the upstream is unreachable (502)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    render(<GrantsGovLiveSection trackedTitles={[]} />);

    fireEvent.click(screen.getByTestId("grants-gov-load"));
    await waitFor(() => {
      expect(screen.getByTestId("grants-gov-offline")).toBeTruthy();
    });
    expect(screen.getByTestId("grants-gov-offline").textContent).toContain("unreachable");
  });

  it("does not blame grants.gov for local failures like an expired session", async () => {
    // Regression: a 401/400 used to render the grants.gov-unreachable panel.
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    render(<GrantsGovLiveSection trackedTitles={[]} />);

    fireEvent.click(screen.getByTestId("grants-gov-load"));
    await waitFor(() => {
      expect(screen.getByTestId("grants-gov-error")).toBeTruthy();
    });
    expect(screen.queryByTestId("grants-gov-offline")).toBeNull();
  });

  it("shows the zero-hit state honestly", async () => {
    fetchMock.mockResolvedValue(loadedPayload([]));
    render(<GrantsGovLiveSection trackedTitles={[]} />);

    fireEvent.click(screen.getByTestId("grants-gov-load"));
    await waitFor(() => {
      expect(screen.getByTestId("grants-gov-empty")).toBeTruthy();
    });
  });

  it("tracks an opportunity through the funding-opportunities route with real dates", async () => {
    fetchMock.mockResolvedValueOnce(loadedPayload());
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    render(<GrantsGovLiveSection trackedTitles={[]} />);

    fireEvent.click(screen.getByTestId("grants-gov-load"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Track as opportunity/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /Track as opportunity/ }));

    await waitFor(() => {
      expect(screen.getByText("Tracked")).toBeTruthy();
    });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/funding-opportunities");
    const body = JSON.parse(String(init.body));
    expect(body.title).toBe(OPPORTUNITY.title);
    expect(body.status).toBe("open");
    expect(body.opensAt).toBe("2026-07-06T00:00:00.000Z");
    expect(body.closesAt).toBe("2099-08-31T23:59:59.000Z");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("recognizes a >160-char title as tracked via its stored truncated form", async () => {
    // Regression: the tracked check used to compare the full live title, which
    // can never equal the 160-char truncated title the API actually stores.
    const longTitle = "L".repeat(300);
    const storedTitle = `${"L".repeat(159)}…`.slice(0, 160);
    fetchMock.mockResolvedValue(loadedPayload([{ ...OPPORTUNITY, title: longTitle }]));
    render(<GrantsGovLiveSection trackedTitles={[storedTitle]} />);

    fireEvent.click(screen.getByTestId("grants-gov-load"));
    await waitFor(() => {
      expect(screen.getByText("Tracked")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /Track as opportunity/ })).toBeNull();
  });

  it("marks already-tracked titles without a track button", async () => {
    fetchMock.mockResolvedValue(loadedPayload());
    render(<GrantsGovLiveSection trackedTitles={[OPPORTUNITY.title.toUpperCase()]} />);

    fireEvent.click(screen.getByTestId("grants-gov-load"));
    await waitFor(() => {
      expect(screen.getByText("Tracked")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /Track as opportunity/ })).toBeNull();
  });

  it("surfaces a track failure without losing the list", async () => {
    fetchMock.mockResolvedValueOnce(loadedPayload());
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      // The real funding-opportunities route's viewer-role denial string.
      json: async () => ({ error: "Workspace access denied" }),
    });
    render(<GrantsGovLiveSection trackedTitles={[]} />);

    fireEvent.click(screen.getByTestId("grants-gov-load"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Track as opportunity/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /Track as opportunity/ }));

    await waitFor(() => {
      expect(screen.getByText("Workspace access denied")).toBeTruthy();
    });
    expect(screen.getByText(OPPORTUNITY.title)).toBeTruthy();
  });

  it("falls back to a friendly message when a gateway returns a non-JSON error body", async () => {
    // Regression: response.json() on an HTML 502 used to surface a raw
    // SyntaxError message as the track error.
    fetchMock.mockResolvedValueOnce(loadedPayload());
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token 'A'");
      },
    });
    render(<GrantsGovLiveSection trackedTitles={[]} />);

    fireEvent.click(screen.getByTestId("grants-gov-load"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Track as opportunity/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /Track as opportunity/ }));

    await waitFor(() => {
      expect(screen.getByText("Failed to track this opportunity")).toBeTruthy();
    });
  });
});

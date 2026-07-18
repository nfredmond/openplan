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

function loadedPayload(opportunities = [OPPORTUNITY]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      opportunities,
      hitCount: opportunities.length,
      fetchedAt: "2026-07-18T19:00:00.000Z",
      cached: false,
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

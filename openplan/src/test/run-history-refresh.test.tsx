import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunHistory } from "@/components/runs/RunHistory";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("RunHistory refresh", () => {
  it("re-reads stored runs when a just-saved run becomes current", async () => {
    const newRun = {
      id: "run-new",
      title: "Freshly saved corridor run",
      query_text: "Current conditions",
      created_at: "2026-08-25T20:00:00.000Z",
      metrics: { overallScore: 42 },
      result_geojson: { type: "FeatureCollection", features: [] },
      summary_text: "Saved result",
      ai_interpretation: null,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ runs: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ runs: [newRun] }) });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<RunHistory workspaceId="workspace-1" />);
    await screen.findByText("No analysis runs yet");

    view.rerender(<RunHistory workspaceId="workspace-1" currentRunId="run-new" />);
    await screen.findByText("Freshly saved corridor run");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

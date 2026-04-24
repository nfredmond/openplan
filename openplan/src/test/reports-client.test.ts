import { afterEach, describe, expect, it, vi } from "vitest";

import { createRtpPacketRecord, generateReportArtifact } from "@/lib/reports/client";

describe("reports client helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates a report artifact and returns warning count", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ warnings: [{ code: "stale_source" }, { code: "missing_note" }] }),
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(generateReportArtifact("report-1")).resolves.toEqual({ warningCount: 2 });
    expect(fetchMock).toHaveBeenCalledWith("/api/reports/report-1/generate", expect.any(Object));
  });

  it("creates and generates an RTP packet through the shared helper", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ reportId: "report-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ warnings: [{ code: "stale_source" }] }),
      });

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createRtpPacketRecord({
        rtpCycleId: "cycle-1",
        title: "Nevada County Draft Packet",
        modelingCountyRunId: "county-run-1",
        generateAfterCreate: true,
      })
    ).resolves.toEqual({ reportId: "report-1", warningCount: 1 });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/reports",
      expect.objectContaining({
        method: "POST",
      })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      rtpCycleId: "cycle-1",
      reportType: "board_packet",
      title: "Nevada County Draft Packet",
      modelingCountyRunId: "county-run-1",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/reports/report-1/generate",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("throws the create error before attempting generation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ error: "Workspace access denied" }),
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createRtpPacketRecord({
        rtpCycleId: "cycle-1",
        generateAfterCreate: true,
      })
    ).rejects.toThrow("Workspace access denied");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

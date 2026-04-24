import { beforeEach, describe, expect, it, vi } from "vitest";

const createServiceRoleClientMock = vi.fn();
const recordUsageEventMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
  isMissingEnvironmentVariableError: (error: unknown) =>
    error instanceof Error && error.name === "MissingEnvironmentVariableError",
}));

vi.mock("@/lib/billing/usage-events", () => ({
  recordUsageEvent: (...args: unknown[]) => recordUsageEventMock(...args),
}));

import { recordUsageEventBestEffort } from "@/lib/billing/usage-recording";

describe("recordUsageEventBestEffort", () => {
  const audit = { warn: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    createServiceRoleClientMock.mockReturnValue({ from: vi.fn() });
    recordUsageEventMock.mockResolvedValue({ ok: true, duplicate: false, id: "usage-1", error: null });
  });

  it("records usage with the service-role client", async () => {
    await recordUsageEventBestEffort(
      {
        workspaceId: "workspace-1",
        eventKey: "report.generate",
        bucketKey: "runs",
        weight: 1,
        sourceRoute: "/api/reports/[reportId]/generate",
        idempotencyKey: "report:1:generate:artifact-1",
      },
      audit
    );

    expect(recordUsageEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: "workspace-1",
        eventKey: "report.generate",
        idempotencyKey: "report:1:generate:artifact-1",
      })
    );
    expect(audit.warn).not.toHaveBeenCalled();
  });

  it("keeps the caller successful when usage recording is unavailable", async () => {
    recordUsageEventMock.mockResolvedValueOnce({
      ok: false,
      duplicate: false,
      id: null,
      error: {
        message: 'relation "usage_events" does not exist',
        code: "42P01",
        missingSchema: true,
      },
    });

    await expect(
      recordUsageEventBestEffort(
        {
          workspaceId: "workspace-1",
          eventKey: "analysis.run",
          sourceRoute: "/api/analysis",
        },
        audit
      )
    ).resolves.toBeUndefined();

    expect(audit.warn).toHaveBeenCalledWith(
      "usage_event_record_failed",
      expect.objectContaining({
        workspaceId: "workspace-1",
        eventKey: "analysis.run",
        missingSchema: true,
      })
    );
  });
});

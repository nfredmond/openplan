import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelCountyOnrampJob,
  dispatchCountyOnrampJob,
} from "@/lib/api/county-onramp-dispatch";
import type { CountyOnrampWorkerPayload } from "@/lib/api/county-onramp-worker";

const payload = {
  jobId: "123e4567-e89b-12d3-a456-426614174001",
  callback: {
    manifestIngestUrl: "https://openplan.example/api/county-runs/run/manifest",
    bearerToken: "callback-secret",
  },
} as CountyOnrampWorkerPayload;

describe("county onramp worker transport", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("prepares without making a request when no worker is configured", async () => {
    const fetcher = vi.fn();
    await expect(dispatchCountyOnrampJob(payload, fetcher)).resolves.toEqual({
      deliveryMode: "prepared",
      workerUrl: null,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses dispatch unless both directions have bearer authentication", async () => {
    vi.stubEnv("OPENPLAN_COUNTY_ONRAMP_WORKER_URL", "https://worker.example/jobs");
    await expect(dispatchCountyOnrampJob(payload, vi.fn())).rejects.toThrow(
      "OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN",
    );
    vi.stubEnv("OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN", "worker-secret");
    await expect(
      dispatchCountyOnrampJob(
        { ...payload, callback: { ...payload.callback, bearerToken: undefined } },
        vi.fn(),
      ),
    ).rejects.toThrow("OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN");
  });

  it("authenticates dispatch and cancellation and normalizes a root worker URL", async () => {
    vi.stubEnv("OPENPLAN_COUNTY_ONRAMP_WORKER_URL", "https://worker.example");
    vi.stubEnv("OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN", "worker-secret");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 202 }))
      .mockResolvedValueOnce(new Response("{}", { status: 202 }));

    await expect(dispatchCountyOnrampJob(payload, fetcher)).resolves.toMatchObject({
      deliveryMode: "queued",
    });
    await cancelCountyOnrampJob({
      workerUrl: "https://worker.example",
      jobId: payload.jobId,
      fetcher,
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://worker.example",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer worker-secret" }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `https://worker.example/jobs/${payload.jobId}/cancel`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer worker-secret" }),
      }),
    );
  });
});

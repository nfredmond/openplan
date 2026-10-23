import { describe, expect, it, vi } from "vitest";
import { discardWorkerZoneAttributes, type ZoneAttributeStamp } from "@/lib/models/zone-attribute-payload";

const runId = "00000000-0000-4000-8000-000000000001";
const stamp = (status: ZoneAttributeStamp["status"]) => ({ status } as ZoneAttributeStamp);
function remover(error: { message: string } | null = null) {
  const remove = vi.fn(async () => ({ error }));
  const from = vi.fn(() => ({ remove }));
  return { client: { storage: { from } }, from, remove };
}

describe("discarding a refused launch's zone-attribute table", () => {
  it("removes the supplied object at the run's exact path", async () => {
    const r = remover();
    await expect(discardWorkerZoneAttributes(stamp("supplied"), runId, r.client)).resolves.toEqual({ removed: true, error: null });
    expect(r.from).toHaveBeenCalledExactlyOnceWith("run-artifacts");
    expect(r.remove).toHaveBeenCalledExactlyOnceWith([`model-runs/${runId}/zone-attributes.json`]);
  });

  it.each(["unavailable", "handoff_failed"] as const)("touches nothing when the stamp is %s", async (status) => {
    const r = remover();
    await expect(discardWorkerZoneAttributes(stamp(status), runId, r.client)).resolves.toEqual({ removed: false, error: null });
    expect(r.from).not.toHaveBeenCalled();
  });

  it("touches nothing without a stamp", async () => {
    const r = remover();
    await expect(discardWorkerZoneAttributes(null, runId, r.client)).resolves.toEqual({ removed: false, error: null });
    expect(r.from).not.toHaveBeenCalled();
  });

  it("reports a failed removal instead of throwing", async () => {
    await expect(discardWorkerZoneAttributes(stamp("supplied"), runId, remover({ message: "denied" }).client))
      .resolves.toEqual({ removed: false, error: "denied" });
    const throwing = { storage: { from: () => { throw new Error("no client"); } } };
    await expect(discardWorkerZoneAttributes(stamp("supplied"), runId, throwing as never))
      .resolves.toEqual({ removed: false, error: "no client" });
  });
});

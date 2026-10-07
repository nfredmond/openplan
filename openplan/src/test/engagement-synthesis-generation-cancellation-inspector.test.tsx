import { createHash, randomUUID } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SynthesisGenerationCancellationInspector } from "@/components/engagement/synthesis-generation-cancellation-inspector";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); vi.unstubAllGlobals(); });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function fixture() {
  const userId = randomUUID(), workspaceId = randomUUID(), campaignId = randomUUID(), sourceId = randomUUID(), requestId = randomUUID();
  const intentText = JSON.stringify({ schemaVersion: 1, sourceId, sourceSha256: "a".repeat(64), connectionId: randomUUID(),
    configurationRevisionId: randomUUID(), configurationHash: "b".repeat(64), modelId: "synthetic-model", taskByteLimit: 4096 });
  const intentSha256 = createHash("sha256").update(intentText).digest("hex");
  return { props: { userId, workspaceId, campaignId, sourceId, sourceSha256: "a".repeat(64), requestId, actorId: userId, intentSha256,
    onAccessLost: vi.fn(), onCancelled: vi.fn() }, state: { schemaVersion: 1, workspaceId, campaignId,
    request: { id: requestId, actorId: userId, intentText, intentSha256, createdAt: "2026-10-06T12:00:00Z" }, cancellation: null } };
}

describe("saved request cancellation inspection", () => {
  it("requires an explicit native read of the original intent before cancellation controls appear", async () => {
    const f = fixture(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(f.state)); vi.stubGlobal("fetch", fetcher);
    render(<SynthesisGenerationCancellationInspector {...f.props} />); expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review cancellation options" }));
    await screen.findByLabelText("Reason for cancelling");
    expect(fetcher.mock.calls[0]).toEqual([`/api/engagement/campaigns/${f.props.campaignId}/synthesis/generation?requestId=${f.props.requestId}`, expect.objectContaining({ method: "GET", cache: "no-store",
      headers: { "x-openplan-expected-user": f.props.userId, "x-openplan-expected-workspace": f.props.workspaceId } })]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["sourceId", "sourceSha256", "actorId", "intentSha256", "requestId"] as const)("refuses an original record that differs from history %s", async field => {
    const f = fixture(), props = { ...f.props, [field]: field.endsWith("Sha256") ? "c".repeat(64) : randomUUID() };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(f.state))); render(<SynthesisGenerationCancellationInspector {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Review cancellation options" })); await screen.findByRole("alert");
    expect(screen.queryByLabelText("Reason for cancelling")).toBeNull();
  });
  it("clears the original intent on denied refresh", async () => {
    const f = fixture(), fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(f.state)).mockResolvedValueOnce(json({}, 403));
    vi.stubGlobal("fetch", fetcher); render(<SynthesisGenerationCancellationInspector {...f.props} />);
    fireEvent.click(screen.getByRole("button", { name: "Review cancellation options" })); await screen.findByLabelText("Reason for cancelling");
    fireEvent.click(screen.getByRole("button", { name: "Refresh original request" }));
    await waitFor(() => expect(f.props.onAccessLost).toHaveBeenCalledOnce()); expect(screen.queryByLabelText("Reason for cancelling")).toBeNull();
  });
  it("keeps other staff inspection read-only", async () => {
    const f = fixture(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(f.state)));
    render(<SynthesisGenerationCancellationInspector {...f.props} userId={randomUUID()} />);
    fireEvent.click(screen.getByRole("button", { name: "Review cancellation options" }));
    await screen.findByText("Only the original staff requester can cancel this request.");
    expect(screen.queryByLabelText("Reason for cancelling")).toBeNull();
  });
});

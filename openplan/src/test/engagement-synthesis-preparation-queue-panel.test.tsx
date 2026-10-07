import { randomUUID } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SynthesisPreparationPanel } from "@/components/engagement/synthesis-preparation-panel";
import { readPendingSynthesisPreparation, retainPendingSynthesisPreparation } from "@/lib/engagement/synthesis-preparation-recovery";
import { thematicChoiceUiFixture } from "./fixtures/engagement/synthesis-thematic-choice-ui";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); vi.unstubAllGlobals(); });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function fixture() {
  const scope = { userId: randomUUID(), workspaceId: randomUUID(), campaignId: randomUUID(), sourceId: randomUUID(),
    sourceSha256: "a".repeat(64), requestId: randomUUID(), intentSha256: "b".repeat(64), stage: "segment" as const };
  const props = { ...scope, actorId: scope.userId, cancelled: false, onAccessLost: vi.fn() };
  const state = { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId: scope.requestId,
    actorId: scope.userId, intentSha256: scope.intentSha256, stage: scope.stage, status: "queued", attempts: 0,
    leaseUntil: null, failureCode: null, sealSha256: null, cancelled: false, createdAt: "2026-10-06T12:00:00Z", updatedAt: "2026-10-06T12:00:00Z", replayed: false };
  const pending = { version: 1 as const, ...scope, command: { operation: "enqueue" as const, requestId: scope.requestId, stage: scope.stage, intentSha256: scope.intentSha256 } };
  return { scope, props, state, pending };
}

describe("staff preparation controls", () => {
  it.each(["enqueue", "retry"])("requires whole-source context choices before a fresh thematic %s", async operation => {
    const f = thematicChoiceUiFixture();
    const props = { ...f.scope, userId: f.scope.actorId, intentSha256: f.scope.requestIntentSha256, stage: "thematic" as const, cancelled: false, onAccessLost: vi.fn() };
    const state = { ...fixture().state, campaignId: props.campaignId, workspaceId: props.workspaceId, requestId: props.requestId,
      actorId: props.actorId, intentSha256: props.intentSha256, stage: "thematic", attempts: 3 };
    const transport = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (init?.method === "POST") return json(state);
      const query = new URL(String(url), "http://localhost").searchParams;
      if (query.get("mode") === "contributions") return json(f.contributionPage(Number(query.get("offset"))));
      return json(operation === "retry" ? { ...state, status: "failed", failureCode: "input_unavailable" } : null);
    });
    vi.stubGlobal("fetch", transport); render(<SynthesisPreparationPanel {...props} />);
    const button = await screen.findByRole("button", { name: operation === "retry" ? "Retry failed preparation" : "Queue preparation" });
    expect(button).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "Choose context for themes" }));
    await screen.findByText(/25 selected among 25 loaded/); expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Load more contributions" }));
    await waitFor(() => expect(button).toBeEnabled()); expect(transport.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fireEvent.click(button); await screen.findByText("Waiting to prepare analysis");
    const writes = transport.mock.calls.filter(([, init]) => init?.method === "POST"); expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual(operation === "retry" ? { operation, requestId: props.requestId, attempt: 3 }
      : { operation, requestId: props.requestId, stage: "thematic", intentSha256: props.intentSha256 });
  });

  it("reads without writing, then retains an exact command before the explicit enqueue", async () => {
    const f = fixture();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        expect(readPendingSynthesisPreparation(localStorage, f.scope)).toEqual(f.pending);
        expect(JSON.parse(String(init.body))).toEqual(f.pending.command);
        expect(init.headers).toMatchObject({ "x-openplan-expected-user": f.scope.userId, "x-openplan-expected-workspace": f.scope.workspaceId });
        return json(f.state);
      }
      return json(null);
    });
    vi.stubGlobal("fetch", fetcher); render(<SynthesisPreparationPanel {...f.props} />);
    const queue = await screen.findByRole("button", { name: "Queue preparation" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual([`/api/engagement/campaigns/${f.scope.campaignId}/synthesis/preparation?requestId=${f.scope.requestId}`, expect.objectContaining({ method: "GET", cache: "no-store", headers: { "x-openplan-expected-user": f.scope.userId, "x-openplan-expected-workspace": f.scope.workspaceId } })]);
    fireEvent.click(queue);
    expect(await screen.findByText("Waiting to prepare analysis")).toBeTruthy();
    expect(readPendingSynthesisPreparation(localStorage, f.scope)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Provider execution still requires separate authorization/)).toBeTruthy();
  });

  it.each(["segment", "context", "thematic"] as const)("inspects the %s stage without granting provider authority", async stage => {
    const f = fixture(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ ...f.state, stage, status: "prepared", attempts: 1, sealSha256: "c".repeat(64) })));
    render(<SynthesisPreparationPanel {...f.props} stage={stage} />);
    expect(await screen.findByText("Preparation complete")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Queue preparation" })).toBeNull();
    expect(screen.getByText(/does not send contributions to a provider/)).toBeTruthy();
  });

  it.each(["actorId", "intentSha256", "stage", "requestId"])("refuses mismatched %s rather than offering a new queue", async field => {
    const f = fixture(), changed = field === "intentSha256" ? "c".repeat(64) : field === "stage" ? "thematic" : randomUUID();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ ...f.state, [field]: changed })));
    render(<SynthesisPreparationPanel {...f.props} />);
    await screen.findByRole("alert"); expect(screen.queryByRole("button", { name: "Queue preparation" })).toBeNull();
    expect(screen.queryByText("Waiting to prepare analysis")).toBeNull();
  });

  it.each(["other staff", "cancelled"])("blocks queueing for %s", async condition => {
    const f = fixture(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(null)));
    render(<SynthesisPreparationPanel {...f.props} actorId={condition === "other staff" ? randomUUID() : f.scope.userId} cancelled={condition === "cancelled"} />);
    expect(await screen.findByRole("button", { name: "Queue preparation" })).toBeDisabled();
  });

  it("retries the observed failed attempt only after a staff action", async () => {
    const f = fixture(), fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ ...f.state, status: "failed", attempts: 3, failureCode: "input_unavailable" }))
      .mockResolvedValueOnce(json({ ...f.state, attempts: 3 }));
    vi.stubGlobal("fetch", fetcher); render(<SynthesisPreparationPanel {...f.props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry failed preparation" }));
    await screen.findByText("Waiting to prepare analysis");
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ operation: "retry", requestId: f.scope.requestId, attempt: 3 });
  });

  it("keeps an unconfirmed command across remount and explicitly replays its exact bytes", async () => {
    const f = fixture(), fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(null)).mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(json(f.state)).mockResolvedValueOnce(json({ ...f.state, replayed: true }));
    vi.stubGlobal("fetch", fetcher); const view = render(<SynthesisPreparationPanel {...f.props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Queue preparation" }));
    await screen.findByRole("alert"); expect(readPendingSynthesisPreparation(localStorage, f.scope)).toEqual(f.pending);
    view.unmount(); render(<SynthesisPreparationPanel {...f.props} />);
    await screen.findByText("Waiting to prepare analysis"); expect(fetcher).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "Retry saved preparation command" }));
    await screen.findByText(/Preparation command confirmed/);
    expect(fetcher.mock.calls[3][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
    expect(readPendingSynthesisPreparation(localStorage, f.scope)).toBeNull();
  });

  it("does not send when the browser cannot retain the command", async () => {
    const f = fixture(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(null));
    vi.stubGlobal("fetch", fetcher); render(<SynthesisPreparationPanel {...f.props} />);
    const queue = await screen.findByRole("button", { name: "Queue preparation" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage is full"); });
    fireEvent.click(queue); await screen.findByText("Storage is full"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reopens a preparation command after its storage write succeeds but readback is interrupted", async () => {
    const f = fixture(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(null)); vi.stubGlobal("fetch", fetcher);
    render(<SynthesisPreparationPanel {...f.props} />); const queue = await screen.findByRole("button", { name: "Queue preparation" });
    const original = Storage.prototype.getItem; let interrupted = false;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      const value = original.call(this, key);
      if (key.endsWith(f.scope.requestId) && value !== null && !interrupted) { interrupted = true; throw new Error("SYNTHETIC interrupted preparation readback"); }
      return value;
    });
    fireEvent.click(queue); expect(await screen.findByRole("button", { name: "Retry saved preparation command" })).toBeEnabled();
    expect(readPendingSynthesisPreparation(localStorage, f.scope)).toEqual(f.pending); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("preserves unreadable recovery before allowing another command", async () => {
    const f = fixture(); retainPendingSynthesisPreparation(localStorage, f.pending);
    const key = localStorage.key(0)!; localStorage.setItem(key, "unreadable original");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(null)); vi.stubGlobal("fetch", fetcher);
    render(<SynthesisPreparationPanel {...f.props} />);
    expect(await screen.findByRole("button", { name: "Queue preparation" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Preserve recovery copy" }));
    expect(await screen.findByText("Preserved preparation copies (1)")).toBeTruthy();
    expect(localStorage.getItem(key)).toBeNull(); expect(localStorage.getItem(localStorage.key(0)!)).toBe("unreadable original");
    expect(screen.getByRole("button", { name: "Queue preparation" })).toBeEnabled(); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("clears preparation on denied refresh and notifies the containing source", async () => {
    const f = fixture(), fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(f.state)).mockResolvedValueOnce(json({}, 403));
    vi.stubGlobal("fetch", fetcher); render(<SynthesisPreparationPanel {...f.props} />);
    await screen.findByText("Waiting to prepare analysis"); fireEvent.click(screen.getByRole("button", { name: "Refresh preparation status" }));
    await screen.findByRole("alert"); expect(f.props.onAccessLost).toHaveBeenCalledOnce();
    expect(screen.queryByText("Waiting to prepare analysis")).toBeNull();
  });

  it("keeps an unavailable read distinct from a missing job", async () => {
    const f = fixture(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<SynthesisPreparationPanel {...f.props} />); await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Queue preparation" })).toBeNull();
    expect(screen.queryByText("Preparation has not been queued")).toBeNull();
  });

  it("discards a late read after the request changes", async () => {
    const a = fixture(), b = fixture(); let resolve!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce(json(null));
    vi.stubGlobal("fetch", fetcher); const view = render(<SynthesisPreparationPanel {...a.props} />);
    view.rerender(<SynthesisPreparationPanel {...b.props} />); await screen.findByText("Preparation has not been queued");
    await act(async () => { resolve(json(a.state)); });
    await waitFor(() => expect(screen.queryByText("Waiting to prepare analysis")).toBeNull());
  });
});

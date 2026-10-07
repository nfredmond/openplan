import { createHash, randomUUID } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SynthesisGenerationCancelPanel } from "@/components/engagement/synthesis-generation-cancel-panel";
import { readPendingSynthesisGeneration, retainPendingSynthesisGeneration } from "@/lib/engagement/synthesis-generation-request-recovery";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); vi.unstubAllGlobals(); });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture() {
  const scope = { userId: randomUUID(), workspaceId: randomUUID(), campaignId: randomUUID(), sourceId: randomUUID(), sourceSha256: "a".repeat(64) };
  const requestId = randomUUID(), date = "2026-10-06T12:00:00Z";
  const intentText = JSON.stringify({ schemaVersion: 1, sourceId: scope.sourceId, sourceSha256: scope.sourceSha256,
    connectionId: randomUUID(), configurationRevisionId: randomUUID(), configurationHash: "b".repeat(64), modelId: "synthetic-model", taskByteLimit: 4096 });
  const props = { ...scope, requestId, intentText, actorId: scope.userId, cancelled: false, onAccessLost: vi.fn(), onCancelled: vi.fn() };
  const create = { version: 1 as const, ...scope, intentText, command: { operation: "create" as const, requestId, intentText } };
  function receipt(body: string, existed = false) {
    const command = JSON.parse(body);
    const receiptText = JSON.stringify({ schemaVersion: 1, id: command.cancellationId, requestId, campaignId: scope.campaignId, workspaceId: scope.workspaceId,
      actorId: scope.userId, reason: command.reason, requestExisted: existed, cancelledAt: date });
    return { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, replayed: false,
      request: existed ? { id: requestId, actorId: scope.userId, intentText, intentSha256: hash(intentText), createdAt: date } : null,
      cancellation: { id: command.cancellationId, receiptText, receiptSha256: hash(receiptText), createdAt: date } };
  }
  return { scope, props, create, receipt };
}

describe("staff analysis request cancellation", () => {
  it.each([false, true])("records cancellation with requestExisted=%s without discarding uncertain creation", async existed => {
    const f = fixture(); retainPendingSynthesisGeneration(localStorage, f.create);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const command = JSON.parse(String(init?.body));
      expect(readPendingSynthesisGeneration(localStorage, f.scope, "cancel")?.command).toEqual(command);
      expect(command).toMatchObject({ operation: "cancel", requestId: f.props.requestId, reason: "  Keep original reason 日本語\n" });
      return json(f.receipt(String(init?.body), existed), 201);
    });
    vi.stubGlobal("fetch", fetcher); render(<SynthesisGenerationCancelPanel {...f.props} />);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reason for cancelling"), { target: { value: "  Keep original reason 日本語\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel analysis request" }));
    await waitFor(() => expect(f.props.onCancelled).toHaveBeenCalledOnce());
    expect(readPendingSynthesisGeneration(localStorage, f.scope, "create")).toEqual(f.create);
    expect(readPendingSynthesisGeneration(localStorage, f.scope, "cancel")).toBeNull();
  });

  it("recovers the original cancellation ID and reason after an uncertain reply", async () => {
    const f = fixture(); let body = "", sends = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      sends++; if (sends === 1) { body = String(init?.body); throw new Error("lost cancellation reply"); }
      expect(init?.body).toBe(body); return json({ ...f.receipt(String(init?.body)), replayed: true });
    });
    vi.stubGlobal("fetch", fetcher); const view = render(<SynthesisGenerationCancelPanel {...f.props} />);
    fireEvent.change(screen.getByLabelText("Reason for cancelling"), { target: { value: "SYNTHETIC stop" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel analysis request" })); await screen.findByText("lost cancellation reply");
    view.unmount(); render(<SynthesisGenerationCancelPanel {...f.props} />);
    expect(await screen.findByRole("button", { name: "Retry saved cancellation" })).toBeEnabled(); expect(sends).toBe(1);
    expect(screen.getByLabelText("Reason for cancelling")).toHaveValue("SYNTHETIC stop");
    fireEvent.click(screen.getByRole("button", { name: "Retry saved cancellation" }));
    await waitFor(() => expect(f.props.onCancelled).toHaveBeenCalledOnce()); expect(sends).toBe(2);
  });

  it("does not replace an unresolved cancellation for another request", async () => {
    const f = fixture(), otherId = randomUUID();
    const pending = { ...f.create, command: { operation: "cancel" as const, requestId: otherId, cancellationId: randomUUID(), reason: "Keep earlier cancellation" } };
    retainPendingSynthesisGeneration(localStorage, pending);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); render(<SynthesisGenerationCancelPanel {...f.props} />);
    expect(await screen.findByRole("button", { name: "Cancel analysis request" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Retry saved cancellation" })).toBeNull();
    expect(readPendingSynthesisGeneration(localStorage, f.scope, "cancel")).toEqual(pending); expect(fetcher).not.toHaveBeenCalled();
  });

  it("offers no new cancellation to a different staff account or for a cancelled request", () => {
    const f = fixture(); const view = render(<SynthesisGenerationCancelPanel {...f.props} actorId={randomUUID()} />);
    expect(screen.queryByRole("button", { name: "Cancel analysis request" })).toBeNull();
    view.rerender(<SynthesisGenerationCancelPanel {...f.props} cancelled />);
    expect(screen.queryByRole("button", { name: "Cancel analysis request" })).toBeNull();
  });

  it("refuses a cancellation when storage readback fails", async () => {
    const f = fixture(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); render(<SynthesisGenerationCancelPanel {...f.props} />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    fireEvent.change(screen.getByLabelText("Reason for cancelling"), { target: { value: "SYNTHETIC stop" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel analysis request" })); await screen.findByRole("alert"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("reopens cancellation recovery after its storage write succeeds but readback is interrupted", async () => {
    const f = fixture(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); render(<SynthesisGenerationCancelPanel {...f.props} />);
    const original = Storage.prototype.getItem; let interrupted = false;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      const value = original.call(this, key);
      if (key.endsWith(":cancel") && value !== null && !interrupted) { interrupted = true; throw new Error("SYNTHETIC interrupted cancellation readback"); }
      return value;
    });
    fireEvent.change(screen.getByLabelText("Reason for cancelling"), { target: { value: "SYNTHETIC stop" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel analysis request" }));
    expect(await screen.findByRole("button", { name: "Retry saved cancellation" })).toBeEnabled();
    expect(readPendingSynthesisGeneration(localStorage, f.scope, "cancel")).not.toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  });

  it("clears private cancellation wording on native access denial", async () => {
    const f = fixture(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 403))); render(<SynthesisGenerationCancelPanel {...f.props} />);
    fireEvent.change(screen.getByLabelText("Reason for cancelling"), { target: { value: "SYNTHETIC private reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel analysis request" }));
    await waitFor(() => expect(f.props.onAccessLost).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Reason for cancelling")).toHaveValue(""); expect(screen.queryByText(/Original reason:/)).toBeNull();
    expect(readPendingSynthesisGeneration(localStorage, f.scope, "cancel")).not.toBeNull();
  });
});

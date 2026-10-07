import { createHash, randomUUID } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SynthesisGenerationCreatePanel } from "@/components/engagement/synthesis-generation-create-panel";
import { readPendingSynthesisGeneration } from "@/lib/engagement/synthesis-generation-request-recovery";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); vi.unstubAllGlobals(); });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function fixture() {
  const scope = { userId: randomUUID(), workspaceId: randomUUID(), campaignId: randomUUID(), sourceId: randomUUID(), sourceSha256: "a".repeat(64) };
  const connectionId = randomUUID(), revisionId = randomUUID(), date = "2026-10-06T12:00:00Z";
  const revision = { id: revisionId, connection_id: connectionId, workspace_id: scope.workspaceId, previous_revision_id: null,
    configuration: { label: "Synthetic local API", protocol: "openai_chat_completions", endpoint: "http://synthetic.invalid/v1", modelIds: ["synthetic-model"], structuredOutput: true, authMode: "none", timeoutSeconds: 120 },
    configuration_hash: "b".repeat(64), configured_by: scope.userId, created_at: date };
  const connection = { id: connectionId, workspace_id: scope.workspaceId, current_revision_id: revisionId, created_by: scope.userId, created_at: date, revoked_at: null, current_revision: revision };
  const page = { connections: [connection], total: 1, offset: 0, nextOffset: null };
  const receipt = (body: string, changes: Record<string, unknown> = {}) => {
    const command = JSON.parse(body);
    return { schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, cancellation: null, replayed: false,
      request: { id: command.requestId, actorId: scope.userId, intentText: command.intentText,
        intentSha256: createHash("sha256").update(command.intentText).digest("hex"), createdAt: date, ...changes } };
  };
  return { scope, props: { ...scope, onAccessLost: vi.fn(), onCreated: vi.fn() }, page, connection, revision, receipt };
}
async function choose(f: ReturnType<typeof fixture>, toggle = "Optional generated analysis") {
  fireEvent.click(screen.getByRole("button", { name: toggle }));
  await screen.findByRole("option", { name: "Synthetic local API" });
  fireEvent.change(screen.getByLabelText("Saved API connection"), { target: { value: f.connection.id } });
  fireEvent.change(screen.getByLabelText("Analysis model"), { target: { value: "synthetic-model" } });
}

describe("staff analysis request creation", () => {
  it("restores an unsent choice after remount but waits for fresh provider metadata", async () => {
    const f = fixture(), choiceMemory = { scope: f.scope, current: null };
    let finish!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(f.page))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<SynthesisGenerationCreatePanel {...f.props} choiceMemory={choiceMemory} />);
    await choose(f); view.unmount();
    render(<SynthesisGenerationCreatePanel {...f.props} choiceMemory={choiceMemory} />);
    expect(screen.getByLabelText("Analysis model")).toHaveValue("synthetic-model");
    expect(screen.getByRole("button", { name: "Save analysis request" })).toBeDisabled();
    await act(async () => finish(json(f.page)));
    expect(screen.getByLabelText("Saved API connection")).toHaveValue(f.connection.id);
    expect(screen.getByRole("button", { name: "Save analysis request" })).toBeEnabled();
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });
  it("does not silently replace a retained provider revision after remount", async () => {
    const f = fixture(), choiceMemory = { scope: f.scope, current: null };
    const revisionId = randomUUID();
    const changed = { ...f.connection, current_revision_id: revisionId, current_revision: { ...f.revision,
      id: revisionId, configuration_hash: "c".repeat(64), configuration: { ...f.revision.configuration, endpoint: "http://replacement.invalid/v1" } } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(f.page))
      .mockResolvedValueOnce(json({ ...f.page, connections: [changed] }));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<SynthesisGenerationCreatePanel {...f.props} choiceMemory={choiceMemory} />);
    await choose(f); view.unmount();
    render(<SynthesisGenerationCreatePanel {...f.props} choiceMemory={choiceMemory} />);
    await screen.findByText("The selected API changed or is unavailable. Choose its current revision before saving a new request.");
    expect(screen.getByText("Destination: http://synthetic.invalid/v1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save analysis request" })).toBeDisabled();
    expect(screen.getByLabelText("Saved API connection")).toHaveValue("");
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });
  it.each(["userId", "workspaceId", "campaignId", "sourceId", "sourceSha256"] as const)("does not restore choices for a different %s", async field => {
    const f = fixture(), choiceMemory = { scope: f.scope, current: null };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(json(f.page)));
    const view = render(<SynthesisGenerationCreatePanel {...f.props} choiceMemory={choiceMemory} />);
    await choose(f); view.unmount();
    render(<SynthesisGenerationCreatePanel {...f.props} {...{ [field]: field === "sourceSha256" ? "c".repeat(64) : randomUUID() }} choiceMemory={choiceMemory} />);
    expect(screen.getByRole("button", { name: "Optional generated analysis" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Analysis model")).toBeNull();
  });
  it.each([401, 403])("forgets the unsent choice after provider access fails with %s", async status => {
    const f = fixture(), choiceMemory = { scope: f.scope, current: null };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(json(f.page)).mockResolvedValueOnce(json({}, status)));
    const view = render(<SynthesisGenerationCreatePanel {...f.props} choiceMemory={choiceMemory} />);
    await choose(f);
    fireEvent.click(screen.getByRole("button", { name: "Refresh analysis providers" }));
    await waitFor(() => expect(f.props.onAccessLost).toHaveBeenCalledOnce());
    view.unmount(); render(<SynthesisGenerationCreatePanel {...f.props} choiceMemory={choiceMemory} />);
    expect(screen.getByRole("button", { name: "Optional generated analysis" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Analysis model")).toBeNull();
  });
  it("retires an unsent choice once its exact request becomes the recovery record", async () => {
    const f = fixture(), choiceMemory = { scope: f.scope, current: null };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.method === "POST") throw new Error("SYNTHETIC lost reply");
      return json(f.page);
    });
    vi.stubGlobal("fetch", fetcher);
    const view = render(<SynthesisGenerationCreatePanel {...f.props} choiceMemory={choiceMemory} />);
    await choose(f); fireEvent.click(screen.getByRole("button", { name: "Save analysis request" }));
    await screen.findByText("SYNTHETIC lost reply");
    expect(choiceMemory.current).toBeNull();
    view.unmount(); render(<SynthesisGenerationCreatePanel {...f.props} choiceMemory={choiceMemory} />);
    await screen.findByRole("button", { name: "Retry saved analysis request" });
    expect(screen.getByRole("button", { name: "Save analysis request" })).toBeDisabled();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("requires a fresh selection when paging returns a changed revision of the chosen connection", async () => {
    const f = fixture();
    const preceding = Array.from({ length: 49 }, (_, index) => {
      const id = randomUUID(), revisionId = randomUUID();
      return { ...f.connection, id, current_revision_id: revisionId, current_revision: { ...f.revision, id: revisionId, connection_id: id,
        configuration: { ...f.revision.configuration, label: `Other synthetic API ${index}` } } };
    });
    const replacementId = randomUUID();
    const changed = { ...f.connection, current_revision_id: replacementId, current_revision: { ...f.revision, id: replacementId, configuration_hash: "c".repeat(64),
      configuration: { ...f.revision.configuration, endpoint: "http://changed-synthetic.invalid/v1" } } };
    const first = { ...f.page, connections: [...preceding, f.connection], total: 51, nextOffset: 50 };
    const later = { ...f.page, connections: [changed], total: 51, offset: 50, nextOffset: null };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(first)).mockResolvedValueOnce(json(later));
    vi.stubGlobal("fetch", fetcher); render(<SynthesisGenerationCreatePanel {...f.props} />); await choose(f);
    expect(screen.getByRole("button", { name: "Save analysis request" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Load more analysis providers" }));
    await screen.findByText("The selected API changed or is unavailable. Choose its current revision before saving a new request.");
    expect(screen.getByRole("button", { name: "Save analysis request" })).toBeDisabled();
    expect(screen.getByLabelText("Saved API connection")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Saved API connection"), { target: { value: changed.id } });
    fireEvent.change(screen.getByLabelText("Analysis model"), { target: { value: "synthetic-model" } });
    expect(screen.getByRole("button", { name: "Save analysis request" })).toBeEnabled();
    expect(screen.getByText("Destination: http://changed-synthetic.invalid/v1")).toBeTruthy();
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("can start another request after cancellation precedes creation and the uncertain original is preserved", async () => {
    const f = fixture();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.method !== "POST") return json(f.page);
      const command = JSON.parse(String(init.body));
      if (command.operation === "create") throw new Error("creation unconfirmed");
      const receiptText = JSON.stringify({ schemaVersion: 1, id: command.cancellationId, requestId: command.requestId,
        campaignId: f.scope.campaignId, workspaceId: f.scope.workspaceId, actorId: f.scope.userId, reason: command.reason,
        requestExisted: false, cancelledAt: "2026-10-06T12:01:00Z" });
      return json({ schemaVersion: 1, workspaceId: f.scope.workspaceId, campaignId: f.scope.campaignId, request: null, replayed: false,
        cancellation: { id: command.cancellationId, receiptText, receiptSha256: createHash("sha256").update(receiptText).digest("hex"), createdAt: "2026-10-06T12:01:00Z" } });
    });
    vi.stubGlobal("fetch", fetcher); render(<SynthesisGenerationCreatePanel {...f.props} />); await choose(f);
    fireEvent.click(screen.getByRole("button", { name: "Save analysis request" })); await screen.findByText("creation unconfirmed");
    const original = readPendingSynthesisGeneration(localStorage, f.scope, "create");
    fireEvent.change(screen.getByLabelText("Reason for cancelling"), { target: { value: "Stop uncertain creation" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel analysis request" }));
    expect(await screen.findByRole("button", { name: "Start another request" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Preserve request recovery copy" }));
    expect(screen.getByRole("button", { name: "Start another request" })).toBeEnabled();
    expect(localStorage.getItem(localStorage.key(0)!)).toBe(JSON.stringify(original));
    fireEvent.click(screen.getByRole("button", { name: "Start another request" }));
    expect(await screen.findByRole("button", { name: "Save analysis request" })).toBeDisabled();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });
  it("does not let a delayed creation reply erase a confirmed cancellation", async () => {
    const f = fixture(); let createBody = "", finishCreate!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (init?.method === "POST") {
        const command = JSON.parse(String(init.body));
        if (command.operation === "create") { createBody = String(init.body); return new Promise(done => { finishCreate = done; }); }
        const receiptText = JSON.stringify({ schemaVersion: 1, id: command.cancellationId, requestId: command.requestId,
          campaignId: f.scope.campaignId, workspaceId: f.scope.workspaceId, actorId: f.scope.userId, reason: command.reason,
          requestExisted: true, cancelledAt: "2026-10-06T12:01:00Z" });
        return json({ ...f.receipt(createBody), cancellation: { id: command.cancellationId, receiptText,
          receiptSha256: createHash("sha256").update(receiptText).digest("hex"), createdAt: "2026-10-06T12:01:00Z" } });
      }
      return json(String(url).includes("/synthesis/preparation") ? null : f.page);
    });
    vi.stubGlobal("fetch", fetcher); render(<SynthesisGenerationCreatePanel {...f.props} />); await choose(f);
    fireEvent.click(screen.getByRole("button", { name: "Save analysis request" }));
    fireEvent.change(await screen.findByLabelText("Reason for cancelling"), { target: { value: "SYNTHETIC stop while save is uncertain" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel analysis request" }));
    await screen.findByText("Cancellation is saved for this request.");
    await act(async () => finishCreate(json(f.receipt(createBody))));
    expect(screen.getByText("Cancellation is saved for this request.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Queue preparation" })).toBeDisabled();
  });
  it("pins provider choice and retains exact intent before saving, then offers preparation without executing it", async () => {
    const f = fixture(), fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (init?.method === "POST") {
        const retained = readPendingSynthesisGeneration(localStorage, f.scope, "create");
        expect(retained?.command).toEqual(JSON.parse(String(init.body)));
        expect(JSON.parse(retained!.intentText)).toEqual({ schemaVersion: 1, sourceId: f.scope.sourceId, sourceSha256: f.scope.sourceSha256,
          connectionId: f.connection.id, configurationRevisionId: f.revision.id, configurationHash: f.revision.configuration_hash, modelId: "synthetic-model", taskByteLimit: 65_536 });
        return json(f.receipt(String(init.body)), 201);
      }
      return json(String(url).includes("/synthesis/preparation") ? null : f.page);
    });
    vi.stubGlobal("fetch", fetcher); render(<SynthesisGenerationCreatePanel {...f.props} />);
    expect(fetcher).not.toHaveBeenCalled(); await choose(f);
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ "x-openplan-expected-user": f.scope.userId, "x-openplan-expected-workspace": f.scope.workspaceId });
    fireEvent.click(screen.getByRole("button", { name: "Save analysis request" }));
    await screen.findByRole("button", { name: "Queue preparation" });
    expect(f.props.onCreated).toHaveBeenCalledOnce(); expect(readPendingSynthesisGeneration(localStorage, f.scope, "create")).toBeNull();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(screen.getByText("Analysis request saved. Saving a request does not grant provider execution permission.")).toBeTruthy();
  });

  it("recovers a lost reply after remount and retries the original intent despite changed provider metadata", async () => {
    const f = fixture(); let firstBody = "", postCount = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (init?.method === "POST") {
        postCount++;
        if (postCount === 1) { firstBody = String(init.body); throw new Error("lost reply"); }
        expect(init.body).toBe(firstBody); return json({ ...f.receipt(String(init.body)), replayed: true });
      }
      return json(String(url).includes("/synthesis/preparation") ? null : f.page);
    });
    vi.stubGlobal("fetch", fetcher); const view = render(<SynthesisGenerationCreatePanel {...f.props} />); await choose(f);
    fireEvent.click(screen.getByRole("button", { name: "Save analysis request" })); await screen.findByText("lost reply");
    view.unmount(); f.revision.configuration_hash = "c".repeat(64);
    render(<SynthesisGenerationCreatePanel {...f.props} />); await screen.findByRole("button", { name: "Retry saved analysis request" });
    expect(postCount).toBe(1); expect(screen.getByRole("button", { name: "Save analysis request" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry saved analysis request" }));
    await screen.findByText("Analysis request saved. Saving a request does not grant provider execution permission."); expect(postCount).toBe(2);
  });

  it("does not send when storage cannot retain the exact command", async () => {
    const f = fixture(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(f.page)); vi.stubGlobal("fetch", fetcher);
    render(<SynthesisGenerationCreatePanel {...f.props} />); await choose(f);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage is full"); });
    fireEvent.click(screen.getByRole("button", { name: "Save analysis request" })); await screen.findByText("Storage is full");
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("reopens a command whose storage write succeeded but readback was interrupted", async () => {
    const f = fixture(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(f.page)); vi.stubGlobal("fetch", fetcher);
    render(<SynthesisGenerationCreatePanel {...f.props} />); await choose(f);
    const original = Storage.prototype.getItem; let interrupted = false;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key: string) {
      const value = original.call(this, key);
      if (key.endsWith(":create") && value !== null && !interrupted) { interrupted = true; throw new Error("SYNTHETIC interrupted storage readback"); }
      return value;
    });
    fireEvent.click(screen.getByRole("button", { name: "Save analysis request" }));
    expect(await screen.findByRole("button", { name: "Retry saved analysis request" })).toBeEnabled();
    expect(readPendingSynthesisGeneration(localStorage, f.scope, "create")).not.toBeNull();
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it.each(["connection workspace", "revision workspace", "revision connection", "revision identity", "cursor"])("refuses provider choices with a different %s", async field => {
    const f = fixture();
    if (field === "connection workspace") f.connection.workspace_id = randomUUID();
    if (field === "revision workspace") f.revision.workspace_id = randomUUID();
    if (field === "revision connection") f.revision.connection_id = randomUUID();
    if (field === "revision identity") f.revision.id = randomUUID();
    const page = field === "cursor" ? { ...f.page, offset: 50 } : f.page;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(page))); render(<SynthesisGenerationCreatePanel {...f.props} />);
    fireEvent.click(screen.getByRole("button", { name: "Optional generated analysis" })); await screen.findByRole("alert");
    expect(screen.queryByRole("option", { name: "Synthetic local API" })).toBeNull(); expect(screen.getByRole("button", { name: "Save analysis request" })).toBeDisabled();
  });

  it("keeps an unavailable provider read distinct from no configured choices", async () => {
    const f = fixture(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline"))); render(<SynthesisGenerationCreatePanel {...f.props} />);
    fireEvent.click(screen.getByRole("button", { name: "Optional generated analysis" })); await screen.findByRole("alert");
    expect(screen.queryByText(/No saved API choices are available/)).toBeNull(); expect(screen.getByRole("button", { name: "Save analysis request" })).toBeDisabled();
  });

  it("rejects a receipt from another actor and keeps the original command", async () => {
    const f = fixture(), fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => init?.method === "POST" ? json(f.receipt(String(init.body), { actorId: randomUUID() })) : json(f.page));
    vi.stubGlobal("fetch", fetcher); render(<SynthesisGenerationCreatePanel {...f.props} />); await choose(f);
    fireEvent.click(screen.getByRole("button", { name: "Save analysis request" })); await screen.findByRole("alert");
    expect(f.props.onCreated).not.toHaveBeenCalled(); expect(readPendingSynthesisGeneration(localStorage, f.scope, "create")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Queue preparation" })).toBeNull();
  });

  it("clears choices and notifies the source when native account pinning denies a refresh", async () => {
    const f = fixture(), fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(f.page)).mockResolvedValueOnce(json({}, 403));
    vi.stubGlobal("fetch", fetcher); render(<SynthesisGenerationCreatePanel {...f.props} />); await choose(f);
    fireEvent.click(screen.getByRole("button", { name: "Refresh analysis providers" }));
    await waitFor(() => expect(f.props.onAccessLost).toHaveBeenCalledOnce());
    expect(screen.queryByRole("option", { name: "Synthetic local API" })).toBeNull();
  });

  it("does not adopt a late save reply after the source changes", async () => {
    const a = fixture(), b = fixture(); let resolve!: (response: Response) => void, body = "";
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.method === "POST") { body = String(init.body); return new Promise(done => { resolve = done; }); }
      return json(a.page);
    });
    vi.stubGlobal("fetch", fetcher); const view = render(<SynthesisGenerationCreatePanel {...a.props} />); await choose(a);
    fireEvent.click(screen.getByRole("button", { name: "Save analysis request" }));
    await waitFor(() => expect(body).not.toBe("")); view.rerender(<SynthesisGenerationCreatePanel {...b.props} />);
    await act(async () => resolve(json(a.receipt(body))));
    expect(a.props.onCreated).not.toHaveBeenCalled(); expect(b.props.onCreated).not.toHaveBeenCalled();
    expect(screen.queryByText("Analysis request saved. Saving a request does not grant provider execution permission.")).toBeNull();
    expect(readPendingSynthesisGeneration(localStorage, a.scope, "create")).not.toBeNull();
  });
});


describe("context request through the shared staff form", () => {
  it("retains a selected contribution before sending and retries it after remount without changing provider or parent", async () => {
    const f = fixture(), continuation = { stage: "context" as const, parent: { parentRequestId: randomUUID(), parentActorId: randomUUID(),
      parentIntentSha256: "c".repeat(64), sourceId: f.scope.sourceId, sourceSha256: f.scope.sourceSha256, throughSequence: 4,
      segmentResultsManifestSha256: "d".repeat(64) }, frameByteLimit: 65536, targetRecordId: `item:${randomUUID()}` };
    let first: string | null = null;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (init?.method !== "POST") return String(url).includes("provider-api-connections") ? json(f.page) : json({}, 503);
      expect(String(url).endsWith(`/synthesis/continuation`)).toBe(true);
      const retained = readPendingSynthesisGeneration(localStorage, f.scope, "continue", continuation);
      expect(retained?.intentText).toBe(JSON.parse(String(init.body)).intentText);
      if (first === null) { first = String(init.body); throw new Error("SYNTHETIC lost context reply"); }
      expect(String(init.body)).toBe(first);
      const command = JSON.parse(first);
      const contextText = JSON.stringify({ schemaVersion: 1, parentRequestId: continuation.parent.parentRequestId,
        selectionSequence: 4, segmentResultsManifestSha256: continuation.parent.segmentResultsManifestSha256,
        contextManifestSha256: "e".repeat(64), contentManifestSha256: "f".repeat(64), frameByteLimit: 65536, targetRecordId: continuation.targetRecordId });
      return json({ ...f.receipt(String(init.body)), replayed: true,
        context: { parentRequestId: command.parent.parentRequestId, contextText,
          contextSha256: createHash("sha256").update(contextText).digest("hex"), createdAt: "2026-10-07T00:00:00Z" } });
    });
    vi.stubGlobal("fetch", fetcher);
    const view = render(<SynthesisGenerationCreatePanel {...f.props} continuation={continuation} />);
    await choose(f, "Combine this contribution"); fireEvent.click(screen.getByRole("button", { name: "Save context request" }));
    await screen.findByText("SYNTHETIC lost context reply");
    expect(readPendingSynthesisGeneration(localStorage, f.scope, "create")).toBeNull(); view.unmount();
    render(<SynthesisGenerationCreatePanel {...f.props} continuation={{ ...continuation, parent: { ...continuation.parent, throughSequence: 5, segmentResultsManifestSha256: "e".repeat(64) } }} />);
    await screen.findByRole("button", { name: "Retry saved analysis request" });
    expect(screen.getByText(/original parent selection and contribution below govern this retry/)).toBeTruthy();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry saved analysis request" }));
    await screen.findByText("Analysis request saved. Saving a request does not grant provider execution permission.");
    expect(f.props.onCreated).toHaveBeenCalledOnce();
    expect(readPendingSynthesisGeneration(localStorage, f.scope, "continue", continuation)).toBeNull();
    expect(JSON.parse(first!).targetRecordId).toBe(continuation.targetRecordId);
    expect(JSON.parse(first!).parent).toEqual(continuation.parent);
    fireEvent.click(screen.getByRole("button", { name: "Inspect saved analysis results" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("stage=context"))).toBe(true));
  });
});

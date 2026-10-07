import { createHash } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SynthesisExecutionPanel } from "@/components/engagement/synthesis-execution-panel";
import { readPendingSynthesisExecution, retainPendingSynthesisExecution } from "@/lib/engagement/synthesis-execution-recovery";

const id = (n: number) => `c7500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const scope = { campaignId: id(1), workspaceId: id(2), requestId: id(3), actorId: id(4), sourceId: id(5),
  sourceSha256: "a".repeat(64), requestIntentSha256: "b".repeat(64), stage: "segment" as const };
const preview = { schemaVersion: 1, ...scope, headerSha256: "c".repeat(64), sealSha256: "d".repeat(64), taskCount: 2,
  inputBytes: 9000, sealedAt: "2026-10-02T00:00:00Z", cancelled: false,
  provider: { connectionId: id(6), revisionId: id(7), configurationHash: "e".repeat(64), label: "SYNTHETIC saved provider",
    endpoint: "https://provider.invalid/v1/", modelId: "synthetic", current: true } };
const { stage: _stage, ...historyScope } = scope;
const history = { schemaVersion: 1, ...historyScope, cancelled: false, entries: [], nextCursor: null };
const intentText = JSON.stringify({ schemaVersion: 1, headerSha256: preview.headerSha256, maxAttempts: 2, maxOutputTokens: 2048,
  responseByteLimit: 65536, expiresAt: "2026-01-01T00:00:00Z", chargesAcknowledged: true, retryTaskIndex: null, retryOfAttemptId: null }, null, 2);
const pending = { version: 1 as const, ...scope, command: { authorizationId: id(8), intentText } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const lostAccess = vi.fn();
let transport: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  localStorage.clear(); vi.resetAllMocks();
  transport = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      return json({ schemaVersion: 1, id: body.authorizationId, requestId: body.requestId, intentText: body.intentText, intentSha256: hash(body.intentText) });
    }
    return json(String(input).includes("mode=history") ? history : preview);
  });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const mount = (userId = scope.actorId) => render(<SynthesisExecutionPanel {...scope} userId={userId} onAccessLost={lostAccess} />);
const open = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Review execution permission" }));
  await screen.findByText(/Provider: SYNTHETIC saved provider/);
};
const acknowledge = () => fireEvent.click(screen.getByRole("checkbox", { name: /I authorize sending/ }));
const saveButton = () => screen.getByRole("button", { name: "Save execution permission" }) as HTMLButtonElement;
const posts = () => transport.mock.calls.filter(([, init]) => init?.method === "POST");

describe("staff execution permission review", () => {
  it("reads only when opened and requires explicit charge acknowledgement after inspecting the real destination", async () => {
    mount(); expect(transport).not.toHaveBeenCalled(); await open();
    expect(screen.getByText(/https:\/\/provider.invalid\/v1\//)).toBeTruthy();
    expect(screen.getByText(/2 prepared tasks; 9,000 saved bytes/)).toBeTruthy();
    expect(screen.getByText(/not a dollar ceiling/)).toBeTruthy(); expect(saveButton().disabled).toBe(true);
    acknowledge(); expect(saveButton().disabled).toBe(false); expect(posts()).toHaveLength(0);
  });
  it("retains exact reviewed limits before POST and blocks another allowance after confirmation", async () => {
    let retainedBeforePost = false;
    transport.mockImplementation(async (input, init) => {
      if (init?.method !== "POST") return json(String(input).includes("mode=history") ? history : preview);
      const body = JSON.parse(String(init.body));
      retainedBeforePost = readPendingSynthesisExecution(localStorage, scope)?.command.intentText === body.intentText;
      return json({ schemaVersion: 1, id: body.authorizationId, requestId: body.requestId, intentText: body.intentText, intentSha256: hash(body.intentText) });
    });
    mount(); await open();
    fireEvent.change(screen.getByLabelText("Maximum attempts"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Output tokens per call"), { target: { value: "1234" } });
    acknowledge(); fireEvent.click(saveButton()); await screen.findByText(/Execution permission saved:/);
    expect(retainedBeforePost).toBe(true); expect(posts()).toHaveLength(1);
    const saved = readPendingSynthesisExecution(localStorage, scope)!;
    expect(JSON.parse(saved.command.intentText)).toMatchObject({ maxAttempts: 1, maxOutputTokens: 1234, headerSha256: preview.headerSha256, chargesAcknowledged: true });
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Retry original execution permission" })).toBeTruthy();
  });
  it("reopens an expired saved allowance without writing and retries only its original bytes", async () => {
    retainPendingSynthesisExecution(localStorage, pending); mount();
    await screen.findByText(/Original allowance/); expect(posts()).toHaveLength(0);
    fireEvent.click(await screen.findByRole("button", { name: "Retry original execution permission" }));
    await screen.findByText(/Execution permission saved:/);
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(String(posts()[0][1]?.body))).toMatchObject(pending.command);
    expect(readPendingSynthesisExecution(localStorage, scope)).toEqual(pending);
  });
  it("retains a lost reply across remount without automatically sending another command", async () => {
    transport.mockImplementation(async (input, init) => {
      if (init?.method === "POST") throw new Error("SYNTHETIC lost reply");
      return json(String(input).includes("mode=history") ? history : preview);
    });
    const view = mount(); await open(); acknowledge(); fireEvent.click(saveButton());
    await screen.findByText("SYNTHETIC lost reply"); const original = readPendingSynthesisExecution(localStorage, scope);
    view.unmount(); mount(); await screen.findByText(/Original allowance/);
    expect(posts()).toHaveLength(1); expect(readPendingSynthesisExecution(localStorage, scope)).toEqual(original);
  });
  it.each(["cancelled", "provider-revoked", "wrong-source", "zero-tasks"])("refuses new authority when %s", async kind => {
    const changed = { ...preview, provider: { ...preview.provider } };
    if (kind === "cancelled") changed.cancelled = true;
    if (kind === "provider-revoked") changed.provider.current = false;
    if (kind === "wrong-source") changed.sourceSha256 = "f".repeat(64);
    if (kind === "zero-tasks") changed.taskCount = 0;
    transport.mockImplementation(async input => json(String(input).includes("mode=history") ? history : changed));
    mount(); fireEvent.click(screen.getByRole("button", { name: "Review execution permission" }));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
    if (kind === "wrong-source") await screen.findByText("Prepared execution scope differs");
    else await screen.findByText(/Provider: SYNTHETIC/);
    acknowledge(); expect(saveButton().disabled).toBe(true); fireEvent.click(saveButton()); expect(posts()).toHaveLength(0);
  });
  it("keeps other staff read-only and never loads the original requester's browser command", async () => {
    retainPendingSynthesisExecution(localStorage, pending); mount(id(99)); await open();
    expect(screen.getByText(/Only the original requester/)).toBeTruthy();
    expect(screen.queryByText(/Original allowance/)).toBeNull(); expect(screen.queryByRole("button", { name: "Save execution permission" })).toBeNull();
    for (const [, init] of transport.mock.calls) expect(new Headers(init?.headers).get("x-openplan-expected-user")).toBe(id(99));
  });
  it("retains saved history when preparation is unavailable, with new allowance disabled", async () => {
    transport.mockImplementation(async input => String(input).includes("mode=history") ? json(history) : json({}, 409));
    mount(); fireEvent.click(screen.getByRole("button", { name: "Review execution permission" }));
    await screen.findByText(/The prepared plan is unavailable/);
    expect(screen.getByText("No saved permissions were found.")).toBeTruthy(); expect(saveButton().disabled).toBe(true);
  });
  it("clears private values when current access fails", async () => {
    mount(); await open(); transport.mockResolvedValue(json({}, 403));
    fireEvent.click(screen.getByRole("button", { name: "Refresh execution review" }));
    await waitFor(() => expect(lostAccess).toHaveBeenCalledOnce());
    expect(screen.queryByText(/Provider: SYNTHETIC/)).toBeNull(); expect(saveButton().disabled).toBe(true);
  });
  it("preserves unreadable recovery before allowing another allowance", async () => {
    retainPendingSynthesisExecution(localStorage, pending); const key = localStorage.key(0)!; localStorage.setItem(key, "{broken original");
    mount(); await screen.findByText(/Execution recovery is unreadable/);
    await screen.findByText(/Provider: SYNTHETIC/); expect(saveButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Preserve allowance recovery" }));
    await screen.findByText("Preserved allowance copies (1)");
    expect(localStorage.getItem(key)).toBeNull(); expect(posts()).toHaveLength(0);
    expect([...Array(localStorage.length)].map((_, index) => localStorage.getItem(localStorage.key(index)!))).toContain("{broken original");
  });
  it("does not adopt a read after unmount", async () => {
    let release!: (response: Response) => void;
    transport.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const view = mount(); fireEvent.click(screen.getByRole("button", { name: "Review execution permission" })); view.unmount();
    await act(async () => { release(json(history)); });
    expect(transport).toHaveBeenCalledTimes(1); expect(lostAccess).not.toHaveBeenCalled();
  });
});

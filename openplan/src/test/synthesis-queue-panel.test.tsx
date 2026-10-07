import { createHash } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SynthesisQueuePanel } from "../components/engagement/synthesis-queue-panel";
import { readPendingSynthesisQueue, retainPendingSynthesisQueue } from "../lib/engagement/synthesis-execution-queue-recovery";
const id = (n: number) => `c7500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { campaignId: id(1), workspaceId: id(2), requestId: id(3), actorId: id(4), sourceId: id(5), sourceSha256: "a".repeat(64), requestIntentSha256: "b".repeat(64), stage: "segment" as const };
const bound = { ...scope, authorizationId: id(6), authorizationIntentSha256: "c".repeat(64) };
const bytes = JSON.stringify({ schemaVersion: 1, ...bound, queueId: id(7) });
const receipt = (commandText = bytes) => ({ schemaVersion: 1, queueId: JSON.parse(commandText).queueId, commandText, commandSha256: createHash("sha256").update(commandText).digest("hex"), createdAt: "2026-10-07T23:00:00Z" });
const lookup = (value: unknown = null) => ({ schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, requestId: scope.requestId, authorizationId: bound.authorizationId, receipt: value });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const lost = vi.fn(); let transport: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => { localStorage.clear(); vi.resetAllMocks(); transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => json(init?.method === "POST" ? receipt(String(init.body)) : lookup())); vi.stubGlobal("fetch", transport); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mount = (expiresAt = "2099-01-01T00:00:00Z", unavailable = false) => render(<SynthesisQueuePanel scope={scope} authorizationId={bound.authorizationId} authorizationIntentSha256={bound.authorizationIntentSha256} expiresAt={expiresAt} unavailable={unavailable} onAccessLost={lost} />);
const review = () => fireEvent.click(screen.getByRole("button", { name: "Review scheduling" }));
const posts = () => transport.mock.calls.filter(([, init]) => init?.method === "POST");
describe("explicit staff scheduling", () => {
  it("requires a successful read and explicit request before sending exact retained bytes", async () => {
    mount(); expect(transport).not.toHaveBeenCalled(); review(); await screen.findByText(/No server queue receipt/); expect(posts()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Request execution under this allowance" }));
    await screen.findByText(/Original execution request is queued/);
    expect(posts()).toHaveLength(1); expect(posts()[0][1]?.body).toBe(readPendingSynthesisQueue(localStorage, bound)?.commandText);
  });
  it("recovers server custody without posting or replacing its identity", async () => {
    transport.mockResolvedValue(json(lookup(receipt()))); mount(); review(); await screen.findByText(/Original execution request is queued/);
    expect(readPendingSynthesisQueue(localStorage, bound)?.commandText).toBe(bytes); expect(posts()).toHaveLength(0);
  });
  it.each(["expired", "unavailable"])("refuses fresh scheduling when %s", async reason => {
    mount(reason === "expired" ? "2020-01-01T00:00:00Z" : undefined, reason === "unavailable"); review(); await screen.findByText(/No server queue receipt/);
    expect((screen.getByRole("button", { name: "Request execution under this allowance" }) as HTMLButtonElement).disabled).toBe(true); expect(posts()).toHaveLength(0);
  });
  it("retries the original command after a lost reply even after expiry", async () => {
    retainPendingSynthesisQueue(localStorage, bound, bytes); mount("2020-01-01T00:00:00Z"); review(); await screen.findByText(/No server queue receipt/);
    transport.mockRejectedValueOnce(new Error("lost reply")); fireEvent.click(screen.getByRole("button", { name: "Retry original execution request" })); await screen.findByText("lost reply");
    fireEvent.click(screen.getByRole("button", { name: "Retry original execution request" })); await screen.findByText(/Original execution request is queued/);
    expect(posts().map(([, init]) => init?.body)).toEqual([bytes, bytes]);
  });
  it("keeps failed lookup distinct from an empty queue", async () => {
    transport.mockResolvedValue(json({}, 503)); mount(); review(); await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "Request execution under this allowance" }) as HTMLButtonElement).disabled).toBe(true); expect(posts()).toHaveLength(0);
  });
  it("preserves unreadable originals before recovering server custody", async () => {
    retainPendingSynthesisQueue(localStorage, bound, bytes); const key = localStorage.key(0)!; localStorage.setItem(key, "{");
    transport.mockResolvedValue(json(lookup(receipt()))); mount(); review(); await screen.findByRole("alert"); expect(transport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preserve browser queue recovery" })); await screen.findByText(/Original execution request is queued/);
    expect(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).some(name => name?.includes(":preserved:") && localStorage.getItem(name) === "{")).toBe(true);
    expect(readPendingSynthesisQueue(localStorage, bound)?.commandText).toBe(bytes); expect(posts()).toHaveLength(0);
  });
  it("clears private recovery display when access is lost", async () => {
    retainPendingSynthesisQueue(localStorage, bound, bytes); transport.mockResolvedValue(json({}, 403)); mount(); review();
    await waitFor(() => expect(lost).toHaveBeenCalledOnce()); expect(screen.queryByText("Original scheduling command")).toBeNull(); expect(posts()).toHaveLength(0);
  });
});

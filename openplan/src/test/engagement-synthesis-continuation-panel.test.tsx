import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const form = vi.hoisted(() => vi.fn());
vi.mock("@/components/engagement/synthesis-generation-create-panel", () => ({ SynthesisGenerationCreatePanel: (props: unknown) => { form(props); return <div>Scoped creation form</div>; } }));
import { SynthesisContinuationPanel } from "@/components/engagement/synthesis-continuation-panel";

const id = (n: number) => `c7740000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const parent = { parentRequestId: id(1), parentActorId: id(2), parentIntentSha256: "a".repeat(64), sourceId: id(3),
  sourceSha256: "b".repeat(64), throughSequence: 4, segmentResultsManifestSha256: "c".repeat(64) };
const props = { userId: id(4), workspaceId: id(5), campaignId: id(6), parent, onAccessLost: vi.fn() };
const entries = Array.from({ length: 27 }, (_, i) => ({ recordId: `item:${id(20 + i)}`, kind: "item", label: `Synthetic contribution ${i + 1}`,
  excerpt: `Synthetic original preview ${i + 1}`, excerptTruncated: false }));
const page = (offset = 0) => ({ schemaVersion: 1, campaignId: props.campaignId, workspaceId: props.workspaceId, parent,
  cancelled: false, interpretation: "not_assessed", offset, pageSize: 25, total: 27, nextOffset: offset === 0 ? 25 : null, entries: entries.slice(offset, offset + 25) });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let transport: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => { vi.resetAllMocks(); transport = vi.fn<typeof fetch>().mockResolvedValue(json(page())); vi.stubGlobal("fetch", transport); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const open = () => fireEvent.click(screen.getByRole("button", { name: "Choose a contribution to combine" }));

describe("contribution context handoff", () => {
  it("reads only on demand and passes the selected contribution plus exact parent to the shared form", async () => {
    render(<SynthesisContinuationPanel {...props} />); expect(transport).not.toHaveBeenCalled(); open();
    await screen.findByText("Showing 25 of 27 contributions in this saved selection.");
    const [url, init] = transport.mock.calls[0], query = new URL(String(url), "http://localhost").searchParams;
    for (const [key, value] of Object.entries(parent)) expect(query.get(key)).toBe(String(value));
    expect(init).toMatchObject({ method: "GET", cache: "no-store", headers: { "x-openplan-expected-user": props.userId, "x-openplan-expected-workspace": props.workspaceId } });
    expect(form).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Synthetic contribution 2" }));
    expect(form).toHaveBeenLastCalledWith(expect.objectContaining({ userId: props.userId, workspaceId: props.workspaceId, campaignId: props.campaignId,
      sourceId: parent.sourceId, sourceSha256: parent.sourceSha256, continuation: { stage: "context", parent, frameByteLimit: 65536, targetRecordId: entries[1].recordId } }));
    expect(transport.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });
  it("loads every page without replacing the selected parent or skipping contributions", async () => {
    render(<SynthesisContinuationPanel {...props} />); open(); await screen.findByText("Showing 25 of 27 contributions in this saved selection.");
    transport.mockResolvedValue(json(page(25))); fireEvent.click(screen.getByRole("button", { name: "Load more contributions" }));
    await screen.findByText("Showing 27 of 27 contributions in this saved selection.");
    expect(new URL(String(transport.mock.calls[1][0]), "http://localhost").searchParams.get("offset")).toBe("25");
    expect(screen.queryByRole("button", { name: "Load more contributions" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Synthetic contribution 27" }));
    expect(form.mock.lastCall?.[0].continuation.targetRecordId).toBe(entries[26].recordId);
  });
  it.each(["workspace", "source", "manifest", "sequence", "actor", "offset", "total", "duplicate"])("refuses a changed contribution page %s and clears the form", async field => {
    render(<SynthesisContinuationPanel {...props} />); open(); await screen.findByText("Showing 25 of 27 contributions in this saved selection.");
    fireEvent.click(screen.getByRole("button", { name: "Synthetic contribution 1" }));
    const value = page(25);
    if (field === "workspace") value.workspaceId = id(99);
    if (field === "source") value.parent = { ...parent, sourceId: id(99) };
    if (field === "manifest") value.parent = { ...parent, segmentResultsManifestSha256: "f".repeat(64) };
    if (field === "sequence") value.parent = { ...parent, throughSequence: 5 };
    if (field === "actor") value.parent = { ...parent, parentActorId: id(99) };
    if (field === "offset") value.offset = 0;
    if (field === "total") { value.total = 28; value.entries.push({ ...entries[26], recordId: `item:${id(99)}` }); }
    if (field === "duplicate") value.entries[0] = entries[0];
    transport.mockResolvedValue(json(value)); fireEvent.click(screen.getByRole("button", { name: "Load more contributions" }));
    await screen.findByRole("alert"); expect(screen.queryByText("Scoped creation form")).toBeNull();
    expect(screen.queryByRole("button", { name: "Synthetic contribution 1" })).toBeNull();
  });
  it.each([401, 403])("clears source previews after access denial %s", async status => {
    render(<SynthesisContinuationPanel {...props} />); open(); await screen.findByRole("button", { name: "Synthetic contribution 1" });
    transport.mockResolvedValue(json({}, status)); fireEvent.click(screen.getByRole("button", { name: "Refresh contribution choices" }));
    await waitFor(() => expect(props.onAccessLost).toHaveBeenCalledOnce());
    expect(screen.queryByText("Synthetic original preview 1")).toBeNull(); expect(screen.queryByText("Reading saved contributions…")).toBeNull();
  });
  it.each(["account", "parent"])("does not render old private results or a late denial after a changed %s", async field => {
    let resolve!: (value: Response) => void;
    transport.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = render(<SynthesisContinuationPanel {...props} />); open(); const signal = transport.mock.calls[0][1]?.signal;
    view.rerender(<SynthesisContinuationPanel {...props} userId={field === "account" ? id(99) : props.userId}
      parent={field === "parent" ? { ...parent, throughSequence: 5 } : parent} />);
    expect(signal?.aborted).toBe(true); await act(async () => resolve(json({}, 403)));
    expect(props.onAccessLost).not.toHaveBeenCalled(); expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Choose a contribution to combine" })).toHaveAttribute("aria-expanded", "false");
  });
  it("closes private choices and aborts an outstanding read", async () => {
    let resolve!: (value: Response) => void;
    transport.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<SynthesisContinuationPanel {...props} />); open(); const signal = transport.mock.calls[0][1]?.signal;
    open(); expect(signal?.aborted).toBe(true); await act(async () => resolve(json(page())));
    expect(screen.queryByText("Synthetic original preview 1")).toBeNull(); expect(form).not.toHaveBeenCalled();
  });
});

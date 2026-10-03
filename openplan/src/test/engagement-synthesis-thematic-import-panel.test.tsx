import { randomUUID, webcrypto } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SynthesisThematicImportPanel } from "@/components/engagement/synthesis-thematic-import-panel";
import { readThematicImportCopy, listPreservedThematicImports, type ThematicImportWorkingCopy } from "@/lib/engagement/synthesis-thematic-import-recovery";
import { verifySynthesisSource } from "@/lib/engagement/synthesis-sources-server";
import { synthesisThematicHistoryFixture } from "./fixtures/engagement/synthesis-thematic-history";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => { localStorage.clear(); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function fixture() {
  const f = await synthesisThematicHistoryFixture(), history = await f.load();
  if (!history.proposal || history.manifest.throughSequence === null) throw new Error("SYNTHETIC proposal missing");
  const source = verifySynthesisSource(f.prepared.source, { requestId: f.prepared.source.requestId, campaignId: f.scope.campaignId, workspaceId: f.scope.workspaceId });
  const scope = { userId: randomUUID(), workspaceId: f.scope.workspaceId, campaignId: f.scope.campaignId,
    sourceId: source.requestId, sourceSha256: source.snapshotSha256, reviewId: randomUUID(), preparationSha256: "a".repeat(64) };
  const origin = { interpretation: "machine_unreviewed", proposalText: history.proposal.canonical, historyText: history.canonical,
    reference: { requestId: f.scope.requestId, selectionSequence: history.manifest.throughSequence, proposalSha256: history.proposal.sha256,
      historyManifestSha256: history.sha256, finalCaptureSha256: String(f.final.outputRow.capture_sha256) } };
  const preview = { campaignId: scope.campaignId, workspaceId: scope.workspaceId, sourceId: scope.sourceId, sourceSha256: scope.sourceSha256,
    requestId: f.scope.requestId, status: "proposal_complete", selectionSequence: history.manifest.throughSequence, cancelled: false, origin };
  const props = { scope, snapshot: source.snapshot, revision: { id: scope.reviewId, sha256: "b".repeat(64), number: 1,
    current: true, title: "SYNTHETIC existing staff draft", groupCount: 2 }, disabled: false,
    memory: { current: null as ThematicImportWorkingCopy | null }, onAccessLost: vi.fn(), onSaved: vi.fn(), onPendingChange: vi.fn() };
  const options = { preview: preview as unknown, readStatus: 200, loseReply: false, wrongReceipt: false };
  const posts: string[] = [];
  const transport = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const path = new URL(String(url), "http://localhost");
    if (init?.method === "POST") {
      const text = String(init.body), intent = JSON.parse(text); posts.push(text);
      if (options.loseReply) { options.loseReply = false; throw new Error("SYNTHETIC lost acknowledgement"); }
      return json({ requestId: options.wrongReceipt ? randomUUID() : intent.requestId, reviewId: scope.reviewId,
        campaignId: scope.campaignId, workspaceId: scope.workspaceId, sourceId: scope.sourceId, sourceSha256: scope.sourceSha256,
        preparationSha256: scope.preparationSha256, revisionNo: 2, revisionSha256: "c".repeat(64), createdAt: source.createdAt, replayed: posts.length > 1 });
    }
    if (options.readStatus !== 200) return json({}, options.readStatus);
    if (path.searchParams.get("mode") === "preview") return json(options.preview);
    return json({ schemaVersion: 1, campaignId: scope.campaignId, workspaceId: scope.workspaceId, sourceId: scope.sourceId,
      sourceSha256: scope.sourceSha256, pageSize: 25, entries: [{ requestId: f.scope.requestId, actorId: f.request.request.actorId,
        parentRequestId: f.request.thematic.parentRequestId, createdAt: source.createdAt, cancelled: false }], nextCursor: null });
  });
  vi.stubGlobal("fetch", transport);
  const inspect = async () => { fireEvent.click(await screen.findByRole("button", { name: `Inspect proposal ${f.scope.requestId.slice(0,8)}` })); await screen.findByRole("button", { name: "Select this proposal for the current draft" }); };
  const select = async () => { await inspect(); fireEvent.click(screen.getByRole("button", { name: "Select this proposal for the current draft" })); };
  const reason = () => fireEvent.change(screen.getByLabelText("Reason for importing this proposal"), { target: { value: "SYNTHETIC inspect this exact proposal" } });
  const submit = () => fireEvent.click(screen.getByRole("button", { name: "Replace draft with this machine proposal" }));
  return { f, source, origin, preview, props, options, posts, transport, inspect, select, reason, submit };
}

describe("explicit thematic import panel", () => {
  it("recovers a busy proposal preview without selecting or importing it", async () => {
    const x = await fixture(), originalTransport = x.transport.getMockImplementation()!;
    let attempts = 0;
    x.transport.mockImplementation(async (url, init) => {
      if (String(url).includes("mode=preview") && attempts++ === 0) return json({}, 503);
      return originalTransport(url, init);
    });
    render(<SynthesisThematicImportPanel {...x.props} />); await x.inspect();
    expect(attempts).toBe(2); expect(x.posts).toHaveLength(0);
    expect(readThematicImportCopy(localStorage, x.props.scope).draft).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("reopens an unselected inspection after remount only through a fresh authorized read", async () => {
    const x = await fixture(), view = render(<SynthesisThematicImportPanel {...x.props} />);
    await x.inspect();
    const privateTitle = JSON.parse(x.origin.proposalText).title;
    expect(readThematicImportCopy(localStorage, x.props.scope).draft).toBeNull();
    expect(x.props.memory.current).toBeNull();
    view.unmount();
    let finish: ((response: Response) => void) | undefined;
    const originalTransport = x.transport.getMockImplementation()!;
    x.transport.mockImplementation(async (url, init) => String(url).includes("mode=preview")
      ? new Promise<Response>(resolve => { finish = resolve; }) : originalTransport(url, init));
    render(<SynthesisThematicImportPanel {...x.props} />);
    await waitFor(() => expect(finish).toBeDefined());
    expect(screen.queryByText(privateTitle)).toBeNull();
    await act(async () => finish!(json({}, 403)));
    await waitFor(() => expect(x.props.onAccessLost).toHaveBeenCalled());
    expect(screen.queryByText(privateTitle)).toBeNull();
    expect(x.posts).toHaveLength(0);
  });
  it("requires inspection, a selected exact parent and a reason before importing", async () => {
    const x = await fixture(); render(<SynthesisThematicImportPanel {...x.props} />);
    await x.inspect(); expect(x.posts).toHaveLength(0);
    expect(screen.getByText(/Replacement preview: revision 1/)).toHaveTextContent("2 groups");
    fireEvent.click(screen.getByRole("button", { name: "Select this proposal for the current draft" }));
    expect(readThematicImportCopy(localStorage, x.props.scope).draft).toMatchObject({ parentId: x.props.revision.id,
      parentSha256: x.props.revision.sha256, parentNumber: 1, proposal: x.origin.reference });
    expect(screen.getByRole("button", { name: "Replace draft with this machine proposal" })).toBeDisabled();
    x.reason(); x.submit();
    await waitFor(() => expect(x.props.onSaved).toHaveBeenCalledTimes(1));
    const command = JSON.parse(x.posts[0]); expect(command).toMatchObject({ operation: "import_thematic", actorId: x.props.scope.userId,
      reviewId: x.props.scope.reviewId, expectedRevisionId: x.props.revision.id, expectedRevisionSha256: x.props.revision.sha256,
      proposal: x.origin.reference, reason: "SYNTHETIC inspect this exact proposal" });
    expect(readThematicImportCopy(localStorage, x.props.scope).pending).toBeNull();
    expect(x.transport.mock.calls.filter(([, init]) => init?.method === "POST").every(([url]) => String(url).endsWith("/synthesis/reviews"))).toBe(true);
  });
  it("recovers a lost reply after remount using the same command bytes", async () => {
    const x = await fixture(); x.options.loseReply = true;
    const first = render(<SynthesisThematicImportPanel {...x.props} />); await x.select(); x.reason(); x.submit();
    await screen.findByRole("button", { name: "Retry retained import" }); await waitFor(() => expect(x.posts).toHaveLength(1));
    first.unmount(); render(<SynthesisThematicImportPanel {...x.props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry retained import" }));
    await waitFor(() => expect(x.props.onSaved).toHaveBeenCalledTimes(1)); expect(x.posts[1]).toBe(x.posts[0]);
    expect(x.transport.mock.calls.some(([url]) => String(url).includes(`throughSequence=${x.origin.reference.selectionSequence}`))).toBe(true);
  });
  it("keeps a stale parent selection and requires preservation before choosing again", async () => {
    const x = await fixture(), view = render(<SynthesisThematicImportPanel {...x.props} />); await x.select(); x.reason();
    view.rerender(<SynthesisThematicImportPanel {...x.props} revision={{ ...x.props.revision, id: randomUUID(), number: 2 }} />);
    expect(screen.getByText(/That parent is no longer/)).toBeVisible(); expect(screen.getByRole("button", { name: "Replace draft with this machine proposal" })).toBeDisabled();
    expect(readThematicImportCopy(localStorage, x.props.scope).draft?.parentId).toBe(x.props.revision.id);
    fireEvent.click(screen.getByRole("button", { name: "Preserve import copy and choose again" }));
    expect(listPreservedThematicImports(localStorage, x.props.scope)[0].value?.draft?.reason).toBe("SYNTHETIC inspect this exact proposal");
    expect(x.posts).toHaveLength(0);
  });
  it("keeps the parent blocked throughout retained selection restoration", async () => {
    const x = await fixture(), view = render(<SynthesisThematicImportPanel {...x.props} />); await x.select(); x.reason();
    view.unmount(); x.props.onPendingChange.mockClear();
    render(<SynthesisThematicImportPanel {...x.props} />);
    await screen.findByLabelText("Reason for importing this proposal");
    expect(x.props.onPendingChange).toHaveBeenCalledWith(true);
    expect(x.props.onPendingChange).not.toHaveBeenCalledWith(false);
  });
  it("does not deliver a completed save to a panel that has unmounted", async () => {
    const x = await fixture(), originalTransport = x.transport.getMockImplementation()!;
    let finish: (() => void) | undefined;
    const held = new Promise<void>(resolve => { finish = resolve; });
    x.transport.mockImplementation(async (url, init) => {
      const response = await originalTransport(url, init);
      if (init?.method === "POST") await held;
      return response;
    });
    const view = render(<SynthesisThematicImportPanel {...x.props} />); await x.select(); x.reason(); x.submit();
    await waitFor(() => expect(x.posts).toHaveLength(1));
    expect(readThematicImportCopy(localStorage, x.props.scope).pending).not.toBeNull();
    view.unmount(); await act(async () => { finish!(); await held; });
    await waitFor(() => expect(readThematicImportCopy(localStorage, x.props.scope).pending).toBeNull());
    expect(x.props.onSaved).not.toHaveBeenCalled();
  });
  it("ignores access refusal from a read whose panel has unmounted", async () => {
    const x = await fixture();
    let finish: (() => void) | undefined;
    const held = new Promise<void>(resolve => { finish = resolve; });
    x.transport.mockImplementation(async () => { await held; return json({}, 403); });
    const view = render(<SynthesisThematicImportPanel {...x.props} />);
    await waitFor(() => expect(x.transport).toHaveBeenCalledTimes(1));
    view.unmount(); await act(async () => { finish!(); await held; });
    expect(x.props.onAccessLost).not.toHaveBeenCalled();
  });
  it("abandons a superseded preview on storage refresh and permits another inspection", async () => {
    const x = await fixture(), originalTransport = x.transport.getMockImplementation()!;
    let finish: (() => void) | undefined, finishRefresh: (() => void) | undefined, previews = 0;
    const held = new Promise<void>(resolve => { finish = resolve; });
    const refreshed = new Promise<void>(resolve => { finishRefresh = resolve; });
    x.transport.mockImplementation(async (url, init) => {
      if (String(url).includes("mode=preview")) {
        previews++;
        if (previews === 1) { await held; return json({}, 403); }
        if (previews === 2) await refreshed;
      }
      return originalTransport(url, init);
    });
    render(<SynthesisThematicImportPanel {...x.props} />);
    fireEvent.click(await screen.findByRole("button", { name: `Inspect proposal ${x.f.scope.requestId.slice(0,8)}` }));
    await act(async () => window.dispatchEvent(new StorageEvent("storage")));
    await waitFor(() => expect(previews).toBe(2));
    await act(async () => { finish!(); await held; });
    expect(x.props.onAccessLost).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: `Inspect proposal ${x.f.scope.requestId.slice(0,8)}` })).toBeDisabled();
    await act(async () => { finishRefresh!(); await refreshed; });
    await waitFor(() => expect(screen.getByRole("button", { name: `Inspect proposal ${x.f.scope.requestId.slice(0,8)}` })).toBeEnabled());
    await x.inspect();
    expect(previews).toBe(3);
  });
  it("does not offer import for incomplete outputs or retain a preview after a failed read", async () => {
    const x = await fixture(); x.options.preview = { ...x.preview, status: "incomplete", origin: null };
    render(<SynthesisThematicImportPanel {...x.props} />);
    fireEvent.click(await screen.findByRole("button", { name: `Inspect proposal ${x.f.scope.requestId.slice(0,8)}` }));
    await screen.findByText(/do not form a complete proposal/); expect(screen.queryByRole("button", { name: "Select this proposal for the current draft" })).toBeNull();
    x.options.preview = x.preview; await x.inspect();
    x.options.readStatus = 503; fireEvent.click(screen.getByRole("button", { name: `Inspect proposal ${x.f.scope.requestId.slice(0,8)}` }));
    await screen.findByRole("alert"); expect(screen.queryByRole("region", { name: "Original machine proposal evidence" })).toBeNull(); expect(x.posts).toHaveLength(0);
  });
  it("preserves quota-failed edits across remount and blocks writes until recovery", async () => {
    const x = await fixture(), view = render(<SynthesisThematicImportPanel {...x.props} />); await x.select();
    const quota = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SYNTHETIC quota failure"); });
    x.reason(); expect(x.props.memory.current?.draft?.reason).toBe("SYNTHETIC inspect this exact proposal");
    view.unmount(); render(<SynthesisThematicImportPanel {...x.props} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Replace draft with this machine proposal" })).toBeDisabled());
    quota.mockRestore(); fireEvent.click(screen.getByRole("button", { name: "Preserve import copy and choose again" }));
    expect(listPreservedThematicImports(localStorage, x.props.scope).some(copy => copy.value?.draft?.reason === "SYNTHETIC inspect this exact proposal")).toBe(true);
    expect(x.posts).toHaveLength(0);
  });
  it("removes private preview state when current access is refused", async () => {
    const x = await fixture(); render(<SynthesisThematicImportPanel {...x.props} />); await x.inspect();
    x.options.readStatus = 403; fireEvent.click(screen.getByRole("button", { name: "Refresh proposal history" }));
    await waitFor(() => expect(x.props.onAccessLost).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("region", { name: "Original machine proposal evidence" })).toBeNull(); expect(x.posts).toHaveLength(0);
  });
  it("keeps a foreign receipt unconfirmed and allows exact retry", async () => {
    const x = await fixture(); x.options.wrongReceipt = true; render(<SynthesisThematicImportPanel {...x.props} />);
    await x.select(); x.reason(); x.submit(); await screen.findByText(/import receipt differs/);
    expect(x.props.onSaved).not.toHaveBeenCalled(); expect(readThematicImportCopy(localStorage, x.props.scope).pending).not.toBeNull();
    x.options.wrongReceipt = false; fireEvent.click(screen.getByRole("button", { name: "Retry retained import" }));
    await waitFor(() => expect(x.props.onSaved).toHaveBeenCalledTimes(1)); expect(x.posts[1]).toBe(x.posts[0]);
  });
  it("shows complete original contribution text and downloads exact retained JSON", async () => {
    const x = await fixture(), blobs: NodeBlob[] = [], links: Array<{ href: string; download: string }> = [];
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("URL", class extends URL { static createObjectURL(blob: Blob | MediaSource) { blobs.push(blob as unknown as NodeBlob); return `blob:synthetic-${blobs.length}`; } static revokeObjectURL() {} });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function(this: HTMLAnchorElement) { links.push({ href: this.href, download: this.download }); });
    render(<SynthesisThematicImportPanel {...x.props} />); await x.inspect();
    const browse = screen.getByRole("region", { name: "Browse original contributions" });
    fireEvent.click(within(browse).getAllByRole("button", { name: /Inspect comment/ })[0]);
    const selected = screen.getByRole("region", { name: "Selected contribution evidence" });
    expect(selected.textContent).toContain(x.source.snapshot.items[0].body); expect(selected).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Download original proposal JSON" }));
    fireEvent.click(screen.getByRole("button", { name: "Download original history JSON" }));
    expect(await blobs[0].text()).toBe(x.origin.proposalText); expect(await blobs[1].text()).toBe(x.origin.historyText);
    expect(links.map(link => link.download)).toEqual([`thematic-proposal-${x.f.scope.requestId}.json`, `thematic-history-${x.f.scope.requestId}.json`]);
  });
  it("shows retained context notes and uncertainty beside each original contribution", async () => {
    const x = await fixture(); render(<SynthesisThematicImportPanel {...x.props} />); await x.inspect();
    const proposal = JSON.parse(x.origin.proposalText) as { contextEvidence: Array<{ sourceId: string; notes: Array<{ text: string }>; uncertainties: string[] }> };
    expect(proposal.contextEvidence.some(context => context.notes.length > 0)).toBe(true);
    expect(proposal.contextEvidence.some(context => context.uncertainties.length > 0)).toBe(true);
    const ids = [...x.source.snapshot.items.map(row => `item:${row.id}`), ...x.source.snapshot.answers.map(row => `answer:${row.id}`)];
    const buttons = within(screen.getByRole("region", { name: "Browse original contributions" })).getAllByRole("button", { name: /Inspect/ });
    for (const context of proposal.contextEvidence) {
      fireEvent.click(buttons[ids.indexOf(context.sourceId)]);
      const selected = screen.getByRole("region", { name: "Selected contribution evidence" });
      for (const note of context.notes) expect(selected.querySelector("ol")?.textContent).toContain(note.text);
      for (const uncertainty of context.uncertainties) expect(selected.querySelector("ul")?.textContent).toContain(uncertainty);
    }
  });
  it("leaves another tab's selected parent intact and adopts it on storage refresh", async () => {
    const x = await fixture(); render(<SynthesisThematicImportPanel {...x.props} />); await x.select();
    const activeKey = Object.keys(localStorage).find(key => key.startsWith("openplan:synthesis-thematic-import:"))!;
    const changed = readThematicImportCopy(localStorage, x.props.scope); changed.draft!.reason = "SYNTHETIC other tab";
    localStorage.setItem(activeKey, JSON.stringify(changed)); x.reason();
    expect(readThematicImportCopy(localStorage, x.props.scope).draft?.reason).toBe("SYNTHETIC other tab");
    expect(x.posts).toHaveLength(0);
    x.props.memory.current = null; await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: activeKey })));
    await waitFor(() => expect(screen.getByLabelText("Reason for importing this proposal")).toHaveValue("SYNTHETIC other tab"));
  });
});

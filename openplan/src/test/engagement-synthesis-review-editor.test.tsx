import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SynthesisReviewEditor } from "@/components/engagement/synthesis-review-editor";
import { EngagementSynthesisSources } from "@/components/engagement/engagement-synthesis-sources";
import { applySynthesisReviewChange, createSynthesisReviewContent, synthesisReviewIntentSchema } from "@/lib/engagement/synthesis-review";
import type { SynthesisReviewRecord } from "@/lib/engagement/synthesis-review-records";
import { listPreservedReviewCopies, readReviewWorkingCopy } from "@/lib/engagement/synthesis-review-recovery";
import { makeSourceSnapshot, savedSource, sourceActor, sourceDate, sourceHash, sourceScope } from "./fixtures/engagement/synthesis-source";
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) }));

const snapshot = makeSourceSnapshot(), source = savedSource(snapshot);
const scope = { userId: sourceActor, workspaceId: sourceScope.workspaceId, campaignId: sourceScope.campaignId, sourceId: sourceScope.requestId, sourceSha256: source.snapshotSha256 };
const reviewId = "e0000000-0000-4000-8000-000000000001";
const original = createSynthesisReviewContent(snapshot, scope.sourceSha256);
const onAccessLost = vi.fn();
const props = { ...scope, snapshot, onAccessLost };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let records: Map<string, SynthesisReviewRecord>, head: string;
let transport: ReturnType<typeof vi.fn<typeof fetch>>;

function seed() {
  const preparationText = JSON.stringify(original.preparation), contentText = JSON.stringify(original.content);
  const intent = { operation: "create" as const, requestId: reviewId, actorId: sourceActor, workspaceId: scope.workspaceId, sourceId: scope.sourceId, sourceSha256: scope.sourceSha256 };
  records.set(reviewId, { reviewId, campaignId: scope.campaignId, workspaceId: scope.workspaceId, sourceId: scope.sourceId, sourceSha256: scope.sourceSha256,
    preparationText, preparationSha256: sourceHash(preparationText), createdAt: sourceDate, createdBy: sourceActor, currentRevisionId: reviewId,
    revision: { requestId: reviewId, revisionNo: 1, parentId: null, parentSha256: null, actorId: sourceActor, reason: null, intent,
      contentText, contentSha256: sourceHash(contentText), createdAt: sourceDate } }); head = reviewId;
}
function receipt(record: SynthesisReviewRecord, replayed: boolean) {
  return { reviewId: record.reviewId, campaignId: scope.campaignId, workspaceId: scope.workspaceId, sourceId: scope.sourceId, sourceSha256: scope.sourceSha256,
    requestId: record.revision.requestId, revisionNo: record.revision.revisionNo, revisionSha256: record.revision.contentSha256, preparationSha256: record.preparationSha256,
    createdAt: sourceDate, replayed };
}
/** This transport supplies server-shaped synthetic records; native tests cover actual RPC custody separately. */
async function server(url: RequestInfo | URL, options?: RequestInit) {
  const path = new URL(String(url), "http://localhost");
  if (path.pathname.endsWith("/sources")) {
    const meta = { requestId: source.requestId, campaignId: scope.campaignId, workspaceId: scope.workspaceId, createdAt: sourceDate, snapshotSha256: source.snapshotSha256, counts: snapshot.counts, selection: snapshot.selection };
    return json(path.searchParams.has("requestId") ? { ...meta, snapshot } : { campaignId: scope.campaignId, workspaceId: scope.workspaceId, pageSize: 25, entries: [meta], nextCursor: null });
  }
  if (options?.method === "POST") {
    const intent = synthesisReviewIntentSchema.parse(JSON.parse(String(options.body)));
    const old = records.get(intent.requestId); if (old) return json(receipt(old, true));
    if (intent.operation === "create") {
      seed(); const first = records.get(reviewId)!;
      records.clear(); head = intent.requestId;
      const record = { ...first, reviewId: head, currentRevisionId: head, revision: { ...first.revision, requestId: head, intent } };
      records.set(head, record); return json(receipt(record, false), 201);
    }
    const parent = records.get(head)!;
    if (head !== intent.expectedRevisionId) return json({ kind: "conflict" }, 409);
    const contentText = JSON.stringify(applySynthesisReviewChange(JSON.parse(parent.revision.contentText), intent.change, snapshot, scope.sourceSha256));
    const record = { ...parent, currentRevisionId: intent.requestId, revision: { ...parent.revision, requestId: intent.requestId, revisionNo: parent.revision.revisionNo + 1,
      parentId: head, parentSha256: parent.revision.contentSha256, reason: intent.reason, intent, contentText, contentSha256: sourceHash(contentText) } };
    head = intent.requestId; records.set(head, record); return json(receipt(record, false), 201);
  }
  const mode = path.searchParams.get("mode");
  if (mode === "read") {
    const record = records.get(path.searchParams.get("revisionId") ?? head);
    return record ? json({ ...record, currentRevisionId: head }) : json({}, 404);
  }
  if (mode === "reviews") {
    const current = records.get(head);
    return json({ campaignId: scope.campaignId, workspaceId: scope.workspaceId, sourceId: scope.sourceId, pageSize: 25,
      entries: current ? [{ reviewId: current.reviewId, createdAt: sourceDate, title: JSON.parse(current.revision.contentText).title, revisionNo: current.revision.revisionNo, revisionSha256: current.revision.contentSha256 }] : [], nextCursor: null });
  }
  if (mode === "revisions") return json({ campaignId: scope.campaignId, workspaceId: scope.workspaceId, reviewId: records.get(head)!.reviewId, pageSize: 25,
    entries: [...records.values()].reverse().map(({ revision }) => ({ requestId: revision.requestId, revisionNo: revision.revisionNo, parentId: revision.parentId,
      parentSha256: revision.parentSha256, revisionSha256: revision.contentSha256, actorId: revision.actorId, reason: revision.reason, createdAt: sourceDate })), nextCursor: null });
  throw new Error("Unexpected synthetic review route");
}
beforeEach(() => { localStorage.clear(); records = new Map(); head = ""; onAccessLost.mockClear(); transport = vi.fn<typeof fetch>().mockImplementation(server); vi.stubGlobal("fetch", transport); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function openSeeded() {
  seed(); const view = render(<SynthesisReviewEditor {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: /Open staff review/ }));
  await screen.findByLabelText("Saved staff review"); return view;
}
async function waitRevision(number: number) { await screen.findByRole("heading", { name: new RegExp(`revision ${number}$`) }); }
describe("retained staff review editor", () => {
  it("creates a retained review from the real saved-source panel and keeps its complete membership", async () => {
    render(<EngagementSynthesisSources userId={scope.userId} workspaceId={scope.workspaceId} campaignId={scope.campaignId} categories={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open saved source/ }));
    const createButton = await screen.findByRole("button", { name: "Create staff review" });
    await waitFor(() => expect(createButton).toBeEnabled()); fireEvent.click(createButton);
    await waitRevision(1); expect(screen.getByText(/302 assigned contributions/)).toBeTruthy();
    const request = transport.mock.calls.find(([, options]) => options?.method === "POST");
    expect(String(request?.[0])).toMatch(/\/synthesis\/reviews$/);
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ operation: "create", actorId: scope.userId, workspaceId: scope.workspaceId, sourceId: scope.sourceId, sourceSha256: scope.sourceSha256 });
    expect(screen.getByText(/Review saved, revision 1/)).toBeTruthy();
  });
  it("restores complete unfinished notes after remount and preserves the original after correction", async () => {
    let view = await openSeeded(); const originalText = records.get(reviewId)!.revision.contentText;
    const notes = "SYNTHETIC full staff note é ".repeat(80) + "UNFINISHED NOTE TAIL";
    fireEvent.change(screen.getByLabelText("Staff review notes"), { target: { value: notes } });
    fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "SYNTHETIC corrected understanding" } });
    expect(readReviewWorkingCopy(localStorage, scope).draft?.notes).toBe(notes);
    view.unmount(); view = render(<SynthesisReviewEditor {...props} />);
    expect(await screen.findByDisplayValue(notes)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save reasoned correction" })); await waitRevision(2);
    expect(records.get(reviewId)!.revision.contentText).toBe(originalText);
    expect(JSON.parse(records.get(head)!.revision.contentText).notes).toBe(notes);
    fireEvent.click(await screen.findByRole("button", { name: "Open revision 1" })); await waitRevision(1);
    expect(screen.getByRole("button", { name: "Save reasoned correction" })).toBeDisabled();
    expect(screen.getByLabelText("Staff review notes")).toHaveValue("");
    expect(screen.getByLabelText("Staff review notes")).toBeDisabled();
    view.unmount();
  });
  it("edits actual contribution membership beyond the first page and restores an unassigned concern in a new group", async () => {
    await openSeeded();
    fireEvent.change(screen.getByLabelText("Correction type"), { target: { value: "group_update" } });
    fireEvent.change(screen.getByLabelText("Find contributions for this group"), { target: { value: "FINAL SOURCE TAIL" } });
    const member = screen.getByRole("checkbox"); expect(member).toBeChecked(); fireEvent.click(member);
    fireEvent.change(screen.getByLabelText("Group label"), { target: { value: "SYNTHETIC reviewed group" } });
    fireEvent.change(screen.getByLabelText("Staff group summary"), { target: { value: "SYNTHETIC reviewed summary" } });
    fireEvent.change(screen.getByLabelText("Staff sentiment assessment"), { target: { value: "mixed" } });
    fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "SYNTHETIC distinct concern" } });
    fireEvent.click(screen.getByRole("button", { name: "Save reasoned correction" })); await waitRevision(2);
    expect(screen.getByText(/301 assigned contributions; 1 unassigned/)).toBeTruthy();
    const changed = JSON.parse(records.get(head)!.revision.contentText);
    expect(changed.groups[0]).toMatchObject({ label: "SYNTHETIC reviewed group", summary: "SYNTHETIC reviewed summary", sentiment: "mixed" });
    expect(changed.unassignedSourceIds).toEqual([`item:${snapshot.items[300].id}`]);
    fireEvent.change(screen.getByLabelText("Correction type"), { target: { value: "group_add" } });
    fireEvent.change(screen.getByLabelText("Group label"), { target: { value: "SYNTHETIC separate issue" } });
    fireEvent.change(screen.getByLabelText("Find contributions for this group"), { target: { value: "FINAL SOURCE TAIL" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "SYNTHETIC preserve minority concern" } });
    fireEvent.click(screen.getByRole("button", { name: "Save reasoned correction" })); await waitRevision(3);
    expect(screen.getByText(/302 assigned contributions; 0 unassigned/)).toBeTruthy();
    expect(JSON.parse(records.get(head)!.revision.contentText).groups[1].sourceIds).toEqual([`item:${snapshot.items[300].id}`]);
    const newGroupId = JSON.parse(records.get(head)!.revision.contentText).groups[1].id;
    fireEvent.change(screen.getByLabelText("Correction type"), { target: { value: "group_remove" } });
    fireEvent.change(screen.getByLabelText("Review group"), { target: { value: newGroupId } });
    fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "SYNTHETIC explicitly unassigned for later review" } });
    fireEvent.click(screen.getByRole("button", { name: "Save reasoned correction" })); await waitRevision(4);
    expect(screen.getByText(/301 assigned contributions; 1 unassigned/)).toBeTruthy();
    expect(JSON.parse(records.get(reviewId)!.revision.contentText).assignedSourceCount).toBe(302);
  });
  it("retries the exact command after persistence succeeded but the response was interrupted", async () => {
    let interrupted = false;
    transport.mockImplementation(async (url, options) => { const result = await server(url, options); if (options?.method === "POST" && !interrupted) { interrupted = true; throw new Error("SYNTHETIC interrupted acknowledgement"); } return result; });
    const first = render(<SynthesisReviewEditor {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create staff review" }));
    await screen.findByText("SYNTHETIC interrupted acknowledgement"); const pending = readReviewWorkingCopy(localStorage, scope).pending;
    expect(screen.getByRole("button", { name: "Create staff review" })).toBeDisabled();
    first.unmount(); render(<EngagementSynthesisSources userId={scope.userId} workspaceId={scope.workspaceId} campaignId={scope.campaignId} categories={[]} />);
    expect(await screen.findByText("Unfinished staff review in this browser")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Open saved source/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry retained review request" })); await waitRevision(1);
    const posts = transport.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(posts).toHaveLength(2); expect(posts[0][1]?.body).toBe(posts[1][1]?.body);
    expect(JSON.parse(String(posts[1][1]?.body)).requestId).toBe(pending?.intent.requestId); expect(records.size).toBe(1);
  });
  it("keeps confirmation when reopening fails", async () => {
    let persisted = false;
    transport.mockImplementation(async (url, options) => { if (persisted && String(url).includes("mode=read")) return json({}, 503); const result = await server(url, options); if (options?.method === "POST") persisted = true; return result; });
    render(<SynthesisReviewEditor {...props} />); fireEvent.click(await screen.findByRole("button", { name: "Create staff review" }));
    expect(await screen.findByText("Review saved, revision 1.")).toBeTruthy();
    await screen.findByText(/Any earlier confirmed save remains retained/);
    expect(readReviewWorkingCopy(localStorage, scope).pending).toBeNull();
  });
  it("hides private content after read or write access is refused", async () => {
    await openSeeded();
    transport.mockResolvedValueOnce(json({}, 403)); fireEvent.click(screen.getByRole("button", { name: "Refresh staff reviews" }));
    expect(await screen.findByText(/Staff access changed/)).toBeTruthy(); expect(screen.queryByLabelText("Saved staff review")).toBeNull(); expect(onAccessLost).toHaveBeenCalled();
    cleanup(); records.clear(); head = ""; transport.mockImplementation(async (url, options) => options?.method === "POST" ? json({}, 401) : server(url, options));
    render(<SynthesisReviewEditor {...props} />); fireEvent.click(await screen.findByRole("button", { name: "Create staff review" }));
    await screen.findByText(/Staff access changed/); expect(readReviewWorkingCopy(localStorage, scope).pending).not.toBeNull();
  });
  it("keeps the newest text visible after storage fails and preserves it for restoration", async () => {
    await openSeeded();
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("SYNTHETIC quota failure"); }).mockImplementation(originalSet);
    fireEvent.change(screen.getByLabelText("Staff review notes"), { target: { value: "SYNTHETIC unsaved newest text" } });
    expect(screen.getByLabelText("Staff review notes")).toHaveValue("SYNTHETIC unsaved newest text");
    expect(screen.getByRole("button", { name: "Save reasoned correction" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Preserve edit and start another correction" }));
    const copies = listPreservedReviewCopies(localStorage, scope); expect(copies.some(row => row.value?.draft?.notes === "SYNTHETIC unsaved newest text")).toBe(true);
    const recovery = screen.getByLabelText("Preserved review recovery copies");
    fireEvent.click(within(recovery).getAllByRole("button", { name: "Restore preserved edit" }).at(-1)!);
    expect(await screen.findByDisplayValue("SYNTHETIC unsaved newest text")).toBeTruthy();
  });
  it("reopens the selected source after focus without losing the retained correction", async () => {
    seed(); render(<EngagementSynthesisSources userId={scope.userId} workspaceId={scope.workspaceId} campaignId={scope.campaignId} categories={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open saved source/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Open staff review/ }));
    fireEvent.change(await screen.findByLabelText("Staff review notes"), { target: { value: "SYNTHETIC focus recovery" } });
    act(() => window.dispatchEvent(new Event("focus")));
    expect(await screen.findByDisplayValue("SYNTHETIC focus recovery")).toBeTruthy();
  });
  it.each(["focus", "storage"])("keeps quota-failed text through %s revalidation until it can be preserved", async event => {
    seed(); render(<EngagementSynthesisSources userId={scope.userId} workspaceId={scope.workspaceId} campaignId={scope.campaignId} categories={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open saved source/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Open staff review/ }));
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("SYNTHETIC quota failure"); }).mockImplementation(originalSet);
    fireEvent.change(await screen.findByLabelText("Staff review notes"), { target: { value: "SYNTHETIC newest text after quota refusal" } });
    expect(screen.getByLabelText("Staff review notes")).toHaveValue("SYNTHETIC newest text after quota refusal");
    act(() => window.dispatchEvent(new Event(event)));
    expect(await screen.findByDisplayValue("SYNTHETIC newest text after quota refusal")).toBeTruthy();
    expect(screen.getByText("Staff review recovery in this browser needs attention")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open staff review/ }));
    expect(await screen.findByDisplayValue("SYNTHETIC newest text after quota refusal")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save reasoned correction" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Preserve edit and start another correction" }));
    expect(listPreservedReviewCopies(localStorage, scope).some(row => row.value?.draft?.notes === "SYNTHETIC newest text after quota refusal")).toBe(true);
  });
  it("does not restore a late private response after the source scope unmounts", async () => {
    seed(); let resolve: (response: Response) => void = () => undefined;
    transport.mockImplementation((url, options) => String(url).includes("mode=read") ? new Promise<Response>(done => { resolve = done; }) : server(url, options));
    const view = render(<SynthesisReviewEditor {...props} />); fireEvent.click(await screen.findByRole("button", { name: /Open staff review/ }));
    view.unmount(); await act(async () => resolve(json(records.get(reviewId))));
    expect(screen.queryByLabelText("Saved staff review")).toBeNull();
  });
  it("keeps the newer requested revision when an older read completes late", async () => {
    await openSeeded();
    fireEvent.change(screen.getByLabelText("Staff review notes"), { target: { value: "SYNTHETIC latest saved note" } });
    fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "SYNTHETIC new revision" } });
    fireEvent.click(screen.getByRole("button", { name: "Save reasoned correction" })); await waitRevision(2);
    let finish: (response: Response) => void = () => undefined;
    transport.mockImplementation((url, options) => String(url).includes(`revisionId=${reviewId}`) ? new Promise<Response>(resolve => { finish = resolve; }) : server(url, options));
    fireEvent.click(await screen.findByRole("button", { name: "Open revision 1" }));
    fireEvent.click(screen.getByRole("button", { name: /Open staff review/ })); await waitRevision(2);
    await act(async () => finish(json({ ...records.get(reviewId), currentRevisionId: head })));
    expect(screen.getByRole("heading", { name: /revision 2$/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /revision 1$/ })).toBeNull();
  });
  it("refuses foreign saved review and history identities before rendering them", async () => {
    for (const patch of [{ reviewId: sourceActor }, { campaignId: sourceActor }, { workspaceId: sourceActor }, { sourceId: sourceActor }, { sourceSha256: "f".repeat(64) }]) {
      cleanup(); seed(); transport.mockImplementation(async (url, options) => String(url).includes("mode=read") ? json({ ...records.get(reviewId), ...patch }) : server(url, options));
      render(<SynthesisReviewEditor {...props} />); fireEvent.click(await screen.findByRole("button", { name: /Open staff review/ }));
      await screen.findByText("Saved review identity differs from this source"); expect(screen.queryByLabelText("Saved staff review")).toBeNull();
    }
    for (const mode of ["reviews", "revisions"]) {
      cleanup(); seed(); transport.mockImplementation(async (url, options) => {
        const result = await server(url, options); return String(url).includes(`mode=${mode}`) ? json({ ...await result.json(), workspaceId: sourceActor }) : result;
      });
      render(<SynthesisReviewEditor {...props} />);
      if (mode === "revisions") fireEvent.click(await screen.findByRole("button", { name: /Open staff review/ }));
      await screen.findByText(mode === "reviews" ? "Review history belongs to another source" : "Revision history belongs to another review");
      expect(screen.queryByLabelText("Saved staff review")).toBeNull();
    }
  });
  it("requires a reason and a real change before freezing or sending a correction", async () => {
    await openSeeded();
    fireEvent.change(screen.getByLabelText("Staff review notes"), { target: { value: "SYNTHETIC changed note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save reasoned correction" }));
    expect(screen.getByText("Add a correction reason and complete the required fields.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Staff review notes"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "SYNTHETIC no content change" } });
    fireEvent.click(screen.getByRole("button", { name: "Save reasoned correction" }));
    expect(screen.getByText("Review correction changes nothing")).toBeTruthy();
    expect(readReviewWorkingCopy(localStorage, scope).pending).toBeNull();
    expect(transport.mock.calls.filter(([, options]) => options?.method === "POST")).toEqual([]);
  });
  it("loads both history tails and refuses a foreign revision continuation", async () => {
    seed(); const ids = Array.from({ length: 30 }, (_, index) => `e0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
    let foreignTail = false;
    transport.mockImplementation(async (url, options) => {
      const query = new URL(String(url), "http://localhost").searchParams;
      if (query.get("mode") === "reviews") {
        const selected = query.has("beforeId") ? [ids[25]] : ids.slice(0, 25);
        return json({ campaignId: scope.campaignId, workspaceId: scope.workspaceId, sourceId: scope.sourceId, pageSize: 25,
          entries: selected.map(id => ({ reviewId: id, createdAt: sourceDate, revisionNo: 1, revisionSha256: "a".repeat(64), title: "SYNTHETIC paged review" })),
          nextCursor: query.has("beforeId") ? null : { id: ids[24], createdAt: sourceDate } });
      }
      if (query.get("mode") === "revisions") {
        const numbers = query.has("before") ? [5, 4, 3, 2, 1] : Array.from({ length: 25 }, (_, index) => 30 - index);
        return json({ campaignId: scope.campaignId, workspaceId: foreignTail && query.has("before") ? sourceActor : scope.workspaceId, reviewId, pageSize: 25,
          entries: numbers.map(number => ({ requestId: ids[number - 1], revisionNo: number, parentId: number === 1 ? null : ids[number - 2], parentSha256: number === 1 ? null : "a".repeat(64),
            revisionSha256: "b".repeat(64), actorId: sourceActor, reason: number === 1 ? null : "SYNTHETIC correction", createdAt: sourceDate })), nextCursor: query.has("before") ? null : 6 });
      }
      return server(url, options);
    });
    render(<SynthesisReviewEditor {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Load older staff reviews" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /Open staff review/ })).toHaveLength(26));
    fireEvent.click(screen.getAllByRole("button", { name: /Open staff review/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Load older revisions" }));
    expect(await screen.findByRole("button", { name: "Open revision 1" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Open revision \d+$/ })).toHaveLength(30);
    fireEvent.click(screen.getAllByRole("button", { name: /Open staff review/ })[0]);
    foreignTail = true; fireEvent.click(await screen.findByRole("button", { name: "Load older revisions" }));
    await screen.findByText("Revision continuation belongs to another review"); expect(screen.queryByLabelText("Saved staff review")).toBeNull();
  });
});

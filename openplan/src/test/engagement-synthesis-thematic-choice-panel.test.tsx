import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SynthesisThematicContextChoice } from "@/components/engagement/synthesis-thematic-context-choice";
import { SynthesisThematicInputsPanel } from "@/components/engagement/synthesis-thematic-inputs-panel";
import { freezeThematicChoice, readPendingThematicChoice } from "@/lib/engagement/synthesis-thematic-choice-recovery";
import { thematicChoiceUiFixture, thematicUiId as id, thematicUiHash as hash } from "./fixtures/engagement/synthesis-thematic-choice-ui";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let f: ReturnType<typeof thematicChoiceUiFixture>, transport: ReturnType<typeof vi.fn<typeof fetch>>;
const onSaved = vi.fn(), onAccessLost = vi.fn(), onReadyChange = vi.fn();
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); f = thematicChoiceUiFixture();
  transport = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (init?.method === "POST") return json(f.choice(), 201);
    const u = new URL(String(url), "http://localhost"), mode = u.searchParams.get("mode");
    if (mode === "contexts") return json(f.contextPage);
    if (mode === "inspect") return json(f.preview);
    if (mode === "contributions") return json(f.contributionPage(Number(u.searchParams.get("offset"))));
    return json(f.progress);
  });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
const choiceProps = () => ({ ...f.scope, userId: f.scope.actorId, targetRecordId: f.entries[0].recordId, label: f.entries[0].label,
  thematicSha256: hash("thematic"), saved: null, onSaved, onAccessLost });
const inputsProps = () => ({ ...f.scope, userId: f.scope.actorId, onAccessLost, onReadyChange });
const posts = () => transport.mock.calls.filter(([, init]) => init?.method === "POST");
async function inspect() {
  fireEvent.click(screen.getByRole("button", { name: "Find eligible contexts" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Inspect context/ }));
  return screen.findByRole("button", { name: "Use this context" });
}

describe("thematic context selection", () => {
  it("reads the exact saved choice on demand without choosing a newer result or writing", async () => {
    render(<SynthesisThematicContextChoice {...choiceProps()} saved={f.choice()} />); expect(transport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Read saved context" })); await screen.findByText(f.noteText);
    const query = new URL(String(transport.mock.calls[0][0]), "http://localhost").searchParams;
    expect(Object.fromEntries(query)).toMatchObject({ mode: "inspect", contextRequestId: f.entry.requestId, throughSequence: "13" });
    expect(transport).toHaveBeenCalledTimes(1); expect(posts()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Use this context" })).toBeNull();
    expect(screen.getByRole("button", { name: "Download complete context" })).toBeTruthy();
  });
  it("refuses a self-hashed replacement while reading a saved choice", async () => {
    const saved = f.choice();
    const changed = JSON.stringify({ ...JSON.parse(f.preview.command.expected.choiceText), finalCaptureSha256: hash("another capture") });
    f.preview.command.expected.choiceText = changed; f.preview.choiceSha256 = hash(changed);
    render(<SynthesisThematicContextChoice {...choiceProps()} saved={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "Read saved context" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("differs from the saved choice");
    expect(screen.queryByText(f.noteText)).toBeNull(); expect(posts()).toHaveLength(0);
  });
  it("discovers and inspects on demand, retaining the exact choice before an explicit save", async () => {
    render(<SynthesisThematicContextChoice {...choiceProps()} />); expect(transport).not.toHaveBeenCalled();
    const use = await inspect(); expect(posts()).toHaveLength(0); expect(screen.getByText(f.noteText)).toBeTruthy();
    const query = new URL(String(transport.mock.calls[2][0]), "http://localhost").searchParams;
    expect(Object.fromEntries(query)).toMatchObject({ contextRequestId: f.entry.requestId, throughSequence: "13", targetRecordId: f.entries[0].recordId });
    transport.mockImplementationOnce(async (_url, init) => {
      const retained = readPendingThematicChoice(localStorage, f.recoveryScope)!;
      expect(init?.body).toBe(retained.commandText); expect(JSON.parse(retained.commandText)).toEqual(f.command());
      expect(init?.headers).toMatchObject({ "x-openplan-expected-user": f.scope.actorId, "x-openplan-expected-workspace": f.scope.workspaceId });
      return json(f.choice(), 201);
    });
    fireEvent.click(use); await waitFor(() => expect(onSaved).toHaveBeenCalledExactlyOnceWith(f.choice()));
    expect(readPendingThematicChoice(localStorage, f.recoveryScope)).toBeNull(); expect(posts()).toHaveLength(1);
  });
  it("restores lost-ack custody alongside a saved server choice and retries only after an explicit action", async () => {
    const view = render(<SynthesisThematicContextChoice {...choiceProps()} />); const use = await inspect();
    transport.mockRejectedValueOnce(Error("SYNTHETIC reply lost")); fireEvent.click(use); await screen.findByRole("alert");
    const original = posts()[0][1]?.body; expect(readPendingThematicChoice(localStorage, f.recoveryScope)?.commandText).toBe(original);
    view.unmount(); render(<SynthesisThematicContextChoice {...choiceProps()} saved={f.choice()} />);
    expect(screen.getByText("Saved context choice reference")).toBeTruthy(); expect(posts()).toHaveLength(1);
    transport.mockResolvedValueOnce(json({ ...f.choice(), replayed: true }));
    fireEvent.click(screen.getByRole("button", { name: "Retry saved context choice" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...f.choice(), replayed: true }));
    expect(posts().map(([, init]) => init?.body)).toEqual([original, original]);
    expect(readPendingThematicChoice(localStorage, f.recoveryScope)).toBeNull();
  });
  it.each(["incomplete", "manifest", "intent", "thematic", "selection"])("refuses a changed %s before offering a choice", async fault => {
    if (fault === "incomplete") { f.progress.status = "incomplete"; f.progress.counts = [{ disposition: "unselected", count: 1 }]; }
    if (fault === "manifest") f.progress.manifestSha256 = hash("other");
    if (fault === "intent") f.preview.command.expected.requestIntentSha256 = hash("other");
    if (fault === "thematic") f.preview.command.expected.thematicSha256 = hash("other");
    if (fault === "selection") f.progress.selectionSequence = 14;
    render(<SynthesisThematicContextChoice {...choiceProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Find eligible contexts" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Inspect context/ })); await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Use this context" })).toBeNull(); expect(posts()).toHaveLength(0);
    if (fault === "incomplete") { expect(screen.getByRole("alert")).toHaveTextContent("This context is not complete"); expect(transport).toHaveBeenCalledTimes(2); }
  });
  it("keeps older discovery available when the whole history page has no eligible request", async () => {
    const page = structuredClone(f.contextPage);
    page.history.entries = Array.from({ length: 25 }, (_, index) => ({ ...f.entry, requestId: id(80 - index) }));
    page.history.nextCursor = { id: id(56), createdAt: f.entry.createdAt }; page.eligibleRequestIds = [];
    transport.mockResolvedValueOnce(json(page)); render(<SynthesisThematicContextChoice {...choiceProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Find eligible contexts" }));
    fireEvent.click(await screen.findByRole("button", { name: "Check older context requests" }));
    await screen.findByRole("button", { name: /^Inspect context/ });
    const query = new URL(String(transport.mock.calls[1][0]), "http://localhost").searchParams;
    expect(query.get("beforeId")).toBe(id(56)); expect(query.get("beforeCreatedAt")).toBe(f.entry.createdAt);
    expect(posts()).toHaveLength(0);
  });
  it.each(["quota", "readback"])("refuses %s storage failure before transport", async fault => {
    render(<SynthesisThematicContextChoice {...choiceProps()} />); const use = await inspect();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { if (fault === "quota") throw Error("Synthetic full storage"); });
    fireEvent.click(use); await screen.findByRole("alert"); expect(posts()).toHaveLength(0); expect(onSaved).not.toHaveBeenCalled();
  });
  it("preserves unreadable raw bytes without issuing a save", async () => {
    freezeThematicChoice(localStorage, f.recoveryScope, f.command()); const key = localStorage.key(0)!;
    localStorage.setItem(key, "UNREADABLE synthetic original"); render(<SynthesisThematicContextChoice {...choiceProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Preserve context choice copy" }));
    await screen.findByText("Preserved context choice copies (1)"); expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(localStorage.key(0)!)).toBe("UNREADABLE synthetic original"); expect(transport).not.toHaveBeenCalled();
  });
  it.each(["account", "source", "intent", "author"])("aborts and discards late private discovery after changing %s", async field => {
    let resolve!: (response: Response) => void; transport.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = render(<SynthesisThematicContextChoice {...choiceProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Find eligible contexts" })); const signal = transport.mock.calls[0][1]?.signal;
    const changed = field === "account" ? { userId: id(99) } : field === "source" ? { sourceSha256: hash("other") } : field === "intent" ? { requestIntentSha256: hash("other") } : { actorId: id(99) };
    view.rerender(<SynthesisThematicContextChoice {...choiceProps()} {...changed} />); expect(signal?.aborted).toBe(true);
    await act(async () => resolve(json({}, 403))); expect(onAccessLost).not.toHaveBeenCalled(); expect(screen.queryByRole("alert")).toBeNull();
  });
  it("keeps a pending save after an account switch even if its receipt arrives", async () => {
    const view = render(<SynthesisThematicContextChoice {...choiceProps()} />); const use = await inspect();
    let resolve!: (response: Response) => void; transport.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.click(use); const pending = readPendingThematicChoice(localStorage, f.recoveryScope);
    view.rerender(<SynthesisThematicContextChoice {...choiceProps()} userId={id(99)} />);
    await act(async () => resolve(json(f.choice()))); expect(onSaved).not.toHaveBeenCalled();
    expect(readPendingThematicChoice(localStorage, f.recoveryScope)).toEqual(pending);
    expect(screen.queryByRole("button", { name: "Retry saved context choice" })).toBeNull();
  });
  it("clears an already inspected private preview when the account changes", async () => {
    const view = render(<SynthesisThematicContextChoice {...choiceProps()} />); await inspect();
    expect(screen.getByText(f.noteText)).toBeTruthy();
    view.rerender(<SynthesisThematicContextChoice {...choiceProps()} userId={id(99)} />);
    expect(screen.queryByText(f.noteText)).toBeNull();
    expect(screen.queryByRole("button", { name: "Use this context" })).toBeNull(); expect(posts()).toHaveLength(0);
  });
  it.each([401, 403])("clears previews on current denial %s and preserves uncertain writes", async status => {
    render(<SynthesisThematicContextChoice {...choiceProps()} />); const use = await inspect();
    transport.mockResolvedValueOnce(json({}, status)); fireEvent.click(use);
    await waitFor(() => expect(onAccessLost).toHaveBeenCalledOnce()); expect(screen.queryByText(f.noteText)).toBeNull();
    expect(readPendingThematicChoice(localStorage, f.recoveryScope)).not.toBeNull(); expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("whole-source theme inputs", () => {
  it("does not report readiness until every source contribution has a confirmed choice", async () => {
    const view = render(<SynthesisThematicInputsPanel {...inputsProps()} />); expect(transport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Choose context for themes" }));
    await screen.findByText(/25 selected among 25 loaded/); expect(onReadyChange).not.toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Load more contributions" }));
    await screen.findByText(/Every source contribution has a saved context choice/); expect(onReadyChange).toHaveBeenLastCalledWith(true);
    expect(posts()).toHaveLength(0); view.unmount(); expect(onReadyChange).toHaveBeenLastCalledWith(false);
  });
  it("keeps an unchosen contribution distinct from an empty source", async () => {
    transport.mockImplementation(async url => json(f.contributionPage(Number(new URL(String(url), "http://localhost").searchParams.get("offset")), false)));
    render(<SynthesisThematicInputsPanel {...inputsProps()} />); fireEvent.click(screen.getByRole("button", { name: "Choose context for themes" }));
    await screen.findByText(/0 selected among 25 loaded/); fireEvent.click(screen.getByRole("button", { name: "Load more contributions" }));
    await screen.findByText(/0 selected among 26 loaded/); expect(onReadyChange).not.toHaveBeenCalledWith(true);
  });
  it.each(["source", "total", "duplicate", "thematic", "choiceTarget"])("refuses changed %s between contribution pages", async field => {
    render(<SynthesisThematicInputsPanel {...inputsProps()} />); fireEvent.click(screen.getByRole("button", { name: "Choose context for themes" }));
    await screen.findByText(/25 selected among 25 loaded/); const page = f.contributionPage(25);
    if (field === "source") page.sourceSha256 = hash("other");
    if (field === "total") { page.page.total = 27; page.page.entries.push({ ...f.entries[25], recordId: `item:${id(199)}` }); page.choices.push(f.choice(`item:${id(199)}`)); }
    if (field === "duplicate") { page.page.entries[0] = f.entries[0]; page.choices[0] = f.choice(); }
    if (field === "thematic") page.thematicSha256 = hash("other");
    if (field === "choiceTarget") { page.choices[0]!.choiceText = f.command().expected.choiceText; page.choices[0]!.choiceSha256 = hash(page.choices[0]!.choiceText); }
    transport.mockResolvedValueOnce(json(page)); fireEvent.click(screen.getByRole("button", { name: "Load more contributions" }));
    await screen.findByRole("alert"); expect(onReadyChange).not.toHaveBeenCalledWith(true); expect(screen.queryByText("Synthetic original 1")).toBeNull();
  });
  it("clears the private list and readiness on current access loss", async () => {
    render(<SynthesisThematicInputsPanel {...inputsProps()} />); fireEvent.click(screen.getByRole("button", { name: "Choose context for themes" }));
    await screen.findByText(/25 selected among 25 loaded/); transport.mockResolvedValueOnce(json({}, 403));
    fireEvent.click(screen.getByRole("button", { name: "Refresh context choices" })); await waitFor(() => expect(onAccessLost).toHaveBeenCalledOnce());
    expect(screen.queryByText("Synthetic original 1")).toBeNull(); expect(onReadyChange).toHaveBeenLastCalledWith(false);
  });
  it("does not discover private choices for another request author", () => {
    render(<SynthesisThematicInputsPanel {...inputsProps()} actorId={id(99)} />);
    expect(screen.queryByRole("button", { name: "Choose context for themes" })).toBeNull(); expect(transport).not.toHaveBeenCalled();
    expect(onReadyChange).toHaveBeenLastCalledWith(false);
  });
});

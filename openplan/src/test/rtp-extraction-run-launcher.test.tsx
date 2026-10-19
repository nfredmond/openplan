import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExtractionRunLauncher,
  type ExtractionSourceDocument,
} from "@/app/(app)/rtp/[rtpCycleId]/extraction/_components/extraction-run-launcher";

// The real launcher runs against a mocked transport. This cannot establish API
// authorization, provider cost enforcement, quote verification, saved placement
// or browser accessibility and layout.
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const fetchMock = vi.fn<typeof fetch>();
const documents: ExtractionSourceDocument[] = [
  { id: "source-1", title: "SYNTHETIC prior plan", unreadableReason: null },
  { id: "scan-1", title: "SYNTHETIC unreadable scan", unreadableReason: "No indexed text is available." },
  { id: "source-2", title: "SYNTHETIC amendment", unreadableReason: null },
];
const scope = () => screen.getByRole("combobox", { name: "Reading scope" });
const source = () => screen.getByRole("combobox", { name: "Document to read" });
const readButton = () => screen.getByRole("button", { name: "Read this document" });

function launcher(canWrite = true, sources = documents) {
  return <ExtractionRunLauncher rtpCycleId="cycle-1" documents={sources} canWrite={canWrite} />;
}

function expectRequest(body: { kbDocumentId: string; targetKinds?: string[] }, index = 0) {
  const [url, init] = fetchMock.mock.calls[index];
  expect(url).toBe("/api/rtp-cycles/cycle-1/extraction-runs");
  expect(init?.method).toBe("POST");
  expect(init?.headers).toEqual({ "content-type": "application/json" });
  expect(JSON.parse(String(init?.body))).toEqual(body);
}

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(Response.json({ summary: { proposed: 2, discarded: 0 } }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("document reading scope", () => {
  it("keeps numeric reading as the default and omits targetKinds from its POST", async () => {
    render(launcher());
    expect(scope()).toHaveValue("numeric");
    fireEvent.click(readButton());
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledOnce();
    expectRequest({ kbDocumentId: "source-1" });
    expect(screen.getByText("2 proposals are waiting for review below. Nothing was dropped.")).toBeVisible();
  });

  it("posts only chapter_block for explicit policy and goal reading of the selected document", async () => {
    render(launcher());
    fireEvent.change(source(), { target: { value: "source-2" } });
    fireEvent.change(scope(), { target: { value: "chapter" } });
    expect(screen.getByText(/choose a chapter and stage a draft/)).toHaveTextContent(
      "Review the draft, then copy, edit and save it in the chapter editor."
    );
    fireEvent.click(readButton());
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledOnce();
    expectRequest({ kbDocumentId: "source-2", targetKinds: ["chapter_block"] });
    expect(screen.getByText(
      "2 proposals are waiting for review in Place copied chapter text. Nothing was dropped."
    )).toBeVisible();
  });

  it("returns to the original omitted-field request when the planner switches back to figures", async () => {
    render(launcher());
    fireEvent.change(scope(), { target: { value: "chapter" } });
    fireEvent.change(scope(), { target: { value: "numeric" } });
    fireEvent.click(readButton());
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expectRequest({ kbDocumentId: "source-1" });
  });

  it.each(["numeric", "chapter"])("disables both selectors and launch without write permission in %s scope", (value) => {
    const view = render(launcher());
    fireEvent.change(scope(), { target: { value } });
    view.rerender(launcher(false));
    expect(source()).toBeDisabled();
    expect(scope()).toBeDisabled();
    expect(readButton()).toBeDisabled();
    fireEvent.click(readButton());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists unreadable sources with their reason and excludes them from the picker", () => {
    render(launcher());
    expect(within(source()).getAllByRole("option")).toHaveLength(2);
    expect(within(source()).queryByRole("option", { name: "SYNTHETIC unreadable scan" })).toBeNull();
    fireEvent.click(screen.getByText("1 document in this library cannot be transcribed from"));
    expect(screen.getByText("No indexed text is available.", { exact: false })).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { label: "empty library", sources: [] },
    { label: "unreadable library", sources: [documents[1]] },
  ])("offers no launch for an $label", ({ sources }) => {
    render(launcher(true, sources));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Read this document" })).toBeNull();
    expect(screen.getByText(/No document in this workspace's library can be transcribed from yet/)).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a selected source that becomes unreadable while another remains available", () => {
    const view = render(launcher());
    fireEvent.change(scope(), { target: { value: "chapter" } });
    view.rerender(launcher(true, [
      { ...documents[0], unreadableReason: "Indexing is unavailable." },
      documents[2],
    ]));
    fireEvent.click(readButton());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("locks document, scope and repeated launch until the chapter request settles", async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
    render(launcher());
    fireEvent.change(scope(), { target: { value: "chapter" } });
    fireEvent.click(readButton());
    expect(source()).toBeDisabled();
    expect(scope()).toBeDisabled();
    expect(readButton()).toBeDisabled();
    fireEvent.click(readButton());
    expect(fetchMock).toHaveBeenCalledOnce();
    expectRequest({ kbDocumentId: "source-1", targetKinds: ["chapter_block"] });
    finish(Response.json({ summary: { proposed: 0, discarded: 0 } }));
    await waitFor(() => expect(readButton()).toBeEnabled());
    expect(source()).toBeEnabled();
    expect(scope()).toBeEnabled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each([
    ["numeric", "4 proposed; 1 dropped because its figures were not in the text it cited. 3 are waiting for review below."],
    ["chapter", "4 proposed; 1 dropped by source checks. 3 are waiting for review in Place copied chapter text."],
  ])("retains discard counts and duplicate warnings in %s scope", async (value, summary) => {
    fetchMock.mockResolvedValueOnce(Response.json({
      summary: { proposed: 3, discarded: 1 },
      warning: "This document was read before. Reading it again stages another set of proposals.",
    }));
    render(launcher());
    fireEvent.change(scope(), { target: { value } });
    fireEvent.click(readButton());
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.getByText(summary)).toBeVisible();
    expect(screen.getByText(/Reading it again stages another set of proposals/)).toBeVisible();
  });

  it.each([
    [503, "No provider key is configured."],
    [429, "Too many AI requests. Wait before reading again."],
  ] as const)("shows a returned %s error without retry or success and unlocks the controls", async (status, error) => {
    fetchMock.mockResolvedValueOnce(Response.json({ error }, { status }));
    render(launcher());
    fireEvent.change(scope(), { target: { value: "chapter" } });
    fireEvent.click(readButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(error);
    expect(screen.queryByText(/waiting for review in Place copied chapter text/)).toBeNull();
    expect(readButton()).toBeEnabled();
    expect(scope()).toBeEnabled();
    expect(source()).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears an earlier summary and warning when another read fails", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({
      summary: { proposed: 2, discarded: 0 }, warning: "SYNTHETIC duplicate warning",
    }));
    render(launcher());
    fireEvent.click(readButton());
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.getByText("SYNTHETIC duplicate warning")).toBeVisible();
    fetchMock.mockRejectedValueOnce(new Error("SYNTHETIC network failure"));
    fireEvent.change(scope(), { target: { value: "chapter" } });
    fireEvent.click(readButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("SYNTHETIC network failure");
    expect(screen.queryByText("SYNTHETIC duplicate warning")).toBeNull();
    expect(screen.queryByText(/proposals are waiting for review/)).toBeNull();
    expect(readButton()).toBeEnabled();
    expect(refresh).toHaveBeenCalledOnce();
  });
  it.each(["numeric", "chapter"])("discloses unread matching passages in %s scope without summing overlapping categories", async (value) => {
    fetchMock.mockResolvedValueOnce(Response.json({
      summary: { proposed: 2, discarded: 0, perTarget: [
        { targetKind: "chapter_block", passagesMatched: 30, passagesRead: 24 },
        { targetKind: "financial_line", passagesMatched: 26, passagesRead: 24 },
        { targetKind: "horizon_band", passagesMatched: 4, passagesRead: 4 },
      ] },
      warning: "SYNTHETIC duplicate warning",
    }));
    render(launcher());
    fireEvent.change(scope(), { target: { value } });
    fireEvent.click(readButton());
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.getByText("24 of 30 matching passages were read for policy and goal text. The remaining matching passages were not evaluated.")).toBeVisible();
    expect(screen.getByText("24 of 26 matching passages were read for financial line. The remaining matching passages were not evaluated.")).toBeVisible();
    expect(screen.getByText("SYNTHETIC duplicate warning")).toBeVisible();
    expect(screen.queryByText(/Nothing was dropped/)).toBeNull();
    expect(screen.getByText(/No proposals were dropped by source checks/)).toBeVisible();
  });

  it("keeps full passage coverage distinct from an unread remainder", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ summary: { proposed: 2, discarded: 0, perTarget: [
      { targetKind: "chapter_block", passagesMatched: 24, passagesRead: 24 },
    ] } }));
    render(launcher());
    fireEvent.change(scope(), { target: { value: "chapter" } });
    fireEvent.click(readButton());
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/Nothing was dropped/)).toBeVisible();
  });

  it("clears earlier passage coverage when the next read fails", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ summary: { proposed: 1, discarded: 0, perTarget: [
      { targetKind: "chapter_block", passagesMatched: 25, passagesRead: 24 },
    ] } }));
    render(launcher());
    fireEvent.click(readButton());
    expect(await screen.findByRole("status")).toHaveTextContent("24 of 25");
    fetchMock.mockRejectedValueOnce(new Error("SYNTHETIC later read failure"));
    fireEvent.click(readButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("SYNTHETIC later read failure");
    expect(screen.queryByRole("status")).toBeNull();
  });

});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualSourceIntake } from "@/app/(app)/rtp/[rtpCycleId]/extraction/_components/manual-source-intake";
import { RTP_EXTRACTION_TARGET_KINDS } from "@/lib/rtp/extraction/contract";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const fetchMock = vi.fn<typeof fetch>();
const document = "44444444-4444-4444-8444-444444444444";
const extraction = "55555555-5555-4555-8555-555555555555";
const quote = "Improve access to daily destinations.";
const page = { documentId: document, extractionId: extraction, checksum: "original-v1", contentSha256: "pages-v1", page: 112, pageCount: 140, source: "text_layer", text: quote };
const props = { rtpCycleId: "cycle", actorId: "actor", documents: [{ id: document, title: "SYNTHETIC prior plan" }], canWrite: true };
function show(canWrite = true) {
  const view = render(<ManualSourceIntake {...props} canWrite={canWrite} />);
  fireEvent.click(screen.getByText("Enter from source page"));
  return view;
}
async function openPage() {
  fireEvent.change(screen.getByLabelText("Source document"), { target: { value: document } });
  fireEvent.click(screen.getByRole("button", { name: "Load retained versions" }));
  await waitFor(() => expect(screen.getByLabelText("Retained text version").querySelectorAll("option")).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Retained text version"), { target: { value: extraction } });
  fireEvent.change(screen.getByLabelText("PDF page number"), { target: { value: "112" } });
  fireEvent.click(screen.getByRole("button", { name: "Open retained page" }));
  await screen.findByRole("region", { name: "Retained source page" });
}
beforeEach(() => {
  sessionStorage.clear(); vi.clearAllMocks();
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/ocr")) return Response.json({ extractions: [{ id: extraction, created_at: "2026-10-18T00:00:00Z", page_count: 140 }], workerConfigured: false, latestJob: null });
    if (init?.method === "POST") return Response.json({ candidateId: "candidate", deduped: false }, { status: 201 });
    return Response.json(page);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// Real component and transport bodies, mocked HTTP. Blind: layout, keyboard,
// actual server authorization/SQL, retained source fidelity and browser custody.
describe("manual source form (source tests, not executed in this lane)", () => {
  it("MANUAL_UI_SIX: offers all six existing record kinds without raw JSON entry", () => {
    show();
    const kinds = screen.getByLabelText("Source record") as HTMLSelectElement;
    expect(Array.from(kinds.options).map((option) => option.value)).toEqual([...RTP_EXTRACTION_TARGET_KINDS]);
    expect(screen.queryByLabelText(/json/i)).toBeNull();
  });
  it("MANUAL_UI_CHAPTER: posts selected version and page with verbatim quote as text", async () => {
    show(); await openPage();
    fireEvent.change(screen.getByLabelText("Source record"), { target: { value: "chapter_block" } });
    fireEvent.change(screen.getByLabelText("Verbatim chapter text and source quote"), { target: { value: quote } });
    fireEvent.click(screen.getByRole("button", { name: "Stage source proposal" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    const posts = fetchMock.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(posts).toHaveLength(1); expect(posts[0][0]).toBe("/api/rtp-cycles/cycle/extraction-candidates");
    expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({ kbDocumentId: document, documentExtractionId: extraction,
      sourcePage: 112, documentChecksum: page.checksum, contentSha256: page.contentSha256, targetKind: "chapter_block", quote, fields: { text: quote } });
  });
  it("MANUAL_UI_UNKNOWN: leaves unknown project cost blank and retains exact dollar digits", async () => {
    show(); await openPage();
    fireEvent.change(screen.getByLabelText("Source record"), { target: { value: "programmed_project" } });
    fireEvent.change(screen.getByLabelText(/Project name as printed/), { target: { value: "Project A" } });
    fireEvent.change(screen.getByLabelText(/Short source quote/), { target: { value: "Project A, cost unknown." } });
    fireEvent.click(screen.getByRole("button", { name: "Stage source proposal" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    const posts = fetchMock.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(JSON.parse(String(posts[0][1]?.body)).fields.estimatedCost).toBe("");
    fireEvent.change(screen.getByLabelText(/Project cost in whole dollars/), { target: { value: "99999999999999" } });
    expect(screen.getByLabelText(/Project cost in whole dollars/)).toHaveValue("99999999999999");
  });
  it("MANUAL_UI_RETRY: keeps the same payload on failure and restores draft after remount", async () => {
    const view = show(); await openPage();
    fireEvent.change(screen.getByLabelText("Source record"), { target: { value: "chapter_block" } });
    fireEvent.change(screen.getByLabelText("Verbatim chapter text and source quote"), { target: { value: quote } });
    fetchMock.mockResolvedValue(Response.json({ error: "Synthetic save unavailable" }, { status: 503 }));
    fireEvent.click(screen.getByRole("button", { name: "Stage source proposal" }));
    await screen.findByText("Synthetic save unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Stage source proposal" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(2));
    const posts = fetchMock.mock.calls.filter((call) => call[1]?.method === "POST");
    expect(posts[0][1]?.body).toBe(posts[1][1]?.body);
    view.unmount(); show();
    expect(screen.getByLabelText("Verbatim chapter text and source quote")).toHaveValue(quote);
    expect(screen.getByRole("button", { name: "Stage source proposal" })).toBeDisabled();
    expect(screen.getByText(/Draft restored in this tab/)).toBeVisible();
  });
  it("MANUAL_UI_VIEWER: disables intake for read-only roles", () => {
    show(false); expect(screen.getByLabelText("Source document")).toBeDisabled(); expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { createHash } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SynthesisContextOutputReader } from "@/components/engagement/synthesis-context-output-reader";

const hash = (s: string) => createHash("sha256").update(s).digest("hex"), partId = hash("source part");
const note = (id: number) => ({ id, text: `SYNTHETIC context note ${id}`, citations: [{ partId, quote: `SYNTHETIC source quotation ${id}` }], relatedNoteIds: [] });
const contextRequestId = "c7770000-0000-4000-8000-000000000001";
const props = (count = 1) => { const outputText = JSON.stringify({ status: "complete", coveredPartIds: Array(100).fill(partId),
  notes: Array.from({ length: count }, (_, i) => note(i)), uncertainties: Array.from({ length: count }, (_, i) => `SYNTHETIC uncertainty ${i}`) }, null, 2);
  return { outputText, contextRequestId, outputSha256: hash(outputText) }; };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("original context reading", () => {
  it("shows generated wording and uncertainties beyond the raw excerpt, with inspectable quotations", () => {
    const f = props(); expect(f.outputText.slice(0, 1600)).not.toContain("SYNTHETIC context note 0");
    render(<SynthesisContextOutputReader {...f} />);
    expect(screen.getByText("SYNTHETIC context note 0")).toBeVisible(); expect(screen.getByText("SYNTHETIC uncertainty 0")).toBeVisible();
    const quote = screen.getByText("SYNTHETIC source quotation 0"); expect(quote.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Source quotations for note 0")); expect(quote.closest("details")).toHaveAttribute("open");
    expect(screen.getByText(/Choosing it for theme preparation does not approve its meaning/)).toBeTruthy();
  });
  it("keeps absent notes and uncertainties explicit without implying no issues", () => {
    render(<SynthesisContextOutputReader {...props(0)} />);
    expect(screen.getByText(/does not establish that the contribution raises no issues/)).toBeTruthy();
    expect(screen.getByText(/Staff still need to check the original contribution/)).toBeTruthy();
  });
  it("pages notes and uncertainties independently without omitting their totals", () => {
    const view = render(<SynthesisContextOutputReader {...props(21)} />);
    expect(screen.getByText("Showing 20 of 21 generated notes.")).toBeTruthy(); expect(screen.queryByText("SYNTHETIC context note 20")).toBeNull();
    expect(screen.getByText("Showing 20 of 21 reported uncertainties.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show more context notes" })); expect(screen.getByText("SYNTHETIC context note 20")).toBeTruthy();
    expect(screen.queryByText("SYNTHETIC uncertainty 20")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show more uncertainties" })); expect(screen.getByText("SYNTHETIC uncertainty 20")).toBeTruthy();
    view.rerender(<SynthesisContextOutputReader {...props(22)} />);
    expect(screen.queryByText("SYNTHETIC context note 20")).toBeNull(); expect(screen.queryByText("SYNTHETIC uncertainty 20")).toBeNull();
  });
  it("downloads the exact original JSON without transport or regenerated formatting", async () => {
    const f = props(); let retained!: Blob;
    const create = vi.fn((blob: Blob) => { retained = blob; return "blob:synthetic-context"; });
    vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = vi.fn(); });
    let download: { name: string; href: string } | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { download = { name: this.download, href: this.href }; });
    const transport = vi.fn(); vi.stubGlobal("fetch", transport); render(<SynthesisContextOutputReader {...f} />);
    expect(create).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Download complete context" }));
    const text = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(retained); });
    expect(text).toBe(f.outputText); expect(download).toEqual({ name: `openplan-context-${contextRequestId}.json`, href: "blob:synthetic-context" });
    expect(transport).not.toHaveBeenCalled();
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-context"), { timeout: 2000 });
  });
});

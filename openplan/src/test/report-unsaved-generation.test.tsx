import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportDetailControls } from "@/components/reports/report-detail-controls";
import type { ComponentProps } from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// Render the real button, but retain its actual handler for tests of the
// handler's own refusal. React suppresses disabled clicks even after DOM edits.
let invokeGenerate: (() => Promise<void>) | undefined;
vi.mock("@/components/ui/button", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/button")>();
  return { ...actual, Button: (props: ComponentProps<typeof actual.Button>) => {
    if (props.type === "button" && props.variant === "secondary" && props.onClick) {
      invokeGenerate = async () => { await Reflect.apply(props.onClick!, undefined, []); };
    }
    return <actual.Button {...props} />;
  } };
});

const report = { id: "report-1", title: "Safety packet", summary: "Saved summary", status: "draft", hasGeneratedArtifact: false };
const ingest = { id: "55555555-5555-4555-8555-555555555555", sourceLabel: "Observed crash source", createdAt: "2026-09-01T00:00:00Z", crashCount: 30, geocodedCount: 28 };
const fetchMock = vi.fn<typeof fetch>();
const ok = () => new Response(JSON.stringify({ success: true }), { status: 200 });
const save = () => screen.getByRole("button", { name: "Save metadata" });
const generate = () => screen.getByRole("button", { name: /Generate (PDF|HTML) packet/ });

beforeEach(() => { invokeGenerate = undefined; fetchMock.mockReset().mockImplementation(async () => ok()); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Report draft custody", () => {
  it.each([
    ["Title", "New title"], ["Summary", "New summary"], ["Status", "archived"],
  ])("requires saving a changed %s on its own", async (label, value) => {
    render(<ReportDetailControls report={report} />);
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(generate()).toBeDisabled();
    expect(invokeGenerate).toBeDefined();
    await act(async () => { await invokeGenerate!(); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires saving a model citation on its own", async () => {
    const modelId = "22222222-2222-4222-8222-222222222222";
    render(<ReportDetailControls report={report} modelRunOptions={[{ id: modelId, title: "Selected model", engineKey: "dual_demand", status: "succeeded" }]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Selected model/ }));
    expect(generate()).toBeDisabled();
    fireEvent.click(save());
    await waitFor(() => expect(generate()).toBeEnabled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).modelRunIds).toEqual([modelId]);
  });

  it("refuses an invalid stored title even when no draft change exists", async () => {
    render(<ReportDetailControls report={{ ...report, title: "t".repeat(161) }} />);
    expect(generate()).toBeDisabled();
    await act(async () => { await invokeGenerate!(); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses generation during an unchanged save even when its handler is called directly", async () => {
    let finishSave!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishSave = resolve; }));
    render(<ReportDetailControls report={report} />);
    fireEvent.click(save());
    expect(generate()).toBeDisabled();
    fireEvent.submit(screen.getByLabelText("Summary").closest("form")!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await invokeGenerate!(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { finishSave(ok()); });
    expect(generate()).toBeEnabled();
  });

  it("preserves an overlong summary and explains its limit without sending an invalid save", () => {
    render(<ReportDetailControls report={report} />);
    const text = "x".repeat(2001);
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: text } });
    expect(screen.getByText(/Summary must be 2,000 characters or fewer/)).toBeInTheDocument();
    expect(screen.getByLabelText("Summary")).toHaveValue(text);
    expect(screen.getByLabelText("Summary")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Summary")).not.toHaveAttribute("maxlength");
    fireEvent.click(save());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(generate()).toBeDisabled();
  });

  it.each([" ", "t".repeat(161)])("retains an invalid title and refuses its request", (title) => {
    render(<ReportDetailControls report={report} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: title } });
    fireEvent.click(save());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Title")).toHaveValue(title);
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
    expect(generate()).toBeDisabled();
  });

  it("accepts the exact trimmed limits and enables generation only after saving", async () => {
    render(<ReportDetailControls report={report} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: ` ${"t".repeat(160)} ` } });
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: ` ${"s".repeat(2000)} ` } });
    expect(generate()).toBeDisabled();
    fireEvent.click(save());
    await waitFor(() => expect(generate()).toBeEnabled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ title: "t".repeat(160), summary: "s".repeat(2000) });
    fireEvent.click(generate());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/reports/report-1/generate");
  });

  it("treats a carried but unsaved Safety selection as pending evidence", async () => {
    render(<ReportDetailControls report={report} safetyIngestOptions={[ingest]} initialSafetyIngestId={ingest.id} />);
    expect(generate()).toBeDisabled();
    expect(screen.getByText(/Save metadata before generating/)).toBeInTheDocument();
    fireEvent.click(save());
    await waitFor(() => expect(generate()).toBeEnabled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).safetyIngestSelections).toEqual([{ ingestId: ingest.id }]);
  });

  it("does not generate while saving, or bless edits made while that save is in flight", async () => {
    let finishSave!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishSave = resolve; }));
    render(<ReportDetailControls report={report} />);
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "Submitted draft" } });
    fireEvent.click(save());
    expect(generate()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "Later unsaved draft" } });
    await act(async () => { finishSave(ok()); });
    expect(screen.getByLabelText("Summary")).toHaveValue("Later unsaved draft");
    expect(generate()).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(save());
    await waitFor(() => expect(generate()).toBeEnabled());
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).summary).toBe("Later unsaved draft");
  });

  it("keeps the draft and generation refusal after a rejected save, then recovers on success", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Save refused" }), { status: 409 }));
    render(<ReportDetailControls report={report} />);
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "Unsaved narrative" } });
    fireEvent.click(save());
    await screen.findByText("Save refused");
    expect(screen.getByLabelText("Summary")).toHaveValue("Unsaved narrative");
    expect(generate()).toBeDisabled();
    fireEvent.click(generate());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(save());
    await waitFor(() => expect(generate()).toBeEnabled());
  });

  it("uses the last successful selection when saving again before server props refresh", async () => {
    render(<ReportDetailControls report={report} safetyIngestOptions={[ingest]} safetyIngestSelections={[{ ingestId: ingest.id }]} />);
    fireEvent.change(screen.getByLabelText("Crash evidence"), { target: { value: "" } });
    expect(generate()).toBeDisabled();
    fireEvent.click(save());
    await waitFor(() => expect(generate()).toBeEnabled());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).safetyIngestSelections).toEqual([]);
    fireEvent.change(screen.getByLabelText("Crash evidence"), { target: { value: ingest.id } });
    expect(generate()).toBeDisabled();
    fireEvent.click(save());
    await waitFor(() => expect(generate()).toBeEnabled());
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).safetyIngestSelections).toEqual([{ ingestId: ingest.id }]);
  });

  it("does not treat output format or trimmed whitespace as unsaved report content", () => {
    render(<ReportDetailControls report={report} />);
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: " Saved summary " } });
    fireEvent.change(screen.getByLabelText("Packet format"), { target: { value: "html" } });
    expect(generate()).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("locks edits during generation and preserves the resulting generated status on later saves", async () => {
    let finishGeneration!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishGeneration = resolve; }));
    render(<ReportDetailControls report={report} />);
    fireEvent.click(generate());
    expect(screen.getByLabelText("Summary")).toBeDisabled();
    expect(save()).toBeDisabled();
    fireEvent.submit(screen.getByLabelText("Summary").closest("form")!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await invokeGenerate!(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { finishGeneration(ok()); });
    expect(screen.getByLabelText("Status")).toHaveValue("generated");
    expect(generate()).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "Revision after generation" } });
    expect(generate()).toBeDisabled();
    fireEvent.click(save());
    await waitFor(() => expect(generate()).toBeEnabled());
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).status).toBe("generated");
  });
});

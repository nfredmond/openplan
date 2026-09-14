import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngagementShareControls } from "@/components/engagement/engagement-share-controls";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const fetchMock = vi.fn();
const initial = { id: "c1", title: "SYNTHETIC listening", status: "active", share_token: "abcdef0123456789abcdef01",
  public_description: "SYNTHETIC saved description", public_slug: null as string | null, allow_public_submissions: false,
  submissions_closed_at: null, demographics_enabled: false };
const description = () => screen.getByLabelText(/Public-facing description/);
const submissions = () => screen.getByLabelText("Accept public submissions through the portal");
const demographics = () => screen.getByLabelText(/Ask respondents optional demographics/);
const slug = () => screen.getByLabelText(/Easy link name/);
const save = () => screen.getByRole("button", { name: "Save share settings" });
const body = (index = 0) => JSON.parse(fetchMock.mock.calls[index][1].body);
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) }); });
afterEach(() => vi.unstubAllGlobals());

describe("share settings follow saved values without losing drafts", () => {
  it("reflects publishing changes in untouched controls and live status", () => {
    const view = render(<EngagementShareControls campaign={initial} />);
    expect(screen.getByText("Portal status: Live · view only")).toBeVisible();
    view.rerender(<EngagementShareControls campaign={{ ...initial, public_description: "SYNTHETIC published", allow_public_submissions: true, demographics_enabled: true, public_slug: "synthetic-published" }} />);
    expect(description()).toHaveValue("SYNTHETIC published"); expect(submissions()).toBeChecked(); expect(demographics()).toBeChecked(); expect(slug()).toHaveValue("synthetic-published");
    expect(screen.getByText("Portal status: Live · accepting submissions")).toBeVisible(); expect(save()).toBeDisabled();
  });
  it("keeps unsaved submission changes separate from live status and sends only that edit", async () => {
    render(<EngagementShareControls campaign={{ ...initial, allow_public_submissions: true }} />);
    fireEvent.click(submissions()); expect(submissions()).not.toBeChecked();
    expect(screen.getByText("Portal status: Live · accepting submissions")).toBeVisible();
    fireEvent.click(save()); await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce()); expect(body()).toEqual({ allowPublicSubmissions: false });
  });
  it("preserves a slug draft while refreshed untouched settings follow the server", async () => {
    const view = render(<EngagementShareControls campaign={initial} />);
    fireEvent.change(slug(), { target: { value: "synthetic-draft" } });
    view.rerender(<EngagementShareControls campaign={{ ...initial, public_description: "SYNTHETIC changed elsewhere", allow_public_submissions: true }} />);
    expect(slug()).toHaveValue("synthetic-draft"); expect(description()).toHaveValue("SYNTHETIC changed elsewhere"); expect(submissions()).toBeChecked();
    fireEvent.click(save()); await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce()); expect(body()).toEqual({ publicSlug: "synthetic-draft" });
  });
  it("keeps explicit empty descriptions and slugs as deliberate clears", async () => {
    render(<EngagementShareControls campaign={{ ...initial, public_slug: "synthetic-old" }} />);
    fireEvent.change(description(), { target: { value: "  " } }); fireEvent.change(slug(), { target: { value: "" } });
    fireEvent.click(save()); await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce()); expect(body()).toEqual({ publicDescription: null, publicSlug: null });
  });
  it("sends a changed demographics setting without replaying the other fields", async () => {
    render(<EngagementShareControls campaign={{ ...initial, demographics_enabled: true }} />);
    fireEvent.click(demographics()); fireEvent.click(save()); await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce()); expect(body()).toEqual({ demographicsEnabled: false });
  });
  it("releases a confirmed draft so a later saved change can appear", () => {
    const view = render(<EngagementShareControls campaign={initial} />);
    fireEvent.change(description(), { target: { value: "  SYNTHETIC edit  " } });
    view.rerender(<EngagementShareControls campaign={{ ...initial, public_description: "SYNTHETIC edit" }} />);
    expect(description()).toHaveValue("SYNTHETIC edit"); expect(save()).toBeDisabled();
    view.rerender(<EngagementShareControls campaign={{ ...initial, public_description: "SYNTHETIC later saved change" }} />);
    expect(description()).toHaveValue("SYNTHETIC later saved change"); expect(save()).toBeDisabled();
  });
  it("never carries an old draft into a different campaign or back again", () => {
    const view = render(<EngagementShareControls campaign={initial} />); fireEvent.change(description(), { target: { value: "SYNTHETIC draft for c1" } });
    view.rerender(<EngagementShareControls campaign={{ ...initial, id: "c2", public_description: "SYNTHETIC c2" }} />);
    expect(description()).toHaveValue("SYNTHETIC c2"); expect(save()).toBeDisabled();
    view.rerender(<EngagementShareControls campaign={initial} />); expect(description()).toHaveValue(initial.public_description); expect(save()).toBeDisabled();
  });
  it("preserves a newer edit while an earlier save is confirmed", async () => {
    const view = render(<EngagementShareControls campaign={initial} />);
    fireEvent.change(description(), { target: { value: "SYNTHETIC first edit" } }); fireEvent.click(save()); await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    fireEvent.change(description(), { target: { value: "SYNTHETIC second edit" } });
    view.rerender(<EngagementShareControls campaign={{ ...initial, public_description: "SYNTHETIC first edit" }} />);
    expect(description()).toHaveValue("SYNTHETIC second edit"); expect(save()).toBeEnabled(); expect(body()).toEqual({ publicDescription: "SYNTHETIC first edit" });
  });
  it("makes an untouched or reverted save a no-op", () => {
    render(<EngagementShareControls campaign={initial} />); expect(save()).toBeDisabled(); fireEvent.click(save());
    fireEvent.change(description(), { target: { value: "SYNTHETIC edit" } }); fireEvent.change(description(), { target: { value: initial.public_description } });
    expect(save()).toBeDisabled(); fireEvent.click(save()); expect(fetchMock).not.toHaveBeenCalled();
  });
});

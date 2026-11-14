import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AwardNoticePicker } from "@/components/grants/award-notice-picker";

const workspaceId = "22222222-2222-4222-8222-222222222222";
const notice = { id: "11111111-1111-4111-8111-111111111111", workspace_id: workspaceId, source_kind: "uploaded_pdf", content_type: "application/pdf", status: "stored", title: "Synthetic notice", original_filename: "synthetic-notice.pdf" };
afterEach(() => vi.unstubAllGlobals());

describe("award notice selection", () => {
  it("searches the existing workspace list and selects by title instead of requiring an ID", async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ documents: [notice], limit: 200 }) }));
    vi.stubGlobal("fetch", fetchMock); const change = vi.fn();
    render(<AwardNoticePicker workspaceId={workspaceId} value="" onChange={change} />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Find notice by title or filename"), { target: { value: "synthetic notice" } });
    fireEvent.click(screen.getByRole("button", { name: "Find an uploaded notice" }));
    await screen.findByRole("option", { name: "Synthetic notice (synthetic-notice.pdf)" });
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost");
    expect(requested.pathname).toBe("/api/knowledge-base/documents");
    expect(requested.searchParams.get("workspaceId")).toBe(workspaceId);
    expect(requested.searchParams.get("q")).toBe("synthetic notice");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: notice.id } });
    expect(change).toHaveBeenCalledWith(notice.id);
    expect(screen.queryByLabelText("Notice id")).not.toBeInTheDocument();
  });

  it("does not offer another workspace, management export, failed extraction or non-PDF", async () => {
    const rows = [notice,
      { ...notice, id: "other-workspace", title: "Other workspace", workspace_id: "other" },
      { ...notice, id: "export", title: "Management export", source_kind: "application_pdf" },
      { ...notice, id: "failed", title: "Failed original", status: "failed" },
      { ...notice, id: "text", title: "Text original", content_type: "text/plain" }];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ documents: rows, limit: 200 }) })));
    render(<AwardNoticePicker workspaceId={workspaceId} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Find an uploaded notice" }));
    await screen.findByRole("option", { name: "Synthetic notice (synthetic-notice.pdf)" });
    expect(screen.getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual(["", notice.id]);
  });

  it("discloses the server list limit instead of claiming all notices were searched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ documents: [notice], limit: 1 }) })));
    render(<AwardNoticePicker workspaceId={workspaceId} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Find an uploaded notice" }));
    await screen.findByText(/reached its 1-file limit/);
    expect(screen.getByRole("status")).toHaveTextContent("Search by filename to find an older notice.");
  });

  it("keeps the retained selection on a read failure and reports the list unavailable", async () => {
    const change = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "unavailable", documents: [notice], limit: 200 }) })));
    render(<AwardNoticePicker workspaceId={workspaceId} value={notice.id} onChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "Find an uploaded notice" }));
    await screen.findByText("Notice list unavailable. Try again.");
    expect(screen.getByRole("combobox")).toHaveValue(notice.id);
    expect(change).not.toHaveBeenCalled();
  });
});

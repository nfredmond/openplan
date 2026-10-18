/** DOM fixtures do not establish real navigation, responsive layout, artifact usability or a browser console. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafetyPlanSeedPanel } from "@/components/grants/safety-plan-seed-panel";
import { SAFETY_SEED_CAVEAT } from "@/lib/grants/safety-seed-origin";
import { buildSafetySeedPreview } from "@/lib/grants/ss4a-safety-seed";
import { safetySeedFixture } from "./fixtures/grants/safety-seed";

const rows = safetySeedFixture(); const preview = buildSafetySeedPreview(rows);
const artifacts = [{ id: rows.artifact.id, reportTitle: "Example Safety report", artifactKind: "html", generatedAt: rows.artifact.generated_at }];
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });

describe("explicit Safety artifact preview and apply UI", () => {
  it("requires selection and review, sends only the bound preview, and refreshes after apply", async () => {
    fetchMock.mockResolvedValueOnce(response({ preview })).mockResolvedValueOnce(response({ applied: true }));
    const onApplied = vi.fn().mockResolvedValue(undefined);
    render(<SafetyPlanSeedPanel opportunityId={rows.opportunity.id} artifacts={artifacts} onApplied={onApplied} />);
    expect(screen.getByText(SAFETY_SEED_CAVEAT)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview Safety seed" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: rows.artifact.id } });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preview Safety seed" }));
    await screen.findByRole("button", { name: "Apply six working drafts" });
    expect(screen.getAllByRole("group")).toHaveLength(6);
    expect(onApplied).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply six working drafts" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toContain(`/funding-opportunities/${rows.opportunity.id}/application/safety-seed`);
    expect(JSON.parse(init.body)).toEqual({ operation: "apply", artifactId: rows.artifact.id, previewHash: preview.previewHash });
    expect(screen.getByRole("status")).toHaveTextContent("Final text, prior drafts and attachments are retained");
  });
  it("clears stale previews but keeps the exact request available after a lost response", async () => {
    const onApplied = vi.fn();
    fetchMock.mockResolvedValueOnce(response({ preview })).mockRejectedValueOnce(new Error("Lost response"))
      .mockResolvedValueOnce(response({ error: "Preview stale" }, 409));
    render(<SafetyPlanSeedPanel opportunityId={rows.opportunity.id} artifacts={artifacts} onApplied={onApplied} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: rows.artifact.id } });
    fireEvent.click(screen.getByRole("button", { name: "Preview Safety seed" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply six working drafts" }));
    await screen.findByText("Lost response");
    expect(screen.getByRole("button", { name: "Apply six working drafts" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Apply six working drafts" }));
    await screen.findByText("Preview stale");
    expect(screen.queryByRole("button", { name: "Apply six working drafts" })).toBeNull();
    expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[2][1].body);
    expect(onApplied).not.toHaveBeenCalled();
  });
});

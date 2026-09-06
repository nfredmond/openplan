/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadProjectEvidenceCandidateInventory } from "@/lib/project-evidence-bundles/inventory";
import { ProjectEvidenceBundlePanel } from "@/app/(app)/projects/[projectId]/_components/project-evidence-bundle-panel";

const PROJECT = {
  id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "22222222-2222-4222-8222-222222222222",
  name: "Exercise project",
  updated_at: "2026-09-06T00:00:00Z",
};

// Only source reads are substituted. The inventory, required candidate,
// revision tokens, selection dialog, and disclosure rendering are real.
async function openActualInventory() {
  const client = {
    from(table: string) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        order() { return chain; },
        limit() { return chain; },
        then(resolve: (result: { data: Record<string, unknown>[]; error: null }) => void) {
          resolve({ data: table === "report_artifacts" ? [{
            id: "report-pdf", report_id: "report", artifact_kind: "pdf",
            storage_path: `${PROJECT.workspace_id}/report/packet.pdf`,
            generated_at: PROJECT.updated_at, updated_at: PROJECT.updated_at,
            metadata_json: {},
            reports: { workspace_id: PROJECT.workspace_id, project_id: PROJECT.id, title: "Exercise report" },
          }] : [], error: null });
        },
      };
      return chain;
    },
  };
  const inventory = await loadProjectEvidenceCandidateInventory(client, PROJECT);
  expect(inventory.readFailed).toBe(false);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => inventory }));
  render(<ProjectEvidenceBundlePanel projectId={PROJECT.id} canGenerate />);
  fireEvent.click(await screen.findByRole("button", { name: "Prepare evidence bundle" }));
  return within(await screen.findByRole("dialog", { name: "Review project evidence bundle" }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window.HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
});

describe("required GeoPackage disclosure before confirmation", () => {
  it("retains the required map and existing optional report selection", async () => {
    const dialog = await openActualInventory();
    const required = dialog.getByRole("checkbox", { name: "Include Exercise project GeoPackage" });
    expect(required).toBeChecked();
    expect(required).toBeDisabled();
    expect(dialog.getByRole("checkbox", { name: "Include Exercise report" })).toBeChecked();
    expect(dialog.getByRole("button", { name: "Freeze evidence bundle" })).toBeDisabled();
  });

  it("names automatically included locations and preserves the warning when optional files are excluded", async () => {
    const dialog = await openActualInventory();
    const report = dialog.getByRole("checkbox", { name: "Include Exercise report" });
    fireEvent.click(report);
    expect(report).not.toBeChecked();
    expect(dialog.getByText(/automatically includes fatal and serious-injury crash locations from the latest ready project acquisition/)).toBeVisible();
    expect(dialog.getByText(/approved public engagement locations that are eligible for export/)).toBeVisible();
    expect(dialog.getByText(/Optional-file checkboxes do not exclude these geographic records/)).toBeVisible();
    expect(dialog.getByText(/openplan_layer_status.*exact included layers, counts, and unavailable coverage/)).toBeVisible();
    expect(dialog.queryByText(/Other geographic layers remain outside this release/)).not.toBeInTheDocument();
    expect(dialog.getByRole("checkbox", { name: /I reviewed this exact selection/ })).not.toBeChecked();
    expect(dialog.getByRole("button", { name: "Freeze evidence bundle" })).toBeDisabled();
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
});

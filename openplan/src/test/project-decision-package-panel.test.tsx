/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectDecisionPackagePanel } from "@/app/(app)/projects/[projectId]/_components/project-decision-package-panel";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const BUNDLE_HASH = "a".repeat(64);
const RECEIPT_HASH = "b".repeat(64);

beforeEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      currentUserId: "approver-1",
      canApprove: true,
      bundles: [{
        id: "bundle-1",
        bundle_sha256: BUNDLE_HASH,
        generated_by: "creator-1",
        generated_at: "2026-08-27T18:00:00Z",
        readinessError: null,
        freshnessError: null,
        staleForCurrentUse: false,
      }],
      submissions: [{
        id: "submission-1",
        bundle_id: "bundle-1",
        bundle_sha256: BUNDLE_HASH,
        submitted_by: "creator-1",
        assigned_approver_id: "approver-1",
        replaces_submission_id: null,
        submitted_at: "2026-08-27T18:05:00Z",
      }],
      decisions: [{
        id: "decision-1",
        submission_id: "submission-1",
        decision: "approved",
        reason: null,
        receipt_sha256: RECEIPT_HASH,
        decided_at: "2026-08-27T18:10:00Z",
      }],
      approvers: [],
    }),
  }));
});

describe("project decision package custody UI", () => {
  it("shows and copies full bundle and receipt hashes on the exact approved chain", async () => {
    const { container } = render(<ProjectDecisionPackagePanel projectId={PROJECT_ID} />);

    expect(await screen.findByText(RECEIPT_HASH)).toBeVisible();
    expect(screen.getAllByText(BUNDLE_HASH)).toHaveLength(2);
    expect(container.querySelector(`[data-bundle-sha="${BUNDLE_HASH}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-submission-bundle-sha="${BUNDLE_HASH}"] [data-decision="approved"]`)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Copy receipt sha-256" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(RECEIPT_HASH);
    expect(screen.getByRole("link", { name: "Download receipt" })).toHaveAttribute(
      "href",
      `/api/projects/${PROJECT_ID}/decision-packages/submission-1/decision`,
    );
  });
});

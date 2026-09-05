/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectEvidenceBundlePanel } from "@/app/(app)/projects/[projectId]/_components/project-evidence-bundle-panel";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const REVISION = "2026-08-26T18:00:00.000Z";

const INVENTORY = {
  projectId: PROJECT_ID,
  projectRevision: REVISION,
  candidates: [
    {
      id: `project_geopackage:${PROJECT_ID}`,
      sourceId: "project_geopackage",
      sourceLabel: "Project record",
      owningModule: "projects",
      recordId: PROJECT_ID,
      parentRecordId: null,
      projectId: PROJECT_ID,
      title: "Main Street GeoPackage",
      originalFilename: "project.gpkg",
      contentType: "application/geopackage+sqlite3",
      byteSize: null,
      recordedChecksumSha256: null,
      createdAt: null,
      updatedAt: REVISION,
      sourceKind: "project_geopackage",
      sourceVintage: REVISION,
      citation: null,
      retrievalState: "rendered_on_freeze",
      claimTier: null,
      custodyState: "rendered_on_freeze",
      uncertainty: [],
      knownLimits: ["Other geographic layers remain outside this release."],
      defaultSelected: true,
      required: true,
      selectable: true,
      exclusionReason: null,
      revisionToken: "a".repeat(64),
    },
    {
      id: "report_artifacts:22222222-2222-4222-8222-222222222222",
      sourceId: "report_artifacts",
      sourceLabel: "Reports",
      owningModule: "reports",
      recordId: "22222222-2222-4222-8222-222222222222",
      parentRecordId: "33333333-3333-4333-8333-333333333333",
      projectId: PROJECT_ID,
      title: "Board packet",
      originalFilename: null,
      contentType: "application/pdf",
      byteSize: 1024,
      recordedChecksumSha256: null,
      createdAt: REVISION,
      updatedAt: REVISION,
      sourceKind: "pdf",
      sourceVintage: null,
      citation: null,
      retrievalState: "available",
      claimTier: null,
      custodyState: "openplan_stored",
      uncertainty: [],
      knownLimits: [],
      defaultSelected: true,
      required: false,
      selectable: true,
      exclusionReason: null,
      revisionToken: "b".repeat(64),
    },
    {
      id: "aerial_artifact_custody:44444444-4444-4444-8444-444444444444",
      sourceId: "aerial_artifact_custody",
      sourceLabel: "Aerial deliverables",
      owningModule: "aerial_processing",
      recordId: "44444444-4444-4444-8444-444444444444",
      parentRecordId: "55555555-5555-4555-8555-555555555555",
      projectId: PROJECT_ID,
      title: "Orthomosaic",
      originalFilename: null,
      contentType: null,
      byteSize: null,
      recordedChecksumSha256: null,
      createdAt: REVISION,
      updatedAt: null,
      sourceKind: "orthomosaic",
      sourceVintage: null,
      citation: null,
      retrievalState: "reference_only",
      claimTier: null,
      custodyState: "unavailable",
      uncertainty: ["The source link expired."],
      knownLimits: [],
      defaultSelected: false,
      required: false,
      selectable: false,
      exclusionReason: "OpenPlan does not hold bytes for this deliverable.",
      revisionToken: "c".repeat(64),
    },
  ],
  sourceOutcomes: {},
  inventoryTruncated: true,
  limits: {
    reviewCandidateLimit: 500,
    selectedFileLimit: 200,
    perFileBytes: 50 * 1024 * 1024,
    totalSelectedFileBytes: 100 * 1024 * 1024,
  },
  priorBundles: [
    {
      id: "66666666-6666-4666-8666-666666666666",
      generatedAt: REVISION,
      byteCount: 4096,
      manifestSha256: "d".repeat(64),
      bundleSha256: "e".repeat(64),
      selectedCount: 2,
      status: "ready",
      failureCode: null,
      downloadHref: `/api/projects/${PROJECT_ID}/evidence-bundles/66666666-6666-4666-8666-666666666666/download`,
    },
  ],
  linkedPlans: [{
    id: "77777777-7777-4777-8777-777777777777",
    title: "Downtown mobility plan",
    status: "active",
    updatedAt: REVISION,
    revisionToken: "f".repeat(64),
  }],
  readFailed: false,
  failureMessage: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(window.HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => INVENTORY,
  }));
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("project evidence bundle reachability", () => {
  it("cancels the copy confirmation timer when leaving the evidence panel", async () => {
    const setTimer = vi.spyOn(window, "setTimeout");
    const clearTimer = vi.spyOn(window, "clearTimeout");
    const view = render(<ProjectEvidenceBundlePanel projectId={PROJECT_ID} canGenerate />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy manifest SHA-256" }));
    await screen.findByText("Copied");
    const timerIndex = setTimer.mock.calls.findIndex((call) => call[1] === 1_500);
    expect(timerIndex).toBeGreaterThanOrEqual(0);
    const timerId = setTimer.mock.results[timerIndex].value;
    view.unmount();
    expect(clearTimer).toHaveBeenCalledWith(timerId);
  });

  it("loads prior bundles and opens the reviewed, grouped selection from Documents", async () => {
    render(<ProjectEvidenceBundlePanel projectId={PROJECT_ID} canGenerate />);
    const prepare = await screen.findByRole("button", { name: "Prepare evidence bundle" });
    expect(prepare).toBeEnabled();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      INVENTORY.priorBundles[0].downloadHref
    );
    expect(screen.getByText(INVENTORY.priorBundles[0].manifestSha256)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy manifest SHA-256" }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        INVENTORY.priorBundles[0].manifestSha256,
      );
    });

    fireEvent.click(prepare);
    expect(await screen.findByRole("dialog", { name: "Review project evidence bundle" })).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Project record")).toBeVisible();
    expect(screen.getByText("Reports")).toBeVisible();
    expect(screen.getByText("Aerial deliverables")).toBeVisible();
    expect(screen.getByText(/Review stops at 500 candidates/)).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Include Main Street GeoPackage" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Include Main Street GeoPackage" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Include Board packet" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Include Orthomosaic" })).toBeDisabled();
    expect(screen.getByText("OpenPlan does not hold bytes for this deliverable.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Freeze evidence bundle" })).toBeDisabled();
    expect(screen.getByLabelText("Linked plan")).toHaveValue(INVENTORY.linkedPlans[0].id);
    expect(screen.getByText("Confirm that you reviewed this exact selection.")).toBeVisible();

    fireEvent.click(screen.getByText(/I reviewed this exact selection/));
    const freeze = screen.getByRole("button", { name: "Freeze evidence bundle" });
    await waitFor(() => expect(freeze).toBeEnabled());

    freeze.focus();
    fireEvent.keyDown(freeze, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), { key: "Tab", shiftKey: true });
    expect(freeze).toHaveFocus();
  });

  it("lets a viewer inspect the selection but presents no enabled create control", async () => {
    render(<ProjectEvidenceBundlePanel projectId={PROJECT_ID} canGenerate={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Prepare evidence bundle" }));
    await waitFor(() => {
      expect(screen.getByText(/Viewers can review candidates and download ready bundles/)).toBeVisible();
    });
    expect(screen.queryByText(/I reviewed this exact selection/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Freeze evidence bundle" })).toBeDisabled();
  });

  it("links missing governed-package prerequisites back to the scoped Plans and Reports workflows", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...INVENTORY,
        linkedPlans: [],
        candidates: INVENTORY.candidates.filter((candidate) => candidate.sourceId !== "report_artifacts"),
      }),
    } as Response);

    render(<ProjectEvidenceBundlePanel projectId={PROJECT_ID} canGenerate />);
    fireEvent.click(await screen.findByRole("button", { name: "Prepare evidence bundle" }));

    expect(await screen.findByRole("link", { name: "Open Plans for this project." })).toHaveAttribute(
      "href",
      `/plans?projectId=${PROJECT_ID}`,
    );
    expect(screen.getByRole("link", { name: "Open Reports for this project." })).toHaveAttribute(
      "href",
      `/reports?projectId=${PROJECT_ID}`,
    );
    expect(screen.getByText(/A linked plan is optional for an archive/)).toBeVisible();
    expect(screen.getByText(/Governed submission still requires exactly one current report PDF/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Freeze evidence bundle" })).toBeDisabled();
    fireEvent.click(screen.getByText(/I reviewed this exact selection/));
    expect(screen.getByRole("button", { name: "Freeze evidence bundle" })).toBeEnabled();
  });
});

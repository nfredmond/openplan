import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PublishedLandUsePlanPage from "@/app/(published)/published-plans/[planId]/page";
import PublicLandUsePlanReviewPage from "@/app/(published)/review/land-use-plans/[shareToken]/page";
import { loadPublishedLandUsePlanPacket, loadPublicLandUsePlanReviewPacket, type PublishedLandUsePlanPacket } from "@/lib/land-use-plans/public";
import { syntheticPlanContext } from "./fixtures/land-use-plans/plan-context";

vi.mock("@/lib/land-use-plans/public", () => ({ loadPublishedLandUsePlanPacket: vi.fn(), loadPublicLandUsePlanReviewPacket: vi.fn() }));
vi.mock("@/components/land-use-plans/public-designation-map", () => ({ PublicDesignationMap: () => null }));

function packet(sourceUrls: string[]): PublishedLandUsePlanPacket {
  return {
    descriptorCustody: "frozen",
    plan: { id: "test-plan", title: "Test published plan", planKindKey: "area", authorityLabel: "Test authority", geographyLabel: "Test area" },
    version: { id: "test-version", versionNumber: 1, contentHash: "test-hash", frozenAt: null },
    decision: { decision_kind: "adopt", decision_body: "Test body", instrument_type: "test", instrument_identifier: "test", vote: null, decided_on: "2026-08-01", effective_on: null, version_content_hash: "test-hash" },
    descriptor: { terminology: { plan: "plan", section: "section", adoptionInstrument: "decision", implementationReport: "report" }, disclosure: "Test coverage disclosure", sourceUrls, verifiedAt: "2026-08-23", reviewDueAt: "2027-01-15" },
    content: {},
    privacy: "Test privacy disclosure",
  };
}

describe("published plan source-review disclosure", () => {
  describe.each(["adopted", "review"] as const)("%s saved context and download", kind => {
    async function show(content: Record<string, unknown>) {
      const value = { ...packet([]), content };
      if (kind === "adopted") {
        vi.mocked(loadPublishedLandUsePlanPacket).mockResolvedValue({ ok: true, packet: value });
        render(await PublishedLandUsePlanPage({ params: Promise.resolve({ planId: "test-plan" }) }));
      } else {
        vi.mocked(loadPublicLandUsePlanReviewPacket).mockResolvedValue({ ok: true, packet: { ...value,
          release: { id: "synthetic-release", roundNumber: 1, reviewOpenOn: "2026-10-07", reviewCloseOn: "2026-10-08", reviewMethod: "external_process", status: "open", outcomeHash: null } } });
        render(await PublicLandUsePlanReviewPage({ params: Promise.resolve({ shareToken: "synthetic-token" }) }));
      }
    }
    it("shows saved area, authority and caveat with an explicit JSON download", async () => {
      const context = syntheticPlanContext();
      context.place.label = "SYNTHETIC retained public boundary";
      context.assessment.authorities[0].label = "SYNTHETIC retained responsible body";
      await show({ planContext: context, confidential_notes: "SYNTHETIC private sentinel" });
      expect(screen.getByRole("region", { name: "Context retained with this version" })).toBeVisible();
      expect(screen.getByText(context.place.label)).toBeVisible();
      expect(screen.getByText(context.assessment.authorities[0].label)).toBeVisible();
      expect(screen.getByText(context.assessment.applicability.explanation)).toBeVisible();
      expect(screen.getByText(/They do not establish legal sufficiency/)).toBeVisible();
      expect(screen.queryByText("SYNTHETIC private sentinel")).toBeNull();
      expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute("download", `openplan-${kind === "adopted" ? "adopted" : "review"}-v1.json`);
      expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute("href", kind === "adopted" ? "/api/public/land-use-plans/test-plan" : "/api/public/land-use-plan-reviews/synthetic-token");
    });
    it.each([{}, { planContext: null }])("discloses unretained context without substituting display labels", async content => {
      await show(content);
      expect(screen.getByText(/This version did not retain its plan context/)).toBeVisible();
      expect(screen.getByRole("region", { name: "Context not retained with this version" })).toBeVisible();
      expect(screen.queryByText(/These are the saved area and staff assessment/)).toBeNull();
      expect(screen.queryByRole("heading", { name: "Responsible bodies" })).toBeNull();
    });
    it("renders root policies and nested content once while retaining checklist selection", async () => {
      await show({ version: { applicableRequirementKeys: ["selected"] }, nodes: [
        { id: "section", node_kind: "section", requirement_key: "selected", title: "Selected section" },
        { id: "nested-section", parent_node_id: "section", node_kind: "section", requirement_key: "selected", title: "Nested section" },
        { id: "nested-policy", parent_node_id: "nested-section", node_kind: "policy", title: "Nested policy", body: "Nested policy text" },
        { id: "root-goal", node_kind: "goal", title: "Root goal", body: "Root goal text" },
        { id: "root-policy", node_kind: "policy", title: "Root policy", body: "Root policy text" },
        { id: "root-child", parent_node_id: "root-policy", node_kind: "objective", title: "Policy objective", body: "Objective text" },
        { id: "unselected", node_kind: "section", requirement_key: "not-selected", title: "Unselected section", body: "Unselected text" },
        { id: "unselected-child", parent_node_id: "unselected", node_kind: "policy", title: "Unselected child", body: "Unselected child text" },
      ] });
      for (const title of ["Selected section", "Nested section", "Nested policy", "Root goal", "Root policy", "Policy objective"]) {
        expect(screen.getAllByRole("heading", { name: title })).toHaveLength(1);
      }
      for (const text of ["Nested policy text", "Root goal text", "Root policy text", "Objective text"]) expect(screen.getByText(text)).toBeVisible();
      expect(screen.queryByText("Unselected text")).toBeNull();
      expect(screen.queryByText("Unselected child text")).toBeNull();
    });
    it("keeps legacy authored sections and root policies when checklist keys were not retained", async () => {
      await show({ nodes: [
        { id: "legacy", node_kind: "section", title: "Legacy section", body: "Legacy section text" },
        { id: "empty", node_kind: "section", title: "Empty template section", body: null },
        { id: "policy", node_kind: "policy", title: "Legacy root policy", body: "Legacy root policy text" },
      ] });
      expect(screen.getByText("Legacy section text")).toBeVisible();
      expect(screen.getByText("Legacy root policy text")).toBeVisible();
      expect(screen.queryByRole("heading", { name: "Empty template section" })).toBeNull();
    });
    it("shows the frozen implementation action and its recorded status", async () => {
      await show({ implementationActions: [{ id: "action", title: "SYNTHETIC action", description: "SYNTHETIC action text", responsible_party: "SYNTHETIC responsible party", due_on: "2027-01-10", status: "in_progress" }] });
      expect(screen.getByRole("heading", { name: "Implementation program" })).toBeVisible();
      expect(screen.getByRole("heading", { name: "SYNTHETIC action" })).toBeVisible();
      expect(screen.getByText("SYNTHETIC action text")).toBeVisible();
      expect(screen.getByText("SYNTHETIC responsible party · 2027-01-10 · in progress")).toBeVisible();
    });
    it("withholds an invalid saved assessment in a malformed reader result", async () => {
      await show({ planContext: { ...syntheticPlanContext(), savedBy: "invalid" } });
      expect(screen.getByRole("alert")).toHaveTextContent("could not be verified");
      expect(screen.queryByRole("heading", { name: "Responsible bodies" })).toBeNull();
    });
  });
  it.each(["frozen", "not_retained"] as const)("discloses %s rules on the public review page", async custody => {
    const value = { ...packet([]), descriptorCustody: custody, release: { id: "synthetic-release", roundNumber: 1,
      reviewOpenOn: "2026-10-07", reviewCloseOn: "2026-10-08", reviewMethod: "external_process", status: "open" as const, outcomeHash: null } };
    vi.mocked(loadPublicLandUsePlanReviewPacket).mockResolvedValue({ ok: true, packet: value });
    render(await PublicLandUsePlanReviewPage({ params: Promise.resolve({ shareToken: "synthetic-token" }) }));
    expect(screen.getByText(custody === "frozen" ? /checklist, terminology and source-review dates were saved with this version/i : /may differ from what reviewers saw/i)).toBeVisible();
  });
  it("withholds review dates when the descriptor has no sources", async () => {
    vi.mocked(loadPublishedLandUsePlanPacket).mockResolvedValue({ ok: true, packet: packet([]) });
    render(await PublishedLandUsePlanPage({ params: Promise.resolve({ planId: "test-plan" }) }));
    expect(screen.queryByText(/Sources reviewed/)).not.toBeInTheDocument();
    expect(screen.getByText(/source review is not established/i)).toBeVisible();
    expect(screen.getByText(/checklist, terminology and source-review dates were saved with this version/i)).toBeVisible();
  });

  it("identifies an unsaved legacy descriptor as a current registry reference", async () => {
    const legacy = packet(["https://example.test/official-source"]);
    legacy.descriptorCustody = "not_retained";
    vi.mocked(loadPublishedLandUsePlanPacket).mockResolvedValue({ ok: true, packet: legacy });
    render(await PublishedLandUsePlanPage({ params: Promise.resolve({ planId: "test-plan" }) }));
    expect(screen.getByText(/may differ from what reviewers saw/i)).toBeVisible();
    expect(screen.queryByText(/checklist, terminology and source-review dates were saved with this version/i)).not.toBeInTheDocument();
  });

  it("preserves the recorded review date beside a sourced descriptor", async () => {
    vi.mocked(loadPublishedLandUsePlanPacket).mockResolvedValue({ ok: true, packet: packet(["https://example.test/official-source"]) });
    render(await PublishedLandUsePlanPage({ params: Promise.resolve({ planId: "test-plan" }) }));
    expect(screen.getByText(/Sources reviewed 2026-08-23; review due 2027-01-15/)).toBeVisible();
    expect(screen.queryByText(/source review is not established/i)).not.toBeInTheDocument();
  });
});

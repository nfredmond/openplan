import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PublishedLandUsePlanPage from "@/app/(public)/published-plans/[planId]/page";
import { loadPublishedLandUsePlanPacket, type PublishedLandUsePlanPacket } from "@/lib/land-use-plans/public";

vi.mock("@/lib/land-use-plans/public", () => ({ loadPublishedLandUsePlanPacket: vi.fn() }));
vi.mock("@/components/land-use-plans/public-designation-map", () => ({ PublicDesignationMap: () => null }));

function packet(sourceUrls: string[]): PublishedLandUsePlanPacket {
  return {
    plan: { id: "test-plan", title: "Test published plan", planKindKey: "area", authorityLabel: "Test authority", geographyLabel: "Test area" },
    version: { id: "test-version", versionNumber: 1, contentHash: "test-hash", frozenAt: null },
    decision: { decision_kind: "adopt", decision_body: "Test body", instrument_type: "test", instrument_identifier: "test", vote: null, decided_on: "2026-08-01", effective_on: null, version_content_hash: "test-hash" },
    descriptor: { terminology: { plan: "plan", section: "section", adoptionInstrument: "decision", implementationReport: "report" }, disclosure: "Test coverage disclosure", sourceUrls, verifiedAt: "2026-08-23", reviewDueAt: "2027-01-15" },
    content: {},
    privacy: "Test privacy disclosure",
  };
}

describe("published plan source-review disclosure", () => {
  it("withholds review dates when the descriptor has no sources", async () => {
    vi.mocked(loadPublishedLandUsePlanPacket).mockResolvedValue({ ok: true, packet: packet([]) });
    render(await PublishedLandUsePlanPage({ params: Promise.resolve({ planId: "test-plan" }) }));
    expect(screen.queryByText(/Sources reviewed/)).not.toBeInTheDocument();
    expect(screen.getByText(/source review is not established/i)).toBeVisible();
  });

  it("preserves the recorded review date beside a sourced descriptor", async () => {
    vi.mocked(loadPublishedLandUsePlanPacket).mockResolvedValue({ ok: true, packet: packet(["https://example.test/official-source"]) });
    render(await PublishedLandUsePlanPage({ params: Promise.resolve({ planId: "test-plan" }) }));
    expect(screen.getByText(/Sources reviewed 2026-08-23; review due 2027-01-15/)).toBeVisible();
    expect(screen.queryByText(/source review is not established/i)).not.toBeInTheDocument();
  });
});

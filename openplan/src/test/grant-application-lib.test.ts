import { describe, expect, it } from "vitest";
import {
  APPLICATION_ATTACHMENT_STATUSES,
  APPLICATION_SECTION_STATUSES,
  buildCatalogAttachmentSeeds,
  buildCatalogSectionSeeds,
  canTransitionAttachmentStatus,
  canTransitionSectionStatus,
  findGrantProgramCatalogEntry,
  parseApplicationAttachmentRow,
  parseApplicationSectionRow,
  parseSuggestedEvidence,
} from "@/lib/grants/application";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";

describe("catalog lookup", () => {
  it("matches only by explicit key, never inferred", () => {
    expect(findGrantProgramCatalogEntry("atp")?.key).toBe("atp");
    expect(findGrantProgramCatalogEntry("  hsip  ")?.key).toBe("hsip");
    expect(findGrantProgramCatalogEntry("Active Transportation Program (ATP)")).toBeNull();
    expect(findGrantProgramCatalogEntry("ATP")).toBeNull();
    expect(findGrantProgramCatalogEntry("")).toBeNull();
    expect(findGrantProgramCatalogEntry("not-a-program")).toBeNull();
  });
});

describe("catalog seed builders", () => {
  it("every catalog entry seeds cleanly with ordered, unique, parseable rows", () => {
    for (const entry of GRANT_PROGRAM_CATALOG) {
      const sections = buildCatalogSectionSeeds(entry);
      const attachments = buildCatalogAttachmentSeeds(entry);

      expect(sections.length, `sections for ${entry.key}`).toBeGreaterThan(0);
      expect(attachments.length, `attachments for ${entry.key}`).toBeGreaterThan(0);

      expect(new Set(sections.map((seed) => seed.section_key)).size).toBe(sections.length);
      expect(new Set(attachments.map((seed) => seed.attachment_key)).size).toBe(attachments.length);

      sections.forEach((seed, index) => {
        expect(seed.sort_order, `sort_order for ${entry.key}/${seed.section_key}`).toBe(index);
        expect(seed.source).toBe("catalog");
        expect(seed.suggested_evidence.length).toBeGreaterThan(0);
        // Seeded rows must round-trip through the defensive row parser once
        // the route adds ids — prove the seed shape is parser-compatible.
        const parsed = parseApplicationSectionRow({
          id: "00000000-0000-4000-8000-000000000001",
          workspace_id: "00000000-0000-4000-8000-000000000002",
          opportunity_id: "00000000-0000-4000-8000-000000000003",
          status: "not_started",
          final_markdown: null,
          finalized_from_draft_id: null,
          updated_by: null,
          created_at: "2026-07-27T00:00:00.000Z",
          updated_at: "2026-07-27T00:00:00.000Z",
          ...seed,
        });
        expect(parsed, `parseable seed for ${entry.key}/${seed.section_key}`).not.toBeNull();
        expect(parsed!.suggested_evidence).toEqual(seed.suggested_evidence);
        expect(parsed!.ai_drafting_enabled).toBe(seed.ai_drafting_enabled);
      });

      attachments.forEach((seed, index) => {
        expect(seed.sort_order).toBe(index);
        const parsed = parseApplicationAttachmentRow({
          id: "00000000-0000-4000-8000-000000000001",
          workspace_id: "00000000-0000-4000-8000-000000000002",
          opportunity_id: "00000000-0000-4000-8000-000000000003",
          status: "missing",
          kb_document_id: null,
          report_artifact_id: null,
          note: null,
          updated_by: null,
          created_at: "2026-07-27T00:00:00.000Z",
          updated_at: "2026-07-27T00:00:00.000Z",
          ...seed,
        });
        expect(parsed, `parseable seed for ${entry.key}/${seed.attachment_key}`).not.toBeNull();
        expect(parsed!.required).toBe(seed.required);
      });
    }
  });

  it("carries an explicit aiDraftingEnabled: false through to the seed", () => {
    const hsip = findGrantProgramCatalogEntry("hsip")!;
    const seeds = buildCatalogSectionSeeds(hsip);
    const bcSection = seeds.find((seed) => seed.section_key === "benefit-cost-calculation");
    expect(bcSection?.ai_drafting_enabled).toBe(false);
    // Omitted flag means draftable.
    const description = seeds.find((seed) => seed.section_key === "project-description");
    expect(description?.ai_drafting_enabled).toBe(true);
  });
});

describe("section status machine", () => {
  it("walks the drafting lifecycle and refuses regressions from final", () => {
    expect(canTransitionSectionStatus("not_started", "drafting")).toBe(true);
    expect(canTransitionSectionStatus("drafting", "operator_review")).toBe(true);
    expect(canTransitionSectionStatus("operator_review", "final")).toBe(true);
    expect(canTransitionSectionStatus("operator_review", "drafting")).toBe(true);
    // Finalizing directly (operator pastes approved text) is allowed from anywhere.
    expect(canTransitionSectionStatus("not_started", "final")).toBe(true);
    expect(canTransitionSectionStatus("drafting", "final")).toBe(true);
    // The only exit from final is reopening for review.
    expect(canTransitionSectionStatus("final", "operator_review")).toBe(true);
    expect(canTransitionSectionStatus("final", "drafting")).toBe(false);
    expect(canTransitionSectionStatus("final", "not_started")).toBe(false);
    // Work never regresses to not_started.
    expect(canTransitionSectionStatus("drafting", "not_started")).toBe(false);
    expect(canTransitionSectionStatus("operator_review", "not_started")).toBe(false);
  });

  it("treats a same-status update as an idempotent no-op", () => {
    for (const status of APPLICATION_SECTION_STATUSES) {
      expect(canTransitionSectionStatus(status, status)).toBe(true);
    }
  });
});

describe("attachment status machine", () => {
  it("allows every operator correction between distinct states", () => {
    for (const from of APPLICATION_ATTACHMENT_STATUSES) {
      for (const to of APPLICATION_ATTACHMENT_STATUSES) {
        expect(canTransitionAttachmentStatus(from, to), `${from} → ${to}`).toBe(true);
      }
    }
  });
});

describe("defensive parsers", () => {
  it("drops unknown evidence kinds instead of failing", () => {
    expect(parseSuggestedEvidence(["modeling", "vibes", "kb", 42, null])).toEqual([
      "modeling",
      "kb",
    ]);
    expect(parseSuggestedEvidence("modeling")).toEqual([]);
    expect(parseSuggestedEvidence(null)).toEqual([]);
  });

  it("rejects malformed section rows and fails closed on the never-AI flag", () => {
    expect(parseApplicationSectionRow(null)).toBeNull();
    expect(parseApplicationSectionRow({ id: "x" })).toBeNull();
    expect(
      parseApplicationSectionRow({
        id: "a",
        workspace_id: "b",
        opportunity_id: "c",
        section_key: "narrative",
        title: "Narrative",
        source: "catalog",
        status: "shipped", // not in the vocabulary
      }),
    ).toBeNull();

    const parsed = parseApplicationSectionRow({
      id: "a",
      workspace_id: "b",
      opportunity_id: "c",
      section_key: "narrative",
      title: "Narrative",
      source: "custom",
      status: "not_started",
      // ai_drafting_enabled missing entirely → parses as NOT draftable.
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.ai_drafting_enabled).toBe(false);
    expect(parsed!.suggested_evidence).toEqual([]);
    expect(parsed!.sort_order).toBe(0);
  });

  it("rejects malformed attachment rows and tolerates optional fields", () => {
    expect(parseApplicationAttachmentRow(null)).toBeNull();
    expect(
      parseApplicationAttachmentRow({
        id: "a",
        workspace_id: "b",
        opportunity_id: "c",
        attachment_key: "map",
        title: "Map",
        status: "lost", // not in the vocabulary
      }),
    ).toBeNull();

    const parsed = parseApplicationAttachmentRow({
      id: "a",
      workspace_id: "b",
      opportunity_id: "c",
      attachment_key: "map",
      title: "Map",
      status: "attached",
      kb_document_id: "d",
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.kb_document_id).toBe("d");
    expect(parsed!.report_artifact_id).toBeNull();
    expect(parsed!.required).toBe(false);
  });
});

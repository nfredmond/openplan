/**
 * An RTP export section has to be declared in five places, and being registered
 * in four of them type-checks perfectly.
 *
 * The five:
 *   1. `RtpExportSectionKey` (lib/rtp/export.ts)
 *   2. `RTP_EXPORT_SECTION_ORDER` / `DEFAULT_RTP_EXPORT_SECTION_KEYS` (same file)
 *   3. `RTP_SECTION_TEMPLATES.board_packet` (lib/reports/catalog.ts)
 *   4. the five `enabledKeysByStage` arrays (same file)
 *   5. `describeReportSectionKey` (same file)
 *
 * (1) and (2) are held together by the compiler — `satisfies Record<Key, true>`
 * makes a forgotten key a build error. Nothing held (3), (4) and (5) to them,
 * which is what this file is for. The failure it prevents is quiet: a section
 * that exists in the exporter but is missing from a packet stage's list simply
 * does not appear in that stage's packet, and the packet still looks complete.
 *
 * Note the asymmetry, which is deliberate rather than sloppy: the board-packet
 * TEMPLATE must be the complete set, while each STAGE list is a subset — an
 * archived packet legitimately omits adoption readiness. So the template is
 * asserted by equality and the stages by containment.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RTP_EXPORT_SECTION_KEYS } from "@/lib/rtp/export";
import {
  RTP_PACKET_PRESET_STAGES,
  buildRtpPacketPresetTemplates,
  describeReportSectionKey,
  RTP_SECTION_TEMPLATES,
} from "@/lib/reports/catalog";

const EXPORT_KEYS = [...DEFAULT_RTP_EXPORT_SECTION_KEYS].sort();

describe("every RTP export section is offered by the board packet", () => {
  it("declares exactly the exporter's sections in the board-packet template", () => {
    const templateKeys = (RTP_SECTION_TEMPLATES.board_packet ?? [])
      .map((template) => template.sectionKey)
      .sort();

    // Equality, not containment: a template key the exporter does not render is
    // a section a planner can switch on that produces nothing, and an exporter
    // section absent here can never be switched on at all.
    expect(templateKeys).toEqual(EXPORT_KEYS);
  });

  it("gives every section a description rather than the generic fallback", () => {
    // DERIVED, not hardcoded. My first attempt guessed at the fallback's
    // wording with a regex that never matched it, so deleting a section's
    // description left this test green — caught by mutation. Asking the
    // function itself what it says about an unknown key cannot drift.
    const genericFallback = describeReportSectionKey("__no_such_section__");

    for (const key of EXPORT_KEYS) {
      const description = describeReportSectionKey(key);
      expect(description, `${key} has no description`).toBeTruthy();
      expect(description, `${key} falls through to the generic description`).not.toBe(genericFallback);
    }
  });
});

describe("every packet stage offers a subset of the real sections", () => {
  it("never enables a section the exporter cannot render", () => {
    for (const stage of RTP_PACKET_PRESET_STAGES) {
      const stageKeys = buildRtpPacketPresetTemplates(stage)
        .filter((template) => template.enabled)
        .map((template) => template.sectionKey);

      for (const key of stageKeys) {
        expect(EXPORT_KEYS, `stage ${stage} enables unknown section ${key}`).toContain(key);
      }
    }
  });

  it("gives every stage at least the plan's own narrative and its money", () => {
    // The two a plan cannot be read without. A stage preset that dropped either
    // would produce a packet that looks whole and answers neither "what is the
    // plan" nor "can it be paid for".
    for (const stage of RTP_PACKET_PRESET_STAGES) {
      const enabled = buildRtpPacketPresetTemplates(stage)
        .filter((template) => template.enabled)
        .map((template) => template.sectionKey);

      expect(enabled, `stage ${stage} drops the chapter digest`).toContain("chapter_digest");
      expect(enabled, `stage ${stage} drops the financial element`).toContain("financial_element");
    }
  });
});

/**
 * Why a packaged application is stamped DRAFT: outstanding required
 * attachments, and unverified items left in its final section text
 * (KI-2026-11-14-061). Client-safe, so the application workspace says before
 * export exactly what the PDF will print.
 *
 * A planner may finalize a section that still holds `[VERIFY]` markers or the
 * Safety seed's unfilled placeholders; finalizing is their call. But a packet
 * whose own section text says nobody has confirmed a claim is not a final
 * application, so the export stamps it DRAFT with the count, and the
 * application workspace says the same before export.
 *
 * WHAT COUNTS. Only the final text of sections whose status is final, the
 * applicant-authored prose of the packet:
 *  - `[VERIFY]` and `[VERIFY: ...]`, this product's mark for a claim nobody has
 *    confirmed, wherever the final text holds one (seeded or typed);
 *  - `[OPERATOR: ...]`, the Safety seed's placeholder for a manual gap
 *    (`buildSs4aSafetyDrafts`), left unfilled.
 *
 * WHAT DOES NOT. Markers the product prints by design outside section text:
 * the evidence appendices' notes, the countermeasure table's CMF notes, the
 * Safety seed sources and caveats appendix. Those are disclosures and stay.
 * Text of a section that is not final is never printed as prose, so it is not
 * counted either.
 */

import type { ApplicationAttachmentRow } from "@/lib/grants/application";

const VERIFY_MARKER = /\[VERIFY(?:\]|:[^\]\n]*\])/g;
const PLACEHOLDER_MARKER = /\[OPERATOR:[^\]\n]*\]/g;

export type UnverifiedItemCount = { verify: number; placeholders: number };

export type UnverifiedSectionSummary = {
  /** Final sections that hold at least one item, in the order given. */
  sections: Array<{ sectionKey: string; title: string } & UnverifiedItemCount>;
  verify: number;
  placeholders: number;
};

export function countUnverifiedItems(text: string | null | undefined): UnverifiedItemCount {
  if (!text) return { verify: 0, placeholders: 0 };
  return {
    verify: text.match(VERIFY_MARKER)?.length ?? 0,
    placeholders: text.match(PLACEHOLDER_MARKER)?.length ?? 0,
  };
}

/** The final sections that still hold items, and the totals. */
export function summarizeUnverifiedSections(
  sections: ReadonlyArray<{ section_key: string; title: string; status: string; final_markdown: string | null }>
): UnverifiedSectionSummary {
  const summary: UnverifiedSectionSummary = { sections: [], verify: 0, placeholders: 0 };
  for (const section of sections) {
    if (section.status !== "final") continue;
    const count = countUnverifiedItems(section.final_markdown);
    if (count.verify + count.placeholders === 0) continue;
    summary.sections.push({ sectionKey: section.section_key, title: section.title, ...count });
    summary.verify += count.verify;
    summary.placeholders += count.placeholders;
  }
  return summary;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "3 unverified items, 1 unfilled placeholder": the items one section or a packet holds. */
export function unverifiedItemsLabel(count: UnverifiedItemCount): string {
  return [
    count.verify > 0 ? plural(count.verify, "unverified item", "unverified items") : null,
    count.placeholders > 0 ? plural(count.placeholders, "unfilled placeholder", "unfilled placeholders") : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The DRAFT stamp reason, or null when no final section holds an item:
 * "DRAFT: 45 unverified items, 6 unfilled placeholders remain in 6 sections".
 */
export function unverifiedDraftStamp(summary: UnverifiedSectionSummary): string | null {
  if (summary.sections.length === 0) return null;
  const sectionCount = summary.sections.length;
  return `DRAFT: ${unverifiedItemsLabel(summary)} ${summary.verify + summary.placeholders === 1 ? "remains" : "remain"} in ${plural(sectionCount, "section", "sections")}`;
}

/** Required checklist items with nothing behind them: neither attached nor N/A. */
export function countOutstandingRequiredAttachments(
  attachments: ReadonlyArray<Pick<ApplicationAttachmentRow, "required" | "status">>
): number {
  return attachments.filter(
    (attachment) =>
      attachment.required &&
      attachment.status !== "attached" &&
      attachment.status !== "not_applicable"
  ).length;
}

/**
 * Every reason the document is stamped DRAFT, in print order: outstanding
 * required attachments, then unverified items left in final section text.
 * Empty when the packet carries no stamp.
 */
export function applicationDraftStamps(
  sections: Parameters<typeof summarizeUnverifiedSections>[0],
  attachments: Parameters<typeof countOutstandingRequiredAttachments>[0]
): string[] {
  const outstanding = countOutstandingRequiredAttachments(attachments);
  const unverified = unverifiedDraftStamp(summarizeUnverifiedSections(sections));
  return [
    ...(outstanding > 0 ? [`DRAFT: ${outstanding} required attachment(s) outstanding`] : []),
    ...(unverified ? [unverified] : []),
  ];
}

/**
 * Every application template the grant program catalog holds, one entry per
 * template, not per program.
 *
 * A program usually has one template, known by the program's own key. A
 * program whose application changed between cycles has more: the current one,
 * which a new application seeds from, and the earlier ones, which are kept
 * only so applications already seeded from them are still recognised. The
 * template picker and the seeding route read the catalog entry and so offer
 * the current template only; nothing seeds an earlier template.
 */

import {
  GRANT_PROGRAM_CATALOG,
  type GrantApplicationAttachmentTemplate,
  type GrantApplicationSectionTemplate,
} from "@/lib/grants/program-catalog";

export type GrantApplicationTemplate = {
  /** The catalog entry the template belongs to. */
  catalogKey: string;
  /** Unique across the catalog: the entry's key unless the entry names another. */
  templateKey: string;
  applicationSections: readonly GrantApplicationSectionTemplate[];
  requiredAttachments: readonly GrantApplicationAttachmentTemplate[];
};

/** Each program's current template, then its earlier ones, in catalog order. */
export function listGrantApplicationTemplates(): GrantApplicationTemplate[] {
  return GRANT_PROGRAM_CATALOG.flatMap((entry) => [
    {
      catalogKey: entry.key,
      templateKey: entry.applicationTemplateKey ?? entry.key,
      applicationSections: entry.applicationSections ?? [],
      requiredAttachments: entry.requiredAttachments ?? [],
    },
    ...(entry.earlierApplicationTemplates ?? []).map((earlier) => ({ catalogKey: entry.key, ...earlier })),
  ]);
}

/**
 * The checklist keys a template asks for only in some cases. A saved
 * attachment row holds required as yes or no, so "if applicable" is read back
 * from the template the application was seeded from.
 */
export function ifApplicableAttachmentKeys(
  template: Pick<GrantApplicationTemplate, "requiredAttachments"> | null
): ReadonlySet<string> {
  return new Set(
    (template?.requiredAttachments ?? []).filter((item) => item.required && item.ifApplicable).map((item) => item.key)
  );
}

/**
 * The catalog program an opportunity was tracked from, when its title and
 * agency are still exactly that program's name and administering agency
 * (tracking from a catalog card copies both). The template picker starts on
 * it, so the planner does not have to find the program again in the list
 * (KI-2026-11-16-035). It is a starting selection only: the planner sees it
 * and can change it, and seeding still takes the key the planner submits.
 * Null when nothing or more than one program matches, or the match has no
 * template.
 */
export function catalogKeyTrackedAs(opportunity: { title: string | null; agencyName: string | null }): string | null {
  const title = opportunity.title?.trim();
  const agency = opportunity.agencyName?.trim();
  if (!title || !agency) return null;
  const matches = GRANT_PROGRAM_CATALOG.filter((entry) => entry.name === title && entry.administeringAgency === agency);
  return matches.length === 1 && (matches[0].applicationSections?.length ?? 0) > 0 ? matches[0].key : null;
}

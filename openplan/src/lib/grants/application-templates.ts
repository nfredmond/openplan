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

/**
 * The printable public address for an engagement campaign (20260810000002).
 *
 * ONE definition of the slug rule, used by every layer that touches it: the
 * share-controls field validates as the planner types, the campaign PATCH
 * route validates before writing, and the public resolution path
 * (`public-portal-data.ts`) decides whether an /engage/{value} is even worth
 * a query. The database CHECK in migration 20260810000002 states the same
 * rule; this module is the application-side mirror, kept in one place so the
 * three surfaces cannot drift apart.
 *
 * The rule: lowercase kebab (a-z, 0-9, single hyphens, no leading/trailing
 * hyphen), 3-64 characters — something a person can say aloud and type back
 * from a printed flyer, in any locale.
 */
export const PUBLIC_SLUG_MIN_LENGTH = 3;
export const PUBLIC_SLUG_MAX_LENGTH = 64;
export const PUBLIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isPublicSlugCandidate(value: string): boolean {
  return (
    value.length >= PUBLIC_SLUG_MIN_LENGTH &&
    value.length <= PUBLIC_SLUG_MAX_LENGTH &&
    PUBLIC_SLUG_PATTERN.test(value)
  );
}

/**
 * A slug is printed on paper and typed back by hand, so " Jefferson-Street "
 * must reach the same address as the flyer: trim, then lowercase. The public
 * resolution path applies the same normalization before matching.
 */
export function normalizePublicSlugInput(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The one sentence both the field and the route use to refuse a bad format,
 * so a planner reads the same words wherever the refusal reaches them.
 */
export const PUBLIC_SLUG_FORMAT_REFUSAL =
  `A link name uses lowercase letters, numbers, and single hyphens (like jefferson-street-study), ${PUBLIC_SLUG_MIN_LENGTH}-${PUBLIC_SLUG_MAX_LENGTH} characters, with no spaces and no hyphen at the start or end.`;

/** The refusal for a slug some other campaign already holds (globally unique). */
export const PUBLIC_SLUG_TAKEN_REFUSAL =
  "That link name is taken — another campaign is already using it. Pick a different one.";

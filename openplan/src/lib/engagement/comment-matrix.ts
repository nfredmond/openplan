export type EngagementCommentMatrixCategoryLike = {
  id: string;
  label?: string | null;
  slug?: string | null;
};

export type EngagementCommentMatrixItemLike = {
  id: string;
  campaign_id?: string | null;
  category_id?: string | null;
  title?: string | null;
  body?: string | null;
  submitted_by?: string | null;
  status?: string | null;
  source_type?: string | null;
  metadata_json?: Record<string, unknown> | null;
  moderation_notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type EngagementCommentMatrixPosture =
  | "included"
  | "held_duplicate_review"
  | "excluded_internal_private"
  | "excluded_not_ready";

export type EngagementCommentMatrixPreviewRow = {
  itemId: string;
  title: string;
  submittedBy: string | null;
  sourceType: string;
  categoryLabel: string | null;
  posture: EngagementCommentMatrixPosture;
  postureLabel: string;
  reason: string;
  bodyExcerpt: string;
  updatedAt: string | null;
};

export type EngagementCommentMatrixPreview = {
  caveat: string;
  counts: {
    includedCount: number;
    heldDuplicateReviewCount: number;
    excludedInternalPrivateCount: number;
    excludedNotReadyCount: number;
    previewedRowCount: number;
    totalItemCount: number;
  };
  rows: EngagementCommentMatrixPreviewRow[];
};

export const ENGAGEMENT_COMMENT_MATRIX_CAVEAT =
  "Staff cue only: this preview does not establish representativeness, legal sufficiency, CEQA/NEPA adequacy, or final publication readiness.";

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataBoolean(metadata: Record<string, unknown> | null | undefined, key: string): boolean {
  return metadata?.[key] === true || metadataString(metadata, key)?.toLowerCase() === "true";
}

function normalizeBodyFingerprint(input: { title?: string | null; body?: string | null }): string {
  return `${input.title ?? ""}|${input.body ?? ""}`.replace(/\s+/g, " ").trim().toLowerCase();
}

export function getEngagementCommentDuplicateKey(item: EngagementCommentMatrixItemLike): string | null {
  const metadataFingerprint = metadataString(item.metadata_json, "body_fingerprint");
  if (metadataFingerprint) return metadataFingerprint;

  const normalizedFingerprint = normalizeBodyFingerprint(item);
  return normalizedFingerprint.replace(/[|\s]/g, "") ? normalizedFingerprint : null;
}

export function isPublicEngagementComment(item: EngagementCommentMatrixItemLike): boolean {
  return (
    item.source_type === "public" ||
    item.source_type === "public_comment" ||
    metadataString(item.metadata_json, "submitted_via") === "public_portal"
  );
}

export function isInternalOrPrivateEngagementNote(item: EngagementCommentMatrixItemLike): boolean {
  const visibility = metadataString(item.metadata_json, "visibility")?.toLowerCase();
  if (
    visibility === "private" ||
    metadataBoolean(item.metadata_json, "private_note") ||
    metadataBoolean(item.metadata_json, "internal_note")
  ) {
    return true;
  }

  if (isPublicEngagementComment(item)) return false;

  return (
    item.source_type === "internal" ||
    item.source_type === "meeting" ||
    item.source_type === "email"
  );
}

export function isEngagementDuplicateReviewResolved(item: EngagementCommentMatrixItemLike): boolean {
  return /duplicate\s+(reviewed|resolved|cleared)|not\s+a\s+duplicate|canonical|merged/i.test(
    item.moderation_notes ?? ""
  );
}

function buildUnresolvedDuplicateIds(items: EngagementCommentMatrixItemLike[]): Set<string> {
  const duplicateGroups = new Map<string, EngagementCommentMatrixItemLike[]>();

  for (const item of items) {
    const key = getEngagementCommentDuplicateKey(item);
    if (!key) continue;
    duplicateGroups.set(key, [...(duplicateGroups.get(key) ?? []), item]);
  }

  const unresolvedDuplicateIds = new Set<string>();

  for (const group of duplicateGroups.values()) {
    const reviewableItems = group.filter((item) => item.status !== "rejected");
    if (reviewableItems.length <= 1) continue;

    const unresolvedItems = reviewableItems.filter((item) => !isEngagementDuplicateReviewResolved(item));
    if (unresolvedItems.length === 0) continue;

    for (const item of unresolvedItems) {
      unresolvedDuplicateIds.add(item.id);
    }
  }

  return unresolvedDuplicateIds;
}

function excerpt(value: string | null | undefined, maxLength = 150): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "No comment body provided.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function categoryLabelFor(
  categoryMap: Map<string, EngagementCommentMatrixCategoryLike>,
  categoryId: string | null | undefined
): string | null {
  if (!categoryId) return null;
  return categoryMap.get(categoryId)?.label ?? "Unlabeled category";
}

function matrixPostureFor(
  item: EngagementCommentMatrixItemLike,
  unresolvedDuplicateIds: Set<string>
): Pick<EngagementCommentMatrixPreviewRow, "posture" | "postureLabel" | "reason"> {
  const approved = item.status === "approved";
  const categorized = Boolean(item.category_id);
  const publicComment = isPublicEngagementComment(item);
  const internalOrPrivate = isInternalOrPrivateEngagementNote(item);

  if (approved && categorized && internalOrPrivate) {
    return {
      posture: "excluded_internal_private",
      postureLabel: "Excluded — internal/private note",
      reason: "Approved categorized item is retained for staff context, but excluded from the public-comment appendix matrix.",
    };
  }

  if (approved && categorized && publicComment && unresolvedDuplicateIds.has(item.id)) {
    return {
      posture: "held_duplicate_review",
      postureLabel: "Held for duplicate review",
      reason: "Approved public comment is duplicate-looking and needs staff review before appendix inclusion.",
    };
  }

  if (approved && categorized && publicComment) {
    return {
      posture: "included",
      postureLabel: "Included in matrix preview",
      reason: "Approved, categorized public comment with no unresolved duplicate hold.",
    };
  }

  return {
    posture: "excluded_not_ready",
    postureLabel: "Excluded — not appendix-ready",
    reason: approved
      ? "Item is not categorized as a public comment ready for appendix matrix use."
      : "Item is not approved for appendix matrix use.",
  };
}

function postureRank(posture: EngagementCommentMatrixPosture): number {
  if (posture === "included") return 0;
  if (posture === "held_duplicate_review") return 1;
  if (posture === "excluded_internal_private") return 2;
  return 3;
}

export function buildEngagementCommentMatrixPreview(
  categories: EngagementCommentMatrixCategoryLike[],
  items: EngagementCommentMatrixItemLike[],
  options?: { rowLimit?: number }
): EngagementCommentMatrixPreview {
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const unresolvedDuplicateIds = buildUnresolvedDuplicateIds(items);

  const rows = items
    .map((item): EngagementCommentMatrixPreviewRow => {
      const posture = matrixPostureFor(item, unresolvedDuplicateIds);
      return {
        itemId: item.id,
        title: item.title?.trim() || "Untitled comment",
        submittedBy: item.submitted_by?.trim() || null,
        sourceType: item.source_type ?? "internal",
        categoryLabel: categoryLabelFor(categoryMap, item.category_id),
        ...posture,
        bodyExcerpt: excerpt(item.body),
        updatedAt: item.updated_at ?? item.created_at ?? null,
      };
    })
    .sort((left, right) => {
      const postureDelta = postureRank(left.posture) - postureRank(right.posture);
      if (postureDelta !== 0) return postureDelta;

      const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : Number.NEGATIVE_INFINITY;
      const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : Number.NEGATIVE_INFINITY;
      return rightTime - leftTime;
    });

  const rowLimit = options?.rowLimit ?? rows.length;
  const previewRows = rows.slice(0, Math.max(0, rowLimit));

  return {
    caveat: ENGAGEMENT_COMMENT_MATRIX_CAVEAT,
    counts: {
      includedCount: rows.filter((row) => row.posture === "included").length,
      heldDuplicateReviewCount: rows.filter((row) => row.posture === "held_duplicate_review").length,
      excludedInternalPrivateCount: rows.filter((row) => row.posture === "excluded_internal_private").length,
      excludedNotReadyCount: rows.filter((row) => row.posture === "excluded_not_ready").length,
      previewedRowCount: previewRows.length,
      totalItemCount: items.length,
    },
    rows: previewRows,
  };
}

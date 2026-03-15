import { ENGAGEMENT_ITEM_SOURCE_TYPES, ENGAGEMENT_ITEM_STATUSES } from "@/lib/engagement/catalog";

type CategoryLike = {
  id: string;
  label?: string | null;
  slug?: string | null;
  description?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ItemLike = {
  id: string;
  campaign_id: string;
  category_id?: string | null;
  title?: string | null;
  body?: string | null;
  submitted_by?: string | null;
  status?: string | null;
  source_type?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  moderation_notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type RecentActivityWindow = {
  count: number;
  since: string;
};

type CategorySummary = {
  categoryId: string | null;
  label: string;
  slug: string | null;
  description: string | null;
  sortOrder: number | null;
  count: number;
  flaggedCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  lastActivityAt: string | null;
  shareOfItems: number;
};

type EngagementCounts = {
  totalItems: number;
  geolocatedItems: number;
  categorizedItems: number;
  uncategorizedItems: number;
  itemsWithModerationNotes: number;
  statusCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  categoryCounts: CategorySummary[];
  lastActivityAt: string | null;
  recentActivity: RecentActivityWindow;
};

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function makeStatusCounts() {
  return Object.fromEntries(ENGAGEMENT_ITEM_STATUSES.map((status) => [status, 0])) as Record<string, number>;
}

function makeSourceCounts() {
  return Object.fromEntries(ENGAGEMENT_ITEM_SOURCE_TYPES.map((source) => [source, 0])) as Record<string, number>;
}

export function summarizeEngagementItems(
  categories: CategoryLike[],
  items: ItemLike[],
  options?: { now?: Date; recentWindowDays?: number }
): EngagementCounts {
  const statusCounts = makeStatusCounts();
  const sourceCounts = makeSourceCounts();
  const now = options?.now ?? new Date();
  const recentWindowDays = options?.recentWindowDays ?? 7;
  const recentThreshold = now.getTime() - recentWindowDays * 24 * 60 * 60 * 1000;
  const categorySummaries = new Map<string, CategorySummary>();

  for (const category of categories) {
    categorySummaries.set(category.id, {
      categoryId: category.id,
      label: category.label ?? "Untitled category",
      slug: category.slug ?? null,
      description: category.description ?? null,
      sortOrder: category.sort_order ?? null,
      count: 0,
      flaggedCount: 0,
      pendingCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      lastActivityAt: null,
      shareOfItems: 0,
    });
  }

  let geolocatedItems = 0;
  let categorizedItems = 0;
  let itemsWithModerationNotes = 0;
  let lastActivityAt: string | null = null;
  let lastActivityTime: number | null = null;
  let recentActivityCount = 0;
  let uncategorizedLastActivityAt: string | null = null;
  let uncategorizedLastActivityTime: number | null = null;
  let uncategorizedFlaggedCount = 0;
  let uncategorizedPendingCount = 0;
  let uncategorizedApprovedCount = 0;
  let uncategorizedRejectedCount = 0;

  for (const item of items) {
    const status = item.status ?? "pending";
    const sourceType = item.source_type ?? "internal";
    const activityAt = item.updated_at ?? item.created_at ?? null;
    const activityTime = parseTimestamp(activityAt);

    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    sourceCounts[sourceType] = (sourceCounts[sourceType] ?? 0) + 1;

    if (typeof item.latitude === "number" && typeof item.longitude === "number") {
      geolocatedItems += 1;
    }

    if (item.moderation_notes?.trim()) {
      itemsWithModerationNotes += 1;
    }

    if (activityTime !== null && activityTime >= recentThreshold) {
      recentActivityCount += 1;
    }

    if (activityTime !== null && (lastActivityTime === null || activityTime > lastActivityTime)) {
      lastActivityTime = activityTime;
      lastActivityAt = activityAt;
    }

    if (!item.category_id) {
      if (status === "flagged") uncategorizedFlaggedCount += 1;
      if (status === "pending") uncategorizedPendingCount += 1;
      if (status === "approved") uncategorizedApprovedCount += 1;
      if (status === "rejected") uncategorizedRejectedCount += 1;
      if (activityTime !== null && (uncategorizedLastActivityTime === null || activityTime > uncategorizedLastActivityTime)) {
        uncategorizedLastActivityTime = activityTime;
        uncategorizedLastActivityAt = activityAt;
      }
      continue;
    }

    categorizedItems += 1;

    const categorySummary = categorySummaries.get(item.category_id);
    if (!categorySummary) {
      continue;
    }

    categorySummary.count += 1;
    if (status === "flagged") categorySummary.flaggedCount += 1;
    if (status === "pending") categorySummary.pendingCount += 1;
    if (status === "approved") categorySummary.approvedCount += 1;
    if (status === "rejected") categorySummary.rejectedCount += 1;

    if (activityTime !== null) {
      const currentCategoryActivity = parseTimestamp(categorySummary.lastActivityAt);
      if (currentCategoryActivity === null || activityTime > currentCategoryActivity) {
        categorySummary.lastActivityAt = activityAt;
      }
    }
  }

  const totalItems = items.length;
  const uncategorizedItems = totalItems - categorizedItems;
  const categoryCounts = [
    ...Array.from(categorySummaries.values()).map((summary) => ({
      ...summary,
      shareOfItems: totalItems > 0 ? summary.count / totalItems : 0,
    })),
    {
      categoryId: null,
      label: "Uncategorized",
      slug: null,
      description: "Items still need category assignment before downstream reporting can rely on them.",
      sortOrder: null,
      count: uncategorizedItems,
      flaggedCount: uncategorizedFlaggedCount,
      pendingCount: uncategorizedPendingCount,
      approvedCount: uncategorizedApprovedCount,
      rejectedCount: uncategorizedRejectedCount,
      lastActivityAt: uncategorizedLastActivityAt,
      shareOfItems: totalItems > 0 ? uncategorizedItems / totalItems : 0,
    },
  ];

  return {
    totalItems,
    geolocatedItems,
    categorizedItems,
    uncategorizedItems,
    itemsWithModerationNotes,
    statusCounts,
    sourceCounts,
    categoryCounts,
    lastActivityAt,
    recentActivity: {
      count: recentActivityCount,
      since: new Date(recentThreshold).toISOString(),
    },
  };
}

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
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
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

type SourceSummary = {
  sourceType: string;
  count: number;
  geolocatedCount: number;
  nonGeolocatedCount: number;
  categorizedCount: number;
  flaggedCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  lastActivityAt: string | null;
  shareOfItems: number;
};

type ModerationQueueSummary = {
  pendingCount: number;
  flaggedCount: number;
  actionableCount: number;
  uncategorizedCount: number;
  itemsWithNotesCount: number;
  triagedCount: number;
  triagedShare: number;
  approvedCount: number;
  rejectedCount: number;
  readyForHandoffCount: number;
};

type GeographyCoverageSummary = {
  geolocatedItems: number;
  nonGeolocatedItems: number;
  geolocatedShare: number;
};

type EngagementCounts = {
  totalItems: number;
  geolocatedItems: number;
  nonGeolocatedItems: number;
  categorizedItems: number;
  uncategorizedItems: number;
  itemsWithModerationNotes: number;
  statusCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  categoryCounts: CategorySummary[];
  sourceSummaries: SourceSummary[];
  moderationQueue: ModerationQueueSummary;
  geographyCoverage: GeographyCoverageSummary;
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
  const recentStatusCounts = makeStatusCounts();
  const recentSourceCounts = makeSourceCounts();
  const now = options?.now ?? new Date();
  const recentWindowDays = options?.recentWindowDays ?? 7;
  const recentThreshold = now.getTime() - recentWindowDays * 24 * 60 * 60 * 1000;
  const categorySummaries = new Map<string, CategorySummary>();
  const sourceSummaries = new Map<string, SourceSummary>();

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

  for (const sourceType of ENGAGEMENT_ITEM_SOURCE_TYPES) {
    sourceSummaries.set(sourceType, {
      sourceType,
      count: 0,
      geolocatedCount: 0,
      nonGeolocatedCount: 0,
      categorizedCount: 0,
      flaggedCount: 0,
      pendingCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      lastActivityAt: null,
      shareOfItems: 0,
    });
  }

  for (const item of items) {
    const status = item.status ?? "pending";
    const sourceType = item.source_type ?? "internal";
    const activityAt = item.updated_at ?? item.created_at ?? null;
    const activityTime = parseTimestamp(activityAt);
    const isGeolocated = typeof item.latitude === "number" && typeof item.longitude === "number";
    const sourceSummary =
      sourceSummaries.get(sourceType) ??
      {
        sourceType,
        count: 0,
        geolocatedCount: 0,
        nonGeolocatedCount: 0,
        categorizedCount: 0,
        flaggedCount: 0,
        pendingCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        lastActivityAt: null,
        shareOfItems: 0,
      };

    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    sourceCounts[sourceType] = (sourceCounts[sourceType] ?? 0) + 1;
    sourceSummary.count += 1;
    if (status === "flagged") sourceSummary.flaggedCount += 1;
    if (status === "pending") sourceSummary.pendingCount += 1;
    if (status === "approved") sourceSummary.approvedCount += 1;
    if (status === "rejected") sourceSummary.rejectedCount += 1;

    if (isGeolocated) {
      geolocatedItems += 1;
      sourceSummary.geolocatedCount += 1;
    } else {
      sourceSummary.nonGeolocatedCount += 1;
    }

    if (item.moderation_notes?.trim()) {
      itemsWithModerationNotes += 1;
    }

    if (activityTime !== null && activityTime >= recentThreshold) {
      recentActivityCount += 1;
      recentStatusCounts[status] = (recentStatusCounts[status] ?? 0) + 1;
      recentSourceCounts[sourceType] = (recentSourceCounts[sourceType] ?? 0) + 1;
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
      if (activityTime !== null) {
        const currentSourceActivity = parseTimestamp(sourceSummary.lastActivityAt);
        if (currentSourceActivity === null || activityTime > currentSourceActivity) {
          sourceSummary.lastActivityAt = activityAt;
        }
      }
      sourceSummaries.set(sourceType, sourceSummary);
      continue;
    }

    categorizedItems += 1;
    sourceSummary.categorizedCount += 1;

    const categorySummary = categorySummaries.get(item.category_id);
    if (!categorySummary) {
      if (activityTime !== null) {
        const currentSourceActivity = parseTimestamp(sourceSummary.lastActivityAt);
        if (currentSourceActivity === null || activityTime > currentSourceActivity) {
          sourceSummary.lastActivityAt = activityAt;
        }
      }
      sourceSummaries.set(sourceType, sourceSummary);
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

      const currentSourceActivity = parseTimestamp(sourceSummary.lastActivityAt);
      if (currentSourceActivity === null || activityTime > currentSourceActivity) {
        sourceSummary.lastActivityAt = activityAt;
      }
    }

    sourceSummaries.set(sourceType, sourceSummary);
  }

  const totalItems = items.length;
  const nonGeolocatedItems = totalItems - geolocatedItems;
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
  const sourceSummaryList = Array.from(sourceSummaries.values()).map((summary) => ({
    ...summary,
    shareOfItems: totalItems > 0 ? summary.count / totalItems : 0,
  }));
  const triagedCount = statusCounts.approved + statusCounts.rejected;
  const readyForHandoffCount = categoryCounts
    .filter((category) => category.categoryId !== null)
    .reduce((sum, category) => sum + category.approvedCount, 0);

  return {
    totalItems,
    geolocatedItems,
    nonGeolocatedItems,
    categorizedItems,
    uncategorizedItems,
    itemsWithModerationNotes,
    statusCounts,
    sourceCounts,
    categoryCounts,
    sourceSummaries: sourceSummaryList,
    moderationQueue: {
      pendingCount: statusCounts.pending,
      flaggedCount: statusCounts.flagged,
      actionableCount: statusCounts.pending + statusCounts.flagged,
      uncategorizedCount: uncategorizedItems,
      itemsWithNotesCount: itemsWithModerationNotes,
      triagedCount,
      triagedShare: totalItems > 0 ? triagedCount / totalItems : 0,
      approvedCount: statusCounts.approved,
      rejectedCount: statusCounts.rejected,
      readyForHandoffCount,
    },
    geographyCoverage: {
      geolocatedItems,
      nonGeolocatedItems,
      geolocatedShare: totalItems > 0 ? geolocatedItems / totalItems : 0,
    },
    lastActivityAt,
    recentActivity: {
      count: recentActivityCount,
      since: new Date(recentThreshold).toISOString(),
      byStatus: recentStatusCounts,
      bySource: recentSourceCounts,
    },
  };
}

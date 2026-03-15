export const ENGAGEMENT_CAMPAIGN_STATUSES = ["draft", "active", "closed", "archived"] as const;
export const ENGAGEMENT_TYPES = ["map_feedback", "comment_collection", "meeting_intake"] as const;
export const ENGAGEMENT_ITEM_STATUSES = ["pending", "approved", "rejected", "flagged"] as const;
export const ENGAGEMENT_ITEM_SOURCE_TYPES = ["internal", "public", "meeting", "email"] as const;

export type EngagementCampaignStatus = (typeof ENGAGEMENT_CAMPAIGN_STATUSES)[number];
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];
export type EngagementItemStatus = (typeof ENGAGEMENT_ITEM_STATUSES)[number];
export type EngagementItemSourceType = (typeof ENGAGEMENT_ITEM_SOURCE_TYPES)[number];

export function titleizeEngagementValue(value: string | null | undefined): string {
  if (!value) return "Unknown";

  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function normalizeEngagementSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

  return normalized || "engagement-category";
}

export function makeEngagementCategorySlug(label: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `${normalizeEngagementSlug(label)}-${suffix}`;
}

export function engagementStatusTone(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "active" || status === "approved") return "success";
  if (status === "closed" || status === "flagged") return "warning";
  if (status === "rejected") return "danger";
  if (status === "draft" || status === "pending" || status === "archived") return "neutral";
  return "neutral";
}

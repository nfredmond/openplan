import type { SupabaseClient } from "@supabase/supabase-js";
import type { EngagementSynthesis } from "./ai-synthesis";

// "You said / We did" close-the-loop entries. OPERATOR-authored narrative
// (mirrors engagement_categories posture): workspace members read/write via RLS;
// the public portal reads status='published' rows only, via the service-role SSR
// client. There is NO public/anon write path, so this file is not subject to the
// survey reader-inventory confinement guard (those tables hold public-submitted
// data; these do not).

type QueryClient = Pick<SupabaseClient, "from">;

export type CloseLoopStatus = "draft" | "published";

export type CloseLoopEntryRow = {
  id: string;
  campaign_id: string;
  category_id: string | null;
  theme_title: string;
  you_said: string;
  we_did: string;
  status: CloseLoopStatus;
  ai_assisted: boolean;
  source_item_ids: string[];
  sort_order: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export const CLOSE_LOOP_ENTRY_COLUMNS =
  "id, campaign_id, category_id, theme_title, you_said, we_did, status, ai_assisted, source_item_ids, sort_order, published_at, created_at, updated_at";

/** All entries for a campaign (operator builder view), ordered for display. */
export async function loadCloseLoopEntries(supabase: QueryClient, campaignId: string): Promise<CloseLoopEntryRow[]> {
  const { data } = await supabase
    .from("engagement_closeloop_entries")
    .select(CLOSE_LOOP_ENTRY_COLUMNS)
    .eq("campaign_id", campaignId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []) as CloseLoopEntryRow[];
}

/** Published entries only — the public portal read (service-role, campaign-scoped). */
export async function loadPublishedCloseLoopEntries(supabase: QueryClient, campaignId: string): Promise<CloseLoopEntryRow[]> {
  const { data } = await supabase
    .from("engagement_closeloop_entries")
    .select(CLOSE_LOOP_ENTRY_COLUMNS)
    .eq("campaign_id", campaignId)
    .eq("status", "published")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []) as CloseLoopEntryRow[];
}

// ── AI draft-assist (never auto-published) ───────────────────────────────────

export type CloseLoopDraft = {
  themeTitle: string;
  youSaid: string;
  sourceItemIds: string[]; // real engagement_items ids, provenance for the draft
};

/** Strip the `item_` grounding prefix (see ai-synthesis.itemFactId) → raw id. */
function factIdToItemId(factId: string): string {
  return factId.startsWith("item_") ? factId.slice("item_".length) : factId;
}

/**
 * Map an engagement synthesis into draft close-loop entries. Pure: the operator
 * reviews and edits each draft (and writes the "we did" side) before anything is
 * created — nothing here publishes. Empty-theme synthesis yields no drafts.
 */
export function buildCloseLoopDraftsFromSynthesis(synthesis: EngagementSynthesis): CloseLoopDraft[] {
  return synthesis.themes
    .filter((theme) => theme.label.trim().length > 0)
    .map((theme) => ({
      themeTitle: theme.label.trim(),
      youSaid: theme.summary.trim(),
      sourceItemIds: theme.fact_ids.map(factIdToItemId).filter((id) => id.length > 0),
    }));
}

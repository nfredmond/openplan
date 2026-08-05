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

/**
 * The entries, and the error that produced them.
 *
 * A READ THAT FAILED AND AN AGENCY THAT NEVER CLOSED THE LOOP ARE DIFFERENT
 * FACTS, and this is the one place in the engagement lane where confusing them
 * damages the agency rather than the resident. `loadPublishedCloseLoopEntries`
 * used to answer `data ?? []` for both, and the public portal hides the
 * "You said / We did" tab entirely when the list is empty — so a dropped column
 * or a permission change made an agency that DID answer its community look like
 * one that never bothered. Nothing on the page said a query had failed, because
 * nothing downstream still knew.
 *
 * `{ rows, error }` is the shape this repo has settled on for a loader seam
 * (`loadOpportunityPursuitContext`, `loadApprovedSurveyAnswers`,
 * `loadSurveyDefinition`): the library neither swallows nor throws, and the
 * caller decides whether it is a page that discloses or a route that answers a
 * status.
 */
export type CloseLoopEntriesResult = {
  rows: CloseLoopEntryRow[];
  error: { message: string } | null;
};

/**
 * All entries for a campaign (operator builder view), ordered for display.
 *
 * STILL SWALLOWS ITS ERROR, and that is not an endorsement — see the header of
 * `CloseLoopEntriesResult`. Its three callers (the operator campaign page, the
 * operator close-loop API route, and `close-loop.test.ts`) are outside the lane
 * that fixed the public read, and changing this signature would break their
 * build with nobody able to repair it in the same change. The operator harm is
 * real but lesser: a planner shown an empty builder over a failed read may
 * re-author entries that already exist. Give it the same `{ rows, error }` seam
 * and update those three call sites.
 */
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
export async function loadPublishedCloseLoopEntries(
  supabase: QueryClient,
  campaignId: string
): Promise<CloseLoopEntriesResult> {
  const result = await supabase
    .from("engagement_closeloop_entries")
    .select(CLOSE_LOOP_ENTRY_COLUMNS)
    .eq("campaign_id", campaignId)
    .eq("status", "published")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return {
    // A failed read carries no rows, so the empty array is the absence of an
    // ANSWER here, never the answer "there are none" — which is exactly what the
    // `error` beside it exists to tell the caller.
    rows: (result.data ?? []) as CloseLoopEntryRow[],
    error: result.error ?? null,
  };
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

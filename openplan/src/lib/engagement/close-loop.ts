import { z } from "zod";
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

export const closeLoopEntrySchema = z.object({
  id: z.string().min(1),
  campaign_id: z.string().min(1),
  category_id: z.string().nullable(),
  theme_title: z.string(),
  you_said: z.string(),
  we_did: z.string(),
  status: z.enum(["draft", "published"]),
  ai_assisted: z.boolean(),
  source_item_ids: z.array(z.string()),
  sort_order: z.number().int(),
  published_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CloseLoopEntryRow = z.infer<typeof closeLoopEntrySchema>;

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

/** Staff responses for the builder, retaining read failures separately from an empty result. */
export async function loadCloseLoopEntries(supabase: QueryClient, campaignId: string): Promise<CloseLoopEntriesResult> {
  const { data, error } = await supabase
    .from("engagement_closeloop_entries")
    .select(CLOSE_LOOP_ENTRY_COLUMNS)
    .eq("campaign_id", campaignId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return { rows: error ? [] : (data ?? []) as CloseLoopEntryRow[], error: error ?? null };
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

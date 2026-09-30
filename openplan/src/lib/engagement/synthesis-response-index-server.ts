import type { SupabaseClient } from "@supabase/supabase-js";
import { SynthesisResponseLinkError } from "./synthesis-response-links-server";
import { readSynthesisResponseLinkIndex, synthesisResponseLinkReviewSchema } from "./synthesis-response-index";

/** Staff navigation includes retained addresses after live responses or review groups disappear. */
export async function loadSynthesisResponseLinkIndex(client: Pick<SupabaseClient, "rpc">, rawScope: unknown) {
  const parsed = synthesisResponseLinkReviewSchema.safeParse(rawScope);
  if (!parsed.success) throw new SynthesisResponseLinkError("invalid", "Select the retained staff review");
  try {
    const result = await client.rpc("list_engagement_synthesis_response_links", { p_campaign: parsed.data.campaignId, p_review: parsed.data.reviewId });
    if (result.error) throw new SynthesisResponseLinkError(result.error.code === "42501" ? "forbidden" : "unavailable", "The retained response link index could not be read");
    if (result.data === null) return null;
    return readSynthesisResponseLinkIndex(result.data, parsed.data);
  } catch (error) {
    if (error instanceof SynthesisResponseLinkError) throw error;
    throw new SynthesisResponseLinkError("unavailable", "The retained response link index could not be verified");
  }
}

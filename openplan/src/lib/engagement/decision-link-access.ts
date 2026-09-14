import { createClient } from "@/lib/supabase/server";
import { loadCampaignAccess } from "./api";
import { decisionLinkFailure } from "./decision-links-server";

/** Read the current signed-in staff scope; never select a workspace from a client body. */
export async function decisionLinkAccess(campaignId: string) {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return { allowed: false as const, error: { kind: "forbidden", status: 401, message: "Sign in to use decision links." } };
  const access = await loadCampaignAccess(client, campaignId, user.id, "engagement.write");
  if (access.error) return { allowed: false as const, error: decisionLinkFailure() };
  if (!access.campaign || !access.allowed) return { allowed: false as const, error: decisionLinkFailure("42501") };
  return { allowed: true as const, client, scope: { campaignId, workspaceId: access.campaign.workspace_id, actorId: user.id } };
}

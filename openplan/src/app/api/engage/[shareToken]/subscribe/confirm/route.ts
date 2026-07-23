import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { confirmSubscription } from "@/lib/notifications/engagement";

function htmlPage(title: string, message: string): Response {
  const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1f2937"><h1 style="font-size:1.25rem">${escape(title)}</h1><p style="color:#4b5563">${escape(message)}</p></body></html>`;
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

type RouteContext = { params: Promise<{ shareToken: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { shareToken } = await context.params;
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!shareToken || shareToken.length < 8 || !token) {
    return htmlPage("Invalid confirmation link", "This confirmation link is missing or malformed.");
  }

  const supabase = createServiceRoleClient();
  const { data: campaign } = await supabase
    .from("engagement_campaigns")
    .select("id, title")
    .eq("share_token", shareToken)
    .maybeSingle();
  if (!campaign) {
    return htmlPage("Confirmation link expired", "We couldn't find that campaign. The link may have expired.");
  }

  const result = await confirmSubscription(supabase, { campaignId: campaign.id, token });
  if (!result.found) {
    return htmlPage("Confirmation link not recognized", "This link is no longer valid. It may already have been used.");
  }
  return htmlPage("You're subscribed", `You'll now receive email updates for "${campaign.title}". You can unsubscribe from any update email.`);
}

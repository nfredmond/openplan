import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { unsubscribeByToken } from "@/lib/notifications/engagement";

function htmlPage(title: string, message: string): Response {
  const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1f2937"><h1 style="font-size:1.25rem">${escape(title)}</h1><p style="color:#4b5563">${escape(message)}</p></body></html>`;
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

type RouteContext = { params: Promise<{ shareToken: string }> };

export async function GET(request: NextRequest, _context: RouteContext) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!token) {
    return htmlPage("Invalid unsubscribe link", "This unsubscribe link is missing its token.");
  }

  // Unsubscribe works on the token alone (no campaign/status gate) so it always
  // honors the request, even for a paused campaign.
  const supabase = createServiceRoleClient();
  const result = await unsubscribeByToken(supabase, token);
  if (!result.found) {
    return htmlPage("Already unsubscribed", "This link is no longer active — you may already be unsubscribed.");
  }
  return htmlPage("You're unsubscribed", "You will no longer receive email updates for this campaign.");
}

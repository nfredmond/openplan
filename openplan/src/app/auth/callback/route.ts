import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";

/**
 * Supabase auth callback — the code-exchange route every emailed link lands on.
 *
 * WHY THIS EXISTS. The app had no callback route at all, so nothing ever called
 * `exchangeCodeForSession`. Under Supabase's default PKCE settings that means a
 * password-reset link, an email-confirmation link, or a magic link could be sent
 * but never completed: the user clicked through and arrived with a `code` that
 * nothing redeemed. A forgotten password was a permanent lockout, which is
 * disqualifying for a product any agency is meant to run unaided.
 *
 * The route is deliberately generic — it redeems the code and forwards to
 * whatever `next` path the flow asked for — so confirmation and invite flows can
 * use it without another bespoke endpoint.
 */

/** Only same-origin app paths, so `next` cannot be turned into an open redirect. */
function safeNextPath(raw: string | null): string {
  if (!raw) return "/dashboard";
  // Reject protocol-relative ("//evil.com") and absolute URLs outright.
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("auth.callback", request);
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));

  // Supabase reports link failures (expired, already used) on the redirect
  // itself. Surface them to the user instead of bouncing to a bare sign-in page
  // that gives no hint why the link did not work.
  const errorDescription = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (errorDescription) {
    audit.warn("auth_callback_provider_error", { error: errorDescription });
    const failed = url.clone();
    failed.pathname = "/sign-in";
    failed.search = "";
    failed.searchParams.set("auth_error", errorDescription);
    return NextResponse.redirect(failed);
  }

  if (!code) {
    const failed = url.clone();
    failed.pathname = "/sign-in";
    failed.search = "";
    failed.searchParams.set("auth_error", "This link is missing its verification code.");
    return NextResponse.redirect(failed);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    audit.warn("auth_callback_exchange_failed", { message: error.message });
    const failed = url.clone();
    failed.pathname = "/sign-in";
    failed.search = "";
    // Supabase's own message distinguishes expired from already-used links,
    // which is exactly what the user needs in order to know to request another.
    failed.searchParams.set("auth_error", error.message);
    return NextResponse.redirect(failed);
  }

  audit.info("auth_callback_exchanged", { next });
  const destination = url.clone();
  destination.pathname = next;
  destination.search = "";
  return NextResponse.redirect(destination);
}

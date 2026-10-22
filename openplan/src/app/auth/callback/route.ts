import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { resolveCallbackDestination, safeNextPath } from "@/lib/auth/callback-destination";
import { classifyAuthLinkError, type AuthLinkError } from "@/lib/auth/link-errors";

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
 *
 * A code only redeems in the browser that asked for the link, because the PKCE
 * verifier lives in that browser's cookies. Emails whose template links to
 * /auth/confirm work on any device; this route stays for links already sent.
 */

function signInWithError(url: NextRequest["nextUrl"], reason: AuthLinkError) {
  const failed = url.clone();
  failed.pathname = "/sign-in";
  failed.search = "";
  failed.hash = "";
  failed.searchParams.set("auth_error", reason);
  return NextResponse.redirect(failed);
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("auth.callback", request);
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));

  // Supabase reports link failures (expired, already used) on the redirect
  // itself. Explain them instead of bouncing to a bare sign-in page, but send
  // only a fixed reason code: the provider's text stays in the audit log.
  const errorDescription = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (errorDescription) {
    audit.warn("auth_callback_provider_error", { error: errorDescription });
    return signInWithError(
      url,
      classifyAuthLinkError({ code: url.searchParams.get("error_code"), message: errorDescription }),
    );
  }

  if (!code) return signInWithError(url, "incomplete");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    audit.warn("auth_callback_exchange_failed", { message: error.message });
    return signInWithError(url, classifyAuthLinkError({ code: error.code, message: error.message }));
  }

  audit.info("auth_callback_exchanged", { next });
  return NextResponse.redirect(resolveCallbackDestination(next, url.origin));
}

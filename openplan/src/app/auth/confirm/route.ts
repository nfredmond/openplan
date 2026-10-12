import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { confirmDestination } from "@/lib/auth/callback-destination";
import { classifyAuthLinkError, type AuthLinkError } from "@/lib/auth/link-errors";

/**
 * Email-link confirmation that works on any device.
 *
 * The /auth/callback route redeems a PKCE code, and that code only redeems in
 * the browser that asked for the email: a planner who requests a reset on a
 * desktop and opens the email on a phone gets a dead link. The email templates
 * link here instead, with a one-time token hash that `verifyOtp` checks on the
 * server, so any browser can finish the step.
 *
 * The templates pass `next={{ .RedirectTo }}`; `confirmDestination` keeps only
 * its same-origin app path.
 */

const LINK_TYPES: readonly EmailOtpType[] = ["signup", "email", "recovery", "invite", "magiclink", "email_change"];

function isLinkType(value: string | null): value is EmailOtpType {
  return value !== null && (LINK_TYPES as readonly string[]).includes(value);
}

function signInWithError(url: NextRequest["nextUrl"], reason: AuthLinkError) {
  const failed = url.clone();
  failed.pathname = "/sign-in";
  failed.search = "";
  failed.hash = "";
  failed.searchParams.set("auth_error", reason);
  return NextResponse.redirect(failed);
}

export async function GET(request: NextRequest) {
  const audit = createApiAuditLogger("auth.confirm", request);
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (!tokenHash || !isLinkType(type)) return signInWithError(url, "incomplete");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    audit.warn("auth_confirm_failed", { type, message: error.message });
    return signInWithError(url, classifyAuthLinkError({ code: error.code, message: error.message }));
  }

  const destination = confirmDestination(url.searchParams.get("next"), url.origin);
  audit.info("auth_confirm_verified", { type, next: destination.pathname });
  return NextResponse.redirect(destination);
}

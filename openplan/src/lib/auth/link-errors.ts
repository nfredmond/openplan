/**
 * Why an emailed sign-in link failed, as a fixed code the sign-in page can explain.
 *
 * The callback used to forward the provider's `error_description` text into the
 * sign-in URL, and the page printed whatever arrived. Anyone could then send a
 * real OpenPlan link that displays words of their choosing ("call this number").
 * Only these codes travel in the URL now; the page maps each to its own copy and
 * treats anything else as a plain failure.
 */

export type AuthLinkError = "expired" | "incomplete" | "other-browser" | "failed";

const MESSAGES: Record<AuthLinkError, string> = {
  expired: "This link has expired or was already used. If you asked for another link, use the newest email.",
  incomplete: "This link is incomplete. Open it straight from the email, or ask for a new one.",
  "other-browser": "Open the link in the browser where you asked for it, or ask for a new one.",
  failed: "This link did not work. Ask for a new one.",
};

export function isAuthLinkError(value: string | null): value is AuthLinkError {
  return value !== null && Object.prototype.hasOwnProperty.call(MESSAGES, value);
}

/** Copy for the sign-in notice. Unknown or hand-typed values get the generic line. */
export function authLinkErrorMessage(value: string | null): string | null {
  if (value === null || value === "") return null;
  return MESSAGES[isAuthLinkError(value) ? value : "failed"];
}

/**
 * Classify a provider failure. Supabase sends `error_code=otp_expired` on the
 * redirect for an expired or used link; a code exchange without its verifier
 * (the link opened in another browser) reports `pkce_code_verifier_not_found`.
 */
export function classifyAuthLinkError(input: { code?: string | null; message?: string | null }): AuthLinkError {
  const code = input.code?.toLowerCase() ?? "";
  const message = input.message?.toLowerCase() ?? "";
  if (code === "otp_expired" || code === "flow_state_expired" || /expired|already been used|invalid or has/.test(message)) {
    return "expired";
  }
  if (code === "pkce_code_verifier_not_found" || code === "bad_code_verifier" || /code verifier/.test(message)) {
    return "other-browser";
  }
  return "failed";
}

/**
 * Whether a password-reset request error must look exactly like success.
 *
 * Supabase answers an unknown address with success and sends nothing. For a
 * real account it refuses a second request inside the mail interval
 * (`smtp_max_frequency`, 60 seconds on the hosted project) with HTTP 429. If
 * the page showed that refusal, two quick requests would tell anyone whether an
 * address has an account. Unknown-user and rate-limit replies therefore show
 * the same "check your email" notice; a network or server failure still shows,
 * because the person can act on it.
 */
export function recoveryErrorLooksLikeSuccess(error: { message: string; status?: number; code?: string }): boolean {
  if (error.status === 429) return true;
  if (error.code && /rate_limit/i.test(error.code)) return true;
  return /user not found|invalid|rate limit|security purposes/i.test(error.message);
}

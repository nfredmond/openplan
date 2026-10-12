# Hosted review follow-up, October 12, 2026

This record closes out the medium and low findings of the independent review
of the hosted relaunch (`$HOME/.local/state/openplan/hosted-relaunch-audit-20261010/OPUS_REVIEW.md`)
and records the first live signup on the hosted site. The blocker and high
findings are in [the October 12 review fixes](../2026-10-12-hosted-review-fixes/STATUS.md).

## Live signup on the hosted site

Nathaniel approved one synthetic account. It used a plus-address on his own
Gmail account, which the Gmail connector could read. The raw email and links
are not kept. Screenshots that show the address stay in private custody;
the two here show none.

| UTC time | Step | Result |
|---|---|---|
| 02:57:58 | Sign up at 390px, production `c03788c` | `POST /auth/v1/signup` 200. "Confirm your email to finish" notice with the spam hint. No horizontal overflow at 390px or 1440px. No console errors. |
| 02:57:59 | First confirmation email | Gmail Inbox, Updates tab. SPF, DKIM (`natfordplanning.com`, selector `resend`) and DMARC pass. Sender `openplan@natfordplanning.com` through Amazon SES. |
| 02:59:07 | "Send the link again" after 65 seconds | `POST /auth/v1/resend` 200, then "A new link is on its way." The Auth record's `confirmation_sent_at` moved to 02:59:06. |
| 03:01:16 | Open the first link in the same browser | 303 from Supabase, 307 from `/auth/callback`, 200 on sign-in with "Email link is invalid or has expired." |
| 06:55:06 | PR 246 live (`4635b8d`) | `/auth/confirm` without a token returns 307 to `sign-in?auth_error=incomplete`. The served CSP names only the project host. |
| 06:55:15 | Hosted email templates switched | Confirmation and recovery templates link to `/auth/confirm?token_hash=...` (Management API, HTTP 200; no other Auth setting changed). |
| 06:55:29 | Reset requested at 390px | Supabase logs `user_recovery_requested` and a 0.93-second send. |
| 06:56:08 | M-2 probe | Second request for the real account inside 60 seconds: HTTP 429 `over_email_send_rate_limit`. Unknown address, twice: HTTP 200. The page shows the same "Check your email" notice for all four. |
| 06:57:31 | Recovery link opened in a second browser profile that never requested it, at 1440px | 307 from `/auth/confirm`, 200 on `/reset-password`. New password saved, then the dashboard. The account became confirmed at this step. No console errors, no overflow. |
| 06:58:02 | Sign out at 1440px | Lands on `/`; `/dashboard` then redirects to sign-in. |
| 06:58:07 | Sign in with the new password at 390px, first browser | Dashboard, no overflow. Sign-out through the More menu works. |
| 07:00 | Cleanup | Account and its empty workspace deleted (Nathaniel approved); the user lookup returns 404. Browser profiles removed. |

Findings from the journey:

- **The resend voids the first link.** Supabase issues a new token on resend.
  A person who opens the first email gets an error. The sign-up note now says
  only the newest link works (PR 246).
- **L-1 is real.** The sign-in page printed the provider's text from the URL
  (screenshot `05-first-link-after-resend-390.png`). Fixed in PR 246.
- **Only the first email was seen in the inbox.** Supabase logs show the resent
  confirmation (02:59) and the reset (06:55) handed to the mail server, each in
  under a second. The Gmail connector returned neither, and Nathaniel was not
  available to look. Their delivery and Inbox or Spam placement are
  unconfirmed.
- **How the recovery link was made.** Because the emailed reset could not be
  read, the recovery link came from the Auth admin API (`generate_link`, type
  `recovery`), which sends no email and returns the same token hash the
  template uses. Opening it in a browser that never asked for it proves the
  route and `verifyOtp` work across devices. It does not prove the email
  template renders the link; that rests on the template text read back after
  the change.
- **The API still answers differently.** The page no longer reveals whether an
  address has an account, but a script calling Supabase's `/auth/v1/recover`
  directly still sees 429 for a real account and 200 for an unknown one inside
  the 60-second interval. CAPTCHA (M-3) would raise the cost of that probe.
- Screenshots that show the address stay in private custody.

## Findings

| Finding | Status | Where |
|---|---|---|
| M-1 links work in one browser only | Fixed. PR 246 live; templates switched; cross-browser recovery passed on production | `openplan/src/app/auth/confirm/route.ts` |
| M-2 reset reveals accounts | Fixed on the page, PR 246, probed live. A direct API call still differs (see above). | `openplan/src/lib/auth/recovery-reply.ts` |
| M-3 auth email allowance | Open: Nathaniel's decision. See below. | |
| M-4 readiness flag set before review | Marked superseded in place | packet `SUPERSEDED_2026-10-12.md` |
| M-5 "fresh" items on older builds | Date-labeled: the OCR evidence ran on `8e721db` and the worker delivery evidence in the a873b era. No current-build rerun. | packet `SUPERSEDED_2026-10-12.md` |
| M-6 generated URLs reachable | Confirmed, open: needs Vercel dashboard. See below. | |
| M-7 cost limit unproved | Partly recorded, open: needs dashboards. See below. | |
| M-8 rate limiter fails open | Fixed, PR 248 (merged as `76af0b4`): chat reserves usage before dispatch; fails closed when the shared key pays. The check and insert are not atomic. | `openplan/src/lib/runtime/ai-rate-limit.ts` |
| M-9 "today" is UTC | Fixed, PR 248 (merged as `76af0b4`): the browser's validated IANA zone, else UTC with that stated. Workspaces store no zone. | `openplan/src/lib/work/deadlines.ts` |
| M-10 one-character edit accepts draft | Fixed, PR 248 (merged as `76af0b4`): each flagged sentence must be reworded or removed (422 otherwise) | narrative-draft route |
| M-11 rollback target predates schema | Fixed in docs | [hosted recovery](../../../openplan/docs/ops/HOSTED_RECOVERY.md#roll-back-the-hosted-app) |
| L-1 provider text on sign-in | Fixed, PR 246 (merged as `4635b8d`) | `openplan/src/lib/auth/link-errors.ts` |
| L-2 loose CSP | `connect-src` and `img-src` pinned, PR 246. `'unsafe-inline' 'unsafe-eval'` in `script-src` remain; a nonce-based policy is separate work. | `openplan/next.config.ts` |
| L-3 subscribe leak | Fixed, PR 246 (merged as `4635b8d`) | subscribe route |
| L-4 signed-link redirects cacheable | Fixed, PR 248 (merged as `76af0b4`): seven routes use `signedStorageRedirect` (`private, no-store`), with a guard | `openplan/src/lib/http/signed-redirect.ts` |
| L-5 key ciphertext not bound | Fixed, PR 248 (merged as `76af0b4`): new saves write `v3` with the workspace ID as AAD; `v1` and `v2` still read; an old `v2` row stays unbound until re-saved | `openplan/src/lib/integrations/key-crypto.ts` |
| L-6 worker shutdown signal | Fixed, PR 249 (merged as `eed8580`; the Railway application-workers image on `7fe78d3` started all seven pollers): `setpriv` keeps the supervisor as PID 1; local Docker showed `runuser` killing it after about 2 seconds | `workers/hosted-node/Dockerfile` |
| L-7 Railway gaps | Watch paths recorded below; stale services await Nathaniel | |
| L-8 narrow equivalence proofs | No change. The review's full-tree diff found nothing escaped. | |
| L-9 route checker absent | Located and hashed; stays private because it reads QA credentials | packet `SUPERSEDED_2026-10-12.md` |
| L-10 log windows have no volume control | Not fixed. Recorded as a limit: a "zero errors" window proves nothing unless the same query returns known traffic in that window. | |
| L-11 stale packet records | Marked superseded in place | packet `SUPERSEDED_2026-10-12.md` |
| L-12 stale figures in HOSTED_LIVE | Correction block added; `docs/README.md` routes newest first | `docs/ops/HOSTED_LIVE_2026-10-11.md` |
| L-13 "zero users" | Closed. AGENTS.md now says public signup opened October 11 and accounts are real user data. | `AGENTS.md` |
| L-14 comparison badge | Fixed, PR 248 (merged as `76af0b4`): each method header shows the weaker recorded tier, or "Claim tier not recorded" | guided comparison panel |
| L-15 comparison IDs | Both exist and are ready; note added | `docs/ops/HOSTED_RELAUNCH_2026-10-10.md` |

## Read-only platform checks, October 12

- **Vercel (M-6).** `openplan-natford.vercel.app`, `openplan-git-main-natford.vercel.app`
  and the deployment URL `openplan-pf1bder53-natford.vercel.app` each return
  200 on `/api/health` without sign-in. The project's Vercel Authentication
  covers preview deployments only (`ssoProtection.deploymentType: preview`).
  A production build that is built but not yet promoted is therefore
  reachable at its own URL, against the production database.
- **Vercel plan (M-7).** Team `natford` is on Pro; the current billing period
  runs October 10 to November 10, 2026. Spend Management is not readable here.
- **Supabase plan (M-7).** Organization "Nat Ford Planning & Analysis" is on
  Pro. The Pro start date is not in the Management API response.
- **Hosted migrations.** 405 applied, ending at `20261017000001`, matching the
  repository at `c03788c`. Another lane applied `20261017000002` at 03:56 UTC
  (406), ahead of its code in PR 232.
- **Railway (L-7).** `ocr` watches `/workers/ocr_worker/**` and `/.dockerignore`
  (last deploy `8e721db`). `aequilibrae` watches `/workers/hosted-models/**`,
  `/workers/aequilibrae_worker/**`, `/workers/activitysim_worker/**`,
  `/scripts/modeling/**` and `/.dockerignore` (last deploy `7d92f39`).
  `application-workers` has no watch paths, so every `main` merge rebuilds it
  (now `c03788c`). `offsite-backup` runs on its cron with no repository source.
  `restore-drill` has never deployed. `activitysim` has no source and its last
  deploy failed on October 11 at 02:47 UTC.
- **Resend (M-3).** The Free plan allows 100 emails per day and 3,000 per
  month (resend.com/pricing, read October 12). `[VERIFY: which Resend plan the
  natfordplanning.com sender uses]`. Supabase allows 30 auth emails per hour
  project-wide, up to 720 a day, so on the Free plan anonymous signup requests
  could use up the day's Resend allowance, including engagement email.

## Steps for Nathaniel

These need his accounts. None was attempted.

1. **M-6, Vercel Deployment Protection.** Vercel, project `openplan`,
   Settings, Deployment Protection. Change Vercel Authentication from
   "Preview deployments" to "Standard Protection" (all deployments except
   production domains). Save. Then check from a private window that
   `https://openplan-zeta.vercel.app/api/health` still returns 200 and
   `https://openplan-natford.vercel.app/api/health` now asks for a Vercel
   sign-in. `[VERIFY: that Standard Protection treats openplan-zeta.vercel.app,
   the project's assigned domain, as a production domain. If the public site
   asks for sign-in, switch back at once.]`
2. **M-7, Vercel spend.** Vercel, team `natford`, Settings, Billing, Spend
   Management. Turn it on with a monthly amount inside the $50 authorization
   and "Pause production deployment" when reached. Record the amount here.
3. **M-7, Supabase Pro start date.** Supabase, organization settings, Billing.
   Record when Pro started. If it started for OpenPlan, the base plan plus two
   Micro projects may exceed the $50 authorization; decide whether that holds.
4. **M-7, Railway seats.** Railway, workspace settings, Members. Record the
   seat count and the hard usage limit.
5. **L-7, stale Railway services.** In project `OpenPlan-hosted-workers`,
   delete `restore-drill` and `activitysim` if they are no longer wanted
   (Settings, Danger, Delete service). The current model service is
   `aequilibrae`; its watch paths include the ActivitySim worker. Confirm
   nothing still points at the old services before deleting them.
6. **M-3, CAPTCHA.** If approved: create a free Cloudflare Turnstile site for
   `openplan-zeta.vercel.app`, then send the site key and secret through a
   private channel, not chat. Enabling it needs a code change on sign-up,
   sign-in, resend and forgot-password, and the Supabase setting
   `security_captcha_provider: turnstile`. Also confirm the Resend plan.
7. **M-5, current-build acceptance (optional).** The older evidence is now
   labeled with its build date. If a current-build receipt is wanted, run one
   OCR job and one report export with a signed-in account.
8. **Offsite key.** Store the offsite decryption key and passphrase somewhere
   other than this workstation (carried over from the review fixes).

## Checks not performed

- No Vercel, Supabase billing, Railway billing or Resend dashboard was opened.
- No CAPTCHA, protection or spend setting was changed.
- No hosted migration was applied.
- No current-build OCR job or report export was run (M-5).

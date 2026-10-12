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

Findings from the journey:

- **The resend voids the first link.** Supabase issues a new token on resend.
  A person who opens the first email gets an error. The sign-up note now says
  only the newest link works (PR 246).
- **L-1 is real.** The sign-in page printed the provider's text from the URL
  (screenshot `05-first-link-after-resend-390.png`). Fixed in PR 246.
- **The second email was not observed.** Gmail counts two messages in the
  thread, but the connector returned only the first, and a search outside
  Trash found nothing. Delivery of the resent message is therefore unconfirmed.
- `[PENDING: confirmation through /auth/confirm, first dashboard, sign-out,
  password recovery with a submitted new password, M-2 probe, cross-device
  check, account deletion]`

## Findings

| Finding | Status | Where |
|---|---|---|
| M-1 links work in one browser only | Fixed in code, PR 246. `[PENDING: hosted template switch and live check]` | `openplan/src/app/auth/confirm/route.ts` |
| M-2 reset reveals accounts | Fixed in code, PR 246. `[PENDING: live probe]` | `openplan/src/lib/auth/recovery-reply.ts` |
| M-3 auth email allowance | Open: Nathaniel's decision. See below. | |
| M-4 readiness flag set before review | Marked superseded in place | packet `SUPERSEDED_2026-10-12.md` |
| M-5 "fresh" items on older builds | Open: needs an authenticated hosted run. See below. | |
| M-6 generated URLs reachable | Confirmed, open: needs Vercel dashboard. See below. | |
| M-7 cost limit unproved | Partly recorded, open: needs dashboards. See below. | |
| M-8 rate limiter fails open | `[PENDING: server PR]` | |
| M-9 "today" is UTC | `[PENDING: server PR]` | |
| M-10 one-character edit accepts draft | `[PENDING: server PR]` | |
| M-11 rollback target predates schema | Fixed in docs | [hosted recovery](../../../openplan/docs/ops/HOSTED_RECOVERY.md#roll-back-the-hosted-app) |
| L-1 provider text on sign-in | Fixed in code, PR 246 | `openplan/src/lib/auth/link-errors.ts` |
| L-2 loose CSP | `connect-src` and `img-src` pinned, PR 246. `'unsafe-inline' 'unsafe-eval'` in `script-src` remain; a nonce-based policy is separate work. | `openplan/next.config.ts` |
| L-3 subscribe leak | Fixed in code, PR 246 | subscribe route |
| L-4 signed-link redirects cacheable | `[PENDING: server PR]` | |
| L-5 key ciphertext not bound | `[PENDING: server PR]` | |
| L-6 worker shutdown signal | `[PENDING: server PR]` | |
| L-7 Railway gaps | Watch paths recorded below; stale services await Nathaniel | |
| L-8 narrow equivalence proofs | No change. The review's full-tree diff found nothing escaped. | |
| L-9 route checker absent | Located and hashed; stays private because it reads QA credentials | packet `SUPERSEDED_2026-10-12.md` |
| L-10 log windows have no volume control | Not fixed. Recorded as a limit: a "zero errors" window proves nothing unless the same query returns known traffic in that window. | |
| L-11 stale packet records | Marked superseded in place | packet `SUPERSEDED_2026-10-12.md` |
| L-12 stale figures in HOSTED_LIVE | Correction block added; `docs/README.md` routes newest first | `docs/ops/HOSTED_LIVE_2026-10-11.md` |
| L-13 "zero users" | Closed. AGENTS.md now says public signup opened October 11 and accounts are real user data. | `AGENTS.md` |
| L-14 comparison badge | `[PENDING: server PR]` | |
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
7. **M-5, current-build acceptance.** Either run one OCR job and one report
   export on the current build with a signed-in account, or approve labeling
   the older evidence with its build date (`8e721db` and the a873b era).
8. **Offsite key.** Store the offsite decryption key and passphrase somewhere
   other than this workstation (carried over from the review fixes).

## Checks not performed

- No Vercel, Supabase billing, Railway billing or Resend dashboard was opened.
- No CAPTCHA, protection or spend setting was changed.
- No hosted migration was applied.

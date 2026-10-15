# Operating the hosted site

This page applies to the hosted installation: the app at
`openplan-zeta.vercel.app` on Vercel, Supabase project `lolckycpdjsgeejsmuzl`,
and the Railway workers. It names each secret and where it lives, never a
value. Recorded October 14, 2026. A later change to any account or variable
replaces the matching line here.

## Know when it breaks

- **Production Health workflow** (`.github/workflows/production-health.yml`).
  It checks the public `/api/health` after every successful Vercel production
  deployment and on a half-hourly schedule. GitHub delays scheduled runs: on
  October 13 and 14 it ran about every four to five hours. A failed run emails
  the repository owner.
- **External uptime monitor.** Not yet set up. A free monitor (for example
  UptimeRobot or Better Stack free plans) should poll `/api/health` every few
  minutes and alert by email. The OCR worker's `/healthz` is on a private
  Railway address and needs a public route or a Railway check instead.
- **Deep health and migration check.** The workflow's second step reads
  `/api/health/deep` and the hosted migration list, and fails when the
  deployed code expects a migration the database lacks. It stays off until the
  owner sets the three values listed under "Secrets and where they live."
- **Error reports.** Error pages send scrubbed reports to `/api/client-errors`,
  which appear in Vercel's runtime log as `client_error`. They reach Sentry
  only when `OPENPLAN_SENTRY_DSN` is set. Vercel keeps runtime logs for a short
  period only, so without Sentry or a log drain an error is visible for hours,
  not weeks.

## Apply a migration

Code deploys on merge; hosted migrations are applied by hand. Apply the
migration before, or together with, the merge whose code reads it.

1. Take a protected database capture (see
   [hosted recovery](HOSTED_RECOVERY.md#capture-and-retain)), or confirm the
   daily offsite capture is current.
2. From `openplan/`, linked to the hosted project, run
   `npm exec -- supabase migration up --linked --include-all`.
   `--include-all` is needed because migrations may be applied out of
   numeric order.
3. Run the Production Health workflow by hand and read the migration line.

## Roll back

Follow [Roll back the hosted app](HOSTED_RECOVERY.md#roll-back-the-hosted-app).
An app rollback does not reverse migrations or encrypted records. The candidate
web build and credential-reading workers must work with the current schema and
read every required credential with their protected configuration. Additive
migrations alone do not establish this compatibility. After an integration
secret rotation, retained records may need both secrets; a build that reads only
one cannot read that required set. Keep compatible readers and both required
secrets, or use a compatible roll-forward fix. Do not rewrite retained rows or
queued envelopes to fit an older build. After a rollback, Vercel stops promoting
new `main` builds until someone promotes one, so record it in the coordination
file.

## Restore

Follow [hosted recovery](HOSTED_RECOVERY.md#restore-into-a-disposable-target)
and the offsite capture's [deployment record](../../../workers/hosted-backup/DEPLOY.md).
The decryption key for offsite captures exists only on Nathaniel's workstation
until he stores a second copy. A full replacement of Auth, Storage and the
workers has not been rehearsed.

## Rotate a key

The general order for any shared secret: create the new value, set it
everywhere it lives, redeploy or restart each service, confirm the feature
works, then revoke the old value. Set Railway values with
`railway variable set NAME --stdin` so no value appears in shell history.

| Secret | How to rotate, and what it affects |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Legacy JWT keys rotate together: a new JWT secret replaces both keys and signs every user out. Update Vercel and every Railway service, then redeploy all of them in one window. Supabase's newer per-key secret keys are not yet tested with OpenPlan. |
| `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`, `MAPBOX_ACCESS_TOKEN`, `MAPBOX_TOKEN` | Create a new public token in the Mapbox account, restricted to the site's URL. Set all four names in Vercel and redeploy, because public values are built into the bundle. Then delete the old token. |
| `ANTHROPIC_API_KEY` | Create a key in the Anthropic Console, set it in Vercel, redeploy, revoke the old key. Workspace-owned keys are separate and belong to each workspace. |
| `RESEND_API_KEY` | Create a sending key in Resend; set it in Vercel and the Railway application workers; restart; revoke the old key. Supabase Auth's SMTP uses its own key, set in the Supabase dashboard. |
| `CRON_SECRET` | Set a new random value in Vercel and redeploy. Vercel's scheduler sends it automatically. |
| `OPENPLAN_INTEGRATION_KEY_SECRET`, `OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET` | Follow the staged [integration secret rotation procedure](../SELF_HOSTING.md#rotate-the-integration-encryption-secret). Prepare both secrets on Vercel and every credential-reading worker before changing the primary. Preserve both with database and journal backups. Reads do not re-encrypt retained records; no hosted rotation has been performed by this change. |
| `OPENPLAN_KB_OCR_WORKER_TOKEN`, `OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN` | Set the same new values in Vercel and the Railway OCR service. Document extraction fails between the two changes. |
| `CENSUS_API_KEY` | Request a new key from the Census Bureau, activate it, set it in Vercel and the Railway model host. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (offsite backup) | Create new bucket credentials in Railway, set them on the `offsite-backup` service, confirm the next capture. |
| `OPENPLAN_HEALTH_TOKEN` | Set the same new random value in Vercel and as the GitHub repository secret, then redeploy. |
| `SUPABASE_ACCESS_TOKEN` (GitHub secret) | Create a new personal access token in the Supabase dashboard, replace the repository secret, delete the old token. |

## Secrets and where they live

Names only. "Vercel" means the `openplan` project's Production environment.

- **Vercel, read by the app:** `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `NEXT_PUBLIC_SITE_URL`, the four Mapbox names above, `ANTHROPIC_API_KEY`,
  `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CRON_SECRET`,
  `OPENPLAN_INTEGRATION_KEY_SECRET`, optional `OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET`, `CENSUS_API_KEY`,
  `OPENPLAN_MODELING_WORKER`, `OPENPLAN_HOSTED_ARTIFACT_MIRROR`,
  `OPENPLAN_KB_OCR_WORKER_URL`, `OPENPLAN_KB_OCR_WORKER_TOKEN`,
  `OPENPLAN_KB_OCR_CALLBACK_URL`, `OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN`,
  `OPENPLAN_KB_OCR_LANGUAGES`.
- **Vercel, not set yet:** `OPENPLAN_MONTHLY_RUN_CAP`,
  `OPENPLAN_MODELING_QUEUE_DEPTH`, `OPENPLAN_HEALTH_TOKEN`, and optionally
  `OPENPLAN_SENTRY_DSN`.
- **Vercel, read by no current code:** `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`,
  `OPENPLAN_STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `OPENPLAN_STRIPE_WEBHOOK_SECRET`,
  `OPENPLAN_BILLING_WEBHOOK_SECRET`, `OPENPLAN_STRIPE_PRICE_ID_STARTER`,
  `OPENPLAN_STRIPE_PRICE_ID_PROFESSIONAL`, `OPENPLAN_STRIPE_ALLOW_GUARDED_FALLBACK`,
  `OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS`, `OPENPLAN_BILLING_READINESS_SECRET`,
  `OPENPLAN_BILLING_USAGE_FLUSH_SECRET`, `OPENPLAN_WORKSPACE_PROVISIONING_SECRET`,
  `OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS`, `SUPABASE_JWT_SECRET`,
  `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_URL`
  and the seven `POSTGRES_*` names. A secret nothing reads is exposure with no
  purpose. Some may be maintained by the Vercel Supabase integration; remove
  them there or in the Vercel dashboard after confirming nothing outside this
  repository uses them.
- **Railway application workers:** Supabase URL, publishable key and service
  role, site URL, `OPENPLAN_INTEGRATION_KEY_SECRET`, the optional second secret
  during rotation, and the Resend sending key
  ([deployment record](../../../workers/hosted-node/DEPLOY.md)).
- **Railway model host:** Supabase URL and service role, `CENSUS_API_KEY`
  ([deployment record](../../../workers/hosted-models/DEPLOY.md)).
- **Railway OCR service:** `OPENPLAN_KB_OCR_WORKER_TOKEN`,
  `OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN` and its dispatch URL
  ([deployment record](../../../workers/ocr_worker/DEPLOY.md)).
- **Railway `offsite-backup`:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  the bucket's `AWS_*` credentials, `BACKUP_*` settings and the public
  encryption key ([deployment record](../../../workers/hosted-backup/DEPLOY.md)).
- **GitHub repository:** variable `OPENPLAN_HEALTH_URL` (set); variable
  `OPENPLAN_SUPABASE_PROJECT_REF` and secrets `OPENPLAN_HEALTH_TOKEN` and
  `SUPABASE_ACCESS_TOKEN` (not set yet).
- **Supabase dashboard:** Auth SMTP password (a Resend key), Auth site URL and
  redirect list.
- **Nathaniel's workstation only:** the offsite backup private key and its
  passphrase, under `~/.local/state/openplan/offsite-backup-key/`.

All four accounts (Vercel, Supabase, Railway, Resend) are under Nathaniel's
login. If he is unavailable, no one else can rotate a key, roll back or
restore.

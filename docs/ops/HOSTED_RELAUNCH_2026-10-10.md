# Hosted relaunch, October 10, 2026

Status at this checkpoint: a staged production build works; the public alias
has not yet switched from the May deployment. Update this record after deployment
acceptance. This does not declare a new semantic release or complete v1.

Nathaniel authorizes public signups at `https://openplan-zeta.vercel.app`, a
redirect from `https://natfordplanning.com/openplan`, and up to $50 per month
in additional services beyond his existing Vercel and Supabase subscriptions.
OpenPlan remains free software without subscription or entitlement gates.

## Configuration and evidence

- Vercel project `natford/openplan` builds the nested `openplan/` package with
  Node 24 and webpack. The hosted project now requires seven GitHub checks
  before production domain assignment. This branch enables automatic deployment
  from `main` only; verify a merged commit before declaring automation accepted.
  Retain the prior deployment for rollback.
- Supabase project `lolckycpdjsgeejsmuzl` has all 399 migrations through
  `20261016000027`. No historical user or client data is imported.
  All ten artifact buckets are private.
  The organization `ubtudgixoqdghuvtfpem` has an active Pro subscription.
  Both OpenPlan and `nat-ford-website` belong to this organization and inherit
  that plan. Billing and project membership are verified on October 10.
- Public email signup retains confirmation. Resend custom SMTP sends from
  `OpenPlan <openplan@natfordplanning.com>`. A synthetic signup confirmation
  arrives. Confirmation callback and password reset completion remain pending.
- Shared paid AI credentials are unset. Corridor analysis produces an explicit
  deterministic fallback without an AI credential. Workspace provider choice
  remains available. Railway pollers are running; model and OCR execution
  acceptance remains pending.
- Synthetic owner sign-in, project creation, saved corridor results, Mapbox
  drawing, desktop and 390px project views, and a two-sheet project workbook
  export work on staged build `f6765e3e0b0e60beca1c79b9073e045b2cc964b5`.
  A second workspace cannot read or rename the owner's project. Anonymous reads
  return no project rows. The workbook is a synthetic artifact, not a client report.
- Vercel logs show the corridor request completed with HTTP 200 in 67,472 ms.
  The browser lost that response; the saved run subsequently opens correctly.
  The message fix preserves this unknown write outcome. Large FARS archives
  exceed Next's fetch-cache size and are fetched without that cache. Reliable
  long-request browser delivery and source-cache performance remain open.

## Managed PostGIS API boundary

`public.spatial_ref_sys` is owned by Supabase's internal administrator. Ordinary
`postgres` cannot revoke its inherited client write grants. A successful REVOKE
statement does not establish protection. Migration `20260730000009` records this
same limitation.

The optional operator script
[`restrict-postgis-data-api.sql`](../../openplan/scripts/ops/restrict-postgis-data-api.sql)
installs an invoker pre-request hook and refuses to overwrite another hook.
It blocks client catalog writes, statistics RPC access and client GraphQL.
OpenPlan currently uses REST, with no GraphQL call sites. Service-role
administration and catalog GET/HEAD remain available. This controls the Data API,
not direct SQL grants, Realtime or Storage. Application RLS remains required.
Advisor warnings about the underlying catalog grants can therefore remain.

Actual endpoint probes refuse anonymous catalog writes and GraphQL with 401,
and authenticated writes and GraphQL with 403. Catalog reads return SRID 4326;
authenticated project reads retain the owner's row. Rollback-only SQL checks
pass, a harmless comment passes, and a broken caller guard fails for allowing
anonymous catalog POST. Run
[`verify-postgis-data-api.sql`](../../openplan/scripts/ops/verify-postgis-data-api.sql)
only against an explicitly selected installation. It writes no application or
catalog records and cannot establish API activation. Repeat endpoint probes.

Supabase documents [pre-request controls](https://supabase.com/docs/guides/api/securing-your-api)
and the [managed PostGIS limitation](https://supabase.com/docs/guides/database/extensions/postgis).
Moving the extension requires a separately planned compatibility and recovery
change. This relaunch does not drop or recreate it.

## Checks and recovery

The staged source's CI, isolated RLS and worker-security workflows pass. The
source change's focused five-test suite and targeted lint pass. Harmless
punctuation preserves the failure-message test; the old categorical no-save
message fails it. Browser evidence and server logs cover different boundaries.
Full whole-product acceptance remains incomplete.

A verified-TLS custom-format managed database backup exists in private operator
custody. An isolated Railway PostgreSQL target restores the captured archive,
including ownership, ACLs and platform event triggers. Verification finds 399
migrations, 308 public tables, 307 tables with RLS, three Auth users, ten Storage
buckets and four object records. Both synthetic users' password hashes match.
Authenticated owner, second-workspace and anonymous SQL probes see one, zero
and zero rows respectively for the retained synthetic project.

The four Storage files, totaling 216,267 bytes, and ten application-worker
journal files match after copying through the isolated target. The target is
stopped after verification. These are captured-data and file-transfer checks,
not a replacement Auth/Storage service cutover, full journal replay or a proved
consistent installation snapshot. Writers remain active during this capture.
The latest observed Supabase physical backup predates schema application.
Never commit credentials, dumps or raw journals. Follow the
[hosted recovery record](../../openplan/docs/ops/HOSTED_RECOVERY.md).

Railway Pro adds $20 monthly and includes $20 compute usage. Resend uses its free
plan with pay-as-you-go disabled. Actual compute charges depend on use. Do not
declare a worker deployed merely by changing an environment flag.

## Worker packaging checkpoint

Railway has private application-queue and model-host services. The model host
co-locates AequilibraE and ActivitySim on one persistent volume, with separate
Python environments. Their existing artifact handoffs require shared local
bytes. Two services with separate filesystems cannot substitute for this.
Application queues have a separate persistent journal volume and Chromium for
report rendering. A synthetic campaign review completes through the live queue
on staged build `faa20d5`, retaining PDF, XLSX and ZIP artifacts. Downloads match
their recorded digests; the PDF's three pages render. The owner can download;
a second workspace receives 404 and an anonymous caller receives 401.
Live model execution and recovery acceptance remain pending at this checkpoint.
See the [model host guide](../../workers/hosted-models/DEPLOY.md)
and [application queue guide](../../workers/hosted-node/DEPLOY.md).

The workspace alerts at $25 compute usage and stops at $40. Railway's Pro plan
includes $20 usage credit; the usage ceiling preserves room within Nathaniel's
$50 additional monthly budget. An interrupted job still needs reconciliation.
Provider limits do not guarantee throughput for large regional workloads.

Both supervisors pass actual child-process exit and shutdown tests. A harmless
log punctuation change passes. Changing an unexpected child exit to return
success fails the corresponding test; the original source passes after restore.
These tests do not establish database recovery, model validity or rendered PDF
fidelity. The existing CI jobs now run them without adding another heavy job.

## Published evidence packaging

Staged model cards report unavailable evidence when Vercel omits repository-root
study files. Next tracing now starts at the repository root and includes each
of the four frozen studies on `/models` and its corresponding artifact route.
The studies and their hash checks are unchanged. Five focused files pass 28
tests and configuration lint passes. Hosted card and download verification
passes on hosted build `219456715`: all four cards load and their study-result
downloads return HTTP 200 with SHA-256 matching the committed source files.

## First model execution and recovery checks

The new shared database initially has no Census tracts. The existing authenticated
ingestion endpoint loads all 26 Nevada County tracts from TIGERweb and ACS, with
zero unmatched rows. It does not insert demo rectangles or invented attributes.

Synthetic run `34f49fc9-c081-49a1-990c-9462f73e8245` exposes a wire-format mismatch:
the app writes `{status, table}`, while the worker expects table fields beside
`status`. The reader now accepts both retained formats and refuses malformed
nested tables. All 24 focused checks pass. Removing the nested reader fails the
new app-format check; falling back from a malformed nested table fails its
refusal check; a harmless comment change passes. Reading the actual retained
app payload recovers 26 demographic rows and 26 equity rows with the source's
2023 vintage. Live rerun acceptance remains pending.

The model service has a stable deployment identity,
`openplan-hosted-lolckycpdjsgeejsmuzl`, for command journal destinations. Preserve
it when recovering this same installation. Changing a service variable does
not itself prove that unresolved stages recover correctly. Current Git-sourced
workers report their actual commit through runtime heartbeat records.

The Nat Ford website agent owns its checkout and `/openplan` redirect. This
agent does not change that project's routes or deployments concurrently.

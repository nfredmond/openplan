# Hosted relaunch, October 10, 2026

Current installation status is superseded by the
[October 11 public cutover record](HOSTED_LIVE_2026-10-11.md).
The findings below remain the historical checkpoint.

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
- Supabase project `lolckycpdjsgeejsmuzl` has 400 migrations: historical files
  through `20261016000027` and the relaunch precision fix `20261016000032`.
  Transit candidate migrations 28 through 31 remain unapplied and disabled.
  No historical user or client data is imported.
  All ten artifact buckets are private.
  The organization `ubtudgixoqdghuvtfpem` has an active Pro subscription.
  Both OpenPlan and `nat-ford-website` belong to this organization and inherit
  that plan. Billing and project membership are verified on October 10.
- Public email signup retains confirmation. Resend custom SMTP sends from
  `OpenPlan <openplan@natfordplanning.com>`. A synthetic signup confirmation
  arrives. A real browser signup confirms, creates its owner workspace and opens
  the dashboard. Password reset opens its form and replaces the password;
  the old password returns 400 and the new password returns 200 through Auth.
  Gmail puts the tested reset message in Spam despite passing SPF, DKIM and DMARC.
  Delivery to Inbox is not guaranteed for this new sender.
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
2023 vintage. New run `5f0f5918-8961-4e97-800d-400935b6c22c` completes all three
AequilibraE stages on worker `83ff1ba0b`. Its scientific outcome remains
`inconclusive`; hosted execution does not establish model validity.

Managed PostgreSQL defaults `extra_float_digits` to zero. Ordinary computed
fractional KPI values fail the existing exact receipt check under that setting.
Migration `20261016000032` sets full precision on the two KPI receipt functions
without changing their request, ownership or numeric guards. A rollback-only
native proof reproduces the rejection with precision zero and passes with full
precision plus a harmless comment. An oversized nonrepresentable integer still
fails exact conversion. The original two pending requests recover exact receipts
through the existing recovery client, without resuming either interrupted job.

ActivitySim's fitted Census microdata population step needs the operator's Census
key separately from the ACS tables supplied by the app. The first full-precision
ActivitySim test stops before execution because that worker key is absent. The
existing deployment key is now configured privately on the model service.
Acceptance of a new ActivitySim job remains pending.

## Hosted model file downloads

The engines retain local file references for their shared scientific handoffs.
The hosted model image additionally mirrors those exact registered bytes into
the private `run-artifacts` bucket. A pinned same-run copy verifies the original
size and digest before upload; an authenticated read verifies the stored bytes.
An uncertain mirror stops registration and preserves the original files.
Managed writes retain their existing attempt scope and stop on uncertainty.

Set `OPENPLAN_HOSTED_ARTIFACT_MIRROR=1` on the model host and Vercel. Downloads
derive a content-addressed object path from the authorized run, stage, digest
and canonical filename. They preserve the original `local://` references and
mint a 15-minute signed download after the existing membership checks.
Local installations can keep their shared-filesystem downloads. Missing or
malformed identities and cross-run local paths are refused.

The focused download route passes 20 tests; the selected worker suites pass.
Harmless prose changes pass. Removing the source digest check, stored byte
comparison, managed mirror call or download run boundary fails its corresponding
targeted check. A live owner download on staged build `fdb22b6` returns 1,050,843
bytes with the exact retained SHA-256. Another workspace receives 404 and an
anonymous caller receives 401. Chrome blocks the direct Storage download during
automated file-save review; native browser file-save acceptance remains unproved.
The map renders 2,052 links at desktop and verified 390px widths without console
errors. The narrow map header overlaps its zoom controls; the following bounded
width correction requires a new rendered check.

The model service has a stable deployment identity,
`openplan-hosted-lolckycpdjsgeejsmuzl`, for command journal destinations. Preserve
it when recovering this same installation. Changing a service variable does
not itself prove that unresolved stages recover correctly. Current Git-sourced
workers report their actual commit through runtime heartbeat records.

The Nat Ford website agent owns its checkout and `/openplan` redirect. This
agent does not change that project's routes or deployments concurrently.

## ActivitySim container execution follow-up

A fresh job `349ed28d-68ba-4b70-867c-14e1d1b55d71` passes the three assignment
stages and builds its real Census population. Its engine fails before simulation:
PyArrow 26.0.0 cannot import with the retained NumPy 1.25.2 stack. An isolated
PyArrow 23.0.1 installation in the same container makes ActivitySim CLI startup
pass. The execution requirements now pin that compatible version, and both
execution images check CLI startup during their builds. This preserves the
existing numerical package pins. The Arrow project documents NumPy 1.21.2 or
higher for [Arrow 23](https://arrow.apache.org/docs/23.0/python/install.html).
The shared image also includes the committed accepted-component assets and
verifies their digests during build. Job completion still requires a fresh run.

The precision migration initially used version 28, which collided with the
separate transit candidate. Its unchanged SQL is renamed to version 32. The
linked CLI repairs only this migration identity; verification finds version 32
applied and candidate version 28 absent. The database function settings remain
unchanged. The coordination record reserves transit versions 28 through 31.

## Browser timestamp correction

A direct hosted model-page load reproduces React hydration error 418. The server
and browser use different default time zones for model timestamps. Both model
catalog and run records now use the same UTC formatter with an explicit UTC
label. Catalog tests pass under UTC, Los Angeles and Honolulu time zones; a
harmless comment passes and removing the UTC option fails the stated assertion.
This check covers date rendering, not the complete browser page. The operator
environment example and Unreleased changelog now document the private artifact
mirror flag and precision migration filename required by existing CI guards.

## Compatible hosted execution verified

Railway deployment `8bdc6df3-8566-43bd-95be-17376366c279` runs the corrected
model image at `edc15c6005e8140caaf8654c85f0e84506d72545`. Native inspection
finds NumPy 1.25.2, PyArrow 23.0.1 and one verified accepted component. Fresh
job `2751645d-c78a-42a3-a5c7-32f1b2732080`, launched from the hosted browser,
completes all six stages. ActivitySim CLI executes its 31 model steps in about
69 seconds. The subsequent network assignment converges below the unchanged
0.0005 solver-gap target. The comparison records matching network, assignment
profile and solver-state hashes; it keeps the two engines separate. These are
uncalibrated screening and execution results, not forecast validation.

Chrome renders the corrected traffic map at an observed width of 390 pixels.
Its header ends before the zoom control, and the zoom control responds. The
viewport override is reset. The embedded T3 browser renders the map controls
but its captured map canvas is blank; Chrome provides the rendered-map evidence.
The latest joined application build and full CI remain pending.

Native Railway API reads confirm baseline backup records on all three active
volumes and daily/weekly schedules retaining six and 27 days respectively.
Snapshot restoration remains outside the verified rehearsal boundary.

## Joined hosted browser checks

Joined build `f2b59e19a3d9f3c734f4161010423d4b02f310c7` is Ready at its staged
production address. The latest documentation commit also passes its Vercel
preview build. The canonical public alias still serves the May source. Its
remaining full GitHub checks must pass before promotion. The focused worker
security check passes; queued checks are not passes.

All 22 primary authenticated navigation pages return HTTP 200 for the synthetic
owner. This is server-response evidence, not complete workflow acceptance.
Vercel returns no error-level rows for the staged production build during the
20-minute inspection interval ending around 04:55 UTC on October 11.

Synthetic campaign `c9872261-35fa-499b-830c-de0c9ae13d07` is a separate public
portal fixture. Its visible description states that it is a hosting test and
requests no personal information or real project comments. The original private
campaign stays private. The public page responds without an authentication
cookie and opens on its sourced Grass Valley extent. Desktop submission
`ca64f624-17c1-46bc-b381-05c40f77bc6a` reaches moderation as pending. Approval
records the synthetic review reason before public display. A second 390-pixel
submission receives its receipt. Chrome renders the map and mobile comment
sheet; participant console review records no errors for these journeys.

A direct reload of the moderation registry reproduces React hydration error
418 because it formats retained timestamps in the environment's default time
zone. The registry now uses an explicit labeled UTC formatter. Its focused
checks pass across UTC, Los Angeles and Honolulu. A harmless comment passes;
removing the time-zone option fails the stated assertion. A fresh hosted browser
check remains required for this correction.

Both synthetic build scenarios complete through the real workers. Guided
comparison correctly refuses to combine them with the earlier AequilibraE
baseline: its previous worker build recorded a different solver-visible network
state. The three newer outputs share the current recorded state. A fresh
baseline completes on the current worker. Exact comparison
`a939cf65-f8f0-4ec4-b8f5-8e3c948a2289` saves all four outputs with matching
network, assignment-profile and settings hashes. Each output remains prototype
only; the synthetic minus-five-percent build parameter is a transmission check,
not a project-effect prediction. The older outputs remain retained. No scientific
validation claim is promoted by these execution checks.

*Note, October 12, 2026:* the hosted project holds two ready four-output
comparisons. `a939cf65-f8f0-4ec4-b8f5-8e3c948a2289`, cited above, was created
at 05:03 UTC on October 11 and is the one the page checker opened.
`1c097639-d635-4c83-960a-2e4c7e9e4454`, created at 05:33 UTC, is the snapshot
recorded in the packet's `compatible-comparison-custody.json`. Both are
prototype-only execution checks.

Staged production build `84f3674` also reaches Ready. Its registry timestamp
renders UTC correctly, but a direct browser reload still reports hydration error
418 in the initial notification list. The inbox now uses the same UTC formatter.
Its initial server-rendered markup is compared across UTC, Los Angeles and
Honolulu. This covers rendered notification markup, not the entire page.
The three focused suites pass 26 checks and focused lint passes. A harmless
comment passes; substituting default-zone notification rendering fails the
targeted markup assertion. A fresh deployed reload remains required.

The latest verified-TLS managed capture is a 6,717,114-byte custom database
archive whose index reads successfully. A fresh private Storage capture retains
146 objects totaling 36,154,548 bytes with individual SHA-256 digests. These are
capture checks, not a new restore rehearsal or a consistent multi-service
snapshot. Application writers remain active. Recent model logs retain an
upstream Pandas chained-assignment warning from completed assignment jobs;
execution success does not resolve that scientific implementation limitation.

## Graph dependency compatibility correction

Native inspection finds AequilibraE 1.7.0, NumPy 2.0.2 and Pandas 3.0.6 in its
environment. A synthetic graph probe reproduces Pandas' chained-assignment
failure during AequilibraE graph compression. Pandas documents that
[Copy-on-Write prevents these assignments](https://pandas.pydata.org/docs/user_guide/copy_on_write.html).
An isolated Pandas 2.3.3 installation on the same host passes dead-end removal,
the expected two-link route and its distance of two synthetic units. The worker
now pins that tested Pandas version and its Docker build runs the graph probe.
ActivitySim's separate numerical environment is unchanged.

The exact build probe passes on the compatible installation and with a harmless
comment. Changing an input link weight fails the distance guard. Running the
same probe under Pandas 3 fails on the reproduced chained assignment. Pandas 2
still reports an upstream warning about future Copy-on-Write behavior. These
checks establish this dependency operation, not regional model validity.
Fresh worker deployment and hosted runs remain required. Older artifacts and
their prototype claim tiers remain retained without rewriting their evidence.

## Right-to-left anti-spam field correction

Arabic browser QA on staged e850501 reproduces a document width of 11,307 pixels
in a 1,323-pixel viewport. The hidden website field uses a negative logical
offset, which positions it beyond the right edge. Comment, survey and
subscription forms now use clipped `sr-only` containment. The field,
`aria-hidden`, negative tab order and disabled autofill remain. Repeat measured
browser overflow on the rebuilt deployment before declaring this defect fixed.

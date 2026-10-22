# Hosted public cutover, October 11, 2026

The [later demo AI and schema catch-up](HOSTED_DEMO_AI_AND_GTFS_SCHEMA_2026-10-11.md)
supersedes this checkpoint's unconfigured-demo-AI and unapplied-GTFS statements.
This record retains its initial deployment and test identities.

**Corrections, October 12, 2026.** The text below is kept as written. These
statements in it are superseded:

- "401 migrations" and "transit candidate migrations 28 through 31 remain
  unapplied": the hosted project records 405 migrations, ending at
  `20261017000001`, matching the repository at `c03788c` (Management API read,
  October 12). Later migrations follow the order in AGENTS.md. See the
  catch-up record above.
- "The final verified-TLS database archive contains 7,030,743 bytes": a later
  capture of 7,179,228 bytes exists, and a daily encrypted offsite capture has
  run since October 12 (`workers/hosted-backup/DEPLOY.md`).
- "Preserve the prior May deployment for rollback": that build predates 405
  migrations. Use the procedure and dated target in
  [hosted recovery](../../openplan/docs/ops/HOSTED_RECOVERY.md#roll-back-the-hosted-app).
- The independent review this record anticipates is complete. Its findings and
  their status are in the
  [October 12 follow-up](../reviews/2026-10-12-hosted-review-followup/STATUS.md).

OpenPlan is live at [openplan-zeta.vercel.app](https://openplan-zeta.vercel.app).
The public address serves checked `main` commit
`8e721db11acf07755fbd6a4b6230d68ff912081b`, version 0.68.0, at this acceptance
checkpoint. This record supersedes the current-status statements in the
[October 10 checkpoint](HOSTED_RELAUNCH_2026-10-10.md), while preserving its
development findings. It does not declare a new semantic release, complete v1,
scientific acceptance, or uninterrupted future service.

Nathaniel authorizes public signups, the Nat Ford website shortcut, and up to
$50 monthly for additional services beyond his existing Vercel and Supabase
subscriptions. OpenPlan remains free and open source. No software subscription,
payment step, or entitlement gate is added.

## Public addresses and deployment custody

- [OpenPlan PR 192](https://github.com/nfredmond/openplan/pull/192) merges checked
  head `a873b82133bfaa7e028444a6097ab1a0e272714b` into `main` as `8e721db`.
  Their tracked trees match. Vercel automatically builds this Git commit and
  assigns the public alias after all seven required GitHub checks pass.
  Deployment `dpl_Ggi68YzNqrBSMppaiVbbpz6WJVd3` is ready. The public health
  response identifies `8e721db11acf`. Preserve the prior May deployment for
  rollback; do not force domain assignment past the check gate.
- The required checks are the QA gate, shuffled test order, worker Python tests,
  modeling script tests, operations script tests, focused worker security, and
  live RLS isolation. All pass on the merged source. The additional upgrade-path
  job also passes. See [CI](https://github.com/nfredmond/openplan/actions/runs/38126179578),
  [RLS](https://github.com/nfredmond/openplan/actions/runs/38126179747),
  [worker security](https://github.com/nfredmond/openplan/actions/runs/38126179618),
  and [upgrade path](https://github.com/nfredmond/openplan/actions/runs/38126179589).
- Vercel builds the nested `openplan/` package with Node 24 and webpack, traces
  the required repository-root evidence, and uses the existing 300-second
  function setting. Git deployment configuration uses the recursive `**`
  default to disable branches, then enables `main`. Six branch cases pass;
  reverting to the former single-star default fails the nested-branch case.
- Railway's three active service integrations use `nfredmond/openplan`, branch
  `main`, with waiting for CI enabled. The initial checked `main` deployments
  are explicitly triggered after the checks pass. That initialization is not
  evidence of a GitHub webhook deployment. Vercel's automatic Git deployment
  is directly observed. Workers retain their configured source watch paths.
- [Website PR 20](https://github.com/nfredmond/nat-ford-website/pull/20) merges
  reviewed head `41325b3965f04eab96161483eb6c38a6d349c869` as website `main`
  commit `71b7022997d6fe0d1f7737b7622adda53ede0fee`. The prepared redirect is
  merged only after OpenPlan's public checks pass. The website agent's checkout
  is unchanged. Vercel deployment `dpl_9fnGcHBF56PVdXYfSgq78TL1Bpfq` is ready
  and the website's main CI passes.
- Eight actual production GET journeys cover apex and `www`, `/openplan` and
  `/openplan/`, with and without query strings. All reach OpenPlan with HTTP
  200. Repeated and encoded query parameters retain their values. Apex-to-`www`
  and trailing-slash normalization may add a redirect hop. These are temporary
  redirects, not an app mounted below the website's path.

## Supabase and account access

OpenPlan project `lolckycpdjsgeejsmuzl` and website project
`bymadqabjvtwrfbkcded` belong to Pro organization `ubtudgixoqdghuvtfpem`.
OpenPlan now uses Micro compute, 1 GB RAM, instead of Nano. The actual upgrade
quote retains the $0.01344 hourly rate and shows $0.00 additional monthly cost.
The website also uses Micro. OpenPlan's disk remains 2 GB and its spend cap
remains enabled.

The controlled compute restart runs between 09:14 and 09:16 UTC. The project
returns `ACTIVE_HEALTHY`. Recorded gateway errors end at 09:15:54 UTC; the 13
new Postgres errors describe administrative shutdown or terminated connections.
A bounded log query through 09:21 UTC finds no subsequent matching server errors.
Schema, authentication, private downloads and worker heartbeats pass afterwards.
This explains that restart window, not all historical provider errors.

The managed database has 401 migrations, 310 public tables, 309 tables with RLS,
and 11 private Storage buckets. `public.spatial_ref_sys` remains the managed
administrator exception described in the October 10 record. Its Data API
pre-request protection does not establish protection for direct SQL, Realtime,
or Storage. The security advisor still reports the underlying catalog grants.
Do not drop PostGIS or revoke application RPCs merely to clear generic warnings.

Applied schema includes the hosted KPI precision fix and the M17 map-package
migration `20261017000001`. Transit candidate migrations 28 through 31 remain
unapplied and disabled. No historical client or user records are imported.
The Storage service limit is 1 GiB; an actual 57,672,059-byte map-package upload
passes its original upload and subsequent checksum/private-download checks.

Public signup is enabled, email confirmation is required, the minimum password
length is eight, and breached-password protection is enabled. The site URL and
sole allowed redirect pattern now identify `openplan-zeta.vercel.app`; the
temporary staging redirect is removed after canonical recovery checks pass.

Resend custom SMTP uses `OpenPlan <openplan@natfordplanning.com>`. The replacement
domain-scoped sending key is configured in the authorized services and the
exposed original is revoked. Keys and raw message bodies remain private.
The real QA account previously completes signup, confirmation, workspace
creation and password replacement on the staged installation. On the public
site it signs in, opens its dashboard, signs out, requests a fresh reset email,
and follows the exact HTML email link to the new-password form. This final
callback check does not change the password. The first test misreads a trailing
bracket in the plain-text link; the corrected fresh HTML link passes.

The tested email reaches Gmail with SPF, DKIM and DMARC passing, but Gmail
classifies it as Spam. Inbox placement is unproved. One initial canonical
browser login stalls until reload; the retry returns Auth HTTP 200 and reaches
the dashboard. The event remains in the private evidence rather than being
erased from the acceptance account.

## Active workers and actual delivery

All three active Railway services run Git commit `8e721db` at this checkpoint:

| Service | Deployment | Actual result |
| --- | --- | --- |
| Application queues | `952011ac-ca8f-4ab1-aa98-f01cd0f123a9` | Success, running instance, seven expected pollers present |
| Shared AequilibraE/ActivitySim host | `bff24ac3-b7be-4e1f-82d2-e250c72d4e34` | Success, both fresh runtime heartbeats identify this commit |
| OCR | `9d0fa13f-e890-4512-bdfa-72794a08176a` | Success, fresh document job completes through canonical dispatch/callback |

The unused older standalone ActivitySim service has no active deployment. Its
historical failed deployment is retained. The disposable restore target is
stopped. Neither is an active application host.

The application image includes Chromium, required connector scripts, and
`poppler-utils`. Inspection finds `pdftoppm` in the deployed image. An actual
page render inside its preceding checked image produces a 612 by 792 PNG.
This proves that dependency and execution path, not every work-program image
export journey. Persistent application journals, OCR custody, and the shared
model volume remain attached across deployments.

Fresh public-site engagement report job
`b2fea488-1d99-40e3-9256-d6ff026e9d8f` completes on its first attempt. Its PDF,
XLSX and ZIP downloads match their stored digests. The owner receives 200, a
second workspace receives 404, and anonymous access receives 401. All three
PDF pages are rendered and reviewed; the XLSX contains 17 sheets and the ZIP
has 12 intact entries. This private synthetic campaign contains zero
contributions. It does not establish report completeness for a populated
agency consultation or native operating-system file-save acceptance.

OCR dispatch now points to the canonical public site. The retained earlier
text-reading job delivers its original terminal result after public cutover:
zero of one image-only pages produce text, an expected failed text extraction.
Its callback payload and custody are not rewritten. Fresh OCR job
`a6c6d8f6-fb4c-434c-8857-d6cc97fee0de` succeeds at 100 percent, records a new
extraction, and makes `OPENPLAN HOSTED OCR TEST` and `12345` available in document
search. Original bytes match SHA-256
`910d40645ca7bd4ed6867bd5c3652a4f8102020cc666a9047c15e8d13e80e18b`.
Owner/other/anonymous original reads return 200/404/401; other/anonymous job
status reads return 404/401. This is an actual synthetic image-only PDF journey.

Earlier fresh No Build and Build jobs complete all three AequilibraE and six
ActivitySim stages. Their separate outputs, registered files, digests and
compatible four-run comparison remain available through the hosted API.
Published frozen-study downloads also match their committed digests. These
checks establish execution and custody. Scientific outcomes remain prototype
or inconclusive; a synthetic transmission change is not calibrated accuracy
or a project-effect prediction. Do not average the engines.

## Browser, privacy and logs

The canonical site passes 49 native page/data/access checks and eight retained
map-package delivery checks. Browser journeys identify the public build,
confirmed-account dashboard and public engagement map at desktop and 390px
widths. The mobile dashboard and map have no horizontal overflow. The rendered
public map loads its existing Mapbox background. Staged evidence on the matching
tracked tree also covers saved map packages, translated participant forms,
keyboard marking and moderated public comments. The keyless fallback is not
exercised because this deployment retains its existing Mapbox token.

A subsequent 390px review finds clipped content on the saved scenario comparison
page even though the document reports no horizontal overflow. The tab panel uses
`display: contents`, so its table can expand the implicit grid column past the
phone width. The final handoff adds the existing `minmax(0, 1fr)` column utility
to this page and its saved-result list and rows. The first rendered correction
fixes the outer page but still exposes nested table clipping, so both levels are
constrained. A joined light-theme review also finds that a long project name
expands the Corridor Analysis project controls beyond their panel. The final
handoff constrains the controls and selector so links wrap within the panel.
Their identified-build browser rechecks belong in the final acceptance
artifact; document width alone does not prove readable content.

The synthetic public campaign is closed and its share token is revoked after
checks. Its old public endpoint returns 404. All five feedback records remain,
including four pending records; the test does not approve them or erase history.
The self-test email subscription is already unsubscribed.

The checked post-cutover Vercel error window contains zero rows. The earlier
09:15 cron query failure coincides with the planned database restart. Bounded
post-restart application-worker and OCR log windows contain no flagged failure
rows. These observations do not assert that all historical logs are clear or
that future requests cannot fail. Continue checking identified deployments,
timestamps and actual delivery when diagnosing a report.

## Cost, backup and remaining boundaries

Railway Pro costs $20 monthly and includes $20 usage credit. The workspace usage
alert is $25 and its hard usage limit is $40. The Railway Agent hard limit is $1.
Resend uses its free plan with pay-as-you-go disabled. No new shared paid AI key
is configured. Workspace-owned provider keys or independently installed
providers remain the user's choice; optional paid AI usage belongs to that
provider account. The prepared Anthropic demo API workspace has a $5 monthly
cap and uses existing prepaid credits with auto reload off. Its encrypted
workspace-key configuration and actual AI request checks belong in the final
acceptance record. Workspace setup health resolves its own readable Anthropic
key, matching the dashboard and request routes, rather than requiring a shared
deployment key. The existing Mapbox token remains in use; its separate account
billing and license review is not proved by this relaunch. These controls do
not guarantee capacity for an arbitrary number of regional model jobs.

The final verified-TLS database archive contains 7,030,743 bytes, has a readable
7,316-entry index, and SHA-256
`6d1cada27ff7ecc44f1c5c654df43bedac006e4a128e73c72d152ccc4edd798c`.
The PostgreSQL 17.11 client preserves owners and ACLs. Private local custody uses
mode 600 inside a mode-700 directory. All 11 private Storage buckets are
captured: 220 objects, 117,871,050 bytes, each hashed. The inventory SHA-256 is
`48eb80d0b621f59a3d5151853c5883d422d48f19acbaee7290f5eec290b49609`.
Raw dumps, objects, signed links, credentials and worker journals are not committed.

The earlier isolated managed restore and file-copy rehearsal remains the
evidence described in [hosted recovery](../../openplan/docs/ops/HOSTED_RECOVERY.md).
This latest archive is not restored during the final capture. Writers remain
active; database and Storage copies are not an atomic installation snapshot.
Railway's configured volume backup schedules are not a tested volume restore.
Replacement Auth/Storage startup, an offsite protected-copy recovery, full
journal replay, practitioner acceptance, and whole-product v1 acceptance remain
unproved. Preserve those distinctions in any operational handoff.

The independent Claude Code Opus 5.5 high-effort audit is a separate acceptance
artifact. This implementation record does not substitute for its findings.

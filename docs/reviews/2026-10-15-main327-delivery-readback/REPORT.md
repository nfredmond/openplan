# Exact-main delivery readback, October 15, 2026

Exact-main operational delivery remains unestablished at this reading. Five
requested regression workflows succeed for fetched main, but RLS still runs,
the public web app reports the preceding build, Railway reports the new
application deployment as `WAITING`, and all eight process kinds remain
`unobserved`. The parent retains the final decision and the merge hold remains
on. This report does not authorize another merge, deployment or migration.

## Scope and provenance

The assigned checkout is
`/home/nathaniel/.t3/worktrees/openplan/t3-0cda92e8`, on
`t3/main327-delivery-readback`. It was clean before the authorized fetch and
fast-forward from `05dd3e8da` to
`b259d73e56d22d4935ef2789874cf69901786b33`. That full fetched commit is the
fixed comparison target throughout this report. No later fetch or operational
poll follows this reading.

Ownership is limited to this review directory and the new private directory
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/node-queue-observation-20261014/main327-readback-20261015/`.
The canonical checkout's three unrelated untracked entries, `.directory`,
`COORDINATION.md` and `supabase/`, were observed and left untouched. The shared
coordination record's leading hold is dated `2026-10-15T06:11:19.706295+00:00`
and names this same main commit. This task does not edit that record.

The nested `npm run product:direction:check` returns zero. It retains reminders
for expired jurisdiction/capability review dates, review version `0.66.0`
versus package `0.68.0`, and intervening substantive changes. It reports the
existing November 6 review deadline. This is document-consistency evidence,
not a new product reassessment or release acceptance.

The collector takes one current read per requested operational surface. All
four start at `2026-10-15T06:56:31Z`; the final response completes at
`06:56:32.050667Z`. Full individual timestamps, identifiers and sanitized
responses are in [evidence.json](evidence.json). Credentials and private raw
responses remain outside Git. The existing rollout proof is read only.

## GitHub workflows

The commit-filtered Actions API returns eight runs, all with the exact full
`b259d73e56d22d4935ef2789874cf69901786b33` head. Each is attempt 1. At the
single API reading, `06:56:31.339414Z` to `06:56:31.914742Z`:

- [CI, 38690748124](https://github.com/nfredmond/openplan/actions/runs/38690748124)
  is `completed/success`, updated `06:42:18Z`.
- [Upgrade Path, 38690748166](https://github.com/nfredmond/openplan/actions/runs/38690748166)
  is `completed/success`, updated `06:13:09Z`.
- [Worker security and cancellation, 38690748118](https://github.com/nfredmond/openplan/actions/runs/38690748118)
  is `completed/success`, updated `06:10:39Z`.
- [Node queue process observations, 38690748385](https://github.com/nfredmond/openplan/actions/runs/38690748385)
  is `completed/success`, updated `06:17:38Z`.
- [Aerial worker custody regression, 38690748106](https://github.com/nfredmond/openplan/actions/runs/38690748106)
  is `completed/success`, updated `06:52:15Z`. This is the ODM regression workflow.
- [RLS Isolation, 38690748137](https://github.com/nfredmond/openplan/actions/runs/38690748137)
  is `in_progress`, conclusion null. It started `06:09:22Z` and last updated
  `06:09:25Z`. There is no completion result at this reading.
- [Production Health, 38691670638](https://github.com/nfredmond/openplan/actions/runs/38691670638)
  is a scheduled `completed/success` run, updated `06:19:11Z`.
- [Production Health, 38690755144](https://github.com/nfredmond/openplan/actions/runs/38690755144)
  is a deployment-status-triggered `completed/skipped` run, updated `06:09:28Z`.

These are API-reported workflow conclusions. This task does not inspect every
job, step or log and does not rerun the suites. A workflow's source commit
identifies its test code, not necessarily the application answering a remote
health URL. Production Health success therefore does not establish exact-main
delivery. The workflow's deep-health/migration step is also configuration
dependent; its execution is not inferred from the overall conclusion.

## Public web identity

A single GET to
<https://openplan-zeta.vercel.app/api/health> returns HTTP 200. The response's
`checkedAt` is `2026-10-15T06:56:31.590Z`, with:

- Commit `1b2fefe0f0e9`, version `0.68.0`.
- Expected migration count 417, latest `20261017000014`.
- App `ok`, database `not_checked`.
- Cache `MISS`, `Cache-Control: no-store, max-age=0`.
- Vercel request ID `sfo1::sfo1::d828g-1792047391540-210a83ca4f56`.

The reported commit does not match pinned main's `b259d73e56d2` prefix. Source
inspection of `openplan/src/app/api/health/route.ts` and
`openplan/src/lib/ops/migration-manifest.ts` confirms that these migrations are
the build's expectations, not an installed-database census. Pinned source has
418 migration SQL files through migration 15. The public response therefore
shows an older build and does not contradict the separate installed count.
This task does not inspect Vercel deployment metadata, runtime logs or a browser.

## Railway application service

The read uses explicit project `9d7fbdc3-c370-41b5-8471-34dc128e718e`, production
environment `343ca578-aef1-4005-9ef6-a8a5e89582d5` and application service
`4883a282-fbed-4043-b220-3b3daabe04e9`. It lists five deployments once with the
installed CLI's documented read command.

The latest deployment, `2a577f7f-bca7-4186-a3e8-c2e41a5a3428`, is `WAITING`
and names the exact pinned main commit. Its creation time is
`2026-10-15T06:09:22.125Z`, about 47 minutes 10 seconds before the read ends.
The preceding deployment, `c41ec7aa-9f23-46d8-8c99-b820864d65ff`, is `SUCCESS`
and names `1b2fefe0f0e98f99700fc77e99146fe697b43ee7`.

The latest list status does not show a running exact-main container. The older
success does not prove current child-process liveness. No logs, process restart,
deployment request or settings change occurs. RLS remains unfinished, but this
read does not establish the specific reason Railway is waiting or when it will
proceed. It provides no future delivery estimate.

## Installed schema and process census

The collector reads credentials programmatically from the existing private
backup variables and confirms the stored Supabase URL names
`lolckycpdjsgeejsmuzl`. A bounded PostgreSQL read returns 418 installed migrations,
latest `20261017000015`; migration `20261017000016` is absent. No migration is
applied. This count/latest check does not compare the full installed version set
or repeat the earlier RLS, privileges and function-definition acceptance.

The existing `public.read_node_queue_process_observations()` RPC returns server
time `2026-10-15T06:56:31.778885+00:00`, scope `process_only`, and job completion
`unassessed`. All eight named kinds return `unobserved`, null `lastSeenAt` and
`lastState`, and zero reported running/stopping observations:

- `document-exports`
- `engagement-email`
- `provider-api`
- `translation-generation`
- `synthesis-preparation`
- `synthesis-execution`
- `contract-calculations`
- `gtfs-ingestion`

The supervisor source declares the first seven kinds. GTFS is a separate
declared census kind and remains disabled under the parent's instruction. This
task does not enable it or independently read its enablement setting.

The SQL reader distinguishes missing observations from fresh, stale, stopping
and stopped observations. `unobserved` means no retained observation for the
kind at the reading. It does not mean zero actual worker processes, an empty
queue, completed work, or a clean stop. The RPC summary does not expose build
identity; this read cannot attest worker build identity from that summary.
Here it also supplies no process observation to qualify any of the seven
required exact-main workers.

The connection requests `default_transaction_read_only=on`, but its explicit
`SHOW transaction_read_only` returns `off`. Server-enforced read-only status is
therefore **not established**. The actual executed SQL consists only of that
SHOW, the migration SELECT, `SET LOCAL ROLE service_role`, and the existing
read RPC SELECT, followed by rollback and connection close. No data-writing
statement or record RPC is invoked. The source reader is inspected before use
and contains SELECTs. The unexpected transaction mode is retained in the
evidence, without claiming a cause or repeating the operational read.

## Acceptance boundary and handoff

Access succeeds for all four reads; no configuration repair is needed or
attempted. Each reading could have shown a different SHA, a failure, a completed
RLS result, a deployed worker or an observed process. The actual mismatches and
incomplete states remain visible. No test or application guard is written or
changed, so no mutation campaign is run for this documentation-only task.

The evidence is a single point in time, not a monitoring interval. No polling
loop, expensive suite, service, build, browser, deployment, database write,
migration, provider action, external send, paid action, push or merge occurs.
No uptime, business-job outcome, full restore, throughput, planner acceptance
or release readiness follows from these checks.

The parent still needs the unfinished RLS result and subsequent identified
exact-main web and seven-worker delivery evidence with actual process
observations. This task does not wait for those states or release the hold.
The report commit is the only repository change handed back for review.

## Parent delivery follow-up at 07:11 UTC

The parent reads the completed RLS workflow separately. Run 38690748137 is now
`completed/success`, updated at `2026-10-15T06:59:34Z`. This supersedes the
earlier unfinished result without changing that historical reading.

At `2026-10-15T07:11:05.856Z`, public health reports commit `b259d73e56d2`,
version `0.68.0`, and 418 expected migrations through `20261017000015`.
Database health remains `not_checked`; this response is build identity evidence.
Railway reports deployment `2a577f7f-bca7-4186-a3e8-c2e41a5a3428` as `SUCCESS`
with the exact full pinned main commit. The preceding deployment is `REMOVED`.

An explicit log read for that deployment finds all seven declared supervisor
startup messages at `07:00:47.951773673Z` through `07:00:47.951809573Z`.
The process RPC at `07:11:06.110294Z` reports one running instance for each of
those seven kinds, with observations between `07:10:50` and `07:10:57`.
GTFS remains unobserved and is not enabled by this verification.

A direct table read at `07:11:31.125483Z` returns exactly seven rows. All have
state `running`, sequence 22 and null `build_sha`. Thus individual observation
rows do not independently attest a commit. Exact worker delivery is correlated
through Railway's commit-labelled successful deployment and its seven startup
messages, alongside the fresh database observations. A stronger direct runtime
source-hash read is unavailable: the SSH command refuses before connection with
`No SSH keys found in your SSH agent or ~/.ssh/`. No key or configuration is
created to overcome that refusal. The first unfiltered 100-line log read omits
startup messages; the focused startup filter returns the seven named records.
Neither the initial empty selection nor the SSH refusal counts as acceptance.

Sanitized responses and raw private transport evidence remain in the original
private rollout directory, under `delivery-after-rls.json`,
`worker-build-observations-after-rls.json`, `worker-startup-filtered.json` and
the corresponding private log files. The parent performs only read operations.

The parent releases the sequential main-delivery hold for the next separately
reviewed change, PR328. This is a technical rollout decision based on the stated
provider correlation boundary. It does not establish job completion, provider
request success, throughput, whole-installation recovery, practitioner
acceptance, scientific validity or general production readiness. Migration16
remains unapplied hosted. A new main change requires fresh CI and delivery
verification before another merge.

# Exact-main delivery remains pending after PR329

The delivery hold remains pending at this checkpoint. Exact-main GitHub CI,
Node process observations, aerial custody and RLS workflows still run. Public
health identifies the preceding main commit. Railway names exact main in a
`WAITING` deployment. Seven fresh process observations have null build SHAs.
The parent retains the release-hold decision; this report does not release it.

## Scope and fixed source

The assigned checkout is
`/home/nathaniel/.t3/worktrees/openplan/t3-a75be947`, branch
`t3/main329-delivery-readback`. Its initial tree is clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. An authorized fetch and fast-forward
pins this branch to `ced6aced9ddc6bf839891fb8e44d67c2d1dfe053`. The tree is clean
at that source before report creation. Canonical main, other worktrees and the
running 06a QA/preview environment receive no changes or process actions.

The supplied merge record is PR329 at `2026-10-15T08:16:28Z`, head
`ac8512432a28a1791d551c688ac430c7fe493a8d`. Local Git confirms that head as
the second parent, with first parent
`4ea6a8ca3b43c6712952fc4e527a8538237a9adb`; the merge commit's committer time
is `2026-10-15T08:16:27Z`. The API merge time and Git committer time are distinct.
A path-filtered diff confirms no changes under `openplan/` or `workers/`
relative to that first parent, including no schema changes. The parent's
accepted exact-PR-head checks and neutral control are prior evidence, not
reexecuted checks in this task.

Ownership covers this report directory and the new private directory
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/node-queue-observation-20261014/main329-delivery-20261015/`.
The prior `MAIN328.md`, MAIN327 report and private capture helper are inspected
read only. Credentials are loaded programmatically from the existing private
rollout configuration; their values are neither printed nor copied into Git.

The nested `openplan/` command `npm run product:direction:check` exits zero.
It retains expired jurisdiction/capability review reminders, review version
`0.66.0` versus package `0.68.0`, and intervening-change reminders, with the
existing November 6 review deadline. No review date or product scope changes.
This is consistency evidence, not a new whole-product reassessment.

## Exact-main GitHub reading

The first commit-filtered Actions read spans
`2026-10-15T08:18:33.127524Z` to `08:18:33.785810Z`. It returns eight runs,
each attempt 1 and each naming the full pinned main SHA. One bounded follow-up
spans `08:19:13.669405Z` to `08:19:14.322322Z`, starting about 41 seconds after
the first read. It finds the same states:

- [CI, 38704493851](https://github.com/nfredmond/openplan/actions/runs/38704493851)
  is `in_progress`, conclusion null, updated `08:16:43Z`.
- [Node queue process observations, 38704494013](https://github.com/nfredmond/openplan/actions/runs/38704494013)
  is `in_progress`, conclusion null, updated `08:16:34Z`.
- [Aerial worker custody regression, 38704493800](https://github.com/nfredmond/openplan/actions/runs/38704493800)
  is `in_progress`, conclusion null, updated `08:16:35Z`.
- [RLS Isolation, 38704493767](https://github.com/nfredmond/openplan/actions/runs/38704493767)
  is `in_progress`, conclusion null, updated `08:16:34Z`.
- [Worker security and cancellation, 38704493992](https://github.com/nfredmond/openplan/actions/runs/38704493992)
  is `completed/success`, updated `08:17:41Z`.
- [Research collector evidence, 38704493815](https://github.com/nfredmond/openplan/actions/runs/38704493815)
  is `completed/success`, updated `08:17:16Z`.
- [Integration secret rotation, 38704493802](https://github.com/nfredmond/openplan/actions/runs/38704493802)
  is `completed/success`, updated `08:17:46Z`.
- [Production Health, 38704502966](https://github.com/nfredmond/openplan/actions/runs/38704502966)
  is `completed/skipped`, updated `08:16:45Z`, event `deployment_status`.

The seven regression runs use `push`. A skipped health run is not a health
success. No exact-main scheduled health run appears in this returned set.
These are workflow-level API conclusions. Job/step logs and branch-protection
requirements are not independently audited. Workflow success identifies test
source, not the build answering a remote URL. No watcher or long polling runs.

## The public web still identifies preceding main

One GET to <https://openplan-zeta.vercel.app/api/health> returns HTTP 200,
checked at `2026-10-15T08:18:46.184Z`. It reports commit `4ea6a8ca3b43`, version
`0.68.0`, and 418 expected migrations through `20261017000015`. App health is
`ok`; database health is `not_checked`. Cache is `MISS`, with
`Cache-Control: no-store, max-age=0`. Request ID is
`sfo1::sfo1::ck9xg-1792052326140-489857b96af8`.

The returned commit does not match pinned main's `ced6aced9ddc` prefix.
The route and migration-manifest source identify these migrations as build
expectations, not an installed-schema census. No browser journey, Vercel
deployment metadata or runtime source inspection accompanies this reading.

## Railway exact-main deployment is waiting

The read explicitly targets project `9d7fbdc3-c370-41b5-8471-34dc128e718e`,
environment `343ca578-aef1-4005-9ef6-a8a5e89582d5`, application service
`4883a282-fbed-4043-b220-3b3daabe04e9`. The initial read finishes at
`2026-10-15T08:18:34.764933Z`; the bounded follow-up ends at `08:19:14.322322Z`.

Deployment `1fd9bd72-1e79-4584-8c3a-2ec6d1ca6c77`, created at
`08:16:30.354Z`, names the exact full pinned main commit. Both readings report
`WAITING`. Preceding deployment `d8a4c5d0-a316-43e0-b0f2-425006f6411b`
remains `SUCCESS`, naming full commit
`4ea6a8ca3b43c6712952fc4e527a8538237a9adb`.

Explicit bounded startup-log reads for those two deployment IDs span
`08:18:45.936869Z` to `08:18:48.662974Z`. Both commands exit zero but return
zero rows with filter `Started OpenPlan worker:` and limit 100. Empty filtered
receipts do not establish missing workers or successful startup. They do not
recapture the preceding deployment's startup messages. No cause or delivery
estimate for `WAITING` is established.

The prior readback at commit `9489c729b` records seven preceding-deployment
startup messages from `08:05:24.761376977Z` through `08:05:24.761404546Z`.
Those remain historical provider evidence. They cannot attest ced6 delivery.
The supervisor declares these worker names and message labels, not independent
operating-system process-title or per-process source-hash attestations.

## Process observations are fresh but do not identify ced6

The stored Supabase URL is checked against project `lolckycpdjsgeejsmuzl`.
The installed reader is `public.read_node_queue_process_observations()`.
The requested name `get_worker_runtime_observations` is absent from both the
pinned source search and the queried public-function catalog. This checkpoint
uses the existing prior read method without creating or changing an RPC.

At server time `2026-10-15T08:18:46.319430Z`, the reader reports scope
`process_only` and job completion `unassessed`. Each named process has one
fresh running instance and no stopping instances:

- `document-exports`, last seen `08:18:32.267864Z`.
- `engagement-email`, last seen `08:18:28.274081Z`.
- `provider-api`, last seen `08:18:31.222912Z`.
- `translation-generation`, last seen `08:18:31.765782Z`.
- `synthesis-preparation`, last seen `08:18:33.100588Z`.
- `synthesis-execution`, last seen `08:18:33.051556Z`.
- `contract-calculations`, last seen `08:18:27.311164Z`.

Their ages are about 13.2 to 19.0 seconds, within the reader's two-minute
freshness window. A separate SELECT in the same transaction returns seven
running rows, sequence 27, and seven retained stopped rows. All 14 rows have
null `build_sha`. Running-row start times fall between `08:05:27.785887Z` and
`08:05:33.242483Z`, before the PR329 merge. These observations do not
independently identify a deployment or prove exact-main worker delivery.

GTFS is `unobserved`, with null last state/time and zero reported running or
stopping instances. Missing observations do not establish zero actual
processes. GTFS remains disabled under the parent's instruction; this task
does not enable it or independently inspect its setting.

The installed migration SELECT returns 418, latest `20261017000015`, with
candidate `20261017000016` absent. This checks count/latest/candidate presence,
not the entire installed version set, function definitions or privileges.

The connection requests `default_transaction_read_only=on`, but
`SHOW transaction_read_only` returns `off`. Server-enforced read-only status
is not established. Executed statements are that SHOW, migration SELECT,
`SET LOCAL ROLE service_role`, the inspected read-only summary RPC SELECT,
the observation-table SELECT and public-function-catalog SELECT. Rollback
and close follow. No write RPC, data-writing statement or configuration change
runs. The `off` result does not authorize writes or configuration repair.

## Evidence limits and parent handoff

[evidence.json](evidence.json) retains sanitized results, exact timestamps and
private-receipt hashes. Raw deployment responses, logs and connection details
stay in the private directory. The collector adapts the prior helper. No
application test or guard is written or changed, so no mutation campaign runs.
The observations can expose failures, mismatched commits, empty log selections
and incomplete states; those outcomes remain explicit here.

GitHub success, public web identity, provider deployment state, historical
startup messages and process RPC observations are separate evidence layers.
Provider correlation at preceding main does not supply a direct worker SHA.
None of these establishes completed jobs, provider request success, queue
capacity, throughput, output quality, scientific validity, whole-installation
recovery or practitioner acceptance. The local 06a full suite and preview
binding remain independent and unchanged.

The parent still needs completed applicable exact-main workflows and identified
ced6 web/worker delivery. The report does not wait for those results. No SSH,
key creation, build/deploy command, hosted setting, migration, secret rotation,
provisioning, spending, external message, push, PR creation or main merge runs.
The only repository write is this locally committed report directory.

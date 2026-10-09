# Integration validation, October 8, 2026

## Full TypeScript check

The isolated integration checkout at `6aa6b54477365135c49690de06950b74088ff85c`
passes the full configured TypeScript check with no diagnostics. The command uses
TypeScript 5.9.3, a 6 GB Node heap, a 7 GB systemd memory limit, no swap for the
scope, a 128-task limit and disabled core dumps:

```sh
ulimit -c 0
systemd-run --user --scope --quiet --unit=openplan-integration-types-6aa6b5447 \
  -p MemoryMax=7G -p MemorySwapMax=0 -p TasksMax=128 -- \
  nice -n 10 node --max-old-space-size=6144 node_modules/typescript/bin/tsc \
  --noEmit --incremental false --extendedDiagnostics
```

The check exits 0 in 53.18 seconds. Compiler diagnostics report 4,580 files,
843,612 TypeScript lines, 9,680,766 instantiations and 4,770,307 KB of memory.
The configuration root inventory contains 3,509 files and no nested worktree.
The difference includes imported dependencies. The earlier 2 GB and 4 GB heap
failures remain failed attempts; the successful run uses the 6 GB allowance
already present in the repository's build script. No source exclusion or type
check bypass was added.

This standalone check precedes Next's generated build types. The production
build is a separate check. Neither check establishes runtime authorization,
rendered browser behavior, data recovery or scientific acceptance.

## Stacked PR checks

At this checkpoint, PR #171 targets the branch of PR #170. Inspection of GitHub
checks shows only the restore drill on #171. CI, live RLS isolation and worker
security each restrict pull requests to the `main` base, so those checks do not
run on the intermediate stack. PR #170 has eight passing checks, but that result
does not cover the later worker and recovery commits in #171.

The three workflows now use an explicit unfiltered pull-request event. Their
main-branch push triggers and job definitions remain intact. The native ops test
`test_stacked_pr_checks.py` requires each PR trigger, permits a harmless comment,
and rejects both a main-only branch restriction and a missing PR trigger. YAML
parsing separately confirms all three event mappings and their five, one and one
jobs. This source guard does not prove GitHub job execution, branch protection or
repository permissions. Observe the new head's actual checks after pushing.

## Production build resource boundary

The first bounded `npm run build` compiles webpack in 41 seconds and finishes
Next's generated TypeScript check in 58 seconds. It then attempts page-data
collection with 23 workers. Native Tokio runtimes cannot create their threads
inside the 256-task limit; the build exits 1 with `SIGABRT`. This is a failed
build, not a completed build or a compiler error. Core dumps remain disabled.

Inspection of the installed Next 16.3.8 code shows its default CPU setting uses
`CIRCLE_NODE_TOTAL` minus one when supplied. The retry sets that value to 3 and
limits affinity to observed available cores 0 and 1. It retains the same 7 GB
memory limit, zero scope swap and 256-task limit. No type-check, page-data or
static-generation stage is disabled. The build uses the same placeholder
Supabase and API values as CI, not a real account or preview database.

The retry exits 0. Webpack compiles in 20.3 seconds; generated TypeScript finishes
in 7.8 seconds using the prior build cache. Two page-data workers complete all
137 static pages in 1,277 ms, followed by page optimization and build tracing.
The command is:

```sh
ulimit -c 0
systemd-run --user --scope --quiet \
  --unit=openplan-integration-build-6aa6b5447-serial \
  -p MemoryMax=7G -p MemorySwapMax=0 -p TasksMax=256 -- \
  env CIRCLE_NODE_TOTAL=3 \
  NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder-anon-key \
  SUPABASE_SERVICE_ROLE_KEY=ci-placeholder-service-role \
  ANTHROPIC_API_KEY=ci-placeholder-anthropic-key \
  taskset -c 0,1 nice -n 10 npm run build
```

The two allowed cores are specific to this observed Linux host. This built
artifact uses CI placeholders and is not the configured acceptance preview.
No application source changed between the checked commit and these runs. The
pending changes at build time are CI workflow triggers, their native test and
this documentation. Full TypeScript and production build validation now pass;
T3 visual acceptance, real session journeys, complete QA/worker/RLS/upgrade
checks on the integrated head and the full V1 requirements remain separate.

## Lightweight worker CI failure and correction

After the trigger fix, GitHub starts all eight checks for `1238cc111`. The worker
job `113640743703` in run `37874778506` fails at
`test_actual_assignment_refuses_existing_outputs_before_run_read`: the assignment
entry imports `Project` before reaching its output-ownership refusal. CI does
not install AequilibraE, while the previous local environment does. The failed
job log, retrieved through the job-log API while the overall run remains active,
identifies the import failure; it is not a scientific or numerical failure.

Assignment now validates retained paths, exclusive output creation and selected
count inputs before importing native engine classes. Tests that exercise project
open/close failures use an explicit scoped runtime double. It restores the prior
modules even after interruption and raises if a matrix, assignment, traffic
class or skimming constructor is reached. The existing module-load stub stays
minimal, and no native numerical implementation is replaced in production.

A separate Python 3.11.15 environment installs the workflow's lightweight
packages and confirms AequilibraE is absent. All 127 top-level worker test scripts
pass serially in 88.07 seconds. The report is
`prototype/lightweight-worker-suite.json`; per-suite logs remain in the private
`worker-ci-lightweight-20261008/run-1` evidence directory. Forty focused unit
cases also pass in the existing Python 3.14 environment with AequilibraE installed.
Those cases still inject project failures; this is not native solver acceptance.

Forty-two controls pass across unit-import restoration, output directory custody,
project cleanup, count consumption and count retention. The retention runner
initially reports an instrument error: reconstructed adapter functions lose their
keyword defaults and fail before the intended fault. It now preserves positional
and keyword defaults and adds a harmless adapter survivor. The original failure
is not counted as successful fault detection. Actual foreign-destination faults
again fail the stated refusal assertion. No scientific gate, tolerance or holdout
changes, and the frozen preview and database remain untouched.

## Separate recovery acceptance database

The detached worktree
`/home/nathaniel/.local/state/openplan/recovery-acceptance-3cfaae4e` identifies
pushed commit `3cfaae4ea88b8d81ecf9fa443131670957ef4648`. It has no tracked
changes. It is an acceptance checkout, not a new unpublished development branch.
The prior preview remains on its original checkout and service invocation.

`prepare_recovery_acceptance_database.py` creates
`openplan_attempt_cli_be567f0764bd46ab97bdb99e51c1502f` from the explicitly selected,
idle migration21 proof template. The installed Supabase CLI applies migrations
22 and 23 and reapplies them without changing the inventories of 33 existing
model tables. The source retains its original inventories and migration21
history. The target records migration23. Installed catalog checks show recovery
RPC execution privileges `false:false:true` for anon, authenticated and
service_role. No reset, source upgrade or application write occurs.

`prototype/recovery-acceptance-database.json` records the checkout, database,
source, script hash and row inventories. Private CLI logs and the resumable
candidate metadata are in
`/home/nathaniel/.local/state/openplan/recovery-acceptance-3cfaae4e-state`.
Five preflight controls include a harmless survivor and faults for omitted
source and checkout ownership checks. They exercise the exact preflight code
before any external command; they do not substitute for the live migration and
catalog evidence.

This prepares the database only. The isolated authentication service, configured
application build, actual session cookies and recovery browser journey remain
open. Storage and other service workflows are not covered by this preparation.
The existing preview database is not the acceptance target.

The current Supabase changelog was checked before configuration work. The
installed PostgreSQL image and services were inspected without printing their
secrets; this preparation does not upgrade those images. Any new auth setup
must account for the documented
[API_EXTERNAL_URL auth path change](https://supabase.com/changelog/47093-self-hosted-supabase-api-external-url-to-include-auth-v1).
The CLI operation follows the installed help and
[migration command documentation](https://supabase.com/docs/reference/cli/supabase-migration-up).

## Isolated Auth and REST acceptance services

The acceptance clone now has separate, bounded GoTrue and PostgREST containers.
They use the existing pinned images, a new signing secret, loopback-only published
ports, 0.5 CPU each, and memory limits of 256 MB and 128 MB respectively. The
private service manifest retains exact container IDs and credentials under
`recovery-acceptance-3cfaae4e-state/services-private.json`. Do not rerun the
one-time setup script over that manifest. Inspect the retained services first.
The original preview and its database remain separate.

The first Auth startup failed. The proof template contains a current Auth schema
but zero rows in `auth.schema_migrations`. GoTrue replayed 55 old migrations,
then failed because an old OAuth migration expected the removed `client_id`
column. That replay also dropped the empty identities primary key and changed
the flow-state table comment. This is a fixture preparation defect, not a passing
Auth migration or a product recovery result.

Schema-only dumps establish that the original proof template's Auth schema and
the running source's Auth schema match. The clone's primary key and comment were
restored, then its entire normalized Auth schema matched that source too. Only
after that comparison, the source's 77 version-only migration records were copied
additively to the clone. No Auth user records were copied. The comparison removes
pg_dump random restriction markers and comments and excludes ownership and
grants. `prototype/recovery-auth-history-repair.json` records the hashes and
boundary. Initial local repair attempts using `postgres` and peer authentication
failed without changing the schema; the successful repair uses the Auth owner
through its existing password-authenticated connection, with credentials kept
out of command arguments and output.

The retained Auth container then starts successfully. Real HTTP checks create a
synthetic user through the admin endpoint, sign in with a password, retrieve the
same user, refresh the session and reject a wrong password. PostgREST returns the
one fixture model to the service role and no models to that unrelated user.
After these checks, all 33 model table row inventories still match the baseline
in both source and target. `prototype/recovery-services-verification.json` records
service identities and results. These checks exercise real authentication and
one workspace read boundary, not every RLS policy.

The shared API gateway, configured application build, app session cookies and
recovery browser journey remain pending. Storage, outbound email, other identity
providers, worker termination and scientific acceptance remain outside this
result. The setup follows the current [Auth configuration documentation](https://supabase.com/docs/guides/self-hosting/auth/config)
and the auth URL change linked above. The services remain local acceptance
infrastructure, not a production deployment.

## Configured application and queued-run recovery journey

The separate loopback gateway on port 29831 routes Auth and REST to the owned
acceptance services. Its key check rejects missing API keys; REST rejects an
invalid session token. Password sign-in, an unrelated user's empty model read,
and the application-origin CORS preflight pass. Storage returns 404 because this
bounded setup does not configure it. The gateway uses the pinned local Kong
image, one worker, a 256 MB limit and a 0.5 CPU limit. The original gateway is
unchanged. See `prototype/recovery-gateway-verification.json`.

The frozen acceptance checkout at `3cfaae4ea88b8d81ecf9fa443131670957ef4648`
builds with its actual local Supabase configuration. Webpack completes in 50
seconds, TypeScript in 63 seconds, and all 137 static pages complete using two
workers. The build exits 0 under the previously recorded 7 GB memory limit,
zero scope swap and 256-task limit. The app serves on port 3516 under its own
2 GB service limit. Process cwd and `/api/health` identify the frozen checkout
and commit. `prototype/recovery-configured-app-verification.json` records this
initial service invocation. Adding the existing local Census credential later
restarts only this owned service; the final invocation is in the journey summary.
No public build variable changes and no external AI provider is configured.

T3 follows the landing-page sign-in link, submits the synthetic account and
loads its owner dashboard. The signup trigger creates the workspace. Project
and model creation use their application forms, not SQL fixture inserts. The
first worker launch refuses because the project has no study area. A synthetic
110-byte GeoJSON boundary passes through the project's upload handler and save
operation. Reloading the model inherits that saved geometry. The second launch
refuses because the isolated database has no Census tracts. Both refusals leave
zero runs for this model. See `prototype/recovery-project-model-journey.json`.

The authenticated Census ingestion endpoint then fetches genuine Nevada County
tract geometry and ACS demographics using the existing local Census credential.
The first attempt fails when the isolated PostgREST container exceeds its 128 MB
limit and exits 137 with `OOMKilled=true`. The database contains zero tract rows
afterward. The retained container receives a 512 MB limit with no swap and
restarts only after that terminal state is verified. The same ingestion request
then stores 26 tracts with no unmatched records. This is source ingestion, not
model calibration or scientific acceptance. The failure remains recorded in
`prototype/recovery-rest-ingest-memory-failure.json`.

With coverage present, the application queues the synthetic model run with three
unstarted stages. No worker is started or pointed at this database. The owner
reviews its execution state, writes a reason, acknowledges the termination
limit and saves the abandonment decision. The app shows the retained receipt;
a full page reload preserves it. The database contains exactly one receipt
matching the browser copy, the parent is cancelled and managed, and all three
stages are cancelled and managed without active attempts. A direct service-role
stage update is refused with `Managed model stage requires an attempt command`.
An authenticated exact retry returns the same receipt, a changed payload under
the same request identity returns 409, and a mismatched expected account returns
403. No extra receipt appears. The record retains false values for termination
verification, continuation authorization, model resume and evidence verification.
See `prototype/recovery-journey-summary.json`.

This remains partial browser acceptance. T3 pointer clicks sometimes report
success without activating controls. Native DOM clicks through T3 evaluate do
activate them; form typing uses T3 type, and file selection uses an in-page File
and DataTransfer. These prove application handlers and authenticated routes, not
physical pointer behavior or the native file chooser. The download button is
invoked, but no resulting file is found in Downloads, so usable downloaded
artifacts remain unverified. The 390-by-844 resize times out; T3 then reports no
connected preview host. No mobile screenshot, final viewport measurement or
complete browser-console review is obtained. No alternate browser is used.
Physical termination, running-child interruption, restart, scientific acceptance
and practitioner observation remain open.


## Retained-run relaunch presentation, October 8

The queued abandonment journey exposes a misleading control: the cancelled,
attempt-managed run still offers relaunch, although the launch route correctly
refuses retained execution records. The page now reads the existing scoped
relaunch-custody RPC separately from enrollment provenance. It offers reset only
for a new run with verified unstarted custody. Retained, unassessed, missing and
unreadable custody display a refusal explanation. Saved status, evidence access,
reaping rules and route authorization remain unchanged. The route repeats its
check because rendered page data can become stale.

The four focused suites pass 51 tests. The seven-case control campaign includes
baseline, a harmless comment, four targeted faults and restored baseline. Faults
expose an incorrectly offered retained-run control, ignored custody, a missing
eligible control and reversed workspace/run arguments. Source bytes are restored
in finally blocks and hashed in `prototype/relaunch-custody-controls.json`.
Targeted ESLint passes. The first test invocation used the repository root and
failed to resolve application imports; the corrected application-directory run
passes. The first control report expected the wrong assertion wording; the
fault itself failed as intended, and the corrected instrument passes.

These tests use component DOM and mocked RPC/HTTP responses. They do not prove
real database authorization, rendered layout, physical worker recovery or human
acceptance. The acceptance checkout stays at 3cfaae4e and does not contain this
presentation correction. T3 reconnects and reads the model in both tab_16 and a
fresh tab_17, but both snapshot calls still fail on its preview client. The panel
reports hidden even after preview_open. Desktop and mobile visual acceptance
remain open; no alternate browser is used.

Full TypeScript validation passes with no emit or incremental cache: 5,006 files,
55.92 seconds, 4,889,887 KB reported compiler memory. The process uses the existing
6 GB Node heap under a 7 GB systemd scope with swap disabled. This is a type
check, not a fresh production build or browser check of the changed page.

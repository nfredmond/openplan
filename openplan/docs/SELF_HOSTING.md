# Operating your own OpenPlan instance

OpenPlan is free, open-source software. Running it still requires a computer,
storage, maintenance and, for some integrations, an external account or paid
usage. Start with the [local setup](../../README.md). Use
[FIRST_DEPLOYMENT](FIRST_DEPLOYMENT.md) to record what actually works on your
chosen installation; use this page for configuration and operating requirements.

## Deployment profiles and current evidence

| Profile | What exists | What remains unproved |
|---|---|---|
| Local evaluation on Linux with Docker Engine | Supabase CLI configuration, app commands, county-worker Compose and local modeling launchers | Installation by someone unfamiliar with the project, on a clean computer, using only the published instructions |
| Agency-owned production | App build/start commands and separate worker deployment guides | A complete hardened reference installation, unattended recovery and a full restore/cutover of representative agency data |
| Optional hosted providers | Supabase and Vercel integration plus worker deployment examples | Eligibility, cost, capacity, persistence and operating evidence for the agency's actual workload |

The CLI stack created by `npm exec -- supabase start` is for local development
and testing. Supabase says it is not hardened for production and must not be
exposed to external traffic. Agency production needs the separate
[Supabase self-hosting deployment](https://supabase.com/docs/guides/self-hosting),
or an appropriately configured managed service. Putting the web app behind a
public address does not change the CLI stack's status.

The free reference path uses an existing Linux computer and
[Docker Engine](https://docs.docker.com/engine/). Docker Desktop has separate
terms: [government entities require a paid subscription](https://docs.docker.com/subscription-billing/desktop-license/).
No paid provider is provisioned by these instructions. Provider-free cartography
is not implemented: current map surfaces use Mapbox.

OpenPlan's target remains core planning work throughout all 50 states and DC,
with California the deepest implementation and separately validated AequilibraE
and ActivitySim methods. An installation that omits compute or other services
has reduced capability; it does not reduce that product commitment. See the
[v1 contract](../../docs/product/V1_PRODUCT_CONTRACT.md).

## Application configuration

Run app commands from the repository's nested `openplan/` directory. The root
README owns the local install sequence. The reference toolchain is Node 24;
[package.json](../package.json) declares the npm version and commands. This is
not a claim that every other Node version has been tested.

Copy [the environment template](../.env.example) to a private `.env.local` and
configure the services you actually run. Do not commit credentials. Public
browser keys and server secrets have different purposes; the Supabase service
role bypasses row-level security and belongs only in trusted server/worker
configuration.

| Setting | Purpose and acceptance check |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Point all components at the intended database. Confirm a saved project survives sign-out/sign-in and that a second workspace cannot read it. Local credentials belong only to the selected local instance. |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin. Match Supabase Auth Site URL and allowed callback/reset redirects. The checked-in local Auth configuration uses `http://127.0.0.1:3000`; use one consistent origin and test actual links. |
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | Public `pk.` token for current map surfaces. The legacy `NEXT_PUBLIC_MAPBOX_TOKEN` alias is accepted. Check the visible map and browser console, not token shape alone. |
| `CENSUS_API_KEY` | Demographic/source requests and travel-model inputs. Activate the key and confirm the required source data can be retrieved for the selected geography. A configured key does not establish data coverage. |
| `OPENPLAN_INTEGRATION_KEY_SECRET` | High-entropy secret for stored per-workspace integration keys. Generate securely, preserve with recovery configuration, and restrict access. Changing it invalidates existing encrypted keys. |
| `ANTHROPIC_API_KEY` | Optional cloud AI requests. Inspect the material being sent and the provider cost before enabling. Model overrides are listed in the environment template. |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Optional outbound application email. Without these, teammate invitations use a copyable link. Supabase Auth email delivery is configured separately. Test invitation and password-reset flows independently. |
| `CHROME_EXECUTABLE_PATH` | Local Chrome/Chromium used for report PDF typesetting. If unavailable, the app uses its disclosed built-in writer tier; inspect the exported document. |
| `CRON_SECRET` | Shared secret for the authenticated maintenance requests listed below. Configure the scheduler's protected environment as well as the app. |

`NEXT_PUBLIC_*` values are included at build time: rebuild after changing them.
Restart server processes after changing their private environment. A worker
container's environment file is read when the container is created; changing
the file and restarting only the app leaves that worker with old values.

For local evaluation, these are the existing database and app commands:

```bash
npm exec -- supabase migration up --local
npm run dev
```

`npm run dev` also runs `predev`, which synchronizes local migrations. For an
already provisioned deployment, the app-only build/start sequence is:

```bash
npm ci
npm run build
npm start
```

`npm start` does not apply migrations, configure TLS, supervise services or
install Supabase. Apply release-appropriate migrations to the intended target
before admitting traffic. A linked managed project uses
`npm exec -- supabase migration up --linked` after linking that project; this
is not the command for an independently self-hosted Supabase deployment.
The latter's migration/role/extension setup still needs a tested OpenPlan recipe.

## Local compute and document processing

A shared public worker service has not been commissioned by this review. The planned hosted preview will need the services for its advertised workflows. Independent operators run those services on
their own infrastructure or arrange a separate provider. Long-running compute
needs a durable worker process, its inputs and persistent artifact storage.

**County-onramp worker.** Before creating its container, configure
`CENSUS_API_KEY`, `OPENPLAN_COUNTY_ONRAMP_WORKER_URL` (the local job endpoint is
`http://127.0.0.1:8686/jobs`), `OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN` and a separate
`OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN` in `.env.local`. Both sides must
use the matching token for each direction. Set
`OPENPLAN_COUNTY_ONRAMP_CALLBACK_ORIGIN` when the worker needs a different
reachable callback origin. Then, from the app directory:

```bash
npm run modeling:up
npm run modeling:logs
```

The [Compose file](../../workers/county_onramp_worker/docker-compose.yml) uses
host networking, a loopback listener and a repository bind mount. This is the
Linux reference topology. Check host/user permissions and callback reachability;
a Docker Desktop installation needs its own networking review. After changing
worker environment values, recreate the affected container with the configured
environment and preserve its mounted data. Restart the app too. An accepted job,
authenticated callback and inspectable output establish more than a health reply.

**General demand-model workers.** `npm run modeling:local` starts the local
AequilibraE and ActivitySim pollers. It is a separate path from `modeling:up`,
which starts the county-onramp service. The launchers discover existing Python
environments; they do not install a complete execution environment. Follow the
[AequilibraE guide](../../workers/aequilibrae_worker/DEPLOY.md) and
[ActivitySim guide](../../workers/activitysim_worker/DEPLOY.md).
ActivitySim explicitly falls back to preflight-only when its execution
environment is missing. A running poller therefore does not establish that
ActivitySim executed, and an executed model does not establish scientific validity.

For co-located run artifacts, configure `OPENPLAN_WORKER_LOCAL_ROOT` to the
persistent filesystem root shared by the app and worker. Include required
`local://` artifacts in recovery inventory. A remote worker cannot use an
unshared local path as if it were object storage.

`OPENPLAN_MODELING_WORKER` declares whether a poller is deployed or absent;
observed run and heartbeat evidence also matter. The optional push endpoint uses
`OPENPLAN_MODELING_WORKER_URL` and `OPENPLAN_MODELING_WORKER_TOKEN` together.
Follow its deployment guide for polling versus push-only configuration. Current
heartbeat/reaper behavior still needs long-run interruption and recovery proof;
keep a failed or inconclusive run in that state until its evidence is resolved.

**Documents and aerial processing.** Local text extraction and OCR are distinct
from cloud AI extraction of structured material. OCR uses
`OPENPLAN_KB_OCR_WORKER_URL`, `OPENPLAN_KB_OCR_WORKER_TOKEN`,
`OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN` and `OPENPLAN_KB_OCR_CALLBACK_URL`.
Install the language data selected by `OPENPLAN_KB_OCR_LANGUAGES`; the callback
ceiling is configured by `OPENPLAN_KB_OCR_CALLBACK_MAX_BYTES`. Follow the
[OCR deployment guide](../../workers/ocr_worker/DEPLOY.md). Aerial processing has
its own [worker deployment guide](../../workers/odm_worker/DEPLOY.md) and
configuration in the environment template. An external worker receives the
inputs needed for its job; selecting a remote endpoint changes where those
inputs are processed.

**OWP review-file rendering.** After applying the additive migrations, run
`npm run worker:document-exports` from `openplan/` as a supervised process.
It uses the same private Documents bucket and database job records as intake;
there is no additional queue service. Configure the app's Supabase URL and
service-role key in the private `.env.local` read by this command. Install
Poppler (`pdftoppm`) and a compatible Chrome/Chromium executable; set
`CHROME_EXECUTABLE_PATH` if it is not `/usr/bin/google-chrome`. A proposal with
cited source charts cannot silently fall back to a PDF renderer that omits them.
No AI provider account is required for manual preparation, text/OCR intake,
reconciliation or review files.

`OPENPLAN_DOCUMENT_EXPORT_WORK_DIR` selects a private persistent cache directory;
the default is `~/.local/state/openplan/document-exports`. Back it up with the
Documents bucket and database. A completed artifact records its revision,
format, checksum and storage identity. A worker restart can resume an expired
lease and reuse verified rendered bytes; a failed job offers retry in Programs.
The cache is retained without automatic cleanup. Treat it as confidential and
monitor disk use. Print the workbook's selected **Print summary** sheet; use the
PDF for the complete formatted program. Wide editable workbook tabs are intended
for on-screen review, not entire-workbook printing.

**Saved API generation worker.** The retained API-job worker
can be started with `npm run worker:provider-api` from `openplan/`, after applying
migration `20261012000002_assistant_api_turns.sql`. `npm run worker:provider-api --
--once` performs one recovery or queue cycle. In a project, open Planner Agent, then Project task · choose provider, and select
Saved workspace API. Choose a connection and one of its configured model IDs,
review its destination and sharing scope, and acknowledge any provider charges.
The request stays queued until this worker receives it. Workspace settings
retains each configuration revision; editing or revoking a connection interrupts
its active old-revision requests and keeps completed history.
Use the same private Supabase URL, service-role key and integration encryption
configuration as the app. No provider key is read from an environment fallback.

The command needs Node 24 and Linux `/usr/bin/flock` plus `/usr/bin/cat`, as does
the native connector. `OPENPLAN_PROVIDER_API_WORK_DIR` selects a private persistent
directory. The default is a deployment-specific directory under
`~/.local/state/openplan/provider-api-worker`, derived from the configured
Supabase URL. Its journal retains that exact destination and attempt identity.
Back it up privately with the database; it contains frozen project information
and may contain an undelivered answer, but does not store provider credentials.

A restart of a running attempt records interruption and never calls the model
again. A completed journal retries only its exact result delivery. If database
access fails, retain the journal and restart against the same deployment. A
corrupt or differently targeted journal is refused before dispatch. Preserve the
directory for recovery; do not erase it or transplant it between deployments to
clear an error. SIGINT/SIGTERM abort active work and preserve delivery state.
Cancellation is observed periodically and rechecked at database completion; it
cannot reverse a provider request or charge already accepted. Reservations are
conservative dispatch accounting, not invoices. Real process and browser recovery checks use a synthetic local API, so live
provider account access, billing and answer usefulness remain unmeasured. See the
[worker evidence](../../docs/reviews/2026-09-12-api-worker/VERIFICATION.md) and
[project UI evidence](../../docs/reviews/2026-09-12-api-project-ui/RESUME.md).

When working with multiple local stacks, supply `OPENPLAN_SUPABASE_WORKDIR`
explicitly to **every** live test/QA command. The application `.env.local` is not
implicitly loaded by Vitest. Example: `OPENPLAN_SUPABASE_WORKDIR=/absolute/stack
npm run test:rls-live` (one shell command). The guarded `db:sync` additionally
refuses a stack whose API URL differs from the application's effective URL.

## Services, schedules and upgrades

A production installation needs named ownership of TLS, firewall rules,
service supervision, database and storage persistence, secrets, outbound
connections, monitoring, backups and recovery. No single checked-in command
currently establishes all of those for a new agency.

The schedules in [vercel.json](../vercel.json) are:

| Authenticated GET endpoint | Required schedule |
|---|---|
| `/api/cron/reap-model-runs` | Every 5 minutes |
| `/api/cron/reap-gtfs-ingests` | Every 15 minutes |
| `/api/cron/sweep-deadlines` | Daily at 13:00 UTC |

On a self-hosted installation, arrange a scheduler that sends
`Authorization: Bearer <CRON_SECRET>` using a protected environment and records
failures. Merely setting a variable in an interactive shell does not configure
cron. Confirm the intended cleanup/reminder effects as well as delivery.

Before upgrading, read the [release notes](../../CHANGELOG.md), capture the
[recovery inventory](ops/BACKUP_AND_RESTORE.md), and rehearse the release against
populated data. Coordinate migrations and app/worker rollout rather than racing
an automatic deployment. Forward migrations are not an automatic rollback path;
old-code compatibility must be established for the particular release. Keep the
previous instance and recovery point until the new one is accepted.

The [safe walkthrough updater](../scripts/ops/safe-refresh-walkthrough.py)
maintains an already configured local service. The desktop control uses this
entry point. It checks the service directory and reported predecessor commit,
builds a separate candidate, retains changed source/runtime and recovers after
a failed promotion. Its local journal supports interrupted-update recovery.
The underlying shell builder remains a low-level tool; direct invocation does
not provide these recovery protections. See the [operator instructions](ops/RUNBOOK.md#local-demo-update-and-recovery)
and [isolated exercise record](../../docs/reviews/2026-09-06-housekeeping/VERIFICATION.md).
Runtime database identity and accepted-release selection remain unproved. Use
[which-openplan.sh](../scripts/ops/which-openplan.sh) and recorded build identity
alongside actual saved-work checks.

## External connections and optional providers

Local storage does not mean offline operation. The following is the inspected
integration inventory; a complete network trace of every reachable workflow has
not been performed. Record the services enabled for your installation and verify
sensitive workflows before using private planning material.

| Destination | Information sent or retrieved |
|---|---|
| Mapbox | Map styles, tiles and camera/area requests. GIS import static previews send the imported layer's bounding polygon in the image request. See [pricing](https://www.mapbox.com/pricing) and [GL JS license](https://github.com/mapbox/mapbox-gl-js/blob/main/LICENSE.txt). |
| Configured Supabase origin | Accounts, planning records, files and database queries. Local CLI evaluation keeps this service local; choosing a hosted origin sends this traffic to that provider. See [hosting responsibilities](https://supabase.com/docs/guides/self-hosting) and [managed pricing](https://supabase.com/pricing). |
| Census, TIGERweb, LEHD, OSM and other source services | Geography/source queries and downloads. Consult [Census](https://www.census.gov/data/developers.html), [TIGERweb](https://tigerweb.geo.census.gov/), [LEHD](https://lehd.ces.census.gov/data/), [OSM terms](https://www.openstreetmap.org/copyright) and [Mobility Database](https://mobilitydatabase.org/). Transit, crash and other integrations add their own source endpoints. |
| Anthropic | Material selected for enabled AI actions: prompts/context, comments and document text or images. [API usage is priced separately](https://platform.claude.com/docs/en/about-claude/pricing). |
| Resend | Recipients, message content and relevant invitation/reminder links. [Provider limits and pricing](https://resend.com/pricing) apply. |
| Configured workers | Job inputs, document/image locators or bytes, configuration, callbacks and outputs. Processing is local only when the configured service and storage are local. |
| Source/package/image registries and tooling | Installation/update downloads and tool telemetry where enabled. Supabase distinguishes CLI telemetry from its self-hosted service in its [documentation](https://supabase.com/docs/guides/self-hosting). |

Hosted providers are optional integrations, with separate terms and costs.
[Vercel Hobby](https://vercel.com/docs/plans/hobby) is for personal,
non-commercial use; its [once-daily cron limit](https://vercel.com/docs/cron-jobs/usage-and-pricing)
does not satisfy the two frequent schedules above. It is not the documented
free agency reference. [Render's free service](https://render.com/docs/free)
is unsuitable as an assumed durable production worker: its documented limits
include ephemeral storage and service interruption. [Fly](https://fly.io/docs/about/pricing/)
and [Railway](https://docs.railway.com/pricing/plans) charge according to their
current plans and resource usage. No fixed monthly estimate or continuing
free allowance is promised here. The cited deployment, Docker Desktop, Vercel cron and hosting-plan boundaries
were rechecked September 6, 2026;
check them again before choosing a service.

## What a successful setup proves

`npm run doctor` diagnoses selected configuration, local services and shallow
worker liveness. It does not prove authenticated dispatch, correct output,
complete schema state, tenant isolation or usability; some unavailable checks
remain warnings. A readiness panel is also a diagnostic, not independent proof.
Complete [the commissioning record](FIRST_DEPLOYMENT.md), preserving failed,
skipped and inconclusive checks. This documentation does not itself establish
a successful new installation or a production-ready release.

## Hosted evaluation and optional administration

Nathaniel's mid-term hosted preview is planned under M15. It must run the same software with working background services and persistent trial data, and disclose remaining release limitations. It is not established as commissioned by this guide. Operator-set resource controls protect the shared machine and approved external spend; they do not create paid software features.

Customers may self-host independently or pay for installation, annual administration and separately scoped customization. Prefer customer-owned hosting, domain and provider accounts with delegated support access. A service agreement states monitoring, updates, backup checks, recovery, support windows and exclusions. It does not promise unlimited compute or customization. When a trial moves to a separate installation, verify complete isolated record/object/artifact transfer, user access and continued work; report export alone does not establish migration. Ending administration must leave a documented, usable installation and its records under customer control.

Public deployment uses production Supabase, real mail/TLS, private admin/worker interfaces, persistent artifacts and tested recovery. Do not expose the local CLI stack. Provider choice, capacity, recurring costs and variable usage require a dated reviewed budget before spending; see the [September 4 hosted-preview research](../../docs/reviews/2026-09-04-pre-handoff/HOSTED_PREVIEW_COST_AND_OPERATIONS_RESEARCH.md)
and the [roadmap](../../docs/ROADMAP.md) for implementation scope.

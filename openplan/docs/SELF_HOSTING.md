# Operating your own OpenPlan instance

OpenPlan is free, open-source software. Running it still requires a computer,
storage, maintenance and, for some integrations, an external account or paid
usage. Start with the [local setup](../../README.md). Use
[FIRST_DEPLOYMENT](FIRST_DEPLOYMENT.md) to record what actually works on your
chosen installation; use this page for configuration and operating requirements.

Production builds allow a 6 GiB Node heap for TypeScript checking. Leave memory
for the operating system and other build processes as well. The default 4 GiB
heap exhausted during a clean v0.60 build; `npm run build` sets the larger
allowance without skipping type checks. This is a build-time requirement, not
the application server's runtime allocation.

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
No paid provider is provisioned by these instructions. The public engagement
map, the Safety crash map, Corridor Analysis, the engagement drawing and
response maps, and the published land use designation map can use a configured
MapLibre style without a Mapbox key. The RTP project map has a source candidate
for the same configuration, pending runtime and browser validation. Other map
surfaces still use Mapbox. See the map configuration below. This does not
establish a complete no-egress installation.

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
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | Public `pk.` token for map surfaces. The legacy `NEXT_PUBLIC_MAPBOX_TOKEN` alias is accepted. A secret `sk.` token is refused. The maps listed under "Maps without a Mapbox key" below can instead use a MapLibre style. Check the visible map and browser console, not token shape alone. |
| `CENSUS_API_KEY` | Demographic/source requests and travel-model inputs. Activate the key and confirm the required source data can be retrieved for the selected geography. A configured key does not establish data coverage. |
| `OPENPLAN_INTEGRATION_KEY_SECRET` | Primary high-entropy secret for stored workspace keys and sealed worker credentials. Generate securely, preserve with recovery configuration, and restrict access. New ciphertext uses this secret. Follow [integration secret rotation](#rotate-the-integration-encryption-secret) before changing it. |
| `OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET` | Optional second secret for reading retained ciphertext during rotation. It does not enable storage without a usable primary. Reads preserve the stored bytes. Web and every worker that decrypts credentials need the same two secrets during a rolling transition. |
| `ANTHROPIC_API_KEY` | Optional cloud AI requests. Inspect the material being sent and the provider cost before enabling. Model overrides are listed in the environment template. |
| `OPENPLAN_SHARED_AI_KEY` | Set to `allow` so a production build lets workspaces without their own key use `ANTHROPIC_API_KEY`. Set it for a single-agency installation. Leave it unset on any deployment with public signup; each workspace then adds its own key. |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Optional outbound application email. Without these, teammate invitations use a copyable link. Supabase Auth email delivery is configured separately. Test invitation and password-reset flows independently. |
| `CHROME_EXECUTABLE_PATH` | Local Chrome/Chromium used for report PDF typesetting. If unavailable, the app uses its disclosed built-in writer tier; inspect the exported document. |
| `CRON_SECRET` | Shared secret for the authenticated maintenance requests listed below. Configure the scheduler's protected environment as well as the app. |
| `OPENPLAN_MAX_OWNED_WORKSPACES` | How many workspaces one person may own. Unset means 5, which includes the workspace created at signup. Each workspace has its own AI and run allowance, so this keeps one account from multiplying them on a deployment with public signup. Use a positive whole number; any other value falls back to 5. Requires migration `20261017000010`. This is an operator limit, not a paid tier. |
| `OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES` | Total bytes one workspace may keep in Storage. Unset means 5 GiB (5368709120). Uploads, generated report files, grant application exports, engagement review files, project evidence bundles and work program exports that would pass it are refused before any upload URL is issued or any byte is stored; if current use cannot be read, the file is refused. The total counts every object whose path begins with the workspace id. Public engagement photos have their own allowance and are not counted. Use a positive whole number; any other value falls back to 5 GiB. Requires migration `20261017000010`; migration `20261017000013` stops members from uploading report and grant export files around it. This is an operator limit, not a paid tier. |
| `OPENPLAN_HEALTH_TOKEN` | Turns on `GET /api/health/deep`, which answers only `Authorization: Bearer <token>`. Unset means the route answers 404. It reads the database once and Storage once, gives each modeling worker's heartbeat age, and lists every migration version the build expects. Use a long random value and give the same value to your monitor. |
| `OPENPLAN_SENTRY_DSN` | Optional. A Sentry project DSN (Sentry's free Developer plan works). Unset means error reports stay in this deployment's server log. When set, each browser error an error page catches, and each server request error, is scrubbed and sent to that project from the server. Browsers never contact Sentry, so the content-security policy does not change. |

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

## Rotate the integration encryption secret

This procedure changes the secret that encrypts provider credentials. It does
not change the provider's API key. Keep a protected copy of both secrets with
the database and worker-journal backups. Do not put either value in a command
argument, report, log or public environment variable.

1. Deploy the version with second-secret support to the web app and every
   worker that reads sealed credentials. Keep the existing primary secret.
   Before replacing an already configured distinct second secret, establish
   that no required record, request, journal or restore point needs it. If it
   is still needed, stop this rotation and retain both existing secrets.
   Two slots cannot preserve three required secrets. This procedure supplies
   no automatic inventory or migration to retire an occupied slot.
2. Generate a new high-entropy secret. Keep the old primary, and set
   `OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET` to the new secret on every reader.
   Restart or redeploy each process. Although named "previous", this setting
   can prepare the next secret for reading. Confirm every reader has this
   configuration before proceeding. An old process with only the old secret
   cannot read new ciphertext.
3. Change each process to the new primary with the old secret in
   `OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET`. Restart or redeploy each one.
   During this transition, prepared processes can read writes from either
   primary. New writes use that process's configured primary.
4. Check an existing workspace key and a new save through the normal workflow.
   Check retained worker requests separately, without dispatching an uncertain
   provider request again. A successful key save does not prove queue recovery.

Reads do not re-encrypt workspace rows or sealed request envelopes. Rewriting
them can change the ciphertext fingerprints that protect queued requests.
Before an app or worker rollback, establish that the candidate readers support
every secret needed by required records. Once required records need both
secrets, keep the web app and credential-reading workers on a build with
second-secret support. Schema compatibility alone does not make an older
single-secret build safe. Do not rewrite retained rows or queued envelopes
to fit it. Use a compatible roll-forward fix if compatibility is uncertain.
See the [hosted rollback procedure](ops/HOSTED_RECOVERY.md#roll-back-the-hosted-app).
There is no automatic inventory or bulk re-encryption command. Keep the old
secret until an inventory establishes that no required live record, retained
request, journal or restore point still needs it. Saving a workspace key again
does not update older queued envelopes or backups. Removing the second secret
makes ciphertext written with it unreadable. A missing or short primary still
disables key storage and decryption, even with a usable second secret.

This read compatibility is not provider-key revocation or a complete response
to a disclosed encryption secret. Plan those actions separately. No hosted
secret rotation is implied by shipping this code.

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
Both local AequilibraE launchers check installed AequilibraE, NumPy and pandas
versions against `workers/aequilibrae_worker/requirements.txt`, then check imports.
The preflight uses `packaging`, included in that requirements file. Automatic
selection tries `.venv311`, then `.venv`, and reports rejected candidates. To bind
an existing external environment, set an absolute interpreter path, quoted when
it contains spaces:

```bash
OPENPLAN_AEQUILIBRAE_PYTHON="/path to execution env/bin/python" npm run modeling:local
```

The same variable works with `npm run worker:aequilibrae`. An explicitly selected
missing, nonexecutable or incompatible interpreter stops the launcher without
fallback. The check does not install or modify an environment. Dependency
adherence and imports do not establish numerical behavior or scientific validity.
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

**Engagement translation worker.** Staff and public comment generation uses
`npm run worker:translation-generation` from `openplan/`. Apply all migrations
through `20261014000020_engagement_public_translation_queue.sql` first; an
upgrade from v0.58.1 applies eleven migrations without resetting saved data.
Use the app's Supabase service credential and integration encryption secret.
Keep `OPENPLAN_TRANSLATION_GENERATION_WORK_DIR` on private durable storage and
reuse it after restart so retained output can be delivered without another model
call. The default directory is partitioned by database beneath
`~/.local/state/openplan/translation-generation-worker/`. Back it up with the
database. Requests stay queued until the worker runs; `-- --once` performs one
claim or recovery cycle. The [runbook](ops/RUNBOOK.md#translation-recovery-worker)
explains interrupted attempts and retained output. Manual translation wording
and saved reads do not require new provider usage.

**Synthesis preparation worker.** Apply migrations through
`20261015000012_engagement_synthesis_preparation_queue.sql`, then run
`npm run worker:synthesis-preparation` from `openplan/`. It prepares explicitly
enqueued segment, context and thematic requests using retained inputs. It does
not create provider authorization or make model calls. Staff generation controls
remain under development. Add `-- --once` for one bounded recovery/discovery pass.

Use the app's Supabase URL and service credential. Keep
`OPENPLAN_SYNTHESIS_PREPARATION_WORK_DIR` on private durable storage; the worker
partitions that absolute root by database target. The default root is
`~/.local/state/openplan/synthesis-preparation-worker`. SIGINT and SIGTERM stop
active work and polling. Restart with the same root and database to recover
pending attempts. The [preparation runbook](ops/RUNBOOK.md#synthesis-preparation-worker)
defines exit codes, retained custody, limits and supervisor requirements.

**Saved API generation worker.** The retained API-job worker
can be started with `npm run worker:provider-api` from `openplan/`, after applying
migration `20261012000002_assistant_api_turns.sql`. `npm run worker:provider-api --
--once` performs one recovery or queue cycle. In a project, open Planner Agent, then Project task · choose provider, and select
Saved API. Choose a connection and one of its configured model IDs,
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

**Map packages.** Migration `20261017000001_project_map_packages.sql` adds map
package records and the private `project-map-packages` bucket, 1 GiB per object.
Files arrive through short-lived signed upload URLs, so the storage service's
own upload limit must allow them: the local `supabase/config.toml` sets
`file_size_limit = "1GiB"`, and a hosted project needs the same in its storage
settings. `OPENPLAN_MAP_PACKAGE_MAX_BYTES` lowers the ZIP size the app accepts.
OpenPlan runs no model for a package and holds no provider key for it. Claude
Fable 5.1 builds packages on a planner's own computer through the connector's
`maps` command; see the [connector guide](../../workers/planner_agent_connector/README.md#map-packages).

When working with multiple local stacks, supply `OPENPLAN_SUPABASE_WORKDIR`
explicitly to **every** live test/QA command. The application `.env.local` is not
implicitly loaded by Vitest. Example: `OPENPLAN_SUPABASE_WORKDIR=/absolute/stack
npm run test:rls-live` (one shell command). The guarded `db:sync` additionally
refuses a stack whose API URL differs from the application's effective URL.

## Services, schedules and upgrades

The opt-in retained transit import candidate has a separate
[worker and recovery procedure](ops/GTFS_MANAGED_INGESTION.md). It requires
coordinated private file persistence and explicit worker installation. Its four
migrations remain unreleased; do not enable it on an unverified installation.

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
| `/api/cron/sweep-engagement-photos` | Daily at 10:30 UTC |

On a self-hosted installation, arrange a scheduler that sends
`Authorization: Bearer <CRON_SECRET>` using a protected environment and records
failures. Merely setting a variable in an interactive shell does not configure
cron. Confirm the intended cleanup/reminder effects as well as delivery.

### Monitoring

- `GET /api/health` is public and reads nothing. It names the commit, the
  version, and how many migrations the build expects with the latest version.
  Point a free uptime monitor at it; a reply proves the app answers, not that
  its database works.
- `GET /api/health/deep` needs `OPENPLAN_HEALTH_TOKEN`. It answers 503 when the
  database or Storage read fails. Only the modeling workers write heartbeats;
  the Node queues do not yet, so a stopped queue does not show here.
- `npm run ops:check-deep-health` compares the migrations the deployed build
  expects with the ones a Supabase-hosted project has applied, and fails when
  the database lacks one. It needs `OPENPLAN_HEALTH_URL`,
  `OPENPLAN_HEALTH_TOKEN`, `OPENPLAN_SUPABASE_PROJECT_REF` and a Supabase
  personal access token in `SUPABASE_ACCESS_TOKEN`, which it uses only to list
  migrations. It compares whole sets, because migrations may be applied out of
  numeric order. The repository's Production Health workflow runs it when the
  repository variable `OPENPLAN_SUPABASE_PROJECT_REF` and the secrets
  `OPENPLAN_HEALTH_TOKEN` and `SUPABASE_ACCESS_TOKEN` are set; until then it
  prints a notice. An independently hosted Supabase has no Management API; run
  `npm exec -- supabase migration list` against it instead.
- Error pages report what they caught to `/api/client-errors` on the same
  deployment, which writes one scrubbed line to the server log (and to Sentry
  when `OPENPLAN_SENTRY_DSN` is set). Reports carry the page path with share
  and invitation tokens replaced, the error's type, message, digest and stack,
  and no user, workspace, cookie or query string.
- Responses carry a `Content-Security-Policy-Report-Only` header beside the
  enforced policy. It is the same policy without `'unsafe-eval'`; browsers
  report what it would block to `/api/csp-report` and block nothing.

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
| Mapbox | Map styles, tiles and camera/area requests. GIS import static previews send the imported layer's bounding polygon in the image request. The public engagement map's place search sends what a resident types and the map's centre to Mapbox's geocoder; `OPENPLAN_PUBLIC_PLACE_SEARCH=off` removes it. See [pricing](https://www.mapbox.com/pricing) and [GL JS license](https://github.com/mapbox/mapbox-gl-js/blob/main/LICENSE.txt). |
| Map style host (only without a Mapbox key) | When `NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL` names a public style such as OpenFreeMap's, the resident's browser fetches the style, tiles, fonts and sprites from that host. A style served by the deployment itself sends nothing out. |
| Configured Supabase origin | Accounts, planning records, files and database queries. Local CLI evaluation keeps this service local; choosing a hosted origin sends this traffic to that provider. See [hosting responsibilities](https://supabase.com/docs/guides/self-hosting) and [managed pricing](https://supabase.com/pricing). |
| Census, TIGERweb, LEHD, OSM and other source services | Geography/source queries and downloads. Consult [Census](https://www.census.gov/data/developers.html), [TIGERweb](https://tigerweb.geo.census.gov/), [LEHD](https://lehd.ces.census.gov/data/), [OSM terms](https://www.openstreetmap.org/copyright) and [Mobility Database](https://mobilitydatabase.org/). Transit, crash and other integrations add their own source endpoints. |
| Anthropic | Material selected for enabled AI actions: prompts/context, comments and document text or images. [API usage is priced separately](https://platform.claude.com/docs/en/about-claude/pricing). |
| Resend | Recipients, message content and relevant invitation/reminder links. [Provider limits and pricing](https://resend.com/pricing) apply. |
| Sentry (only with `OPENPLAN_SENTRY_DSN`) | Scrubbed error reports: the failing page's path with tokens replaced, error type, message, digest, stack, release and commit. Sent from the server, not the browser. See [Sentry pricing](https://sentry.io/pricing/). |
| Configured workers | Job inputs, document/image locators or bytes, configuration, callbacks and outputs. Processing is local only when the configured service and storage are local. |
| Source/package/image registries and tooling | Installation/update downloads and tool telemetry where enabled. Supabase distinguishes CLI telemetry from its self-hosted service in its [documentation](https://supabase.com/docs/guides/self-hosting). |

### Maps without a Mapbox key

With no Mapbox key, these maps are drawn by MapLibre from a style you choose:

- the public engagement map on `/engage/<token>` and `/embed/<token>`;
- the Safety crash map on `/safety`;
- Corridor Analysis on `/explore`;
- the drawing map used by comment forms, surveys and study-area pickers, and
  the map of engagement responses;
- the published land use designation map on published plans, plan reviews and
  land use reports;
- the RTP cycle project map on staff cycle pages and `/plan/<shareToken>`
  (source candidate; runtime and browser validation pending).

October 19 source checks pass 44 focused RTP tests and strict scoped lint.
The tests use map doubles. Browser behavior, emitted worker/CSS assets, WebGL
and provider operation remain unverified.

Set `NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL` and rebuild, since `NEXT_PUBLIC_*`
values are fixed at build time. A Mapbox key, when set, takes precedence. Each
map credits the sources its style declares, so keep the style's attribution.
If a browser cannot start MapLibre (it needs WebGL2), the map shows a notice in
its place and the rest of the page still works.

The RTP map preserves its refusal of an unusable configured Mapbox token when
neither token variable supplies a public `pk.` token, even if an open style is
configured. Remove the unusable token and rebuild to choose the open style.
A public token that fails at runtime does not trigger a provider switch.

What still needs a Mapbox key:

- Place search on the public engagement map, which uses Mapbox's geocoder.
- The background picker (streets, satellite, terrain), on the public map and on
  Safety. Its backgrounds are Mapbox styles. Without a key there is no picker
  and the map uses your one style.
- The shell map on the Aerial index, the Aerial mission maps and flight plan
  editor, the traffic volume and model agreement maps, the participation heat
  map, and the static preview in GIS layer import. The RTP candidate above
  remains pending validation.

On Corridor Analysis your style is used in both light and dark mode; with a key
the map follows the page's mode. Labels for uploaded workspace layers and land
use designations use the fonts your style serves, and are left off if it
serves none.

Two ways to set it:

- **Fully local, no outside requests.** Cut a regional extract from a Protomaps
  build with the [pmtiles CLI](https://docs.protomaps.com/pmtiles/cli), for
  example `pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles
  region.pmtiles --bbox=<west>,<south>,<east>,<north>`, and place it with a
  MapLibre style JSON under `openplan/public/maps/`. Point the style's vector
  source at `pmtiles:///maps/region.pmtiles` and set
  `NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL` to the style's path on the deployment,
  such as `/maps/<style>.json`. Street names and the
  pin-group counts appear only if the style also lists `glyphs` (fonts) the
  deployment serves; without them the map draws without labels. Keep the style's
  OpenStreetMap attribution.
- **A free public style, no key or account.** For example
  `NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty`.
  The style's host is added to the content-security policy automatically; list
  any other tile, font or sprite hosts in `OPENPLAN_MAP_EXTRA_ORIGINS`. Read the
  host's terms before relying on it for a public campaign.

Both were checked in a browser on October 11, 2026, against a Ukiah-area
extract and against OpenFreeMap's Liberty style.

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

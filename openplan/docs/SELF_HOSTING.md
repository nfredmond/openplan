# Self-hosting OpenPlan

OpenPlan is free and open source. Any agency, MPO/RTPA, city, county, tribe, non-profit, or
planning/environmental consultancy can run its own copy — your geography, your data, your database,
no involvement from anyone else.

This is the deployment guide for the people who will operate it. It is written for a competent IT
team or a technically-minded planner; it assumes no prior knowledge of the codebase.

**There is currently no hosted OpenPlan instance** — running your own copy (locally or deployed)
is how you use it today. If a hosted deployment exists in the future it will be announced in the
README; nothing in this guide changes either way.

---

## What you are standing up

| Piece | What it is | Required? |
|---|---|---|
| **The web app** | Next.js 16 app in `openplan/`. Runs on Vercel, or any Node host. | Yes |
| **Supabase project** | Postgres + PostGIS + Auth + Storage. Holds all of your data. | Yes |
| **Mapbox token** | Renders every map surface. | Yes, in practice |
| **Census API key** | ACS demographics, equity tracts. Free. | Strongly recommended |
| **Anthropic API key** | AI drafting, synthesis, translation, the in-app assistant. | Optional |
| **AequilibraE worker** | Separate Python process for network-assignment model runs — run always-on polling your database, or as a pool OpenPlan pushes to. | Only for modeling |

The app tells you, on the dashboard, which of these are missing and what each one costs you. That
panel is the authoritative answer for a running deployment — this document is the setup path.

---

## 0. Local development (no cloud accounts needed except Mapbox)

To run OpenPlan on your own machine with a local database — for development, evaluation, or a
single-user workstation:

1. Install [Docker](https://docs.docker.com/get-docker/) (the local Supabase stack runs in it)
   and Node 20+.
2. From `openplan/`:

   ```bash
   npm ci
   npm exec -- supabase start
   ```

   `supabase start` prints the local **API URL**, **anon key**, and **service_role key** when the
   stack is up.
3. Copy `.env.example` to `.env.local` and set at minimum:
   - `NEXT_PUBLIC_SUPABASE_URL` → the printed API URL (`http://127.0.0.1:54321`)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → the printed anon key
   - `SUPABASE_SERVICE_ROLE_KEY` → the printed service_role key
   - `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` → your free Mapbox public token
4. Apply the schema:

   ```bash
   npm exec -- supabase migration up
   ```

5. `npm run dev`, then open `http://localhost:3000` and sign up. Local email confirmation is
   disabled, so the account activates immediately. Signing up provisions your workspace; you
   then pick your own geography and create your own records — there is no demo dataset to load,
   and nothing about the app is fitted to one place.

One local quirk: the local Supabase config sets its auth site URL to `http://127.0.0.1:3000`, so
the password-reset round-trip (`/forgot-password` → emailed link → `/auth/callback`) works from
`127.0.0.1:3000` but not from `localhost:3000`. Normal sign-in works from either.

### Keeping an always-on local instance (optional)

If you want a persistent instance to open in front of someone — rather than starting a dev
server each time — run it from a **second checkout** and keep that checkout current with
`scripts/ops/refresh-walkthrough-instance.sh`:

```bash
scripts/ops/refresh-walkthrough-instance.sh ~/apps/openplan
```

It fast-forwards the instance to `origin/main`, reinstalls, rebuilds, and restarts the service
unit that serves it. It **refuses** to run if that checkout has uncommitted changes or commits
that were never pushed, so refreshing a demo box can't cost you work. It never copies secrets;
it only reports, by name, variables your canonical `.env.local` defines that the instance is
missing — worth heeding, because a missing one degrades a feature silently rather than loudly.

Use a separate checkout on purpose: `next dev` in your working copy and `next start` in the
instance would otherwise contend for the same `.next` directory.

Everything below this point is the production/deployment path.

---

## 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com). Note the project ref (the subdomain of
   your project URL) — everything below refers to *your* project, never anyone else's.
2. From *Project Settings → API*, collect:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`

   The service-role key bypasses Row Level Security by design. It is used only in server code and in
   the modeling worker. Never expose it to a browser and never commit it.

3. Apply the schema. From `openplan/`:

   ```bash
   npm exec -- supabase link --project-ref <your-project-ref>
   npm exec -- supabase migration up --linked
   ```

   `migration up` applies only migrations that have not run yet. Do **not** use `supabase db reset`
   against a project with real data — it re-applies every migration from scratch and destroys the
   contents.

   **Apply migrations before you deploy the app, not after.** OpenPlan degrades honestly when a column
   is missing — it says a thing could not be read rather than reporting an empty result as a finding —
   but "could not be read" is still what your users see, and on the public engagement portal that
   audience is members of the public rather than staff. Deploying code ahead of its migrations turns a
   deploy window into a window where every resident who opens a campaign is told the map could not be
   framed. Running them in this order costs nothing and closes that window entirely.

Row Level Security is enabled on every tenant table and scopes rows to workspace membership. Nothing
further is required to isolate one agency's data from another's within a deployment.

### Accounts and workspaces

Sign-up is self-serve and free. A database trigger (`handle_new_user`) provisions a workspace for
each new account automatically, and the account owner can invite teammates from the dashboard. There
is no access queue, no approval step, and no payment step to configure.

**Configure Supabase Auth URLs for your domain.** Under *Authentication → URL Configuration* in the
Supabase dashboard, set the **Site URL** to your deployment's origin and add
`https://<your-domain>/auth/callback` to the **Redirect URLs** allowlist. This is what makes the
email-confirmation link and the password-reset link (`/forgot-password` → `/auth/callback`) return to
your app instead of being rejected. If you leave **Confirm email** enabled (the Supabase default on a
hosted project), sign-up shows a "confirm your email to finish" step and the account activates when
the emailed link is clicked; if you disable it, sign-up drops the user straight into their workspace.
Either way the app handles it — but the redirect URL must be allowlisted first.

---

## 2. Environment variables

Copy `.env.example` to `.env.local` for development, or set these in your host's environment for
production. Grouped by what breaks without each.

### Required — the app will not work

| Variable | Consequence if missing |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | No database, no auth. Nothing works. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side writes fail — workspace provisioning, geography, ingestion. |
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | Every map renders blank: shell backdrop, Explore, Safety, engagement maps. |

**About the Mapbox token.** Get one free at [mapbox.com](https://account.mapbox.com/). It must be a
**public** token — these begin with `pk.`. A secret token (`sk.`) will not work in a browser and
must never be published. The legacy name `NEXT_PUBLIC_MAPBOX_TOKEN` is still accepted as an alias,
but prefer `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`.

`NEXT_PUBLIC_*` variables are inlined at **build** time. Changing one requires a rebuild, not just a
restart.

### Recommended — features return empty without them

| Variable | Consequence if missing |
|---|---|
| `CENSUS_API_KEY` | Equity choropleths stay empty, census-tract ingestion does not populate, ACS-backed corridor demographics are unavailable. These surfaces return *no data* rather than an error — indistinguishable from "there is nothing here for my area" unless you know the key is absent. |
| `ANTHROPIC_API_KEY` | AI-assisted grant drafting, engagement synthesis, translation, moderation, and the in-app assistant are unavailable. Everything else works. |

A Census API key is **free** and issued instantly at
[api.census.gov/data/key_signup.html](https://api.census.gov/data/key_signup.html).

### Optional — specific subsystems

| Variable | What it enables |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | The canonical public origin of your deployment (e.g. `https://plan.example.gov`) — governs the canonical URL and social-preview origin of every public page. On Vercel it falls back to the deployment URL; on other hosts, set it. |
| `CHROME_EXECUTABLE_PATH` | Path to a Chrome/Chromium binary for report PDF typesetting on a non-serverless host. Falls back to `/usr/bin/google-chrome`; without any Chrome, PDFs use the built-in writer tier and disclose it in the document. |
| `OPENPLAN_ASSISTANT_MODEL`, `OPENPLAN_GRANTS_AI_MODEL`, `OPENPLAN_ENGAGEMENT_{SYNTHESIS,TRANSLATION,MODERATION}_MODEL` | Override the Claude model each AI surface uses — cost/quality controls; unset uses the compiled defaults. |
| `OPENPLAN_EQUITY_INGEST_TOKEN` | Bearer token gating the equity-designation tract ingest endpoint. |
| `OPENPLAN_INTEGRATION_KEY_SECRET` | Optional. Enables **per-workspace integration keys**: with it set, workspace owners/admins can store their own Anthropic and Census keys from the dashboard — encrypted with this secret, validated live before saving, and billed to their own provider accounts. **Set it to a high-entropy value** — `openssl rand -hex 32` — never a passphrase: the secret is the only thing standing between a database dump and the stored keys, and stored ciphertexts are only as strong as it is (16 characters is the enforced minimum, not a recommendation). **Unset, per-workspace keys are simply disabled** and the panel says so; the deployment env keys above keep working exactly as before. Rotating or changing this secret invalidates every stored workspace key (they fail decryption and fall back to the deployment env keys), so after a rotation teams re-enter their keys. Keys stored before the salted-KDF upgrade (`v1:`-format ciphertexts) remain readable under the same secret — no re-entry is needed for the upgrade itself. |
| `OPENPLAN_WORKER_LOCAL_ROOT` | Single-machine deployments only: filesystem root where a co-located modeling worker writes artifacts so the app reads them from disk. |
| `OPENPLAN_MODELING_WORKER` | Declares whether a **polling** AequilibraE worker serves this deployment: `deployed` or `absent`. A poller reads your database, so the app has nothing to probe and cannot find out for itself. **Unset means "not declared"** — nothing changes, and the model launch controls go on inferring a missing worker from runs that were queued and then reaped. Declaring it is what lets the *first* launch be honest instead of the second: with `absent`, worker-backed runs are refused at the launch button naming this deployment; with `deployed`, they launch normally, and a run that is never picked up still refuses the next one, because run history outranks the declaration. Not a plan or a tier — nothing here is for sale. |
| `OPENPLAN_MODELING_WORKER_URL` / `_TOKEN` | Optional. A worker OpenPlan **pushes** each queued model run to, instead of waiting for one to poll — which is what lets you run a stateless pool rather than an always-on machine, and is the only configuration in which a planner is told *at launch* whether anything took their run. Both are required together: a URL with no token is refused rather than used, because the endpoint starts minutes of compute on request. Give the base URL; the contract path is appended. Run the worker with `AEQ_WORKER_MODE=push` (or `both`) and the same token. It composes with the declaration above rather than replacing it — every stage is claimed atomically, so a poller and a push pool can both serve one deployment with no coordination. |
| `OPENPLAN_MODELING_QUEUE_DEPTH` | Optional operator bound on how many model runs one workspace may have waiting on the processing worker at once. **Unset means unlimited** and the counting query is never even run — the default, and the right setting for a self-hosted deployment. Set it only to protect compute you pay for; the refusal names you rather than offering anyone an upgrade. |
| `CRON_SECRET` | Authorizes `/api/cron/reap-model-runs`, which marks crashed model runs as failed instead of leaving them queued forever. Vercel sets and sends this automatically; on another host, set it and send `Authorization: Bearer $CRON_SECRET` from your scheduler. |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Outbound email. Without them the app does not pretend to send: teammate invitations produce a link the inviter copies and sends themselves. |
| `OPENPLAN_COUNTY_ONRAMP_WORKER_URL` / `_TOKEN` / `_CALLBACK_BEARER_TOKEN` | Dispatches county-onramp jobs to a worker. Without the URL the app prepares the job and reports `deliveryMode: "prepared"` rather than claiming it was submitted — and `/county-runs` says so *before* the first launch rather than after it, since the URL is the same test the dispatcher itself applies. Unlike the modeling worker there is nothing extra to declare: configuring the URL is the declaration. |
| `OPENPLAN_AERIAL_PROCESSING_*` | Aerial Ops integration with an external processing platform. |
| `LODES_YEAR` | Pins the LEHD LODES vintage used for commute flows. |
| `OPENPLAN_MONTHLY_RUN_CAP` | An optional per-workspace monthly cap on expensive runs. **Unset means unlimited**, which is the default and the right setting for a self-hosted deployment. Set it only if you run a public deployment and need to protect your own compute. It is an operator limit, not a tier — model-run launches count 5×, everything else 1×, and the refusal names you rather than offering an upgrade. |

### Removed

`OPENPLAN_STRIPE_*`, `STRIPE_SECRET_KEY`, `OPENPLAN_BILLING_*` no longer do anything — the
Stripe/subscription/plan subsystem has been deleted. OpenPlan has no plans, no tiers, no per-plan
quotas, and no payment step. If these are set in an existing deployment, remove them.

**Nothing in OpenPlan is gated behind payment.** If you find a surface that refuses an action for a
billing-shaped reason, that is a bug — please report it.

---

## 3. Deploy the web app

On Vercel the repo works as-is — `vercel.json` sets the install and build commands and registers the
run-reaper cron. Set the environment variables in the project settings, then deploy.

On any other Node host, from `openplan/`:

```bash
npm ci
npm run build     # webpack builder, not Turbopack
npm start
```

Then schedule `GET /api/cron/reap-model-runs` every ~5 minutes with an
`Authorization: Bearer $CRON_SECRET` header.

---

## 4. Set your workspace geography

After the first sign-in, open the dashboard and set the **workspace geography** — the county, city,
CDP, or metro area where your agency works. This is the one place OpenPlan records "where are we",
and several surfaces read it:

- map cameras open on your area instead of a neutral continental view;
- stage-gate templates bind to your state's rules rather than staying unbound;
- census tracts for your county are ingested so equity layers populate;
- Safety and modeling study areas pre-fill.

Until it is set, those surfaces behave neutrally and say so. OpenPlan will never substitute a
plausible-looking default place.

---

## 5. Modeling worker (only if you want model runs)

Screening-grade network assignment runs in a separate Python process — the AequilibraE worker in
`workers/aequilibrae_worker/`. See
[`workers/aequilibrae_worker/DEPLOY.md`](../../workers/aequilibrae_worker/DEPLOY.md) for the
deployment commands.

**There are two ways to start it, and they cost different amounts.** `AEQ_WORKER_MODE` on the worker
selects one; both execute runs through exactly the same code, so nothing about a run differs between
them.

| Mode | What it is | What it costs | Deploy with |
| --- | --- | --- | --- |
| `poll` (default) | The worker reads queued runs out of your Supabase project. The app never calls it, so there is no URL to configure. | An always-on process. Fly.io is roughly **$3–5/month**; Railway's monthly free credit covers light use. | `workers/aequilibrae_worker/fly.toml` |
| `push` | The worker serves an HTTP trigger, and the app POSTs each queued run to it. Nothing has to stay running between runs. | Whatever your platform charges for the compute a run actually uses — a scale-to-zero pool idles at nothing. | `workers/aequilibrae_worker/fly.push.toml` |
| `both` | Both at once, with nothing for you to coordinate. Between processes, every stage is taken with an atomic *queued → running* claim, so whichever reaches a stage first runs it and the other stops — no lock to configure, and no way for a run to execute twice. Inside the one process, the polling thread and the push thread execute stages one at a time rather than side by side. | As `poll`. | either, with `AEQ_WORKER_MODE=both` |

The two Fly configs are separate files because they are opposite configurations: the polling one has
no HTTP service and is never stopped, the push one serves a port and is allowed to stop when idle.
`DEPLOY.md` has the commands for both, plus Railway and plain Docker.

**To use the push mode**, set `OPENPLAN_MODELING_WORKER_URL` to the worker's base URL and
`OPENPLAN_MODELING_WORKER_TOKEN` to a shared secret, and set the same token on the worker (with
`AEQ_WORKER_MODE=push`). Both are required together — a URL with no token is refused rather than
used, because that endpoint starts minutes of compute on request. The contract path is appended for
you, so give the base URL.

This is also the only configuration in which OpenPlan can tell a planner **at launch** whether
anything took their run: the push either is accepted or is not, and either answer is on screen
immediately instead of arriving fifteen minutes later as a reaper failure.

**Two things push mode asks of you, and it is not honest to leave them out.**

1. *The pool must stay alive while a run drains.* The worker answers the push immediately and then
   executes for minutes, so a platform that reclaims an instance the moment it looks idle can stop
   one mid-run. The worker treats a stop signal as *stop accepting, then finish* — it drains what it
   accepted and names in its logs anything it could not — but only if your platform waits: set
   `kill_timeout` (Fly), `terminationGracePeriodSeconds` (Kubernetes) or `docker stop --timeout` at
   least as high as your longest stage. `fly.push.toml` sets Fly's maximum of five minutes.
2. *Schedule the staleness sweep.* `/api/cron/reap-model-runs` with `CRON_SECRET` is what turns an
   interrupted or abandoned run into an honest failure. Nothing is silently lost without it — the
   model page reconciles stale runs whenever it loads — but on a push-only deployment there is no
   poller to rescue anything, so the sweep is the safety net.

Acceptance is not completion: a worker that answered "I have it" and then went away leaves a run that
stops progressing, which OpenPlan reports as a stalled run rather than as a success. What it never
becomes is a run that quietly disappeared.

**What this does not do.** It cannot create compute. On a deployment that runs neither a poller nor a
pool, a worker-backed run still cannot execute; what changed is that the planner is now told so at
the moment they launch, by name, instead of watching a queued run die. Everything else in OpenPlan —
every other run mode, every other module — works with no worker at all.

**Tell the app which way you went.** Set `OPENPLAN_MODELING_WORKER` to `deployed` or `absent`. It is
one variable and it takes ten seconds, and it is the difference between a planner being told *before*
they launch that this deployment cannot run screening assignment, and finding out fifteen minutes
later when the reaper fails their run. Because the worker polls, the app has nothing to ping and no
heartbeat to read: without your answer it can only infer a missing worker from runs that have
**already** been queued and abandoned, so the first run on every new deployment is spent discovering
what you could simply have said.

- `absent` — worker-backed run modes (Fast Screening, the behavioral-demand preflight) are refused at
  the launch button, naming this deployment as the reason and pointing the planner at the run modes
  that execute in-process. Every other module is untouched. This is a legitimate configuration, not a
  reduced tier; OpenPlan is free either way.
- `deployed` — nothing is refused. If runs are queued and never picked up anyway, the launch control
  refuses the next one regardless: **what the runs show outranks what the variable says**, in both
  directions, so a retired worker cannot go on vouching for itself and a stale `absent` cannot block a
  worker that is demonstrably running.
- unset — nothing changes from before this existed.

The declaration and the push URL answer different questions: the URL says where a run can be pushed,
the declaration says whether anything is **watching the queue**. With a push endpoint configured, an
undeclared deployment is no longer reported as a gap — there is nothing left for the declaration to
close, because the launch itself now gets an answer.

**If you run a push pool and nothing polls, leave `OPENPLAN_MODELING_WORKER` unset.** This is the one
combination worth spelling out, because the truthful-looking answer is the wrong one. `absent` means
*nothing is watching the queue*, which is literally true of a push-only deployment — and it makes the
launch button refuse every worker-backed run, including ones your pool would have executed happily.
`deployed` would claim a poller you do not run. Unset is the only answer that is both true and
working, and it costs you nothing: the push endpoint answers at launch, which is strictly better than
what the declaration was ever able to say.

**Optionally, bound the queue.** `OPENPLAN_MODELING_QUEUE_DEPTH` caps how many model runs one
workspace may have waiting on the worker at once. **Unset means unlimited**, and the counting query
is skipped entirely — that is what you get by default. Set it only to protect compute you are paying
for. The refusal names you, the operator, and offers nobody an upgrade, because there is nothing to
buy.

The dashboard's configuration panel shows what OpenPlan currently believes about your deployment,
including when the declaration is contradicted by your own runs or by a configured push endpoint, is
set to a value it does not understand, or when a push endpoint is half-configured and therefore
unused.

> **Open question for the project, not for you:** whether OpenPlan should offer a shared hosted
> worker so self-hosting agencies do not each stand one up. That is a cost and trust decision that
> has not been made; today, each deployment runs its own.

---

## Sharing the public engagement portal

Each engagement campaign can publish a public feedback page at
**`/engage/<shareToken>`** on your deployment's own domain. The share token is minted server-side
from the campaign console ("Generate link" under Operator Actions — nothing to invent or type), and
the page only resolves while the campaign status is **Active**; the console's Private / Staged /
Live chip always shows the current state. Everything submitted through the public page lands in
that campaign's moderation queue inside the authenticated console — nothing appears publicly until
a member approves it.

**Regenerating invalidates the old link immediately.** "Regenerate link" mints a fresh token and
saves it in one step; the previous URL stops resolving the moment it lands, everywhere it was
already shared. Use it when a link has leaked beyond its intended audience. "Disable link" takes
the page offline without minting a replacement.

---

## Verifying a deployment

1. Sign up. A workspace should be provisioned automatically.
2. Check the dashboard's configuration panel. It lists anything that is missing and what it costs
   you; a fully configured deployment shows nothing.
3. Set the workspace geography and confirm the map reframes to your area.
4. Invite a teammate from the dashboard and accept the invitation from another account.
5. If you deployed the worker, launch a screening run and watch its stages advance.

## Where to get help

OpenPlan is open source. Issues and questions belong in the repository. There is no support contract
and no vendor to call — which is the point: the software, the schema, and the data are yours.

# Self-hosting OpenPlan

OpenPlan is free and open source. Any agency, MPO/RTPA, city, county, tribe, non-profit, or
planning/environmental consultancy can run its own copy — your geography, your data, your database,
no involvement from anyone else.

**Who this is for.** Whoever is putting OpenPlan on the internet for your team — often a planner
doing it themselves, sometimes a GIS analyst or whoever handles software at your agency. It assumes
no prior knowledge of the codebase, or of the services involved, and explains each one before asking
you to sign up for it. You do not need to be a programmer, but you will be creating accounts and
copying keys between them, so set aside an uninterrupted hour.

**In a hurry?** [`FIRST_DEPLOYMENT.md`](FIRST_DEPLOYMENT.md) is the same path as a
20-minute checklist with no explanation. Use that to work through it; use this document when
something does not behave as expected.

**Do this once, for everybody.** The point of deploying is that nobody else has to install
anything. When you finish, OpenPlan lives at a web address; every planner at your agency visits it,
creates an account, and starts working. If you only want to *evaluate* OpenPlan first, the README's
["Running OpenPlan on one computer"](../../README.md) puts it on a single machine with no accounts
and no public address — that is the smaller commitment, and a reasonable first step.

**There is currently no hosted OpenPlan instance** — running your own copy is how you use it today.
There is no waiting list and nobody to ask: the instructions below are the whole path. If a hosted
deployment exists in the future it will be announced in the README; nothing here changes either way.

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

To run OpenPlan on one machine with a local database — for development, evaluation, or a
single-user workstation — follow
**["Running OpenPlan on one computer"](../../README.md#running-openplan-on-one-computer)** in the
README. It installs Docker and Node step by step for Windows, macOS and Linux, and needs no cloud
accounts beyond a free Mapbox token.

That path is the right first move even if you intend to deploy: it proves the software runs and
lets you look around before you create hosted accounts. Nothing you do locally carries over to a
deployment — the local database is separate — so treat it as a trial, not as step one of the
production setup.

Two things about the local instance that the README does not cover, because they only matter once
you are working in it:

- Signing up provisions your workspace immediately; local email confirmation is disabled, so the
  account activates without a round-trip. There is no demo dataset to load — you pick your own
  geography and create your own records, and nothing about the app is fitted to one place.
- The local Supabase config sets its auth site URL to `http://127.0.0.1:3000`, so the
  password-reset round-trip (`/forgot-password` → emailed link → `/auth/callback`) works from
  `127.0.0.1:3000` but not from `localhost:3000`. Ordinary sign-in works from either.

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

**Supabase** is the database. It stores every project, comment, model run and account in your
deployment, and it handles sign-in. It is a company running Postgres for you, so that you are not
administering a database server. Its free tier is enough to start.

1. Create a free account and a project at [supabase.com](https://supabase.com). Choose a region near
   your users and set a strong database password — **save that password**, as Supabase shows it once.

   Your project gets an address like `https://abcdefghijklm.supabase.co`. The random-looking part —
   `abcdefghijklm` — is your **project ref**, and a later command asks for it. Everything below
   refers to *your* project, never anyone else's.

2. From *Project Settings → API*, collect:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`

   The service-role key bypasses Row Level Security by design. It is used only in server code and in
   the modeling worker. **Never expose it to a browser and never commit it** — anyone holding it can
   read and change every workspace in your deployment. The other two keys are safe to publish; the
   `NEXT_PUBLIC_` prefix means they are sent to browsers on purpose.

3. Create the tables. A new Supabase project is empty; OpenPlan's ~157 tables have to be built in
   it. Run this on a computer that has the code (see the README's local setup for how to get it),
   from inside the `openplan` folder:

   ```bash
   npm exec -- supabase link --project-ref <your-project-ref>
   npm exec -- supabase migration up --linked
   ```

   `link` tells the tool which of your Supabase projects to talk to; it will ask for the database
   password from step 1. `migration up` then builds the tables. Expect a long list of migration
   names and a minute or two of work.

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
| `CRON_SECRET` | Authorizes `/api/cron/reap-model-runs`, which marks crashed model runs as failed instead of leaving them queued forever. **You must set this yourself, on Vercel too** — Vercel *sends* the header automatically on scheduled invocations once the variable exists, but it does not create the variable, and while it is unset the reap cron answers 401 on every run (the model pages' reconcile-on-read then becomes the only rescue for stuck runs). On another host, set it and send `Authorization: Bearer $CRON_SECRET` from your scheduler. *(Corrected 2026-08-04: this row previously said Vercel "sets" it.)* |
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

This is the step that turns OpenPlan from something on your laptop into a web address your
colleagues can use.

**Vercel** is a hosting company. It watches your copy of the OpenPlan code on GitHub and, whenever
that code changes, rebuilds the site and publishes it. Its free tier is sufficient for a small
agency. You can use any Node host instead — see the end of this section — but Vercel needs no
server administration, which is why it is the documented path.

### 3a. Put the code somewhere Vercel can see it

Vercel deploys from a code repository. If you have not already:

1. Create a free account at [github.com](https://github.com).
2. Go to [github.com/nfredmond/openplan](https://github.com/nfredmond/openplan) and click **Fork**
   (top right). A fork is your own copy — you can deploy from it and pull in later updates.

### 3b. Create the Vercel project

1. Sign up at [vercel.com](https://vercel.com) and choose **Continue with GitHub**, so Vercel can
   see your fork.
2. Click **Add New… → Project**. Find your `openplan` fork and click **Import**.
3. **Set the Root Directory.** Vercel asks which folder holds the app. Click **Edit** next to Root
   Directory and choose **`openplan`**.

   > This is the one setting people get wrong. The repository contains a folder called `openplan`,
   > and the app is inside it. Leaving this at the repository root produces a build failure that
   > does not explain itself.

4. Leave the framework, build command, and output directory alone. The repository's `vercel.json`
   already sets them, and it also registers the scheduled cleanup job described below.
5. **Do not click Deploy yet.** Add the environment variables first — the next step.

### 3c. Add the environment variables

On the same import screen, expand **Environment Variables**. Add each of the four required settings
from [section 2](#2-environment-variables) — the three Supabase values from your hosted project and
your Mapbox token. Add `CENSUS_API_KEY` and `ANTHROPIC_API_KEY` too if you have them.

Two that only matter once you are deployed:

| Setting | Value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | your deployment's address, e.g. `https://openplan-yourteam.vercel.app` |
| `CRON_SECRET` | any long random string you invent — it authorises the cleanup job below |

You will not know your address until the first deploy finishes. Deploy without
`NEXT_PUBLIC_SITE_URL`, note the address Vercel gives you, then add it and redeploy. Everything
works in the meantime except links OpenPlan generates for emails and share links.

> **The Supabase values here must come from your hosted Supabase project, not from
> `supabase start`.** The local ones point at `127.0.0.1` — your own machine — which a deployed site
> cannot reach. If maps load but nothing else does, this is why.

### 3d. Deploy, then finish two settings

Click **Deploy**. The first build takes a few minutes. When it finishes, Vercel shows you the
address.

Two things still need that address:

1. **Add `NEXT_PUBLIC_SITE_URL`** as described above and redeploy.
2. **Tell Supabase about your domain.** Without this, confirmation and password-reset emails send
   people to a rejected link. In the Supabase dashboard → *Authentication → URL Configuration*, set
   **Site URL** to your address and add `https://<your-address>/auth/callback` to **Redirect URLs**.
   This is the same step described under [Accounts and workspaces](#accounts-and-workspaces).

Now open your address, click **Create your free workspace**, and make the first account. Then set
your workspace geography — [section 4](#4-set-your-workspace-geography).

### The scheduled cleanup job

`vercel.json` registers a job that calls `GET /api/cron/reap-model-runs` every few minutes to close
out model runs whose worker died. It authenticates with the `CRON_SECRET` you set above. On Vercel
this is automatic. **On any other host you must schedule it yourself**, sending an
`Authorization: Bearer <your CRON_SECRET>` header. Without it, a crashed model run stays marked
"running" forever rather than being recorded as failed.

### On a host other than Vercel

Any host that runs Node works. From `openplan/`:

```bash
npm ci
npm run build     # webpack builder, not Turbopack
npm start
```

Set the same environment variables in that host's configuration, and schedule the cleanup job
described above.

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

## Upgrading a running deployment

The one rule: **migrations run before the new code deploys.** OpenPlan is
written to degrade honestly when the code is newer than the schema for a few
minutes, but the safe order costs nothing, so use it every time. `CHANGELOG.md`
at the repository root is the per-release manifest — it leads with whether a
release added migrations and anything else an operator must do.

1. **Back up first.** Local Docker stack:
   `docker exec supabase_db_openplan pg_dump -U postgres postgres > backup-$(date +%Y%m%d).sql`
   Hosted Supabase project: `npm exec -- supabase db dump -f backup-$(date +%Y%m%d).sql --linked`.
   Success looks like: a non-empty `.sql` file. The hosted **free tier takes no
   automatic backups**, and there is no down-migration path (next point), so
   this file is the entire rollback story.
2. **Know what "rollback" means here.** Migrations are **forward-only** —
   Supabase has no down migrations and OpenPlan ships none. Recovering from a
   bad upgrade means restoring the backup from step 1
   (`psql "$DATABASE_URL" < backup-….sql`), not un-running a migration.
3. **Pull the new code** into the checkout that runs your deployment (for a
   Vercel fork setup, pull into your local clone first and do not push yet —
   pushing is what triggers the deploy).
4. **Apply migrations:** `npm exec -- supabase migration up` (add `--linked`
   for a hosted project). This applies only versions your database has not
   seen; it never re-runs old ones and never destroys data — a build guard
   (`src/test/migrations/no-destructive-migration.test.ts`) refuses
   destructive statements from entering the migration set at all.
5. **Deploy the new code** (push the fork / restart the app).

**If a migration fails partway:** applied ones stay applied; re-running
`migration up` resumes from the failure. A transient error clears on retry; a
deterministic failure means stop — do not deploy the new code — and either ask
for help with the exact error text or restore the step-1 backup. The app
running the OLD code against the partially-upgraded schema keeps working:
surfaces that need the missing pieces say "could not be read" rather than
showing wrong numbers.

`npm run doctor` (from `openplan/`) reports whether your database is behind
the migration files on disk, so "did the migrations actually run?" has a
one-command answer.

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

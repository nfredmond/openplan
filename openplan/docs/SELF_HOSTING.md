# Self-hosting OpenPlan

OpenPlan is free and open source. Any agency, MPO/RTPA, city, county, tribe, non-profit, or
planning/environmental consultancy can run its own copy — your geography, your data, your database,
no involvement from anyone else.

This is the deployment guide for the people who will operate it. It is written for a competent IT
team or a technically-minded planner; it assumes no prior knowledge of the codebase.

**You do not need to self-host to use OpenPlan.** Sign-up on a hosted deployment is free and
immediate. Self-host when you want the data in your own database, under your own controls.

---

## What you are standing up

| Piece | What it is | Required? |
|---|---|---|
| **The web app** | Next.js 16 app in `openplan/`. Runs on Vercel, or any Node host. | Yes |
| **Supabase project** | Postgres + PostGIS + Auth + Storage. Holds all of your data. | Yes |
| **Mapbox token** | Renders every map surface. | Yes, in practice |
| **Census API key** | ACS demographics, equity tracts. Free. | Strongly recommended |
| **Anthropic API key** | AI drafting, synthesis, translation, the in-app assistant. | Optional |
| **AequilibraE worker** | Separate Python process for network-assignment model runs. | Only for modeling |

The app tells you, on the dashboard, which of these are missing and what each one costs you. That
panel is the authoritative answer for a running deployment — this document is the setup path.

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
| `OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS` | Comma-separated emails that may reach `/admin` (the platform-operator console: watchboard, smoke evidence, readiness export). Gated by email, not workspace role — every self-signed-up user is an owner of their own workspace, so role cannot gate an operator console. Set this to your own address on a self-hosted deployment or `/admin` is unreachable. |
| `CRON_SECRET` | Authorizes `/api/cron/reap-model-runs`, which marks crashed model runs as failed instead of leaving them queued forever. Vercel sets and sends this automatically; on another host, set it and send `Authorization: Bearer $CRON_SECRET` from your scheduler. |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Outbound email. Without them the app does not pretend to send: teammate invitations produce a link the inviter copies and sends themselves. |
| `OPENPLAN_COUNTY_ONRAMP_WORKER_URL` / `_TOKEN` / `_CALLBACK_BEARER_TOKEN` | Dispatches county-onramp jobs to a worker. Without the URL the app prepares the job and reports `deliveryMode: "prepared"` rather than claiming it was submitted. |
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
`workers/aequilibrae_worker/`. It **polls your Supabase project** for queued runs; the web app never
calls it directly, so there is no worker URL to configure. See
[`workers/aequilibrae_worker/DEPLOY.md`](../../workers/aequilibrae_worker/DEPLOY.md) for the
deployment commands.

**Cost, honestly.** The worker must be always-on to pick up queued runs, and an always-on process is
not free anywhere. The documented options are Fly.io at roughly **$3–5/month** and Railway's monthly
free credit, which covers light use. If you do not deploy a worker, everything else in OpenPlan
still works — model runs simply stay queued, and the dashboard says so rather than leaving them
looking stuck.

> **Open question for the project, not for you:** whether OpenPlan should offer a shared hosted
> worker so self-hosting agencies do not each stand one up. That is a cost and trust decision that
> has not been made; today, each deployment runs its own.

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

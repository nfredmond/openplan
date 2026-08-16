# OpenPlan

OpenPlan is Apache-2.0 open-source planning software for transportation and land-use teams — an operating system for a planning department where the map is the worksurface, every number carries its provenance, and AI assistance is auditable end to end.

## What it does

- **Cartographic workbench** — a live map behind every screen with projects, study corridors, RTP cycles, aerial missions, equity tracts, and community comments as clickable layers, plus an inspector-driven workflow shell. Every layer is fillable from inside the app: equity tracts load on demand from the US Census Bureau for a workspace's own county, and when a layer draws nothing it says whether that is an empty record or a limit of the data.
- **Projects & delivery** — project control rooms with milestones, submittals, deliverables, risks, decisions, meetings; an invoice register with retention math; award closeout gated on 100% reimbursement (Caltrans LAPM-style delivery discipline as workflow).
- **Grants** — a pipeline from funding need → opportunity → decision → award → reimbursement, a curated catalog of real CA/federal programs with one-click tracking, and AI-drafted narratives where every factual sentence must cite a verifiable workspace fact (per-sentence grounding validation, unverified sentences flagged).
- **Community engagement** — public map-based commenting via share links: points, drawn lines, and drawn areas, optional photo attachments (private until approved), "Support" votes, and a staff moderation queue in front of everything public.
- **Analysis Studio** — corridor analysis over live Census/OSM/FARS data with equity screening, composite scores, and grant-ready report generation; fallback estimates are always labeled "Estimated," never silently substituted.
- **Transportation modeling** — screening-grade network model runs (AequilibraE worker) with KPIs, evidence packets, claim-grade gating, and a CEQA §15064.3 VMT screen with downloadable statutory memos.
- **RTP & programming** — RTP cycle workrooms with chapter drafting, linked project portfolios, funding rollups, and board-packet exports; RTIP/STIP program registries.
- **Planner Agent** — a copilot grounded in workspace data (streaming AI chat with a deterministic fallback), executable actions behind hash-verified, single-use, time-limited approvals, and a visible audit ledger of every action.

Nat Ford Planning builds and maintains the project.

**OpenPlan is free.** There is no paid tier, no plan, no seat count, no usage quota, and no payment
step anywhere in the software — sign up and every feature is available. There is no Stripe or
billing integration in the codebase; the subscription subsystem that once existed was deleted, and
`src/test/no-paid-tier-guard.test.ts` fails the build if it comes back.

Two things that sound commercial are not: the **invoice register** is Caltrans LAPM
grant-reimbursement invoicing — an agency invoicing *its funder* — and the **AI rate limit** bounds
Anthropic spend against runaway loops. Both are planning/operations features, unrelated to charging
anyone for OpenPlan.

Run it on your own infrastructure whenever you like. To put it online for your whole team, follow
[`openplan/docs/FIRST_DEPLOYMENT.md`](openplan/docs/FIRST_DEPLOYMENT.md) — a 20-minute checklist —
or [`openplan/docs/SELF_HOSTING.md`](openplan/docs/SELF_HOSTING.md) for the same path with every
piece explained. To try it on one machine first, see
[Running OpenPlan on one computer](#running-openplan-on-one-computer) below. The software, the
schema, and your data are yours.

## Repository layout

- `openplan/` — main Next.js application.
- `docs/` — product, proof, operations, governance, and planning documentation.
- `qa-harness/` — local and production smoke-check scripts.
- `scripts/` — validation, modeling, and operator utilities.
- `schemas/` — reusable schemas.
- `workers/` — Python workers (AequilibraE screening runs, county validation, drone photogrammetry,
  OCR for scanned documents).

Two walkthroughs worth knowing about once OpenPlan is running:

- [`openplan/docs/READING_AN_ADOPTED_PLAN.md`](openplan/docs/READING_AN_ADOPTED_PLAN.md) — how a
  planner points OpenPlan at last cycle's adopted RTP and gets its figures and its own policy text
  back, each citing the page it came from, with nothing entering the plan until a person saves it.
- [`openplan/docs/SELF_HOSTING.md`](openplan/docs/SELF_HOSTING.md) — every service, every setting,
  and what to do when one of them misbehaves.

## Running OpenPlan on one computer

OpenPlan is free, and there is no sign-up queue or hosted account to wait for —
you run your own copy. That means one setup step before you can open it, which
is what this section walks through.

**You do not need to be a programmer.** You need to be comfortable installing a
program and typing a few commands into a terminal window. Every step below says
what to do, what it is doing, and what "it worked" looks like. If your agency has
someone who installs software, this is a natural thing to hand them — but plenty
of planners do it themselves.

**If anything goes sideways, there is one command — `npm run doctor` — that
checks your machine and tells you in plain language what is wrong.** It is worth
knowing about before you start.

**Roughly 30–60 minutes**, most of it waiting for things to download.

Once it is running it belongs to you: your data stays on your machine, and
nothing is sent anywhere. When you are ready for your whole team to use it from
their own browsers, the same software deploys to the web — see
[`openplan/docs/FIRST_DEPLOYMENT.md`](openplan/docs/FIRST_DEPLOYMENT.md). Running
it on one computer first is the sensible way to look around before deciding.

### Step 1 — install the two programs OpenPlan needs

OpenPlan is a website that runs on your own machine. Two free programs make that
possible.

**Node.js** runs the website itself. **Docker Desktop** runs the database —
"Desktop" is just the name; it is a normal application with an icon.

You install both once and then mostly forget them.

<details>
<summary><b>Windows</b></summary>

1. **Node.js** — go to [nodejs.org](https://nodejs.org). Click the button
   labelled **LTS** (that means "long-term support" — the stable one). Run the
   downloaded `.msi` file and click Next until it finishes. Accept every default.
2. **Docker Desktop** — go to
   [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
   and download for Windows. Run the installer.
   - If it offers "Use WSL 2", say yes. It may ask you to restart.
   - **After it finishes, open Docker Desktop from the Start menu and leave it
     running.** Look for the whale icon near the clock. Wait until it stops
     animating — that can take a minute or two. If Docker Desktop is not open,
     nothing later in this guide will work.
3. Open **PowerShell** (Start menu → type "PowerShell").

</details>

<details>
<summary><b>macOS</b></summary>

1. **Node.js** — go to [nodejs.org](https://nodejs.org). Click the button
   labelled **LTS**. Open the downloaded `.pkg` and click through the installer.
2. **Docker Desktop** — go to
   [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/).
   **You must pick the right one:** click the Apple menu → *About This Mac*. If
   it says **Apple** (M1/M2/M3/M4), download the Apple Silicon version. If it
   says **Intel**, download the Intel version. The wrong one fails in a confusing
   way.
   - Open the downloaded `.dmg` and drag the Docker whale into Applications.
   - **Open Docker from Applications and leave it running.** It will ask for your
     password the first time — that is expected. Wait for the whale in the menu
     bar to stop animating.
3. Open **Terminal** (Applications → Utilities → Terminal).

</details>

<details>
<summary><b>Ubuntu / Debian Linux</b></summary>

There is no click-through installer worth using here; paste these into a
terminal. You will be asked for your password.

```bash
# Node.js. The version in Ubuntu's own catalogue is too old for OpenPlan,
# so this adds the official Node.js source first.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Docker.
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

**Now log out of the computer and log back in.** The last line gives your
account permission to use Docker, and that permission only takes effect on a
fresh login. Skipping this is the single most common reason the next steps fail.

</details>

**Check both installed correctly.** Once you have the OpenPlan code (step 2),
one command checks everything at once and tells you in plain language what is
wrong:

```bash
npm run doctor
```

It checks your Node version, whether Docker is actually *running* (not just
installed), whether the ports are free, and whether your settings file is
complete — and for anything wrong it says what to do about it. **If you get
stuck at any point in this guide, run it and read the output.** It never prints
your keys, so the output is safe to paste to someone helping you.

Before you have the code, check the two by hand — type each of these and press
Enter:

```bash
node --version
docker info
```

- `node --version` should print `v20.` or higher — for example `v22.11.0`.
  A lower number, or "command not found", means Node.js did not install; try
  step 1 again.
- `docker info` should print about thirty lines of details. If it says
  **"Cannot connect to the Docker daemon"**, Docker is installed but not
  *running* — open Docker Desktop and wait for the whale to settle, then try
  again.

> Use `docker info`, not `docker --version`. The version command answers even
> when Docker is switched off, so it will tell you everything is fine when it
> is not.

### Step 2 — get the OpenPlan code and set it up

Type these one at a time, waiting for each to finish.

```bash
git clone https://github.com/nfredmond/openplan.git
cd openplan/openplan
npm install
```

`git clone` copies OpenPlan to your computer. `npm install` downloads the
hundreds of building blocks it depends on — including the database tool used in
the next step, so there is nothing else to install by hand. It takes a minute.

> `npm install` prints a yellow warning about "install scripts not yet covered
> by allowScripts", naming Docker- and database-related packages. **This is
> normal and nothing is broken.** Carry on.

Note the `cd openplan/openplan` — the folder really does contain a folder of the
same name, and the second one is where every command below is run.

### Step 3 — start the database

```bash
npm exec -- supabase start
```

The first time, this downloads several gigabytes and can take **ten minutes or
more** with no visible progress for long stretches. That is expected. Leave it
alone. Later runs take seconds.

When it finishes it prints a block of text containing an **API URL** and two
long strings labelled **anon key** and **service_role key**. **Leave this window
open — you need to copy those three values in the next step.**

> Those two dashes in `npm exec -- supabase` are required. Without them you get
> the error *"Must specify one of --local, --linked…"*.

### Step 4 — fill in the settings file

```bash
cp .env.example .env.local
```

That makes a settings file. Open `.env.local` in any text editor — Notepad,
TextEdit, or `nano .env.local` — and fill in four lines. The file explains every
setting; these four are the ones OpenPlan cannot start without.

| Setting | What to paste |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the **API URL** printed in step 3 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **anon key** printed in step 3 |
| `SUPABASE_SERVICE_ROLE_KEY` | the **service_role key** printed in step 3 |
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | a free map key — see below |

**The map key.** OpenPlan draws maps using a free service called Mapbox. Make a
free account at [mapbox.com](https://mapbox.com), find "Access tokens", and copy
the **default public token**. It starts with `pk.` — the public prefix matters,
because a secret token (`sk.`) will not work in a browser. Without this key
OpenPlan still runs, but every map is blank, and the map is most of the product.

**If you plan to run travel models, add `CENSUS_API_KEY` now.** It is free, it
arrives by email in a minute or two, and you get it here:
[api.census.gov/data/key_signup.html](https://api.census.gov/data/key_signup.html).
Click the activation link in the email — an unactivated key is refused the same
way a missing one is.

Every travel model starts from how many people, households and workers live in
each area, and that comes from the US Census Bureau. The Census Bureau used to
answer without a key and no longer does, so **without this key OpenPlan cannot
build a model at all.** It will tell you so in the first second rather than
failing partway through, but it cannot work around it. Nothing else in OpenPlan
needs the key — maps, engagement, grants and reports are all unaffected.

Everything else in the file is optional. OpenPlan works without it and says
plainly which feature is unavailable rather than failing silently. The one worth
adding later is `ANTHROPIC_API_KEY`, which turns on the AI assistant, comment
summarising, and translation.

### Step 5 — build the database tables

```bash
npm exec -- supabase db reset
```

This creates the ~157 tables OpenPlan uses. It prints a long list. Takes a
minute.

> **Only ever run this on a fresh install.** `db reset` erases everything in the
> local database and rebuilds it. Once you have real data, use
> `npm exec -- supabase migration up` instead, which only adds what is new.

### Step 6 — start OpenPlan

```bash
npm run dev
```

Wait for it to print `Ready`, then open **http://localhost:3000** in your
browser. Click **Create your free workspace** and make an account. The account
lives only on this computer.

**To stop OpenPlan**, click the terminal window and press `Ctrl+C`. To start it
again later, open a terminal, `cd` back into the `openplan/openplan` folder, and
run `npm run dev`. Docker Desktop needs to be running first — the database lives
there.

### Step 7 — turn on travel modelling

**Skip this if you are only here to look around.** Everything else in OpenPlan —
maps, engagement, grants, plans, reports — works without it.

This step is what makes OpenPlan produce a traffic number: how many
vehicle-miles a county drives in a day. Without it you can still set a run up,
and OpenPlan will tell you plainly, before you click, that it will write the job
down rather than run it.

It runs on your own machine, in Docker, beside the database. Nothing is hosted
and nothing costs money.

```bash
npm run modeling:up
```

The first time, this builds a container: **several minutes**, and about a
gigabyte of traffic-modelling software. It prints a lot and then goes quiet.
Later starts take a second.

Then open `.env.local` again and add these two lines:

```bash
OPENPLAN_COUNTY_ONRAMP_WORKER_URL=http://127.0.0.1:8686/jobs
OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN=pick-any-long-random-string
```

The second one is a password OpenPlan makes up to recognise its own results
coming back. Any long jumble of letters will do; nobody ever types it again.
**Do not skip it** — without it the model runs for six minutes and OpenPlan
turns the answer away at the door, with nothing on screen to say why.

You also need `CENSUS_API_KEY` from step 4. Every travel model starts from how
many people live where, and that comes from the US Census Bureau.

Now stop OpenPlan (`Ctrl+C`) and start it again with `npm run dev`, so it picks
up the new settings. Check it took:

```bash
npm run doctor
```

It should say **the modeling worker answered**. If it does not, it will say
which of the three settings is missing.

**A county takes about six minutes**, most of it spent downloading the road
network. Go to **County runs**, search for a county, name the run, and launch
it. Results land in `data/screening-runs/` inside the OpenPlan folder — a few
hundred megabytes per county.

`npm run modeling:logs` shows what the modeller is doing. `npm run
modeling:down` stops it.

> **What these numbers are for.** Screening and prioritisation, and the
> supporting numbers in a grant application. They are not calibrated forecasts,
> and OpenPlan will not let them be used for an environmental document. Every
> figure it produces carries what it was built from.

### If something goes wrong

**First: run `npm run doctor`.** It diagnoses everything in this table
automatically and says what to do. The table is here for the cases it cannot
see.

| What you see | What it means |
|---|---|
| `Cannot connect to the Docker daemon` | Docker Desktop is not running. Open it and wait for the whale icon to settle. |
| `supabase start` seems frozen | On a first run this is normal for up to ten minutes. Leave it. |
| `Must specify one of --local, --linked` | You left out the two dashes: it is `npm exec -- supabase …` |
| `command not found: node` or `npm` | Node.js did not install, or the terminal was open before you installed it. Close the terminal, open a new one, try again. |
| `EADDRINUSE` / `port 3000 already in use` | OpenPlan is already running in another window, or something else is using that port. Use `npm run dev -- --port 3001`. |
| Pages load but every map is blank | The Mapbox key is missing or wrong. It must start with `pk.` |
| `permission denied` from Docker (Linux) | You skipped the log-out-and-back-in after the Docker install in step 1. |

Useful gates:

```bash
npm run lint
npm test
npm run build
npm run qa:gate   # lint + tests + dependency audit + production build
```

To demo publicly from a laptop, see `docs/ops/2026-07-17-v1-demo-runbook.md`.

Command note: package scripts are invoked with `npm run …` in current operator docs because `package-lock.json` is canonical and npm is the most reliable baseline on this host. The app pins `packageManager` to npm, while `npm run qa:gate` explicitly pins `pnpm@10.33.0` and disables Corepack strict package-manager enforcement for the production audit lane. Legacy proof logs may still cite bare `pnpm` commands.

## License boundary

Unless otherwise marked, source code is licensed under the Apache License, Version 2.0. See `LICENSE` and `LICENSE-NOTICE.md`.

The license does not grant rights to Nat Ford Planning trademarks, logos, private credentials, client confidential information, third-party datasets, third-party media, or client-specific deliverables unless those materials are explicitly included under the same license.

## Capability boundaries

OpenPlan states its limits as plainly as its strengths — several are enforced by tests. Modeling outputs are screening-grade with caveats attached, not calibrated or validated forecasting. LAPM support is delivery tracking and an invoice register, not exact Caltrans exhibit/E-76 form generation. Aerial operations cover mission and evidence tracking; imagery-to-orthomosaic processing is on the roadmap. It should not be described as a finished autonomous municipal SaaS or a substitute for qualified planning review.

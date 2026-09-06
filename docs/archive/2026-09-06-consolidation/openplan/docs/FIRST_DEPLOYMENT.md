# Putting your first OpenPlan instance online

A single pass, in order, from nothing to a web address your colleagues can use.
Roughly **20–30 minutes**, most of it waiting.

This is the short version. [`SELF_HOSTING.md`](SELF_HOSTING.md) explains what each
piece is and why; come here when you just want the sequence, go there when
something does not behave.

**What you will have created when you finish:** four free accounts (GitHub,
Supabase, Vercel, Mapbox), a database holding your agency's data, and a URL.
Nobody else has to install anything — they visit the URL and sign up.

---

## Before you start

You need a computer with **Node.js** and **git** installed, only for one command
in step 3. If you have already followed the README's local setup, you have both.
If not, install Node from [nodejs.org](https://nodejs.org) (the **LTS** button)
— you do **not** need Docker for a deployment.

Have somewhere to paste six values as you collect them. A scratch text file is
fine. Two of them are secrets, so delete it afterwards.

---

## 1. Mapbox — the map key  ·  ~2 min

- [ ] Sign up at [mapbox.com](https://mapbox.com)
- [ ] Find **Access tokens**, copy the **default public token**
- [ ] Check it starts with `pk.` — a secret token (`sk.`) will not work in a browser

> **Collected:** `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`

Without this OpenPlan runs but every map is blank, which is most of the product.

---

## 2. Supabase — the database  ·  ~5 min

- [ ] Sign up at [supabase.com](https://supabase.com), create a project
- [ ] Choose a region near your users
- [ ] Set a database password and **save it** — Supabase shows it once, and step 3 asks for it
- [ ] Wait for the project to finish provisioning (a minute or two)
- [ ] Go to **Project Settings → API** and copy three values

> **Collected:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
> `SUPABASE_SERVICE_ROLE_KEY`

The **service_role** key can read and change every workspace in your
deployment. Treat it like a root password: it goes in Vercel's settings and
nowhere else — never in a browser, never in the repository.

Your project address looks like `https://abcdefghijklm.supabase.co`. The
random-looking middle part is your **project ref**. Note it; step 3 needs it.

---

## 3. Build the database tables  ·  ~5 min

A new Supabase project is empty. This creates OpenPlan's ~157 tables.

```bash
git clone https://github.com/nfredmond/openplan.git
cd openplan/openplan
npm install
npm exec -- supabase link --project-ref <your-project-ref>
npm exec -- supabase migration up --linked
```

- [ ] `link` succeeded (it asks for the database password from step 2)
- [ ] `migration up` printed a long list of migration names and finished without error

> The two dashes in `npm exec -- supabase` are required. Without them you get
> *"Must specify one of --local, --linked…"*.

**Do this before deploying, not after.** OpenPlan tells a user when something
could not be read rather than pretending it found nothing — but on the public
engagement portal, that user is a member of the public. Deploying ahead of the
tables turns the gap into a window where residents are told the map could not be
loaded. Doing it in this order closes the window entirely.

---

## 4. GitHub — a copy Vercel can watch  ·  ~2 min

- [ ] Sign up at [github.com](https://github.com) if you have not already
- [ ] Go to [github.com/nfredmond/openplan](https://github.com/nfredmond/openplan) and click **Fork**

A fork is your own copy. Vercel deploys from it, and you can pull in later
updates from the original.

---

## 5. Vercel — put it online  ·  ~10 min

- [ ] Sign up at [vercel.com](https://vercel.com), choosing **Continue with GitHub**
- [ ] **Add New… → Project**, find your `openplan` fork, **Import**
- [ ] **Set Root Directory to `openplan`** — click *Edit* beside Root Directory

> This is the step people get wrong. The repository contains a folder of the
> same name and the app is inside it. Leaving this at the repository root fails
> the build without explaining why.

- [ ] Leave framework, build command and output directory alone — `vercel.json` sets them
- [ ] Expand **Environment Variables** and add all four collected values
- [ ] Add `CRON_SECRET` — any long random string you invent
- [ ] Click **Deploy**, wait a few minutes
- [ ] Copy the address Vercel gives you

---

## 6. Two settings that need the address  ·  ~5 min

Neither can be done before step 5, because neither exists until Vercel gives you
a URL.

- [ ] In **Vercel → Settings → Environment Variables**, add `NEXT_PUBLIC_SITE_URL`
      set to your address (e.g. `https://openplan-yourteam.vercel.app`), then
      **redeploy** (Deployments → ⋯ → Redeploy)
- [ ] In **Supabase → Authentication → URL Configuration**, set **Site URL** to
      your address and add `https://<your-address>/auth/callback` to **Redirect URLs**

Without the second, confirmation and password-reset emails send people to a link
Supabase rejects.

---

## 7. First sign-in  ·  ~3 min

- [ ] Open your address
- [ ] Click **Create your free workspace** and make the first account
- [ ] Set your **workspace geography** on the dashboard — your county, city, CDP or metro

Setting the geography is what makes maps open on your area, binds stage-gate
templates to your state's rules, and populates equity layers. Until it is set
those surfaces behave neutrally and say so — OpenPlan never substitutes a
plausible-looking default place.

- [ ] Check the dashboard's readiness panel. It names anything still missing and
      what each omission costs you. That panel, not this document, is the
      authoritative answer for a running deployment.

---

## Optional, once it is working

| Add | What it turns on |
|---|---|
| `CENSUS_API_KEY` | ACS demographics and equity tracts. Free from the Census Bureau. |
| `ANTHROPIC_API_KEY` | The planning assistant, comment synthesis, moderation, translation. |
| A custom domain | `openplan.youragency.gov` instead of `*.vercel.app`. Vercel → Settings → Domains. |

Everything else in `.env.example` is for subsystems most agencies will not run —
the modeling worker, the aerial processing worker, county validation. Each is
documented in [`SELF_HOSTING.md`](SELF_HOSTING.md), and OpenPlan says plainly
which feature is unavailable rather than failing quietly.

---

## If it does not work

| What you see | What it means |
|---|---|
| Build fails immediately on Vercel | Root Directory is not set to `openplan` (step 5) |
| Site loads, maps blank | Mapbox token missing or not a `pk.` public token |
| Site loads, everything else errors | The Supabase values are the LOCAL ones (`127.0.0.1`). A deployed site cannot reach your computer — use the hosted project's keys from step 2. |
| "could not be read" on many surfaces | Step 3 did not finish. Re-run `migration up --linked`. |
| Confirmation email link is rejected | Step 6's Supabase redirect URL is not set |
| `Must specify one of --local, --linked` | The two dashes: `npm exec -- supabase …` |

---

## Keeping it up to date

Vercel redeploys automatically when your fork changes — so the order below
matters: it applies the new migrations **before** anything can trigger that
deploy, instead of racing it. *(An earlier version of this page said to sync
the fork first and then beat the deploy by hand. That is a race you can lose;
this order has no race.)*

1. **Read the release notes first.** `CHANGELOG.md` at the top of the
   repository says what each release changes and whether it added migrations —
   it is written for you, the operator.
2. **Capture a complete recovery point.** Follow
   `docs/ops/BACKUP_AND_RESTORE.md`. The database dump, Storage bytes, and their
   hashes travel together. OpenPlan migrations are forward-only, so a verified
   restore is the rollback path.
3. **Pull the new code into your local clone only** (this does not touch your
   fork on GitHub, so nothing deploys yet):
   `git pull https://github.com/nfredmond/openplan.git main`
4. **Apply the new migrations:**
   `npm exec -- supabase migration up --linked`
   Success looks like: each new migration named as "Applying…", then a clean
   exit. The running app keeps working during this — migrations are written to
   be safe under the previous version.
5. **Now update your fork** (this triggers the deploy): `git push`, or the
   "Sync fork" button on GitHub.

**If a migration fails partway:** everything already applied stays applied;
nothing is half-applied inside one migration. Running
`npm exec -- supabase migration up --linked` again resumes from the failed one
— transient network hiccups usually clear on the second run. If the same
migration fails the same way twice, stop, do not sync the fork, and follow the
isolated restore procedure if the app is misbehaving.

# Changelog

What changed in OpenPlan, written for whoever operates a deployment rather than
for whoever wrote the code. Each entry says what is new, and — where it matters
— what you have to do about it.

**Upgrading, in short:** pull the new code, run
`npm exec -- supabase migration up --linked` **before** the app deploys, then
deploy. That order matters; see the note under 0.2.0. **If you are upgrading from
0.2.0 or earlier, read the security note under 0.3.0 first** — that fix lives
entirely in the migrations, so it takes effect as soon as they run.

OpenPlan uses [semantic versioning](https://semver.org). While the major version
is `0`, the database schema is still changing in ways that need care on upgrade —
which is exactly what a `0.x` version is for. `1.0` will mean the schema is
stable enough to promise smooth upgrades indefinitely.

---

## 0.3.0 — 2026-08-03

**This release contains a security fix. Upgrade promptly.** If you run a
deployment that has ever loaded a transit feed, treat this as urgent; if you have
not, it is still worth doing now, because the hole opens the moment you do.

**Requires migrations — and for the security fix, the migrations *are* the fix.**
This release adds six. Four of them (`…000008` through `…000011`) are the
security repair, and they are pure SQL: ten `ALTER TABLE` and fourteen `REVOKE`,
with no application code involved. That means **running the migrations closes the
hole on its own**, even if you cannot deploy new code today. Run
`npm exec -- supabase migration up --linked` **before** deploying the app, as
always.

### Security: eight tables had a tenant boundary that had never been switched on

Eight tables holding transit-network data — agencies, routes, stops, trips, stop
times, shapes and both calendar tables — each carried a correct access rule
restricting them to the workspace that owns the feed. On none of them had that
rule ever been *switched on*. In Postgres a policy and the setting that enforces
it are two separate things, and only the first had ever been written. The
database stored the rule, listed it, and applied it to nothing.

What that meant in practice, confirmed against a running database using only the
public key and no account at all: an anonymous visitor could read a workspace's
private transit network, add to it, rename a route, and delete a stop. In the
same test the **parent** table correctly refused the same visitor — which is what
made the diagnosis certain. The boundary had been designed and reviewed, and then
never armed.

**Honest scope.** No feature in OpenPlan writes those eight tables yet, so on most
deployments there was little or nothing in them to expose. This is fixed now
because it stops being harmless the first time an agency imports a GTFS feed.

**What the fix changes, and what it does not.** It switches the existing rules on
and removes anonymous write access as a second, independent lock. It does not
alter a single access rule — all 552 were already correct. Members' access to
their own data was measured before and after and is unchanged, and genuinely
public feeds stay public. Two reference tables (census tracts and LODES) also had
anonymous write access removed while staying publicly readable.

**Why it went unnoticed for four months.** The test guarding those rules read the
*text of the migration files* rather than asking the database, so it could not see
that what it was reading had never taken effect. It has been replaced by a live
check, with no exception list, that fails the build if any table ever again
carries a rule that is not switched on.

### The assistant records who did the work

When the planning assistant performs an action, the record now distinguishes the
agent that authored it from the person who approved it and the session it ran
under — three different things that had been collapsed into one. An agent acting
on its own behalf is recorded as itself rather than as the person, because
authorising an action is not the same as having written it.

### Regional transportation plans

A model run cited as evidence now travels with its engine, its status and its
claim tier, and a run that failed or is screening-grade carries a plain warning
next to the citation. Nothing is hidden or refused — a planner may still cite any
run, including a preliminary one, which is often the right thing to do in a draft.
The defect was that a reader could not tell a calibrated run from a failed sketch,
not that the citation existed.

### Setting up and operating a deployment

- **`npm run doctor`** checks an installation and says what is wrong in plain
  language. Most failures in the setup path are silent — Docker answers while it
  is off, and a working `supabase start` looks frozen for ten minutes — so the
  install now reports its own state instead of leaving you to infer it.
- **The dead billing schema is labelled in the database itself,** so nobody
  mistakes the leftover Stripe tables for something the product uses. OpenPlan is
  free and has no paid tier; those tables are inert and are being left in place
  deliberately rather than dropped against a hosted database.
- **Two dependencies the build had been using by accident are now declared,** so a
  clean install builds the same way yours does.

### Documentation

The install guide no longer implies it is written for someone other than the
planner reading it, every dated record now says on its face that it describes a
moment rather than the current state, and product copy that read like the tooling
that generated it has been rewritten.

---

## 0.2.0 — 2026-07-30

The first tagged release. Everything before this was untagged development; the
version had sat at `0.1.0` since the initial commit because nothing read it.

**Requires migrations.** This release adds five: campaign accessibility
contacts, submission geofencing, survey response drafts, aerial artifact
custody, and a grant revoke on the custody ledger. Run
`npm exec -- supabase migration up --linked` **before** deploying the app.
OpenPlan degrades honestly when a column is missing — it says a thing could not
be read rather than reporting nothing found — but on the public engagement
portal the person reading that is a member of the public, so deploying ahead of
your migrations turns an upgrade into a window where residents are told the map
could not be loaded.

### Community engagement

- **The participant portal speaks eleven languages.** It resolves a resident's
  language from `?lang=`, then their browser, then English; carries `dir` and
  `lang` down to each run of text so Arabic and Farsi read correctly; and says
  plainly what it has *not* translated rather than presenting English as the
  agency's choice. Spanish is complete; the other nine offer the language picker
  and the coverage notice. An operator can author translations per campaign, and
  machine translations are labelled as such until a person accepts them — at
  which point the agency becomes answerable for the wording, which the interface
  states before you click.
- **A resident who cannot use the portal can still take part.** Campaigns record
  a contact — in the agency's own words, never defaulted by OpenPlan — for
  arranging another way to participate. It renders in the resident's language.
  OpenPlan makes no accessibility-conformance claim, and a test fails the build
  if one appears.
- **Comment that never came through the portal can be imported.** Open-house
  comment cards, the project inbox, meeting transcripts: CSV import with a
  preview that refuses the whole file if any row is bad. Everything imports as
  `pending` and goes through the same moderation queue. Imported comment cannot
  be recorded as a public portal submission — that means somebody submitted it
  themselves under a rate limit and a share token, which a spreadsheet row
  cannot be given afterwards.
- **Submissions can be held to the campaign's own area.** Opt-in per campaign,
  and only where the campaign has recorded a place. Every vertex of a drawn
  shape is checked, not its centre. A comment with no location is not outside
  the area and is still accepted.
- **A survey can be left and come back to.** Partial answers are saved against a
  resume credential that never appears in a URL and is stored only as a hash.
  Drafts live in their own table, so no response count, aggregate or
  representativeness reading can mistake an abandoned draft for turnout.
- **Survey questions can depend on earlier answers,** evaluated on the server as
  well as in the browser. A hidden question is neither required of a respondent
  nor recorded from one.
- **The spatial hotspot test no longer assumes a downtown.** The clustering
  radius is adjustable, because one fixed radius is a claim about geographic
  scale that is wrong for a rural county.

### Aerial

- **Processing artifacts are taken into custody.** Orthomosaics, point clouds
  and DSMs were recorded as time-limited vendor links, so the deliverables of a
  flight — and the evidence under any analysis built on them — became
  unreachable when those links expired, while the job still read `succeeded`.
  The bytes are now fetched into private storage with a checksum, per artifact,
  and the interface distinguishes held, still-recoverable, and gone.
- **Processing jobs are visible.** Job status, progress, outputs and failure
  reasons had been recorded since the first aerial migration and no page read
  them. An operator who dispatched a flight saw a page that looked as though
  nothing had happened.

### Scenarios, models, workspaces

- **A scenario comparison can say what it assumed.** Assumption sets, data
  packages and indicator snapshots can be recorded and read; previously only
  comparison snapshots had any surface, so three quarters of the provenance
  chain was invisible.
- **A county run says whether it can be validated,** listing every blocker and
  the exact command, instead of going quiet at the step where operators get
  stuck.
- **An invitation can be read, and refused.** Following an invite link and
  signing in used to join you to a workspace you had never been shown. The link
  now lands on the invitation — workspace, role, who sent it, when it expires —
  with accept and decline as two buttons. Reading one writes nothing.

### For operators

- **A deployment now names itself.** The dashboard shows the version and the
  commit it was built from. On Vercel the commit is automatic; on other hosts
  set `OPENPLAN_COMMIT_SHA` at build time. Where it is unset, the interface says
  the commit is unrecorded rather than inventing one.
- **New setup documentation.** [`FIRST_DEPLOYMENT.md`](openplan/docs/FIRST_DEPLOYMENT.md)
  is a 20-minute checklist from nothing to a working address;
  [`SELF_HOSTING.md`](openplan/docs/SELF_HOSTING.md) explains each service; and
  the README now installs Node and Docker step by step for Windows, macOS and
  Linux.
- **New optional settings:** `OPENPLAN_AERIAL_ARTIFACT_MAX_BYTES` caps artifact
  custody downloads, and `OPENPLAN_COMMIT_SHA` records the build commit. Both
  have working defaults.

### Removed

- `POST /api/models/[modelId]/runs/[modelRunId]/skims` — a redundant duplicate
  of a path the modeling worker already uses directly, and a lossier one: it
  accepted a period and mode, echoed them, and stored neither. Skim matrices
  were already downloadable from the run's artifact list and still are.

---

## 0.1.0

Initial development. Untagged.

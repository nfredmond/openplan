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

## Unreleased

**Migrations are required before the app deploys, in this order:**
`20260805000004`, `20260805000005`, `20260805000006`, `20260805000007`,
`20260805000008`.

`20260805000004` stops two periods of one plan claiming the same year. If your
plan already has overlapping periods the migration will REFUSE to apply and tell
you how many — it will not edit or delete your periods to make itself apply.
Resolve the overlaps, then run it again.

`20260805000006` also **raises the `gtfs-uploads` storage bucket ceiling from
50 MiB to 200 MiB.** If your Supabase project has a global upload cap lower than
that, raising the bucket does not lift it — the largest US transit feeds are
around 94 MiB, so a project cap below that will refuse them with a storage error
at the end of an upload rather than anything a planner can act on.

### Transit feeds can be brought in

A planner can now bring their transit operator's published feed into OpenPlan
three ways: search the national feed catalog by their own geography, paste the
operator's feed address, or upload a `.zip`. It is on the Data Hub.

- **What OpenPlan stores is SERVICE LEVELS, never the timetable.** It answers
  "how often does the bus come here, and for how many hours a day". It does not
  and will not answer "what time is the 4:15" — it reads no real-time feed, so
  any such answer would be a promise to a rider made from a schedule that may be
  months out of date. Departure times are counted during the read and discarded.
- **Most published feeds in the catalog are out of date, and OpenPlan now says
  so.** Of four real Sacramento-area feeds checked on 2026-08-05, three had
  expired — one sixteen months earlier. The catalog does not publish an expiry,
  so it is only knowable after the feed is downloaded and read. Every surface
  that shows a feed shows the dates its schedule actually covers.
- **A refetch that comes back materially smaller is stored but NOT adopted.** If
  refreshing a feed derives more than 20% fewer routes or stops than the version
  in use, OpenPlan keeps the new version, leaves the old one in service, and
  says why — a truncated download and a real service cut look identical, and
  only a person should decide which one happened. Adopting it anyway is one
  click, on purpose.
- **Feed addresses are checked before they are fetched.** A feed URL pointing
  inside the deployment's own network — including through a redirect — is
  refused. Operators who need to fetch from a specific internal host can set
  `OPENPLAN_OUTBOUND_ALLOWED_HOSTS`.
- New optional operator settings, all with working defaults:
  `OPENPLAN_GTFS_MAX_ARCHIVE_BYTES`, `OPENPLAN_GTFS_MAX_CATALOG_BYTES`,
  `OPENPLAN_GTFS_PARSE_BUDGET_MS`.
- **A scheduled sweep runs every 15 minutes** (`/api/cron/reap-gtfs-ingests`,
  registered in `vercel.json`) closing feed ingests that stopped responding, so
  a killed process cannot leave a feed reading "parsing" forever. It needs
  `CRON_SECRET` set; without it the route is closed rather than open.

- **A plan whose periods cover only part of its horizon no longer reports
  itself fiscally constrained.** If your plan runs to 2050 and your periods stop
  at 2035, the years in between were accounted for by nothing and the totals
  described only part of the plan. The finding is now withheld and names the
  uncovered years. **If a plan of yours previously read "fiscally constrained"
  it may now read "not determined" — that is the correction, not a regression.**
- **Periods may not overlap.** Two periods claiming the same year made the
  plan's own escalation ambiguous, because each period escalates its money to
  its own expenditure year. Adjacent periods are fine: one ending 2035 and one
  starting 2036.
- A period falling outside the plan's stated horizon is still allowed — there
  are real situations for it — but the screen now says so rather than staying
  silent.

---

## 0.5.0 — 2026-08-05

**Regional Transportation Plans can now answer whether they can be paid for.**
This release adds the financial element an RTP is adopted against — revenue,
the cost of operating and maintaining the system, per-project programmed costs,
and a fiscal-constraint finding — plus the project lists, a per-cycle map, a
public draft-review page, and a comment-response record.

**A migration is required before the app deploys:** `20260805000003`. It adds
three tables — `rtp_horizon_bands`, `rtp_financial_assumptions`,
`rtp_performance_measures` — and adds columns to `rtp_cycles`
(`financial_basis_year`, `annual_inflation_rate`) and to
`project_rtp_cycle_links` (`horizon_band_id`, `estimated_cost`,
`cost_basis_year`, `updated_at`). Nothing is dropped or rewritten, and every
new column is nullable, so applying it changes nothing you can see until the
financial-element screens land.

Also in this release, and visible immediately:

- **Regional Transportation Plans no longer cite California statutes to
  agencies outside California.** Project priority scores were annotated with
  "CEQA §15064.3 · SB 743" and three other California authorities for every
  workspace in the country, including on the public plan page an agency shares
  with residents. Priorities now carry the policy basis of the jurisdiction
  the workspace records as its home, and a workspace that has not recorded one
  cites nothing rather than borrowing another state's law. If your plan pages
  previously showed California citations and your agency is not in California,
  they will change.
- **The federal policy basis no longer names Justice40**, which was terminated
  in January 2025. It cites the federal planning regulation instead.
- **The "publish this plan" control now appears on every RTP cycle.** It was
  previously hidden on cycles with no projects attached yet, and on cycles
  whose project list failed to load.
- **Plan details can be corrected after creation** — title, geography label,
  horizon years, adoption date, public review window, summary, and map pin.
  Previously these could only be set when the cycle was created.
- **Public plan pages are no longer indexable by search engines.** The share
  link is the credential, so it should reach only the people you send it to.

New in the RTP module:

- **A financial element.** Declare the periods your plan programmes money
  across, record revenue and the cost of operating and maintaining the system
  against each, and give each project its cost in this plan. OpenPlan then
  reports whether the constrained programme can be paid for, period by period.
- **It says "not determined" rather than guessing.** If a constrained project
  has no cost recorded, or no revenue has been entered, or amounts sit in
  different base years with no inflation rate to reconcile them, the finding is
  withheld and names what is missing. A plan with gaps in it will never report
  itself fiscally constrained.
- **Year-of-expenditure dollars.** Record costs in constant dollars with a base
  year and set an annual inflation rate, and OpenPlan escalates them to the
  year each period expects to spend. With no rate recorded it reports constant
  dollars and says so, rather than presenting them as year-of-expenditure
  figures.
- **Project lists grouped by period**, with each project's cost and a subtotal
  that never counts an unpriced project as zero.
- **Performance measures** — baselines and targets with the source each
  baseline came from.
- **A map of the plan's projects**, coloured by whether they are in the
  constrained programme or on the illustrative list. It states how many
  projects have no location recorded rather than quietly drawing fewer.
- **A public draft-review page** at the same share link, showing the plan's
  chapters, its financial element and its project lists, and saying plainly
  whether public review is open, has not opened, or has closed.
- **A comment-response record** pairing approved public comments with the
  agency's published responses. Comments still awaiting moderation never
  appear. An unanswered comment is flagged as outstanding; it does not block
  adoption.

Two notes for whoever generates board packets:

- Board packets have been rendering every project as **unscored** because the
  packet's query omitted the priority scores. Fixed — existing packets will
  show priority tiers when regenerated.
- The financial element and the comment-response record are now in every
  packet stage, and in the Export HTML/PDF buttons as well as in generated
  packets. Those two paths previously produced different documents.

---

## 0.4.0 — 2026-08-05

**OpenPlan stops assuming California.** Six registries shipped with a single
entry each, so California got real capability and the other forty-nine states
got an honest disclaimer. This release gives every US agency a delivery
template, a reimbursement vocabulary, and — in three more states — a funding
catalog of their own.

**Requires three migrations** if you are coming from 0.3.0 (`20260804000001`,
`20260804000002`, `20260805000001`). Run
`npm exec -- supabase migration up --linked` (locally: without `--linked`)
before deploying, as always. None of them modifies an existing row: the two
dated `20260804…` migrations set table permissions (a no-op on any database you
already have — see "Fresh installs" below), and `20260805000001` changes only
what NEW workspaces are born holding.

### A federal-aid delivery template for the whole country

The new **US Federal-Aid Delivery Floor** carries eight gates built from the
rules that hold anywhere in the United States — the Uniform Guidance (2 CFR
200), the federal-aid highway rules (23 CFR), NEPA, and the Uniform Relocation
Act (49 CFR 24) — with the evidence each gate actually requires. Where a
regulatory figure matters, the template cites the section (for example
2 CFR 200.501 for the single-audit threshold) instead of restating a number
that would quietly go stale.

It states its own limits where you choose it: your state DOT's local-agency
manual implements these same steps and may add its own; FTA-funded transit
follows different mechanics and is not covered; state environmental law (CEQA,
SEPA) is an overlay it does not carry.

What you will notice:

- A workspace anywhere in the US now gets this template as a real jurisdiction
  match rather than a labelled assumption. California workspaces keep the
  California pack.
- An existing workspace that has stated a non-California US geography will see
  its stage-gate panel report that a template for its jurisdiction now exists,
  with a rebind offer. **Rebinding never edits or deletes a recorded gate
  decision** — decisions recorded against gates the new template does not
  define stay exactly as signed and stop appearing on project boards while that
  template is bound. The panel names those gates before you confirm.
- New workspaces are born bound to the federal template (that is the migration).

### Reimbursement vocabulary that is not one state's

A grant-reimbursement draw in a non-California workspace was logged under
Caltrans LAPM posture names, disclosed as assumed. There is now a **generic US
federal-aid reimbursement profile** — progress invoicing, final-only, retention
in effect, or agreement-terms-deferred — carrying a documentation checklist for
what a complete reimbursement package contains anywhere, with the indirect-cost
basis citing 2 CFR 200.414(f) rather than restating a rate. Its framing line is
the honest one and shows wherever the profile does: your executed funding
agreement controls; where it differs from the profile, the agreement wins.
California keeps LAPM.

### Washington, Oregon and Colorado funding catalogs

Fifteen state programs, each verified against its own official page on
2026-08-05: Washington (TIB Urban Arterial, Small City Arterial, Small City
Active Transportation, Complete Streets; WSDOT Pedestrian & Bicycle and Safe
Routes to School; FMSIB freight), Oregon (ODOT Safe Routes to School, Oregon
Community Paths, Connect Oregon, Small City Allotment, Great Streets, and the
joint ODOT/DLCD TGM planning grants), and Colorado (the Multimodal
Transportation and Mitigation Options Fund, and Safe Routes to School).

Two candidates were **dropped rather than shipped on memory**: Colorado's
Revitalizing Main Streets, whose own page states it no longer has funding to
award, and "CDOT planning grant cycles", which is not a program CDOT offers —
planning studies are an eligible cost under MMOF, which that entry now says.
Two others were corrected to their current names: TIB's Small City Sidewalk
Program now runs as the Small City Active Transportation Program, and MMOF's
name now includes "and Mitigation".

### A wrong-template bug fixed before it could reach anyone

Registering a second template exposed a latent fault: the report detail page,
the packet generator, and the assistant's project context all built their gate
boards on whichever template was the registry default rather than the one the
workspace is bound to. With one template registered the two were always the
same id, so nothing was ever wrong on screen — but with two, a California
workspace's recorded gate decisions would have matched none of the federal
template's gates and rendered as "no decision recorded" on every one, inside a
packet an agency sends to a funder. The board builders now require the caller
to state the bound template, and a workspace whose binding cannot be
established gets an explicit "could not be checked" instead of a board. Packet
generation refuses (409) rather than freezing gate names nobody bound.

Related: a workspace created before this release still holds the old default
template id, and that id cannot tell us whether an agency chose California's
gates or merely inherited them. OpenPlan now treats every id the column default
has ever stamped as an assumption to be disclosed, not a choice to be reported.

### Fresh installs work again under newer Supabase CLI versions

**Requires one migration** (`20260804000002`). Run
`npm exec -- supabase migration up --linked` (locally: without `--linked`)
before deploying, as always. On every EXISTING database this migration is a
no-op — it changes nothing you already have.

Newer versions of the Supabase CLI (the jump from 2.76 to 2.111 in this repo's
lockfile) changed what a brand-new local database grants by default: tables
created by migrations no longer give the application's own server role — or any
signed-in user — permission to read or write rows. Existing databases are
unaffected because their tables keep the permissions they were created with,
which is why nothing looked wrong on machines that had been running OpenPlan
all along. But a FRESH install — a new agency following the README, a CI
`db reset` — produced a database the app could not use at all: every screen
failed, and the setup instructions led to a dead end.

The migration restores exactly the intended posture on fresh databases: the
server role gets its full access back, signed-in users get the table access
that row-level security then narrows per workspace (the same posture every
existing deployment has always had, and the one the live isolation tests
verify), and the deliberately locked-down tables from 0.3.0's security fix
stay locked down. It was verified against a from-scratch database, and the
live isolation suite now runs on every pull request rather than once nightly —
which is how this was caught.

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
that what it was reading had never taken effect. Two checks replaced it, and it
matters which does what *(corrected 2026-08-04 — this entry originally claimed the
live check "fails the build", which overstated its mechanism)*: a build-time check
derived from the migrations fails **every build** if a declared table lacks
`ENABLE ROW LEVEL SECURITY`, and a **live** check with no exception list asks a
running database the same question — but the live check runs only in the nightly
scheduled job and on demand (`npm run test:rls-live`), not on every build, so
drift introduced directly against a live database surfaces within a day, not
instantly.

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

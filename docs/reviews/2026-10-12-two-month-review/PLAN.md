# OpenPlan: review of August 11 to October 11, 2026, and the plan to v1.0 and beyond

Prepared October 11, 2026 for Nathaniel Redmond. Draft for review before any
repository change. Main was not touched while preparing it.

Sources: 15 independent review reports in
`~/.local/state/openplan-review-20261011/` covering all 119 pull requests
(#100 to #218), every Claude Code and Codex session on OpenPlan since August
11, the roadmap and product documents, the frontend, backend, workers, tests,
infrastructure, and a module-by-module check against what a planner can
finish. Reviewed commit: `origin/main` at `c735abec3` (v0.68.0 plus unreleased
work), later `673099778`.

The companion `BACKLOG.md` lists all 487 itemized findings by module, with
file and line, severity and source. This plan sequences them.

## 1. Bottom line

1. **The roadmap was edited 194 times in two months but stopped describing
   the product.** Four of those edits changed direction after September 6.
   The rest appended evidence links or bumped header fields. Nothing from
   October 10 and 11 reached it: the public launch, the Maps module, the UI
   overhaul, the engagement map work. The roadmap, the v1 contract and the
   known-issues list still say hosting is deferred. The last "next steps"
   list ran out around October 8.
2. **OpenPlan is broad and mostly unfinished as planner work.** One of seven
   common small-agency jobs can be finished end to end without the
   developer: an engagement map for a corridor study. The OWP, a grant
   application and a sales-tax measure are partly finishable. A safety
   action plan, an RTP update from the prior adopted plan, and a defensible
   screening traffic number are not.
3. **Most agent hours went to internal work.** In October, about 80 percent
   of added lines were evidence files and about 8 percent were application
   code. About 72 percent of Codex pull requests changed nothing a planner
   sees. Concrete requests from you (the BCA workbench, the dashboard, the
   engagement map, the hosted relaunch) produced visible work within a day.
   Open-ended "keep going until v1" produced recovery and custody work.
4. **About 30 flagged defects are open on main and none is in the
   known-issues list.** The review found more beside them. The most
   important:
   - County model runs are graded against the retired 30 percent gate, so a
     failing run can still read "Screening-grade." This is a scientific
     overclaim on a planner-facing number.
   - Five money defects: OWP hours counted twice, a report issued without
     rechecking adoption, an amendment overwrite, a voided invoice
     stranding its costs, and finance approval that skips PM review. A
     member can also edit a paid invoice directly through the database.
   - Board packets silently undercount engagement comments past 1,000.
   - Engagement support votes can be inflated by a script on the public site.
   - The new dashboard hides deadlines missed more than a day ago.
   - Missing funding gaps and missing ATP scores print as zero.
5. **The public site needs operating basics before you invite anyone.** No
   monitoring or error tracking, database changes applied by hand after code
   deploys, no automated file backup, usage caps off by default, no signup
   bot check, an uncapped Mapbox key in the page code, and a copy of the
   production database in an offline Railway service.
6. **Your direction has been consistent; the documents drifted from it.**
   Your own words, August 25: "Is openplan the ultimate planning platform for
   any type of planner in the United States" and "Fully working model for
   all of the United States for v1... California must be flawless. Even if
   it takes a year or more." September 4 added requirements you said "are
   not add ons." The v1 contract captures this correctly. The roadmap's
   problem is shape and currency, not ambition.

## 2. Where each module stands today

Grades: demo; usable for one job; usable for the job; defensible for public
use. Nothing is "defensible" yet because no practicing planner has been
observed and no model result is validated.

| Module | Grade | Biggest gap |
|---|---|---|
| Engagement (staff, portal, embed) | Usable for the job | Study area set at the bottom of a 12-section setup tab; vote inflation; 18,264 words on the campaign page; no observed users |
| Dashboard, My Work | Usable for the job | Missed dates older than a day hidden; RTP comment and measure claim dates missing from My Work |
| Projects | Usable for the job | About 45 sequential database reads per page load; templates are deliverable lists only |
| Land Use Plans | Usable for one job | Plan-kind and cross-state authority cases untested; no development review |
| Work program (OWP/UPWP) | Usable for one job | Hidden behind a button on any program; reporting shown before preparation; three money defects |
| Local measure | Usable for one job (staff side) | Cities cannot sign in; no project quantities; hard to find |
| Invoices and contracts | Usable for one job | Two money defects; 127 KB of single-line code nobody can review |
| Grants and BCA | Usable for one job | ATP scoring code not on any screen; no deadline alerts; BCA geography is free text |
| Corridor Analysis | Usable for one job | Code roadmap printed under every result; gives a score, not a volume |
| Safety | Usable for one job | Stops after crash analysis; fatal-only outside California |
| Data Hub | Usable for one job | Hosted transit uploads fail above about 4.5 MB though 200 MB is advertised; shapefile intake untested; transit panel full of operator text |
| Documents, Reports | Usable for one job | No full document writing and review |
| RTP | Usable for one job (hand-built) | Reading the prior plan needs a paid key; no policy and action register |
| Plans (generic) | Demo | A list of links that overlaps RTP and Safety |
| Travel modeling, Scenarios, Model Validation | Demo | Build case is a typed percentage; county runs graded on the retired 30 percent gate; an interrupted stage stays "running" forever; no validation |
| Maps | Demo | OpenPlan makes no maps itself; needs Fable on the planner's computer |
| Aerial | Demo | No ODM worker on the hosted site; DJI import unproven |
| Planner Agent | Demo | Needs a paid key per workspace; cannot take an assignment |
| Billing, Command center | Vestigial | Redirect stubs |

## 3. Was the roadmap properly and continually updated

No. It was updated often but not kept current. Specifically:

- **Status has no home.** It lives in 49 dated paragraphs and 118 links into
  `docs/reviews/`. No milestone has a status field, owner or summary row.
- **A guard forces misleading headers.** The direction check requires every
  document header to equal the package version, so release commits bump them
  with no review. The capability matrix header says v0.68.0 while its body
  still calls v0.44.0 an unreleased candidate.
- **Expired inputs pass.** The capability matrix, registry and jurisdiction
  registry are past their review dates, and the check still exits 0.
- **Coordination notes landed in product documents.** Same-day merge-hold
  notes sit in the roadmap and ledger.
- **KNOWN_ISSUES and ARCHITECTURE were last reconciled September 6.**
- **The August 25 four-release plan lasted 94 minutes** before the broader
  contract replaced it. Its first item, serious-injury crash data outside
  California, never shipped.
- **Documentation grew from 93 files to 6,096 (127 MB) in two months.** 98
  percent is review evidence: 2,504 JSON files, 1,083 logs, 821 Python
  scripts, 413 screenshots. A new agent following AGENTS.md reads about
  52,700 words before starting and still does not learn that a hosted site
  exists.

## 4. How the plan is organized

The v1 contract stays the destination. This plan changes how the work is
sequenced and recorded, not what v1 means.

Five principles drive the sequence:

1. **Finish jobs, not layers.** Each release completes a named planner job
   end to end, from a visible entry point to a usable file, or it fixes
   something that breaks one.
2. **Safe to show before wide to show.** The live site gets operating basics
   and the open defects get fixed before new features.
3. **Cheapest unlock first.** Several jobs are days from finishable because
   the code exists but the entry point, page order or one wire is missing.
4. **Proof scales with risk.** Money, permissions, public data and model
   numbers keep strong verification. A copy change does not get a
   1,000-file evidence folder.
5. **Science runs alongside, never instead.** The model validation program
   continues on its own track and never blocks everyday planning jobs.

The work falls into four stages to v1, then a post-v1 horizon. Version
numbers below are indicative; a release ships when its job is done.

## 5. Stage A: safe to show (v0.69, about one week of agent time)

Goal: the public site can be shown to strangers without a surprise bill,
an outage nobody notices, or a known defect touching money or public input.

### A1. Operate the live site

- Uptime check on `/api/health` and the OCR health route (free external
  service), plus a token-protected deep health check (one database read, one
  storage check, worker heartbeat ages). Re-arm the production health
  workflow.
- Error tracking (Sentry free tier or a log drain); report client errors
  from the error boundaries.
- A CI check that fails when the repository has migrations the hosted
  database lacks; health reports expected versus applied migration.
- Set `OPENPLAN_MONTHLY_RUN_CAP` and `OPENPLAN_MODELING_QUEUE_DEPTH`; add a
  deployment-wide run concurrency limit and per-workspace storage quotas.
- Signup bot check (Cloudflare Turnstile or hCaptcha, both free, both
  supported by Supabase Auth); a per-account limit on new workspaces; an AI
  limiter that reserves before the call and fails closed.
- Public engagement abuse: a database-backed photo throttle (today it lives
  in one server's memory), photos stored as pending until attached, a sweep
  for orphans, and a byte budget per campaign; daily caps on the "send me
  updates" form per campaign and per address, from a sender separate from
  signup mail.
- Census tract ingest limited to a writer role with a rate limit.
- Mapbox: URL-restrict the public token, add a usage alert, and make the
  key-free MapLibre style the default for public maps.
- Scheduled offsite backup of database and storage objects (Backblaze B2 or
  similar, a few dollars a month within the $50).
- Separate the model host from the other workers so the Railway hard limit
  cannot stop email, exports and OCR together.
- Heartbeats for every Node queue, so a stopped queue does not look slow.
- One-page operator procedures: roll back, restore, rotate each key, and
  where each secret lives (names only). Second-key support for the
  integration secret.
- Email: Google Postmaster Tools, aligned DMARC on a sending subdomain, and
  a decision on the sender domain (see decisions).
- Delete or expire the offline `restore-drill` Postgres that holds a
  production copy (needs your go-ahead).
- Add `robots.txt`; remove `X-Powered-By`; tighten the content-security
  policy where it can be done without breaking maps.

### A2. Fix the flagged defects that touch money, the public or a claim

Log all open findings in `KNOWN_ISSUES.md` first, then fix in this order:

0. County run grading: derive the claim tier from the rules-v4 outcome the
   Python already computes; a failing run reads "prototype only"; retire
   the "validated-screening" stage name. Until then, hide the grade.
1. Engagement vote inflation from browser-minted device tokens (#194), and
   the cross-campaign device hash.
2. OWP: duplicate labor hours in the overlap check; report issue without
   adoption recheck; amendment overwrite (#103, #104).
3. Contracts: voided draft invoice strands sources; finance approval that
   skips PM review; deliverable submission blocked for members (#106, #107).
4. Dashboard hides dates missed more than a day ago; contract tasks with
   due dates shown as undated (#187).
5. One shared date helper: date-only values are past only after the day
   ends everywhere; timestamps compare as instants. Replaces the UTC slices
   in #207, #218 and agrees with `isDeadlinePast`.
6. Map packages: same-project check and retry comparison (new migration);
   route agent-produced files through the action registry or record the
   exception (#189).
7. Light-mode Corridor Analysis result card and hover text (#193), after a
   browser check.
8. BCA geography bound to the project's place of record (#118).
9. Board packets and the campaign list read every page of engagement
   comments, with the existing complete-read helper and a guard against
   unpaged reads of tables that grow.
10. Terminal-state guard triggers on invoices, and invoice line
    replacement as one database function instead of delete-then-insert.
11. Unknown stays unknown: funding gaps and reimbursements in report
    snapshots, ATP scores, and transit figures when the feed failed.
12. The contract role check that lets a user ask about another user's role.
13. Move Caltrans guidance out of the federal grant program list into the
    California adapter.
14. Remaining P2 findings, each fixed or recorded with a reason.

### A3. Make the documents true

- Update the v1 contract, roadmap, AGENTS.md, README, KNOWN_ISSUES and
  ARCHITECTURE for the hosted site, the Maps module, the UI overhaul and
  the engagement map work.
- Replace `docs/ROADMAP.md` with a short status page (section 10).
- Move the release-by-release paragraphs out of the roadmap into
  CHANGELOG or a dated archive file.
- Change the direction check so headers record the review that actually
  happened, and so expired inputs produce a visible failure.
- Rerun the twelve first-week journeys against current main. The last full
  run was September 6, 24 versions ago. This is the baseline for Stage B.

## 6. Stage B: find it, finish it (v0.70 to v0.73, two to four weeks)

Goal: every top-level surface either completes a real job or leaves the top
level. Most of this stage is wiring and plain words, not new systems.

### B1. Entry points, page order, words (v0.70)

- OWP/UPWP as its own program type and navigation label; preparation shown
  above reporting until adoption; "Start from last year's OWP" carries over
  the closed cycle.
- A visible entry for the local measure.
- Engagement: study-area picker inside the publishing checklist; "Before
  publishing" and "Advanced" groups on the Setup tab; report-back builder
  moved to Responses.
- Onboarding starts with a project; the AI key becomes optional; Help lists
  every feature that needs a key (RTP reading and Maps are missing).
- Remove builder text from planner pages: the Corridor Analysis roadmap
  card, the RTP "queue lane" sidebar, "control lane" links, migration and
  environment-variable sentences (about 20 places), audit event ids in the
  Planner Agent drawer. Move what operators need into `OperatorDetail`.
- Widen the build-notes guard to the custody vocabulary and to `src/lib`;
  add a guard for em dashes in rendered strings (about 700 today) and for
  `?? 0` in JSX.
- One shared error boundary that actually retries; `loading.tsx` for every
  module; parallel reads on the project page and load only the open tab.
- Merge the three plan entries in navigation (your decision D4).
- Retire the Billing and Command center redirects with a date.

### B1a. Things that break silently on the hosted site (v0.70)

- Transit (GTFS) and aerial uploads go straight to storage with a signed
  link, as workspace GIS already does, so feeds above 4.5 MB work.
- Model stages: a renewable lease tied to the heartbeat, reconciliation of
  owned "running" stages on restart, a clean drain on shutdown, and a
  visible "no progress for N minutes" state for ActivitySim instead of a
  silent hang. Either wire the 2,700 lines of unused engine-supervision
  code or retire it.
- ActivitySim results written through the same journaled path AequilibraE
  uses.
- One pinned dependency set for both model images and the county stack,
  with the graph-compatibility check run in each.
- A workspace time zone, and one "today in this workspace" helper used by
  claims, allocations, invoices, deadlines and the Planner Agent.

### B2. Widen the journey harness (v0.70)

Add six journeys so every core job has one: RTP update from the prior plan,
an OWP reporting period, a grant application, a measure reporting cycle, a
safety action plan, and a contract month-end. Run affected journeys on
every release; run the full set at each stage end.

### B3. Safety action plan and SS4A (v0.71)

Build on the existing KSI locations: high-injury network, systemic risk
screen, countermeasure list with crash modification factors from the FHWA
clearinghouse, ranked project list, and a plan document through Reports.
Research serious-injury crash sources outside California (the August 25
item that never shipped) and label fatal-only states at the figure.

### B4. Grants that reach submission (v0.72)

Put the existing ATP scoring packet on screen; seed SS4A sections from the
safety plan; deadlines and changed-deadline alerts in My Work; a search or
filter on the 3,500-word program catalog; award conditions handed to the
project and invoices without re-entry.

### B5. Local measure with recipient cities (v0.73)

A recipient role limited to its own claims; project, quantity, unit and
period on each claim; staff review, return and approve; public oversight
page with outputs. This is M13a-b and your Napa Measure U and San Francisco
Prop L examples.

## 7. Stage C: the September 4 jobs (v0.74 to about v0.85, two to four months)

Goal: every requirement you named on September 4 has a finished first job.
Each line is one or more releases; order follows dependency and how many
jobs it unlocks.

1. **RTP update from the adopted predecessor (M12a-b).** Start from the
   prior plan with OCR text plus table import, reviewed in the existing
   staging screen, with no paid key required. Then the policy and action
   register, financial element tables and differences between cycles.
2. **Maps without an agent.** Shared map shell with the key-free engine on
   every map surface; fix the style-load race at 12 call sites; load
   `mapbox-gl` only on map pages; export a project map as a figure with a
   source line. Fable map packages stay the premium option, and an
   API-direct path (phase B) lets an agency pay per run.
3. **Capital delivery, California local agency case (M10a).** Agreements,
   authorizations and obligations; phase records through PS&E,
   procurement, construction pay periods and closeout; Caltrans LAPM
   invoicing on the existing invoice engine. Not started today.
4. **Agency-side procurement (M14a-b).** Issue an RFP or RFQ, receive
   responses securely, evaluate by the correct method, award and hand off
   to the contract record. The consultant side exists.
5. **Contract drawdown and OWP to a real agency cycle.** Rebuild the
   one-line contract and OWP components on shared primitives; Caltrans
   prescribed forms where the source is current.
6. **Land use authority cases (M1) and development review (M7).** A
   California plan in an Oregon workspace and the reverse, a multistate MPO,
   a tribal authority; remove the TIGERweb and US literals from core.
7. **Aerial end to end (M5b).** An ODM worker for the hosted site or a
   documented self-hosted path; DJI Mini 4 Pro controller import proof
   (needs your controller model); orthophotos as a basemap layer elsewhere.
8. **Planner Agent provider choice for chat (A0) and the first durable
   assignment (A1b).** Then the MCP server under ADR-004, which is the
   bridge to Buzz.
9. **Data intake (M5a).** Shapefile, KML/KMZ and file geodatabase variants
   with a journey; dataset versions on re-upload.
10. **Documents (M2b).** Full document drafting and review with sections,
    figures, tables, comments and an approved output.

## 8. Stage D: proof for v1.0

Goal: the contract's acceptance evidence on one candidate commit.

- **Geography.** Grow coverage state by state in the order you set August
  25 (Nevada, Arizona, New Mexico, Texas after California) together with
  the September 4 manual states (Oregon, Washington, Nevada, Alaska,
  Hawaii); all 50 states and DC before the tag.
- **Science (S1 to S3)** on its own track throughout: production ingestion
  of both models, structural experiments on development data only, then
  untouched use-specific validation in every state. The approved guided
  traffic-number flow (screening and grant narratives, hard stop at
  environmental review) ships early as a labeled screening tier.
- **People.** Observe practicing planners and public participants under the
  observation protocol; an independent person installs, operates, backs up,
  restores and upgrades OpenPlan without you.
- **Accessibility.** WCAG 2.2 AA, keyboard, screen reader and print checks
  on every core journey and public page; an automated axe check in CI.
- **Capability matrix.** Every required cell `proven`. Today: 0 proven, 37
  partial, 62 not assessed.

## 9. After v1.0

Kept so they are not lost, in rough order:

1. Buzz workspace that drives OpenPlan agentically (your ultimate goal,
   July 28), on the action registry and MCP server built in Stage C.
2. Your four endorsed cross-module upgrades: crash rates per vehicle-mile
   once a model use is validated; engagement comments corroborated by crash
   history; two-model agreement as a citable fact in grants (never as an
   accuracy claim); My Work as the app-wide inbox.
3. One money story per project; orthophotos everywhere.
4. Territories and international adapters.
5. Multi-agent orchestration (the north-star "AI COO").
6. TimesFM 3.0 forecasting if the license permits the use.

## 10. The new roadmap format

`docs/ROADMAP.md` becomes a page a planner reads in two minutes:

1. A status table: milestone, status (done, in progress, next, later),
   last evidence (one link), next action.
2. "Next three" with dates, refilled when an item closes.
3. Links to the contract, ledger, CHANGELOG and an evidence index.

Milestone definitions move to `docs/product/MILESTONES.md`. Release notes
live only in CHANGELOG. Evidence keeps one short verification note per pull
request in the repository; raw logs, JSON receipts and screenshots go to CI
artifacts or release assets, linked by hash.

## 11. How agents should work from here

- **Give each lane a planner job, not "keep going until v1."** The evidence
  in section 1 shows the difference.
- **Make merge holds mechanical.** A required check reads a hold file in
  the repository and fails while it names main. Unanswered P1 bot findings
  block merge. A minimum open time lets the bot review post.
- **Cap evidence.** One verification note per pull request. Mutation logs
  and screenshots leave git.
- **Plain pull request bodies** you can read: what a planner sees, what was
  checked, what is not done.
- **Faster, more honest CI for one owner.**
  - Cancel superseded pull-request runs (635 CI runs in 30 days, no
    cancellation).
  - Run the core isolation tests on every pull request and shard the
    engagement synthesis suites, which are 82 percent of the 43-minute
    database-security job.
  - Default tests to a plain node environment; use a simulated browser
    only for component tests (about 1,110 seconds of setup per run today).
  - Build the live-test list from file names. One live security test
    added September 8 has never run in CI.
  - Run the 18 worker test suites CI never runs (OCR, ODM, three
    ActivitySim and three modeling suites).
  - Move the dependency audit to a schedule; drop the strict up-to-date
    rule; pin worker images by digest.
  - Replace hand-kept totals and growing exemption lists with derived
    checks; stop pinning long UI sentences in tests (1,062 assertions), so
    cutting words does not mean editing tests.
  - One shared mutation harness in `scripts/ops` instead of one per review.
- **Shared plumbing.** About 20 hand-written background-job protocols and
  five receipt mechanisms share no code. New durable work uses one library;
  old ones move to it when they are next changed.
- **Prune the 119 stale worktrees** after their lanes close.
- **Models.** Opus 5.5 or GPT-6.1 Sol at high for work; Haiku 5.5 at high
  for simple jobs; Astra only for deep planning. Already in your global
  files.

## 12. Decisions only you can make

1. Does this review count as the independent Opus review your merge hold
   waits on, or do you want the relaunch agent's separate check as well?
2. Planner vocabulary (D6): packet, retain, campaign or consultation,
   posture, unassessed.
3. The "OpenPlan · Nat Ford Planning" footer credit, and whether OpenPlan
   email keeps sending from natfordplanning.com while Nat Ford is paused.
4. Delete the offline restore-drill Postgres that holds a production copy.
5. Spending within the $50: offsite backup (a few dollars), Resend Pro
   ($20) only if signups grow.
6. State order after California: August 25 named Nevada, Arizona, New
   Mexico and Texas; September 4 named Oregon, Washington, Nevada, Alaska
   and Hawaii for manuals. Confirm one order.
7. Your DJI controller model (Mini 4 Pro with RC-N2, RC 2, or another).
8. A Fable probe run for Maps, and whether to build the API-direct path
   before the $200 credit expires October 28.
9. Territory depth for v1.
10. Moving the 127 MB of evidence out of `docs/` (history keeps it).
11. A first real agency or planner to observe.

## 13. What I will do first when the hold lifts

In order, each as its own pull request with a plain body:

1. KNOWN_ISSUES entries for all open findings, and the documents truth pass.
2. The county grading fix, then the money and public-input defect fixes
   (A2 items 0 to 5).
3. Live-site operations that need no spending decision: monitoring, error
   tracking, migration check, usage caps, queue heartbeats, procedures.
4. The new roadmap page.
5. The journey rerun as the Stage B baseline.

Buzz reminder: agentic control of OpenPlan is still your stated ultimate
goal. Stage C builds the MCP server and durable assignments it needs.

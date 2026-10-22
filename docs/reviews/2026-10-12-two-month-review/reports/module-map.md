## Bottom line

1. **Only Engagement runs end to end.** It is the one module a small agency can use start to finish today. Projects, Land Use Plans, My Work and the four project handoffs (GIS, workbook, evidence bundle, two-person approval) each finish one job.
2. **Nine of the 24 navigation entries have no first-week journey.** They are RTP, Programming Cycles (with the work program and measure pages under it), Grants, Invoices, Maps, Aerial, Scenarios, Planner Agent Activity and Help. The contract requires every top-level surface to be part of a proven journey or leave the top level (`docs/product/V1_PRODUCT_CONTRACT.md:193`).
3. **The last full harness run is old.** It ran September 6 on `648504cf`: nine passes, three partials. OpenPlan has since gone from v0.44 to v0.68 and is now publicly hosted.
4. **The queue is lopsided.** The October 6 immediate sequence (`docs/ROADMAP.md:55-72`) leads with engagement synthesis, which builds on the most finished module. Safety action plans, grant applications, starting an RTP from the prior plan, and city reporting for a measure are each one or two builds from finishable, and none is queued.
5. **Three core jobs need a paid or external AI service**, despite the contract's "no required paid infrastructure" (`V1_PRODUCT_CONTRACT.md:223`):
   - reading figures out of a prior RTP needs an Anthropic key (`src/app/api/rtp-cycles/[rtpCycleId]/extraction-runs/route.ts:370-376`);
   - Maps needs Claude Fable 5.1 running on the planner's own computer (`src/components/map-packages/map-package-creator.tsx:107-113`);
   - comment translation needs an Anthropic key.

   Help says "everything else works without a key" (`src/app/(app)/help/page.tsx:173-178`), which is false for the first two.
6. **The contract and roadmap still say hosting is deferred** (`V1_PRODUCT_CONTRACT.md:22`, `docs/ROADMAP.md:115`). The site has been live with public signups since today (`docs/ops/HOSTED_LIVE_2026-10-11.md`). The roadmap has no milestone for running a public service.

## 1. Module inventory

Grades: empty shell; demo (works on fixtures or needs the developer); usable for one job; usable for the job; defensible for public use. Nothing reaches "defensible," because no planner has been observed and no model result has been validated. "Spine" means the surface reads or writes Projects or a statutory plan.

| Surface | Routes | What a planner can do today | What contract and roadmap require | CORE ids | Grade | Biggest gap | Spine or island |
|---|---|---|---|---|---|---|---|
| Dashboard | `/dashboard` | See work that needs them and what is due in 60 days, the 8 latest projects, three figures, charts and a setup checklist (`dashboard/page.tsx:265`) | Saved views; failed jobs; awaited approvals (M2c) | CORE-DAILYWORK-01 | Usable for the job | The checklist counts an Anthropic key, a geography and a corridor run, but not a project (`first-run-checklist.tsx:297,319,364`) | Spine |
| My Work | `/my-work` | One queue from 18 sources: delivery, moderation, failed runs, decision packages, land-use actions, contract tasks, work-program periods, grant decisions, award obligations, invoice windows (`src/lib/my-work/sources.ts:243-998`) | Delegation, reminders, return to work (M2c) | CORE-DAILYWORK-01, CORE-PM-01 | Usable for the job | Missing RTP comment periods, measure claim deadlines and grant section deadlines; contract reminders "awaiting installation" (`projects/[projectId]/management/page.tsx:22`) | Spine |
| Projects | `/projects`, `/projects/[id]` (5 tabs) | Create; import and export the portfolio workbook (import only adds new projects); 24 work-plan templates; budget, funding, delivery, risks; corridor and study area; evidence ZIP; GeoPackage; two-person decision package; readiness JSON | One case from intake to handoff (M2, M2a) | CORE-PLATFORM-01, CORE-WORKPLAN-01, CORE-PM-01 | Usable for the job | Templates are only deliverable and milestone lists; no single owner for a fact shared by Plans, Land Use Plans and RTP | Spine |
| Project weekly management | `/projects/[id]/management` | Contract forecasts, schedules and cost tables; the page is one unstyled function (`management/page.tsx:12-28`) | Weekly project-management review (M11) | CORE-PM-01 | Usable for one job | Reachable only from one panel link (`project-contracts.tsx:6`); not built from the shared interface components | Spine |
| Plans (generic) | `/plans`, `/plans/[id]` | Plans typed Corridor, ATP, Safety, Regional, Complete Streets or Other (`src/lib/plans/catalog.ts:1-8`); link records; six presence checks | Meaning versus Land Use Plans and RTP (matrix line 88) | CORE-PLATFORM-01 | Demo | A list of links with no writing tools; "Safety Plan" and "Regional Plan" compete with the Safety and RTP modules | Spine |
| Land Use Plans | `/land-use-plans`, `/[id]`, `/review/land-use-plans/[token]`, `/published-plans/[id]` | Author sections, policies and actions; designation layer; freeze; public review; responses; adoption; publish; implementation report. Harness job 06 passed | Plan-kind rules (M1); housing and development review (M7) | CORE-PLATFORM-01, CORE-GEO-01 | Usable for one job | No housing element or development-review case; plan-kind rules unfinished | Spine |
| RTP | `/rtp`, `/rtp/[id]` (5 tabs), `/document`, `/extraction`, `/extraction/chapters`, `/plan/[token]` | 7 chapter templates (`src/lib/rtp/catalog.ts:50-98`); financial ledger; fiscal constraint; performance measures; scored project list; comment response; public page; "packets"; AI reading of a prior plan | Start from the adopted plan and carry it through adoption (M12a-d) | CORE-RTP-01/02 | Usable for one job (hand-built draft) | Reading a prior plan needs an Anthropic key; no register of policies and actions; jargon such as "Reset and regenerate packets" (`rtp/page.tsx:771-776`); no journey | Spine |
| Programming Cycles | `/programs`, `/programs/[id]` | Program types are RTIP, STIP, ITIP, TCEP, Local Measure and "Other Program Lane" (`src/lib/programs/catalog.ts:1-8`); link projects; log opportunities | Agency prioritization (M6c) | CORE-OWP-01, CORE-FUNDADMIN-01 | Usable for one job | Types are California-only; there is no OWP or UPWP type | Spine |
| Work program (OWP/UPWP) | `/programs/[id]/work-program` | Keep prior OWP PDFs; edit elements, funding and staffing tables; check totals; adopt and amend; record actual work; period reports; reimbursement packets; closeout and carryover (about 163 KB, 15 components) | Full annual cycle (M2d.1-4) | CORE-OWP-01 | Usable for one job (tested on a synthetic case) | Hidden behind a "Work program" button on any program (`programs/[programId]/page.tsx:812-815`); reporting sits above preparation (`work-program/page.tsx:42-44`); no Caltrans form output; no journey | Spine |
| Local measure | `/programs/[id]/measure`, `/measure/[token]` | Receipts, allocation rules, periods, allocation, recipients, claims with documents, maintenance of effort, oversight statement, public page | Cities report on the administrator's site (M13a-d) | CORE-FUNDADMIN-01 | Usable for one job (staff side only) | Cities cannot sign in (`src/lib/measures/write-authorization.ts:20-31`); no project quantities; the entry is reachable mainly through command-palette search (`nav-registry.ts:135-146`); no journey | Partly spine |
| Invoices and contracts | `/invoicing`, `/invoicing/engagements/[id]`, `/billing` (redirect) | Caltrans local-assistance (LAPM) reimbursement invoices to the funder; money owed to the agency; contract management in 14 tabs | Contract drawdown; capital payments (M10, M11) | CORE-PM-01, CORE-CAPITAL-01, CORE-LAPM-01 | Usable for one job (synthetic) | About 127 KB of code packed onto single lines across 19 files, not using the shared interface components; exact Caltrans forms deferred; no journey | Spine |
| Grants and BCA | `/grants` (3 tabs), `/grants/bca/[projectId]` | Live Grants.gov search; catalog of 9 federal programs plus 6 states; application sections with optional AI drafts; attachment checklist; export; awards; benefit-cost workbench | Discovery through award, with alerts (M13e, M6b) | CORE-GRANTPURSUIT-01, CORE-ANALYSIS-01 | Usable for one job | The ATP scoring packet (`src/lib/planner-pack/atp.ts:102`, `render.ts:289`) exists in code but no screen calls it; no deadline alerts; no journey | Spine |
| Engagement (staff) | `/engagement`, `/engagement/[id]` (4 tabs), `/preview` | Templates; publishing checklist; survey; categories; map layers; offline import; other ways to take part; translations; moderation; response map; crash cross-check; staff synthesis; reporting back; PDF, XLSX and ZIP exports; RTP link. Harness job 03 passed | Better than Social Pinpoint, with observed users (M9a-c) | CORE-ENG-01 to 04 | Usable for the job | Nobody has been observed using it; the Setup tab has 12 sections and the study area is set at the bottom | Spine |
| Engagement portal and embed | `/engage/[token]`, `/about`, `/embed/[token]` | Resident drops a pin, comments, gets a receipt; only approved comments are public | WCAG 2.2 AA; non-map option (M9a) | CORE-ENG-01, CORE-INCLUSIVE-01 | Usable for the job | No accessibility check with real users; hosted email lands in Gmail spam | Spine |
| Travel modeling | `/models`, `/models/[id]` | Guided comparison: AequilibraE and ActivitySim, each run as baseline (no-build) and build; run evidence; CEQA VMT screen | Validated two-model results nationwide (S1-S3) | CORE-MODEL-01 | Demo | The build case is a percentage the planner types (`api/models/project-comparison/route.ts:35-40`); no validation; needs a worker running; job 05 partial | Spine |
| Model Validation (county runs) | `/county-runs`, `/[id]` | County setup and validation runs | Scientific record-keeping (S1) | CORE-MODEL-01 | Demo | The label claims more than the results support; job 11 partial | Island |
| Scenarios | `/scenarios`, `/[id]` | Scenario sets and comparison snapshots | Four-way comparison | CORE-MODEL-01 | Demo | No journey of its own | Spine |
| Corridor Analysis (Explore) | `/explore` | Screening score from Census, crash, transit and equity data; runs saved under a monthly cap (`api/analysis/route.ts:353`) | Ordinary analysis (M5) | CORE-ANALYSIS-01 | Usable for one job | It gives a score, not a traffic number | Spine |
| Safety | `/safety` | California CCRS crashes (with injuries) or national FARS (fatal only); map; worst killed-or-seriously-injured (KSI) locations; burden screen; send to a report (`safety-workspace.tsx:1473,1529,1577`) | From problem to treatment decision (M6a) | CORE-MODAL-01 | Usable for one job | No high-injury network, systemic risk screen, countermeasures or plan document; fatal-only outside California; job 04 partial | Spine |
| Data Hub | `/data-hub` | GIS upload, data sources, datasets, transit (GTFS) feed intake (optional), Title VI service-equity panel | Shapefile, KML and geodatabase intake (M5a) | CORE-INTAKE-01 | Usable for one job | Shapefile never tested; a re-upload cannot become a new version (KI-2026-09-01-019) | Island that feeds Projects |
| Documents | `/knowledge-base` | Library of every workspace file; upload; text recognition (OCR) through a worker | Writing and reviewing documents (M2b) | CORE-DOCUMENTS-01 | Usable for one job | No way to write and review a full document | Spine |
| Reports | `/reports`, `/[id]` | Three types: project status, analysis summary, board packet (`src/lib/reports/catalog.ts:18-20`); RTP and land-use reports; AI draft; PDF | Decision documents (M2b, M5) | CORE-DOCUMENTS-01 | Usable for one job | Cannot produce a plan document; "packet" wording throughout | Spine |
| Maps | `/maps`, `/maps/[id]` | Ask Claude Fable on your computer for a map package, or upload a ZIP; view and download | No direct contract line | (none) | Demo | OpenPlan itself makes no maps; only Claude connections are looked up (`maps/page.tsx:76-77`) | Spine |
| Aerial Imagery | `/aerial`, `/missions/[id]`, `/edit` | Mission and survey grid; KML and DJI WPML export; image upload; OpenDroneMap (ODM) processing; artifacts; orthophoto layer | Full ODM and WebODM parity; DJI USB transfer (M5b) | CORE-AERIAL-01/02, CORE-DJI-01 | Demo | No ODM worker on the hosted site; DJI controller import unproven; no journey | Spine |
| Planner Agent and activity | App-wide assistant, `/assistant-activity` | Anthropic chat grounded in workspace records; 12 actions that need approval (`action-metadata.ts:21-134`); panel for an installed command-line agent; activity log | Provider choice (A0); assigning work (A1) | CORE-AGENT-01, CORE-AGENTIC-01 | Demo | Each workspace needs its own paid key; cannot assign work across modules | Spine |
| Workspace setup and health | `/workspace` | Team, geography, readiness, stage gates, AI keys, API connections, deployment health | Agency installation; confidentiality (M3, M4) | CORE-HOST-01 | Usable for the job | Server health is administrator content on a planner page; only four roles | n/a |
| Billing | `/billing` | Redirects to `/invoicing` | n/a | (none) | Vestigial | Kept only for old bookmarks | n/a |
| Command center | `/command-center` | Redirects to `/dashboard`; merged into it August 10 | Matrix line 106 says it is not a module | (none) | Vestigial | Needs a removal date | n/a |
| Published pages | `/plan/[token]`, `/plan/[token]/document`, `/published-plans/[id]`, `/review/land-use-plans/[token]`, `/measure/[token]` | Public RTP, land-use plan and measure pages | Accessible, printable public documents (V1) | CORE-RTP-01, CORE-FUNDADMIN-01 | Usable for one job each | No print or screen-reader proof | Spine |
| Help | `/help` | Module descriptions, guides, list of AI-key features | Setup by a stranger (V1) | CORE-PLATFORM-01 | Usable | The AI-key list leaves out RTP reading and Maps | n/a |
| Sign-up and onboarding | `/sign-up`, `/sign-in`, `/invitations/[token]`, password reset, setup wizard, checklist | Account, workspace, geography, invitations. Jobs 01 and 01-neutral passed | Works without Nathaniel (V1) | CORE-HOST-01 | Usable for the job | The first highlighted step is the Anthropic key (`first-run-checklist.tsx:297`); no project step | Spine |

**Vestigial or misplaced surfaces:**
- **Billing and Command center** survive only as redirects for old bookmarks. Each needs a removal date.
- **The public header** shows signed-in users three links: Dashboard, Corridor Analysis and Invoices (`top-nav.tsx:16-19`). That set looks left over, and a resident portal has no use for an invoices link.
- **Plans** overlaps RTP and Safety and has no writing tools.
- **Model Validation** is a modeler's tool and belongs under Travel modeling.
- **Planner Agent Activity** is a log, yet it sits fifth in the Workspace group (`nav-registry.ts:115-120`).

## 2. Journey check

Last full run: September 6 on `648504cf` (`docs/ops/V044_FINAL_FIRST_WEEK_OUTCOMES_2026-09-06.md`). There is no later run directory under `~/.local/state/openplan/first-week-runs/`. Four Blocker fixes from that campaign still wait on a full rerun before they count as closed (KI-078, 079, 080 and 082 in `docs/ops/KNOWN_ISSUES.md`).

| Job | Navigation path | Visible entry at every step? | Sept 6 result |
|---|---|---|---|
| 01 First-day setup | Public "Create free workspace", sign-up, setup wizard, dashboard checklist, `/workspace` | Yes; leads with the AI key | Pass |
| 01 Neutral geography | Same, then Land Use Plans, then readiness JSON on `/workspace` and the project page | Yes | Pass |
| 02 Project end to end | Projects, create, upload geography, report, evidence bundle | Yes | Pass |
| 03 Public engagement | Engagement, create, publish checklist, copy link, portal, Responses | Yes; study area is at the bottom of Setup | Pass |
| 04 Safety case | Safety, import, KSI locations, "Carry this Safety analysis into a report" | Yes up to the report; no treatment, cost or benefit step exists | Partial |
| 05 Analysis corridor | Corridor Analysis or Travel modeling, start comparison, type the build assumption | Yes; needs a worker and a typed percentage | Partial |
| 06 Land-use plan | Land Use Plans, Data Hub, Documents, review, adoption, publish, implementation report | Yes | Pass |
| 07 GIS handoff | Project, Evidence tab, GeoPackage | Yes | Pass |
| 08 Portfolio round trip | Projects, download workbook, import preview | Yes | Pass |
| 09 Evidence bundle | Project, Evidence (`project-documents-panel.tsx:162`) | Yes | Pass |
| 10 Two-person decision handoff | Project, Evidence, decision package (`:163`), My Work for both people | Yes | Pass |
| 11 Model validation evidence | Travel modeling, published studies, model detail | Yes; the screen text did not confirm no point cap or holdout | Partial |

No job covers RTP, Programming Cycles, the work program, the local measure, Grants, Invoices and contracts, Maps, Aerial, Scenarios, the Planner Agent, or shapefile and transit-feed intake.

## 3. The purpose test

**What a small-city or rural planner can finish alone.** An engagement map for a corridor study is the only one of the seven jobs that runs end to end. The planner starts from the corridor-safety template, publishes through the checklist, moderates in Responses, reports back and downloads PDF and XLSX reports. It breaks in three places: the study area is set at the bottom of a 12-section Setup tab, hosted email lands in spam, and translation needs the agency's own Anthropic key. The OWP and the sales-tax measure can each be partly finished. The OWP can be prepared from last year's PDFs, adopted, amended, reported by period and closed with carryover. First the planner has to find it by creating a program with a California type and clicking a "Work program" button. Staff setup lives in Invoices, and the quarterly packet is not the form Caltrans prescribes. On the measure, staff can record receipts, allocations, claims, maintenance of effort and a public oversight page. Recipient cities cannot sign in, and claims carry dollars but no project quantities. An SS4A or ATP application can be drafted and exported from catalog-seeded sections and an attachment checklist. The ATP scoring packet already in code is not on any screen. SS4A also requires an adopted safety action plan, and OpenPlan cannot produce one.

**Where the rest break.** A safety action plan stops after the crash analysis. OpenPlan gives California crash data, the worst KSI locations, a burden screen and a report section, and only fatal crashes outside California. It has no high-injury network, systemic risk screen, countermeasure list, ranked project list or plan document; the work-plan template only names those deliverables. A screening traffic number exists but cannot be defended at a hearing. Corridor Analysis returns a score. The model comparison returns "synthetic expanded daily traffic" for the no-build case, which is not AADT and has no validated accuracy. The build case is just the planner's typed change in daily auto trips. A self-hosted install also needs a modeling worker running. An RTP update from the prior adopted plan fails at the first step without a paid key, because reading figures from the old plan calls Anthropic (`extraction-runs/route.ts:370-376`). With a key, there is still no register of policies and actions, adoption is a status flag, and no journey has ever tested this path. A planner can build an RTP cycle by hand. That is drafting from scratch, not updating the plan.

| Job | Finish alone today? | Where it breaks |
|---|---|---|
| Update the RTP from the prior adopted plan | No | Reading the old plan needs a paid key; no policy and action register; no journey |
| Run the OWP for the year | Partly | Hidden entry; no OWP type; reporting shown before preparation; no Caltrans forms |
| Write an SS4A or ATP grant | Partly (draft and export) | ATP packet not on any screen; no safety plan to support SS4A; no deadline alerts |
| Engagement map for a corridor study, then report back | Yes | Study area buried; email lands in spam; translation needs a key |
| Screening traffic number for a corridor | No (a number, not a defensible one) | Build is a typed percentage; no validation; worker needed when self-hosted |
| Prepare a safety action plan | No | No high-injury network, countermeasure or plan-document step; fatal-only outside California |
| Administer a local sales-tax measure | Partly (staff side only) | Cities cannot sign in; no project quantities; hidden entry |

## 4. The gap ladder

### Ranked by distance from "a planner can finish one real job here"

| Rank | Surface | Distance | What closes it |
|---|---|---|---|
| 1 | Engagement | At the line | Move the study-area step into the checklist; observe one real campaign |
| 2 | Projects, My Work, Dashboard | At the line | A "start a project" onboarding step; RTP comment and measure claim dates in My Work |
| 3 | Land Use Plans | At the line for one plan | Plan-kind rules (M1) |
| 4 | Work program (OWP) | One short step | Visible entry and page order; then one real RTPA cycle |
| 5 | Local measure | One build | A recipient role and a reporting form (M13a-b) |
| 6 | Grants | One wiring step | Put the ATP packet and SS4A sections on screen; deadline alerts |
| 7 | Safety | One build | High-injury network, countermeasure list, plan document through Reports |
| 8 | Invoices and contracts | One step plus cleanup | A journey; rebuild the contract screens on the shared components |
| 9 | RTP | Two builds | Reading the old plan without AI; a policy and action register |
| 10 | Reports, Documents | Two builds | Writing and reviewing full documents (M2b) |
| 11 | Data Hub | One build | Shapefile, KML and geodatabase intake, with a journey |
| 12 | Corridor Analysis | Waits on model validation for volumes | Call the score a score |
| 13 | Maps | Far | A map figure export that needs no agent |
| 14 | Aerial | Far | An ODM worker, hosted or documented; DJI import proof |
| 15 | Travel modeling, Scenarios, Model Validation | Farthest | S1-S3 validation; build scenarios from real network changes |
| 16 | Planner Agent | Farthest for assigning work | A0, then A1 |

### Work order: finishing the job (in this order)

1. **Rerun and widen the harness.** Run the full campaign against `origin/main` on a local server; it is 35 days and 24 versions old. Add six jobs: RTP update from the prior plan, an OWP reporting period, a grant application, a measure reporting cycle, a safety action plan, and a contract month-end. The rerun also closes the four Blocker fixes still waiting on it.
2. **Fix entry points and page order.** Days, not weeks. This unlocks the OWP, the measure and engagement:
   - an OWP/UPWP program type with its own nav label;
   - preparation shown above reporting until the work program is adopted;
   - a visible way into the measure;
   - the study-area step inside the publishing checklist;
   - onboarding that starts with a project and makes the AI key optional;
   - a corrected Help list of AI-key features.
3. **Safety action plan.** Build on the existing KSI locations: high-injury network, countermeasure toolbox, ranked project list, and a plan document assembled through Reports. This unlocks the safety plan and SS4A.
4. **Grant applications.** Call the existing ATP packet code (`computeAtpPacket`) from the application workspace, seed SS4A sections from the safety plan, and put deadlines in My Work.
5. **RTP without a paid key.** Start from the prior plan with OCR text plus a spreadsheet or table import, reviewed through the existing staging screen. Then build the policy and action register (M12b).
6. **Measure recipients.** A recipient role limited to its own claims, with project, quantity, unit and period on each claim.
7. **Contract and OWP screens on the shared components.** Not a feature, but it lets someone other than the original author maintain M2d and M11.
8. **Maps without an agent.** Export the in-app project map as a figure with source lines. Keep Fable as an option.

### Separate track: defensible for public and legal review

- Observe real planners under `docs/product/PLANNER_OBSERVATION_PROTOCOL.md`. No session has been recorded yet.
- Validate the models (S1-S3). Until then, label every model number "screening" next to the number itself.
- Run WCAG 2.2 AA, print and screen-reader checks on the portal and every public page.
- Close M1 (legal applicability), M4 (confidentiality and records), M8a (environmental review), and get injury crash data outside California.
- Operate the public site properly: hosted backups, signup abuse controls, data retention, privacy terms for real agency data, email deliverability.

## 5. What the roadmap misses

**Requirements with no scheduled milestone:**
1. **Running a public service.** The site went live October 11 with public signups and a $50 a month service budget, but the contract (`:22`) and roadmap (`:115`) still say hosting is deferred. M15 sits at step 5 as "mid-term" (`ROADMAP.md:142`).
2. **A journey for every top-level surface** (contract `:193`, `:205`). No milestone adds harness jobs or schedules reruns.
3. **A path with no AI for every core job** (contract `:223`; CORE-AGENTIC-01). A0 adds AI providers but nothing requires a keyless route.
4. **The safety action plan as a named job.** The ledger maps it to M6a (`CORE_REQUIREMENTS_LEDGER.md:121`), but M6a's text never covers it.
5. **The October interface overhaul.** The October 1 review, the October 10 overhaul and PRs #186-#196 have no roadmap home, and `docs/PLAIN_WORDS_FEWER_BOXES.md` is not referenced.
6. **California-only program types in shared code** (`programs/catalog.ts:1-8`), against the contract's ban on US-specific concepts in core architecture (`:229`).
7. **Language, print and low-bandwidth support (CORE-INCLUSIVE-01).** No increment schedules it.
8. **Territories.** Waiting on your clarification (`ROADMAP.md:126`).
9. **State agencies, tribal governments and nonprofits.** All "not assessed" (matrix lines 116-120), with no milestone.

**Milestones with no planner job behind them:**
- **M3a desktop OpenPlan Control.** It serves your demo machine; demo recovery now belongs to hosted operations.
- **W1 Nat Ford website.** Nat Ford is paused and the site already forwards to OpenPlan.
- **S2a TimesFM evaluation.** License limits block deployment.
- **M2c Signal palette and square corners.** Interface polish, not planning practice.
- **M9b automated comment synthesis.** Five releases (v0.62 to v0.66) with no control a planner can use. Help says AI theme generation "is not yet available" (`help/page.tsx:168-171`).
- **CORE-LEGACY-01 DOT Dashboard parity.** A comparison, not a job.

The roadmap is 851 lines and more than half of it is dated release notes. Moving those to `docs/reviews/` would leave a readable queue.

## 6. Three screens, control by control

**A. Engagement campaign, Setup tab (usable for the job).** Files: `engagement/[campaignId]/page.tsx:671-957`, `campaign-publish-flow.tsx`.
- **Public link strip** (`:671`): correct as is.
- **Tab label** "Campaign console sections" (`:678`): developer word; change to "Campaign sections."
- **Checklist header** (`flow:254-258`): replace the sentence about links that do not resolve with "Residents can open the link once every step is done."
- **Generate link** (`:292-307`) and **Save description** (`:310-337`): work. Missing a preview of how the description reads to a resident.
- **Accept public submissions** (`:339-360`): sends the planner to "Public access below," which sits inside the operator actions at the bottom of the page. Needs an inline view-only toggle.
- **Map area check** (`public-portal.ts:241-251`): has no control. The fix is "at the bottom of this page" (`flow:147-152`). Replace the 50-word warning with an inline study-area picker that reuses the project's place.
- **Set Active** (`:362-378`): there is no "Preview as a resident" step; the preview link only appears in the URL block (`:85,177`).
- **Survey builder** (`:699`): its questions use categories that are edited three sections later.
- **Report-back builder** (`:705`): placed before any response exists; it belongs on Responses or Record.
- **RTP attachment** (`:724-787`): can only be edited at the bottom of the page.
- **Categories** (`:790-850`): "Category Registry" and "Category structure stays intentionally light..." (`:793,796`) are developer notes; delete both and title it "Comment categories."
- **The rest of the tab** (`:875-957`): 12 sections, with the two most needed (study area, public access) last. Split into "Before publishing" and "Advanced."

**B. Work program page (usable for one job).** Files: `work-program/page.tsx:40-45`, `reporting-panel.tsx:28`, `editor.tsx:105-146`.
- **Entry button** (`programs/[programId]/page.tsx:812-815`): shown on every program type, including RTIP and STIP. There is no list of work programs.
- **Page header** (`:42`): "retained sources" is internal wording. Suggested: "Prepare this year's work program from last year's adopted copy."
- **Reporting panel first** (`:43`): a new OWP opens on "Save a preparation revision below..." (`reporting-panel.tsx:28`). Preparation should come first until adoption.
- **Eight jump links**: one leaves the page for Invoices to set up staff. Recovery buttons ("Reload entries", "Retry pending save") are always shown instead of only on failure.
- **Draft notice** (`editor.tsx:106`): keep the first sentence; show revision numbers only when there is a conflict.
- **Adopt and amend controls** (`:107`): sit above the content they adopt.
- **Prior OWP sources** (`:108-121`): labels like "Retained document extraction" are unclear. Missing a one-step "Start from last year's OWP" that brings over the closed cycle's carryover.
- **Damaged-draft recovery** (`:128`): shown in the main flow; it should be an alert only.
- **Agency and cycle fields** (`:130-135`): "Currency code" for a US agency. Free-text boxes stand in for the fund-source tables a California RTPA uses (FHWA PL, FTA 5303, RPA, local match).
- **"Prepare structured funding and staffing tables"** (`:136`): optional without explanation; make structured tables the default.
- **Three diagnostic blocks** (`:140-142`): sit before the Save button; merge them into one list of what is unresolved.
- **Save** (`:144`): at the very bottom; needs a fixed save bar.
- **Revisions** (`:145`): show a SHA-256 hash to planners; move it into the download's details.

**C. Maps (demo).** Files: `maps/page.tsx:73-151`, `map-package-creator.tsx:70-233`, `map-package-view.tsx:81-145`.
- **Header and "Make maps" button** (`page:96-97`, `creator:233`): imply OpenPlan makes the maps. Suggested: "Map packages made by an AI agent on your computer, or uploaded by you," and the button "Request map package."
- **Project and purpose steps** (`:72-98`): fine. The grant program's map requirements could be filled in from the catalog.
- **"Who makes the package?"** (`:107-113`): offers only "Claude Fable 5.1 on my computer" or a ZIP upload. It assumes Claude is installed and paid for, and Fable runs need your approval. The page looks up only Claude connections (`page:76-77`). It should say plainly that Claude must be installed.
- **"Connect a computer"** (`:120-144`): does not say what the connector can read on that computer.
- **"Practice run (every map says so)"** (`:177-180`): unclear; suggest "Mark every map as a draft." The only time estimate is "several hours" (`:110`).
- **Package list** (`page:129-149`): does not show why a package failed.
- **Package view** (`view:81-145`): clear, but there is no way to place a figure into a report or grant application.

## Method and limits

- I read the contract, ledger, capability matrix, roadmap, architecture doc, README, harness guide, all 12 job files, the nav registry, `top-nav.tsx`, all 67 pages and the API route tree, plus targeted components and libraries. I did not run the app, so "what a planner can do" means what the page and its routes support, not what renders.
- The September 6 harness record is the only browser evidence I used.
- Grades are my judgment against the five-step scale.
- I did not check the live site beyond the October 11 records on `origin/main`.
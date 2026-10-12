# OpenPlan backlog by module, October 11, 2026

Companion to `PLAN.md`. Every row comes from one of the 15 review reports in
`~/.local/state/openplan-review-20261011/`; the Source column names it. Rows
were compiled by Haiku 5.5 and checked by Opus 5.5. Severity: P1 touches
money, public input, security or a scientific claim; P2 breaks or misleads a
planner; P3 is debt, polish or maintainability. File and line references are
to `origin/main` at `c735abec3` unless a PR is named. Verify each before
fixing; some come from reading code, not from running it.

## Live site operations

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| OPS-01 | No uptime check or alert on the live site. Set OPENPLAN_HEALTH_URL, restore the 15-minute health schedule, add a free external check on /api/health and OCR /healthz. | Production Health workflow | P1 | infra |
| OPS-02 | No alerting on 5xx rates, cron 401s, worker crash loops, Resend quota, Supabase restriction or Mapbox usage. Only the Railway $25 email exists. | infra section 8 | P1 | infra |
| OPS-03 | Health route is shallow and reports database "not_checked". Add a token-protected deep route: one DB read, one Storage check, heartbeat ages. | /api/health | P2 | infra |
| OPS-04 | No error tracking. Browser errors go only to console.error. Add Sentry free tier or a log drain, and report from global-error.tsx and route error files. | global-error.tsx | P2 | infra |
| OPS-05 | Cron routes return 401 without CRON_SECRET and nothing alerts (reap-model-runs, reap-gtfs-ingests, sweep-deadlines). | vercel.json cron | P2 | infra |
| OPS-06 | Code deploys automatically but migrations are applied by hand. GTFS cleanup route went live before migrations 28 to 31 on Oct 11. Add a check that fails when the repo is ahead of `supabase migration list --linked`. | HOSTED_DEMO_AI_AND_GTFS_SCHEMA_2026-10-11.md | P1 | infra |
| OPS-07 | Migration filenames run ahead of the calendar (20261017000001 exists on Oct 11), so new timestamped migrations sort before applied ones. | migrations folder | P2 | infra, docs-audit |
| OPS-08 | No automated Storage backup. Database backups kept 7 days, no PITR, and they exclude Storage bytes. Schedule bucket copy plus pg_dump to an offsite bucket. | infra section 5 | P1 | infra |
| OPS-09 | Manual database and Storage captures exist only on the owner's machine, with no schedule and no offsite copy. | infra section 5 | P2 | infra |
| OPS-10 | Hosted restore never run end to end. One partial rehearsal Oct 10. Untested: Auth and Storage replacement, real sign-in, Railway volume restore, cutover. | HOSTED_RECOVERY.md | P2 | infra |
| OPS-11 | Restore procedure works only into a disposable target and relies on private SQL and TOC files that are not in the repo. | HOSTED_RECOVERY.md | P2 | infra |
| OPS-12 | Offline restore-drill Postgres on Railway holds a restored production copy, including password hashes. Delete it or set an expiry. | Railway restore-drill | P1 | infra |
| OPS-13 | Retired activitysim Railway service shows Failed and still keeps a billed volume. | Railway | P3 | infra |
| OPS-14 | No written rollback procedure. The "prior May deployment" named in HOSTED_LIVE cannot run against 405 migrations. Write a one-page rollback and keep migrations additive. | HOSTED_LIVE | P1 | infra |
| OPS-15 | One operator on personal accounts (Vercel, Supabase, Railway). Add a second owner or recovery contact and an ops document listing accounts and where secrets live (names only). | infra section 9 | P2 | infra |
| OPS-16 | Public signup has no per-account resource limits. Both cost caps default to unlimited, and caps count per workspace, so each signup gets a fresh allowance. Set OPENPLAN_MONTHLY_RUN_CAP and OPENPLAN_MODELING_QUEUE_DEPTH now, then add deployment-wide concurrency and per-workspace quotas. | run-cap.ts:80-86; run-dispatch.ts:67 | P1 | infra, code-backend, code-workers |
| OPS-17 | Railway $40 hard stop halts email, exports and OCR along with models. Move the model host to its own Railway project or add a deployment-wide run cap. | infra sections 6 and 10 | P1 | infra |
| OPS-18 | AI spend scales with workspace count. The AI limit is 20 calls per 5 minutes per workspace, fails open on lookup error, and counts events after the model call, so parallel requests all pass. Limit per user and per installation, reserve before the call, fail closed when a deployment key is used. | lib/runtime/ai-rate-limit.ts:24-25, 83-99 | P1 | code-backend |
| OPS-19 | No per-workspace or per-user storage quota. Limits are per file only (100 MB documents, 1 GiB map packages, 200 MB GTFS, 64 MB aerial images, 256 MB aerial artifacts). Add a workspace_storage_usage ledger checked before upload URLs are issued. | lib/http/body-limit.ts:33,62,71 | P1 | code-backend, infra |
| OPS-20 | Resend free plan allows 100 emails a day. If Vercel's RESEND_API_KEY is the same account as Supabase SMTP, a subscribe flood blocks signup confirmations and resets. Verify the key, cap daily sends, use a separate sender. | subscribe/route.ts:56-92; public-submit.ts:9 | P1 | code-backend, infra |
| OPS-21 | Confirmation mail lands in Gmail spam. Set up Postmaster Tools, send from a subdomain with aligned DMARC and tracking off, and plan for Resend Pro if signups grow. | Resend and DMARC setup | P2 | infra, prs-171-200 |
| OPS-22 | Mapbox has no usage cap and the token ships in the bundle (two names read directly in 19 files). URL-restrict the token, add a usage alert, and default public maps to the keyless MapLibre style. | infra section 7; code-backend section 2 | P1 | infra, code-backend, prs-171-200 |
| OPS-23 | Vercel Spend Management, firewall rules and log retention were not visible to the reviewer. Confirm the caps and the pause setting in the dashboard. | Vercel dashboard | P2 | infra |
| OPS-24 | Supabase spend cap restricts service on overage instead of billing. A filled quota would restrict every tenant. | Supabase settings | P2 | code-backend, infra |
| OPS-25 | Hosted deploys from main with "wait for CI". Dashboard instant rollback and promotion bypass the gate, and that escape hatch is undocumented. | Vercel and Railway settings | P2 | infra |
| OPS-26 | Railway application-workers rebuilt on each of the last eight main commits, interrupting in-flight exports and emails. Add railway.json per service with narrow watch paths. | infra section 6 | P2 | infra |
| OPS-27 | Railway service settings exist only in the dashboard. Base images use tags, not digests. aequilibrae>=1.6.0 and ocrmypdf>=16.0 are open ranges. Pin both. | aequilibrae_worker/requirements.txt; Dockerfiles | P2 | infra, code-workers |
| OPS-28 | Node queues (email, translation, synthesis, GTFS) write no heartbeat, so a stopped queue looks like a slow one. | workers/hosted-node | P2 | infra, code-workers |
| OPS-29 | Supervisors exit non-zero when any child exits. Logs go to stdout with no drain and no crash alert. | supervise.py; supervise.mjs | P2 | infra, code-workers |
| OPS-30 | Build sits at the 8 GB builder limit. One Vercel build hit the 45-minute limit and one was SIGKILLed. Skip the duplicate type check on Vercel (CI already checks) and record a cold-build time. | Vercel build | P2 | infra |
| OPS-31 | Build runs with --webpack and a 6 GB heap. The flag has no recorded reason (commit d7dbb9090). Record a reason or remove it. | next build script | P3 | infra |
| OPS-32 | Failed Vercel builds after the hosted merges (one time limit, one out of memory). #206's body says a forced cold build passed in 63 seconds; the tracked doc says the setting does not prove lower memory. Correct the body or the doc. | #206 | P2 | prs-171-200, prs-201-218 |
| OPS-33 | Corridor analysis took 67.5 s and the browser lost the response. The 300 s project default exists only in the dashboard. | infra section 3 | P2 | infra |
| OPS-34 | Public site has no written rollback, restore, key-rotation or monitoring procedure. PR #217 adds none of them. | infra section 9 | P2 | infra, prs-201-218 |
| OPS-35 | Self-host: subscribe links, invitation links and a server-side self-fetch take their origin from the request Host. Use NEXT_PUBLIC_SITE_URL. | subscribe/route.ts:84; workspaces/invitations/route.ts:226; models/[modelId]/runs/route.ts:1373-1377 | P2 | code-backend |
| OPS-36 | Self-host PostgREST pre-request hook (#191) is not a migration, so self-hosters never get it. Move it into a migration. | PR #191 | P2 | prs-171-200 |
| OPS-37 | No robots.txt or sitemap (both return 404). | public site root | P3 | infra |
| OPS-38 | Vercel production env vars and cost caps could not be read. Confirm whether OPENPLAN_MONTHLY_RUN_CAP and OPENPLAN_MODELING_QUEUE_DEPTH are set. | Vercel env | P1 | infra |

## Security and data access

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| SEC-01 | Any signed-in account, including a viewer, writes the shared census_tracts table through the service role, with no role check or rate limit. Require a writer role or make it operator-only like equity ingest. | geographies/census-tracts/ingest/route.ts:52-76 | P1 | code-backend |
| SEC-02 | Role oracle: contract_snapshot_can_read and contract_calculation_job_visible are granted to authenticated and accept a caller-chosen actor id. A user can learn another user's contract role. Use auth.uid() and revoke the two-argument form. | migrations 20260915000002:3-7; 20260916000001:13-17 | P1 | code-backend |
| SEC-03 | GET connectors route has no getUser, relies on RLS alone, and returns raw error.message. Add 401 and a generic error. | network-packages/[packageId]/versions/[versionId]/connectors/route.ts:8-31 | P2 | code-backend |
| SEC-04 | Raw database error.message returned by 16 routes; worst is models/.../kpis/route.ts (3 cases). | code-backend section 3 | P2 | code-backend |
| SEC-05 | Public signup has no CAPTCHA and no per-account quota. Email confirmation, 8-character minimum and breached-password check exist. | Supabase Auth | P1 | infra, prs-171-200 |
| SEC-06 | OPENPLAN_INTEGRATION_KEY_SECRET has no rotation or second-key support. Rotating it invalidates every stored workspace key. Accept a previous key. | key-crypto.ts:15 | P1 | code-backend, infra |
| SEC-07 | Service role key lives in Vercel and all three Railway services, with no rotation procedure. | infra section 9 | P2 | infra |
| SEC-08 | AI key fallback: lookup falls back to the deployment ANTHROPIC_API_KEY, and provider turns accept authMode "deployment_api_key". If a shared key is ever set, every signup can spend it. | anthropic-access.ts:27; workspace-keys.ts:158; providers/turns/route.ts:21 | P1 | code-backend |
| SEC-09 | CSP script-src allows 'unsafe-inline' and 'unsafe-eval'; connect-src allows any *.supabase.co project; X-Powered-By: Next.js is still sent. | next.config.ts | P2 | infra |
| SEC-10 | Private vulnerability reporting and Dependabot security updates are both disabled. | GitHub settings | P2 | infra |
| SEC-11 | Proxy accepts a client-supplied x-request-id unchanged. | src/proxy.ts:15-19 | P3 | code-backend |
| SEC-12 | Anonymous csp-report writes to the log with no throttle. | csp-report/route.ts | P3 | code-backend |
| SEC-13 | Three permissive USING (true) policies on reference tables (census_tracts, lodes_od, equity_tract_designations). Confirm they are intended. | migrations 20260420000062, 20260724000001 | P3 | code-backend |
| SEC-14 | Engage IP fingerprint is spoofable if self-hosted behind a pass-through proxy. Vercel overwrites x-forwarded-for. | lib/engagement/public-submit.ts:58-66 | P3 | code-backend |
| SEC-15 | Exposed Resend key: the cutover record says the original was revoked but not where it was exposed. Record the location. | cutover record | P2 | prs-171-200 |
| SEC-16 | No cross-tenant read or write found in 40 sampled routes. Keep the live isolation tests as the regression check. | code-backend section 2 | P3 | code-backend |

## Dashboard and My Work

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| DSH-01 | Dashboard reads RTP and campaign dates only from yesterday onward. An RTP adoption or comment date missed two days ago drops off the dashboard. | lib/dashboard/workspace-dates.ts:45; dashboard/page.tsx:126 | P1 | prs-171-200 |
| DSH-02 | My Work declares contract tasks and work-program reviews undated even when they have a due date, so a future contract deadline can show as overdue. | lib/my-work/query.ts:292 | P1 | prs-171-200 |
| DSH-03 | Closed award still counted as overdue in the digest and reminder sweep. Codex P1 on #144 was not fixed. Use the review rule for review candidates. | lib/work/work.ts:582-597 | P1 | prs-136-170 |
| DSH-04 | My Work misses RTP comment periods, measure claim deadlines and grant section deadlines. | My Work sources | P2 | module-map |
| DSH-05 | Contract reminders show "awaiting installation". | projects/[projectId]/management/page.tsx:22 | P2 | module-map |
| DSH-06 | Dashboard checklist counts an Anthropic key, a geography and a corridor run, but not a project. The first highlighted step is the Anthropic key. | first-run-checklist.tsx:297, 319, 364 | P2 | module-map |
| DSH-07 | Award-and-milestone conflict text ("Review the obligation dates") is long on narrow cards. | My Work cards | P3 | prs-136-170 |
| DSH-08 | Date-only fix covers only fmtDateTime. Other date formatters are unaudited. | fmtDateTime | P3 | prs-136-170 |
| DSH-09 | Dashboard component coming-up-rail.tsx (199 lines) has no test; only its logic is tested. | components/dashboard/coming-up-rail.tsx | P3 | tests |
| DSH-10 | Dashboard lacks saved views, failed-job list and awaited-approvals panel (M2c). | Dashboard | P3 | module-map |

## Projects

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| PRJ-01 | Project page makes about 45 sequential awaited reads and loads every tab's data. Run independent reads in Promise.all and load only the open tab. | projects/[projectId]/page.tsx:139-1032 | P2 | code-frontend |
| PRJ-02 | Project page has no loading.tsx. | projects/[projectId] | P2 | code-frontend |
| PRJ-03 | Project spine boards: project-spine-board.tsx replaces two older boards that only tests import. Delete the old ones. | project spine components | P3 | code-frontend |
| PRJ-04 | project-spine-board.tsx uses grid-cols-5 with no breakpoint, which breaks at 390 px. | project-spine-board.tsx:74,218 | P2 | code-frontend |
| PRJ-05 | "Open control lane" and "the creation lane" are operator wording on project pages. | project-delivery-board.tsx:189,277,332,414,603 | P2 | code-frontend |
| PRJ-06 | Migration notices shown to planners. | project-budget-panel.tsx:66-76; project-delivery-board.tsx:596-598; project-funding-panel.tsx:260,564 | P2 | code-frontend |
| PRJ-07 | Raw database value rendered as text: engagement_kind.replaceAll("_", " "). | project-contracts.tsx:6 | P3 | code-frontend |
| PRJ-08 | Weekly management page is one unstyled function, reachable only from one panel link. Rebuild on shared components. | projects/[projectId]/management/page.tsx:12-28; project-contracts.tsx:6 | P2 | module-map |
| PRJ-09 | Work-plan templates are only deliverable and milestone lists. No single owner for facts shared by Plans, Land Use Plans and RTP. | work-plan templates | P3 | module-map |
| PRJ-10 | Portfolio workbook import adds new projects only. | portfolio import | P3 | module-map |
| PRJ-11 | Measure claims cannot be tied to the projects they fund. Measures, OWP, GTFS, network packages, Title VI and VMT have no project foreign key. | code-backend section 6 | P2 | code-backend |
| PRJ-12 | Project spine is partial. Plans, land_use_plans and rtp_cycles are three separate plan concepts. | code-backend section 6 | P3 | code-backend |

## Engagement (staff, portal, embed)

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| ENG-01 | Anonymous Storage exhaustion. Photo throttle is an in-memory Map per instance (15 per 10 minutes). Bytes are stored before any comment exists, and no cron sweeps orphans. Move the throttle to a database count, store under a pending prefix with a sweep, and add a per-campaign byte budget. | lib/engagement/photo.ts:116-140; photo-upload/route.ts:147-151; vercel.json:18-30 | P1 | code-backend, infra |
| ENG-02 | Vote inflation. A browser-minted device token creates a fresh voter, so one script can add 120 support votes to one comment every 10 minutes. Limit by a stronger identity. | vote/route.ts:189-216 | P1 | code-backend, prs-171-200 |
| ENG-03 | Anonymous subscribe sends email to any address (12 per 10 minutes per IP per campaign). Add daily caps per campaign and per address, and a separate sender. | subscribe/route.ts:56-92; public-submit.ts:9 | P1 | code-backend |
| ENG-04 | Board packet generation reads engagement items in one request. Any campaign over 1,000 comments is silently understated. Use readEveryPage with its complete flag. | reports/[reportId]/generate/route.ts:965-970, 1734-1737, 1796 | P1 | code-backend |
| ENG-05 | Campaign list item counts have the same 1,000-row cap. | engagement/campaigns/route.ts:94-99 | P1 | code-backend |
| ENG-06 | Device hash is the same across campaigns, so staff can link one browser's comments across consultations. | #194 device hash | P2 | prs-171-200 |
| ENG-07 | Codex P1 on topic provenance in #185 was not verified as fixed. | #185 | P2 | prs-171-200 |
| ENG-08 | CHANGELOG lines for #185 are stale: "Not done: a map that works without a Mapbox key" and "rules unchanged". | CHANGELOG | P3 | prs-171-200 |
| ENG-09 | Public map does not catch a MapLibre construction failure (no WebGL2). The resident gets a broken map instead of the notice. | public-map-stage.tsx:806-818 | P2 | prs-171-200 |
| ENG-10 | Place search and background picker disappear on the key-free map path. | public map | P3 | prs-171-200 |
| ENG-11 | Machine translation: translations keep the old meaning silently when English changes. Catalogs match by key only. Add a source-hash check. | 19 translation catalogs (#195) | P2 | prs-171-200 |
| ENG-12 | Script subtags are dropped. zh-Hant and zh-TW get the Simplified catalog, and pa-Arab gets Gurmukhi. | normalizePortalLocaleTag, locales.ts:196 | P2 | prs-171-200 |
| ENG-13 | CHANGELOG overstates translation coverage, names the wrong setting (PORTAL_MACHINE_TRANSLATED_LOCALES, not CATALOGS_WITHOUT_MACHINE_NOTICE), and omits English-only demographic options and survey widgets. | CHANGELOG | P2 | prs-171-200 |
| ENG-14 | Translation provenance is "four agents" and no browser capture. Fluency unjudged. | catalogs | P3 | prs-171-200 |
| ENG-15 | Engagement campaign page is 18,264 words across 90 component files, twice the size of any other page. Apply the word rules and move survey, translation and context setup into guided flows. | engagement/[campaignId]/page.tsx | P2 | code-frontend, module-map |
| ENG-16 | Setup tab has 12 sections, and study area and public access sit last. Split into "Before publishing" and "Advanced", and move study area into the checklist. | engagement/[campaignId]/page.tsx:671-957 | P2 | module-map |
| ENG-17 | Tab label "Campaign console sections" is developer wording. Use "Campaign sections". | page.tsx:678 | P3 | module-map |
| ENG-18 | "Category Registry" and "Category structure stays intentionally light" are developer notes. Delete them and title the section "Comment categories". | page.tsx:793, 796 | P3 | module-map |
| ENG-19 | Checklist header about links that do not resolve. Replace with "Residents can open the link once every step is done." | flow:254-258 | P3 | module-map |
| ENG-20 | "Accept public submissions" points the planner to operator actions at the bottom. Add an inline view-only toggle. | page.tsx:339-360 | P3 | module-map |
| ENG-21 | Map area check has no control. Its warning is 50 words. Replace it with an inline study-area picker that reuses the project place. | public-portal.ts:241-251; flow:147-152 | P2 | module-map |
| ENG-22 | No "Preview as a resident" step; the preview link appears only in the URL block. | page.tsx:362-378, 85, 177 | P3 | module-map |
| ENG-23 | Survey builder uses categories that are edited three sections later. | page.tsx:699 | P3 | module-map |
| ENG-24 | Report-back builder sits before any response exists. Move it to Responses or Record. | page.tsx:705 | P3 | module-map |
| ENG-25 | RTP attachment can be edited only at the bottom of the page. | page.tsx:724-787 | P3 | module-map |
| ENG-26 | Synthesis panels use builder vocabulary. | synthesis-queue-panel.tsx:48,75,78; synthesis-progress-panel.tsx:13; synthesis-request-history-panel.tsx:85 | P2 | code-frontend |
| ENG-27 | Synthesis queue panel has six explanatory sentences for a two-button flow, including "Queue custody does not prove that a call ran". | synthesis-queue-panel.tsx:75 | P2 | prs-136-170, prs-171-200 |
| ENG-28 | "Maximum task bytes" field has a four-sentence explanation and a hardcoded default of 65536 in two places. Planners cannot reason about bytes. | synthesis-generation-create-panel.tsx | P2 | prs-136-170 |
| ENG-29 | Recovery copy tells staff to raise the limit even when required bytes exceed the 1,048,576 schema cap. Add an "exceeds system maximum" branch. | synthesis-progress-panel.tsx | P2 | prs-136-170 |
| ENG-30 | Synthesis execution limits reset when the panel remounts (Codex P1 on #132). | synthesis-execution-panel.tsx:39, 82-85 | P2 | prs-100-135 |
| ENG-31 | Five-step synthesis pipeline has no demonstrated useful output. Hold further synthesis work until one non-empty run produces a summary a planner would use. | #116, #117, #119, #121, #122, #132 | P2 | prs-100-135 |
| ENG-32 | "Approval does not establish public release" lengthens an already five-sentence intro. Cut it. | engagement-review-files.tsx | P3 | prs-136-170 |
| ENG-33 | Public portal Codex P1 on stale and copy issues is not separately tracked. Confirm. | portal | P3 | prs-171-200 |
| ENG-34 | Engagement map has no observed planner use. CORE-ENG-01 to 04 have no session records. | docs/product/PLANNER_OBSERVATION_PROTOCOL.md | P2 | module-map |

## Work program (OWP/UPWP)

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| OWP-01 | start_amendment can overwrite an in-progress amendment. Never redefined. | 20260909000001_work_program_review.sql:127 | P1 | prs-100-135, code-backend |
| OWP-02 | Overlap check ignores unmapped time entries, so labor hours can be counted twice. | 20260910000001_work_program_actuals.sql:147 | P1 | prs-100-135, code-backend |
| OWP-03 | Issuing a report does not recheck adoption. | 20261003000001_work_program_reimbursement.sql:198-202 | P1 | prs-100-135, code-backend |
| OWP-04 | Five OWP and contract money defects confirmed as cited. Fix each with a small SQL change and a regression test. | 20260909000001:127; 20260910000001:147; 20261003000001:198-202; 20260912000004:164; 20260912000003:64 | P1 | code-backend |
| OWP-05 | Viewers see a time-entry form that always fails. | reporting-panel.tsx:28 | P2 | prs-100-135, code-frontend |
| OWP-06 | "Work program" button appears on every program, including RTIP and STIP. There is no list of work programs. Add an OWP/UPWP program type with its own nav label. | programs/[programId]/page.tsx:812-815 | P2 | code-frontend, module-map |
| OWP-07 | Reporting panel comes before preparation. Show preparation first until adoption. | work-program/page.tsx:42-44 | P2 | module-map |
| OWP-08 | Header uses "retained sources". Suggested: "Prepare this year's work program from last year's adopted copy." | work-program/page.tsx:42 | P3 | module-map |
| OWP-09 | Eight jump links; one leaves the page for Invoices to set up staff. | work-program page | P3 | module-map |
| OWP-10 | "Reload entries" and "Retry pending save" always show. Show them only on failure. | editor.tsx:105-146 | P3 | module-map |
| OWP-11 | Draft notice: keep the first sentence. Show revision numbers only on conflict. | editor.tsx:106 | P3 | module-map |
| OWP-12 | Adopt and amend controls sit above the content they adopt. Move them beside it. | editor.tsx:107 | P3 | module-map |
| OWP-13 | "Retained document extraction" is unclear. Add "Start from last year's OWP" to carry over the closed cycle's carryover. | editor.tsx:108-121 | P2 | module-map |
| OWP-14 | Damaged-draft recovery shows in the main flow. Make it an alert only. | editor.tsx:128 | P3 | module-map |
| OWP-15 | "Currency code" for a US agency. Free-text boxes stand in for fund-source tables (FHWA PL, FTA 5303, RPA, local match). | editor.tsx:130-135 | P2 | module-map |
| OWP-16 | "Prepare structured funding and staffing tables" is optional without explanation. Make structured tables the default. | editor.tsx:136 | P3 | module-map |
| OWP-17 | Three diagnostic blocks sit before Save. Merge them into one list of what is unresolved. | editor.tsx:140-142 | P3 | module-map |
| OWP-18 | Save button is at the bottom. Add a fixed save bar. | editor.tsx:144 | P3 | module-map |
| OWP-19 | Revisions show a SHA-256 hash to planners. Move it into the download's details. | editor.tsx:145 | P3 | module-map |
| OWP-20 | Work-program page is about 163 KB across 15 components and has no Caltrans form output. | work-program | P2 | module-map |
| OWP-21 | Five work-program routes are named by no test. | code-backend section 8 | P2 | code-backend |
| OWP-22 | Work program is tested only on a synthetic case. | tests | P3 | module-map |

## Contracts and invoices

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| CON-01 | Invoice status rules exist only in the route. The client_invoices update policy checks membership only, and non-contract invoices have no guard trigger. A member can edit a paid invoice through PostgREST with the shipped anon key. Add BEFORE UPDATE triggers for terminal states. | 20260727000010:274-284; client-invoices/[invoiceId]/route.ts:267, 566-582 | P1 | code-backend |
| CON-02 | Invoice line replacement is a hand-written non-atomic sequence (delete, insert, stamp, restore on failure). A timeout between delete and insert loses the lines. Use one plpgsql RPC. | client-invoices/[invoiceId]/route.ts:459-540 | P1 | code-backend |
| CON-03 | Voided draft invoice strands its sources permanently. | 20260912000004_contract_accounting_reconciliation.sql:164 | P1 | prs-100-135 |
| CON-04 | Finance can approve an invoice that skipped PM review. | 20260912000003_received_consultant_invoices.sql:64 | P1 | prs-100-135 |
| CON-05 | Members and consultants cannot submit deliverables in the UI. | contract-management.tsx:49 | P2 | prs-100-135 |
| CON-06 | Invoice "today" is a UTC calendar day, which turns over at 5 p.m. Pacific. | client-invoices/[invoiceId]/route.ts:564 | P2 | code-backend |
| CON-07 | Contract and invoice code is about 127 KB packed onto single lines across 19 files. Rebuild on shared components. | contract components | P2 | module-map |
| CON-08 | client-invoice-composer.tsx (779 lines) is an inline create form. Move it to GuidedFlow. | client-invoice-composer.tsx | P2 | code-frontend |
| CON-09 | Six invoicing-management routes are named by no test. | code-backend section 8 | P2 | code-backend |
| CON-10 | Five separate money families: billing_invoice_records, client_invoices, contract_received_invoices, work_program_reimbursement_claims, measure_claims. | schema | P3 | code-backend |
| CON-11 | /invoicing/engagements/<id> is linked only from one-line contract components. | contract-management.tsx:41 | P3 | code-frontend |
| CON-12 | Caltrans LAPM backfill is marked interim_unconfigured_default. Confirm before use. | 20260727000009:76-81 | P3 | code-backend |
| CON-13 | Exact Caltrans local-assistance forms are deferred. | invoicing | P2 | module-map |
| CON-14 | Contract management lines run past 200 characters; settlement-closeout.tsx has a 3,685-character line. Reformat. | settlement-closeout.tsx; contract-management.tsx | P3 | prs-100-135 |

## Local measure

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| MEA-01 | Cities cannot sign in. Add a recipient role limited to its own claims, with project, quantity, unit and period on each claim. | measures/write-authorization.ts:20-31 | P2 | module-map |
| MEA-02 | Measure recipient-organization isolation is missing (CORE-FUNDADMIN-01). | measure data model | P1 | docs-audit |
| MEA-03 | Claim submitted_on is a UTC date. It rolls over at 5 p.m. Pacific. | measures/[measureId]/claims/route.ts:94; claims/[claimId]/route.ts:228 | P1 | code-backend |
| MEA-04 | Allocation stated_on is a UTC date. | periods/[periodId]/allocate/route.ts:255, 398 | P1 | code-backend |
| MEA-05 | Six money routes have no test: recipients, periods, allocation-rules, basis-values, claims/[claimId]/documents, POST /measures. | code-backend section 8 | P2 | code-backend, tests |
| MEA-06 | Claims carry dollars but no project quantities. | measure claims | P2 | module-map |
| MEA-07 | Measure entry is reachable mainly through command-palette search. Add a visible entry. | nav-registry.ts:135-146; programs/[programId]/measure chip | P2 | module-map, code-frontend |
| MEA-08 | Measure public page has no print or screen-reader proof. | /measure/[token] | P3 | module-map |
| MEA-09 | Measure flow has one link from the program page, so only one inbound path. | programs/[programId]/page.tsx:819 | P3 | code-frontend |

## Grants and BCA

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| GRT-01 | BCA geography is free text, not the project's place of record. A second unbound geography exists. | lib/bca/workbench/schema.ts:96 | P1 | prs-100-135 |
| GRT-02 | US federal grant bundle carries Caltrans-specific guidance (Caltrans named 41 times, including the HSIP Caltrans LRSM tool). A planner in Ohio is told to check with Caltrans. Move state text to state adapters. | lib/grants/programs/us-federal.ts:15-90, 360, 430 | P1 | code-backend |
| GRT-03 | Missing ATP scores (safety, equity, climate, total) become 0. | lib/planner-pack/atp.ts:150-154 | P1 | code-backend |
| GRT-04 | Missing funding need, gap or reimbursement becomes 0, so a missing gap reads as fully funded. | lib/reports/catalog.ts:1011-1022 | P1 | code-backend |
| GRT-05 | Grant drafts call a closed call open. Date slicing of TIMESTAMPTZ values means a call closing 09:00 UTC reads as "today" until midnight. Add one date helper: end of day for date-only values, instant comparison for timestamps. | lib/grants/narrative-evidence.ts (opportunityDateClaims); narrative-draft and sections/[sectionId]/draft routes | P1 | prs-201-218 |
| GRT-06 | BCA USDOT horizon warning fires on custom capital-only profiles. | engine.ts:99-107; profiles.ts | P2 | prs-100-135 |
| GRT-07 | ATP scoring packet (computeAtpPacket) exists in code but no screen calls it. | lib/planner-pack/atp.ts:102; render.ts:289 | P2 | module-map |
| GRT-08 | No deadline alerts. Put grant deadlines in My Work. | grants | P2 | module-map |
| GRT-09 | Grants Opportunities tab prints about 3,500 words. | grants page | P3 | prs-171-200 |
| GRT-10 | SS4A requires an adopted safety action plan, which OpenPlan cannot produce. | Grants and Safety | P2 | module-map |
| GRT-11 | Grants tab test checks only the links, not which tab opens. | grants-links-open-the-right-tab | P3 | tests |

## RTP

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| RTP-01 | Reading a prior plan needs an Anthropic key. Help says everything else works without a key, which is false here and for Maps. Add a keyless path: OCR text plus spreadsheet import, reviewed through the existing staging screen. | extraction-runs/route.ts:370-376; help/page.tsx:173-178 | P1 | module-map |
| RTP-02 | No register of policies and actions, and adoption is only a status flag. Build M12b. | RTP model | P2 | module-map |
| RTP-03 | RTP index sidebar shows "Primary queue lane" and "Dominant share". Cut it to one line and rename links to what they open. Two queue consoles sit at rtp/page.tsx:962-1000. | rtp-registry-advisory-panel.tsx:131-234; rtp/page.tsx:963 | P2 | code-frontend, module-map |
| RTP-04 | "Reset and regenerate packets" is jargon. | rtp/page.tsx:771-776 | P2 | module-map |
| RTP-05 | Report detail prints ?? 0 next to an honest "Not captured" line. Pass null and render through FigureRow. Add a guard against ?? 0 in JSX. | rtp-report-detail.tsx:610-632, 685-701 (honest at 705) | P2 | code-frontend |
| RTP-06 | Report detail nests four frames. Flatten it. | rtp-report-detail.tsx:600-632 | P3 | code-frontend |
| RTP-07 | RTP cannot start from the prior adopted plan. Starting from scratch is the only path. | RTP | P2 | module-map |
| RTP-08 | RTP has no first-week journey. | harness | P2 | module-map |
| RTP-09 | rtp/_packet-state.ts (452 lines) has no direct test. | tests | P3 | tests |
| RTP-10 | Jurisdiction registry expired 2026-09-28. RTP priority basis depends on it. | jurisdiction registry | P2 | docs-audit |

## Land use plans

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| LUP-01 | Geography PATCH is allowed after context is saved. | land-use-plans/[planId]/route.ts:157-158 | P1 | prs-100-135 |
| LUP-02 | Publication races the report pointer, and report publication is last-write-wins. | decisions/route.ts:223 | P2 | prs-100-135 |
| LUP-03 | Public designation map accepts an invalid bbox. | public-designation-map.tsx:45-47 | P2 | prs-100-135 |
| LUP-04 | Land use creation is limited to TIGERweb and the US. Breaks the any-place rule. | create-command.ts:39-42; plan-context-recovery.ts:130; migration 20261016000007:95 | P2 | prs-100-135 |
| LUP-05 | Six land-use plan writes are named by no test. | code-backend section 8 | P2 | code-backend |
| LUP-06 | Plan-kind rules are unfinished. No housing element or development-review case. | M1, M7 | P2 | module-map |
| LUP-07 | M1 "done" cases are untested: California plan in an Oregon workspace, missing home jurisdiction, multistate MPO, tribal authority. | M1 | P2 | prs-100-135 |
| LUP-08 | Land-use report maps and downloads bind to frozen editions. The #131 transaction has no caller. | #131 | P3 | prs-100-135 |
| LUP-09 | Land use workbench has a 4,954-character line, and 28 lines over 300 characters. | land-use-plan-workbench.tsx | P3 | code-frontend, prs-100-135 |
| LUP-10 | Land use creator and survey builder are inline forms. Move them to GuidedFlow. | land-use-plan-creator.tsx; survey-builder.tsx | P2 | code-frontend |
| LUP-11 | Plans (generic) module overlaps RTP and Safety and has no writing tools. Decide its meaning. | /plans | P3 | module-map |
| LUP-12 | Eleven land-use PRs landed on one day, most without review. | #123-#133 | P3 | prs-100-135 |

## Safety

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| SAF-01 | No high-injury network, systemic risk screen, countermeasure list, ranked project list or plan document. | Safety module | P2 | module-map |
| SAF-02 | Fatal-only crash data (FARS) outside California. No injury crash data outside CA. | registry.ts:36 | P2 | module-map, docs-audit |
| SAF-03 | Safety analysis stops after the report step. No treatment, cost or benefit step. | Safety | P2 | module-map |
| SAF-04 | Safety map is Mapbox-only. | safety-crash-map.tsx:223 | P2 | code-frontend |
| SAF-05 | Migration notice shown on the safety page. | safety/page.tsx:184 | P3 | code-frontend |
| SAF-06 | Safety map uses a crash data source from California only (CCRS). Labeled. Keep the label. | lib/safety/sources/ccrs.ts | P3 | code-backend |

## Corridor Analysis and Explore

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| COR-01 | Roadmap card on every result ("Next layer buildout ... CARTO workflow lane"). Delete the card. | explore-geospatial-briefing.tsx:83, 95, 113-118; explore-results-board.tsx:684 | P2 | code-frontend, module-map |
| COR-02 | Result card is dark-on-dark in light mode. Near-black gradient behind text-foreground, and no CSS overrides it. Confirm in a browser. | explore-current-result-card.tsx | P1 | prs-171-200 |
| COR-03 | Map overlay colors (#d8efe8 outline, #bfe3ff top of score ramp) were chosen for a dark basemap. | Explore map | P2 | prs-171-200 |
| COR-04 | Pale sky text on the light rail. | explore-hover-inspector.tsx:147, 157 | P2 | prs-171-200 |
| COR-05 | "Operator-facing summary of the current run" on the result card. | explore-current-result-card.tsx:88-89 | P2 | prs-171-200 |
| COR-06 | Corridor Analysis gives a score, not a traffic number. Label it as a score. | Explore | P2 | module-map |
| COR-07 | Corridor Analysis map is Mapbox-only. | use-explore-map-instance.ts:65 | P2 | code-frontend |
| COR-08 | Explore results have box-in-box nesting. | explore-geospatial-briefing.tsx:82-121 | P3 | code-frontend |
| COR-09 | Explore map-first archetype is violated by the roadmap card and nesting. | Explore | P3 | code-frontend |
| COR-10 | KI-2026-10-11-001 still says it closes when #193 merges (already merged). | KNOWN_ISSUES.md | P3 | prs-171-200 |

## Travel modeling, county runs and science

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| MOD-01 | County runs graded against the retired 30% gate. The evidence label ignores the rules-v4 outcome the Python computes. A failing run shows "Screening-grade" and a passing one shows "validated-screening". Derive the tier from rules-v4 and make failures prototype_only. | evidence-backbone.ts:388-390, 304, 580-590; county-onramp-persistence.ts:63-77; validate_screening_observed_counts.py:661-691, 1335-1342 | P1 | code-workers |
| MOD-02 | County model stack pins AequilibraE 1.7 with pandas 3, the pair the hosted image refuses. Use one constraints file and run the compatibility check in the county image. | scripts/modeling/requirements.txt:27-28, 36-47; aequilibrae_worker/requirements.txt:1-8 | P1 | code-workers |
| MOD-03 | Interrupted model stage stays "running" forever on hosted (deploy, OOM kill, lost acknowledgement). WorkerStateWriteUnconfirmed is caught by the generic except. Recovery is abandon-only. Add a renewable lease tied to the heartbeat, reconcile at stage boundaries, drain on SIGTERM. | main.py:7850-7866, 642; supabase_poll.py:1041-1096, 1094; hosted-models/supervise.py | P1 | code-workers |
| MOD-04 | Worker claim is a one-time queued-to-running PATCH with no ownership renewal. | main.py:642-651; run-reaper.ts:1-8 | P2 | code-workers |
| MOD-05 | Transit KPIs publish a numeric 0 when the feed failed. Publish null with a status, or omit the row. | main.py:6772-6774, 2625-2648 | P1 | code-workers |
| MOD-06 | County on-ramp: a failed completed-callback is relabeled as a failed model run. Jobs are in memory. Retry or journal callbacks. | county_onramp_worker/main.py:466-503, 44-45 | P1 | code-workers |
| MOD-07 | Comparison build case is a percentage the planner types. Derive it from a real network change. | api/models/project-comparison/route.ts:35-40 | P1 | module-map |
| MOD-08 | Validation not done (S1 to S3). Label every model number "screening" next to the number. | model outputs | P1 | module-map |
| MOD-09 | No-build output says "synthetic expanded daily traffic", which is not AADT and has no validated accuracy. | model output | P1 | module-map |
| MOD-10 | Model validation county-runs label claims more than the results support. | /county-runs | P1 | module-map |
| MOD-11 | ActivitySim coefficients are the Bay Area set everywhere. | ActivitySim config | P1 | code-workers |
| MOD-12 | Nationwide counts fall back to HPMS. Only CA, WA, CO and OR have their own feeds. | auto_counts.py:100-105; count_sources.py:78-141 | P2 | code-workers |
| MOD-13 | Territories beyond Puerto Rico get "No U.S. state or territory is recorded for FIPS 66", which reads like a data fault. Use an explicit "no federal source" message. Buffer in meters, not a fixed 0.03 degrees. | lodes.py:35-45; main.py:162 | P3 | code-workers |
| MOD-14 | ActivitySim transit skims are all zero, and congestion by time of day is not represented. Label this in outputs. | ACTIVITYSIM_RUNTIME_GAP.md | P2 | code-workers |
| MOD-15 | ActivitySim claim tier is hard-coded "prototype", which is not in the app's claim enum. | supabase_poll.py:787 | P2 | code-workers |
| MOD-16 | Worker writes acceptance_rule "unknown", so every rules-v4 assessment is inconclusive. Every run stays prototype_only. | main.py:5329; model_validation_core.py:383-386 | P2 | code-workers |
| MOD-17 | Rules-v4 checks only that the preregistration digest looks like a hash. Verify it against the file before any frozen rule ships. | model_validation_core.py:102-103, 384 | P2 | code-workers |
| MOD-18 | Opt-in calibration fits scalars clipped to 0.1 to 10. The docstring says "not reachable" and the block self-labels calibrated_to_counts. Correct the docstring and drop the tier label. | calibrate_to_counts.py:33-41, 172, 317, 388; screening_runtime.py:1435 | P2 | code-workers |
| MOD-19 | Worker lane records no OSM retrieval time, and the network depends on live Overpass. Record retrieval time and a snapshot hash. | main.py:2903-2913, 3651-3705 | P2 | code-workers |
| MOD-20 | Managed attempt and engine-supervision stack (about 2.7k lines) has no production caller. Wire it in or retire it. Do not count it as recovery. | model_engine_channel.py:213; model_engine_process.py | P2 | code-workers |
| MOD-21 | Migration 14 model_stage_attempts has no consumer. 24 unread columns are registered as exemptions. | migration 20261016000014; a-column-nothing-reads test | P2 | prs-136-170 |
| MOD-22 | ActivitySim KPI and artifact inserts are not journaled. Route them through model_legacy_kpi_command. | supabase_poll.py:287-336 | P2 | code-workers |
| MOD-23 | Hosted ActivitySim has no timeout or memory scope, and the heartbeat reports healthy during a hang. Show progress-based liveness; never auto-kill. | activitysim_worker/runtime.py:875-881 | P2 | code-workers |
| MOD-24 | Migration 18 enrolls every existing model run as historical_unassessed. The UI marks them "Reconciliation required", removes Relaunch and the progress bar, and refuses database writes. No reconciliation tool exists. | migration 18; model page | P1 | prs-136-170 |
| MOD-25 | Model creator refuses to proceed without a project or scenario set. This is not in the CHANGELOG. | model creator | P2 | prs-136-170 |
| MOD-26 | Local artifact downloads now refuse on non-Linux hosts. Self-hosters on macOS or Windows lose them. Not in CHANGELOG. | local-artifact-file.ts (readPinnedLocalFile) | P2 | prs-136-170 |
| MOD-27 | Workspace deletion is refused when retained model commands exist. No operator doc. | workspace delete route | P2 | prs-136-170 |
| MOD-28 | #168 KPI-deletion defect: relaunch cleanup can delete a retained KPI while a retry returns its receipt. Migration 18 triggers address it. Never logged in KNOWN_ISSUES. Log it and verify the fix. | #168, #169 | P2 | prs-136-170 |
| MOD-29 | Recovery status calls one RPC per worker run in sequence on every model page load (N round trips, plus 5-second refresh). | recovery-status-server.ts | P2 | prs-136-170, code-workers |
| MOD-30 | Model card hashes 42 artifacts on each render with no caching. | published-distributed-work-loading.ts | P2 | prs-136-170 |
| MOD-31 | Recovery notice is a 46-word sentence using "worker journal" and "database records". Shorten it. | modelRecoveryNotice | P2 | prs-136-170 |
| MOD-32 | Planner-visible recovery change shipped with no rendered acceptance. | #169, #170 | P2 | prs-136-170 |
| MOD-33 | #157: broad except handlers may swallow the unconfirmed-write exception. Progress path is fixed; the select-link path is unverified. | aequilibrae_worker/main.py; supabase_poll.py | P2 | prs-136-170 |
| MOD-34 | _confirmed_state_patch is copied byte for byte into both workers. | aequilibrae_worker/main.py; supabase_poll.py | P3 | prs-136-170, code-workers |
| MOD-35 | Resolving run directories now throws on a 12-character prefix. Existing short-prefix directories need a reconciliation tool that did not ship. | resolveRunWorkDir (#162) | P2 | prs-136-170 |
| MOD-36 | Decisive-eligibility change did not bump VALIDATION_RULES_VERSION (still 4). Old and new assessments share one rules identity. | model_validation_core.py; VALIDATION_RULES_VERSION | P2 | prs-136-170 |
| MOD-37 | --matcher-source falls back silently to a .gz sibling when the named file is missing. | verify_comparable_observation_study.py:31-42, 54-56 | P2 | prs-136-170 |
| MOD-38 | Owner-unreadable env files are accepted (mode 0200). The check tests only mode & 0o077. MemoryMax=2G is hardcoded. | checkedPath (#150) | P2 | prs-136-170 |
| MOD-39 | Five validation and instrument versions coexist. Mark the superseded ones read-only. | model_validation_core v4, v5; validation_instrument; _v2; structural diagnosis v3 | P3 | code-workers |
| MOD-40 | County on-ramp is not deployed on hosted. No county worker URL is set and the app hides the launch, so hosted planners cannot reach the guided flow. | county-onramp-dispatch.ts:39 | P2 | code-workers |
| MOD-41 | Duplicated worker infrastructure: heartbeat file byte-identical in both workers; 45 sys.path edits. Move into one installable package. | worker_heartbeat.py; supabase_poll.py:46-48, 214-306 | P3 | code-workers |
| MOD-42 | main.py is 8,402 lines. stage_artifacts is about 1,180 lines; stage_assignment is about 830. Split by stage. | main.py:4281-5116, 5816-6994 | P3 | code-workers |
| MOD-43 | Python has no lint or type configuration. | repo | P3 | code-workers |
| MOD-44 | Some recovery modules are written as compressed one-line style. | model_recovery_decision_command.py | P3 | code-workers |
| MOD-45 | Three ActivitySim root suites and three modeling suites never run in CI. | ci.yml; worker-security-regression.yml | P2 | code-workers, tests |
| MOD-46 | Dual-model agreement server (377 lines) has no direct test. This is the code behind the standing dual-model directive. | lib/models/verified-dual-demand-agreement-server.ts | P2 | tests |
| MOD-47 | Model run volumes route (397 lines) has no direct test. | api/models/[modelId]/runs/[modelRunId]/volumes/route.ts | P3 | tests |
| MOD-48 | Model runs route is 1,559 lines with 22 direct writes. | app/api/models/[modelId]/runs/route.ts | P3 | code-backend |
| MOD-49 | Guided traffic-number flow is partly built. Hosted planners cannot reach it (see MOD-40). | county-runs | P2 | code-workers |

## Data Hub and GTFS

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| DAT-01 | Hosted GTFS upload is capped near 4.5 MB by Vercel while 200 MiB is advertised. Every agency feed above that size fails with a bare 413. Use direct-to-Storage signed upload. | body-limit.ts:62, 71, 76 | P2 | code-workers |
| DAT-02 | Shapefile intake never tested. A re-upload cannot become a new version (KI-2026-09-01-019). | Data Hub | P2 | module-map |
| DAT-03 | Data Hub GTFS panel is 1,393 words. managed-gtfs-imports.tsx has 37 of 173 lines over 160 characters (one is 627). Copy such as "Exact command receipt confirmed in this session." | data-hub components | P2 | code-frontend, prs-171-200 |
| DAT-04 | Data Hub components gained about 700 words, mostly from #190. | Data Hub | P2 | prs-171-200 |
| DAT-05 | Managed GTFS reaper cron calls a function from migration 28 before migrations were applied. Record applied dates and any cron errors. | #190 | P2 | prs-171-200 |
| DAT-06 | Transit KPIs show zero for an unusable feed (see MOD-05). Codex P1 on transit-as-zero in #177 is unverified. | #177 | P2 | prs-171-200 |
| DAT-07 | Managed GTFS ingestion is about 10.9k lines of TypeScript and is off on hosted. Migrations 28 to 31 are unreleased. | GTFS | P3 | code-workers |
| DAT-08 | Data Hub Title VI service-equity panel has no separate browser test. | Data Hub | P3 | tests |

## Documents and Reports

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| RPT-01 | Reports offer three types (project status, analysis summary, board packet) and cannot produce a plan document. "Packet" wording throughout. | src/lib/reports/catalog.ts:18-20 | P2 | module-map |
| RPT-02 | Published structural diagnosis card shows a release number ("v0.39") in the UI. | published-structural-diagnosis-card.tsx:44 | P2 | code-frontend |
| RPT-03 | Reports detail page is 4,036 words and a control stack. Make it a reading surface. | /reports/[reportId] | P3 | code-frontend, module-map |
| RPT-04 | Report generate route is 2,776 lines and reports/html.ts is 2,136. Split them. | app/api/reports/[reportId]/generate/route.ts; lib/reports/html.ts | P3 | code-backend |
| RPT-05 | report-standard-detail.tsx (415 lines) has no test. | tests | P3 | tests |
| RPT-06 | No way to write and review a full document (M2b). | Documents | P2 | module-map |
| RPT-07 | Knowledge base uploads have a 100 MB limit per file and no workspace quota. | body-limit.ts:33 | P2 | code-backend |

## Maps and map packages

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| MAP-01 | 13 of 14 map constructors need a Mapbox token. Only the resident map has a key-free MapLibre path. Share the engine choice from public-map-stage.tsx, starting with Safety, Corridor Analysis and the geometry picker. | safety-crash-map.tsx:223; use-explore-map-instance.ts:65 | P1 | code-frontend, prs-171-200, module-map |
| MAP-02 | Style-load race. map.once("style.load") after a false isStyleLoaded() is at 12 call sites. The repo measured 2 of 5 loads never drawing. One hook was fixed and the rest remain. Add a whenStyleAccepts() helper and a guard. | cartographic-map-backdrop.tsx:1121 (plus nine more); geometry-picker-map.tsx:455; location-display-map.tsx:392; use-workspace-gis-map-binding.ts:320-345 | P1 | code-frontend |
| MAP-03 | Updates that bail with no retry. | geometry-picker-map.tsx:425; mission-aoi-editor.tsx:300 | P2 | code-frontend |
| MAP-04 | mapbox-gl downloads on every signed-in page to serve one route. Load it with next/dynamic behind the route check, or mount it from an Aerial layout. | cartographic-shell.tsx:26, 108; cartographic-map-backdrop (2,486 lines) | P2 | code-frontend |
| MAP-05 | Published land use map hard-codes a Mapbox style. | public-designation-map.tsx:50 | P2 | code-frontend |
| MAP-06 | Public about tab map questions are Mapbox-only. | engage/<token>/about | P2 | code-frontend |
| MAP-07 | Who makes the package? offers only "Claude Fable 5.1 on my computer" or ZIP upload. It assumes Claude is installed and paid for. Say so plainly. | map-package-creator.tsx:107-113; maps/page.tsx:76-77 | P2 | module-map |
| MAP-08 | Maps header and "Make maps" button imply OpenPlan makes the maps. Rename the button "Request map package". | maps/page.tsx:96-97; map-package-creator.tsx:233 | P2 | module-map |
| MAP-09 | "Practice run (every map says so)" is unclear. Use "Mark every map as a draft." Time estimate is only "several hours". | map-package-creator.tsx:110, 177-180 | P3 | module-map |
| MAP-10 | "Connect a computer" does not say what the connector can read. | map-package-creator.tsx:120-144 | P3 | module-map |
| MAP-11 | Package list does not show why a package failed. | maps/page.tsx:129-149 | P2 | module-map |
| MAP-12 | Package view has no way to place a figure into a report or grant application. | map-package-view.tsx:81-145 | P3 | module-map |
| MAP-13 | Vendored transportation-gis skill fetch.py knows only US states and Puerto Rico. Its error text uses "Winters, CA" as the example. | vendored skill (#189) | P2 | prs-171-200 |
| MAP-14 | Migration 20261017000001 checks only that the funding opportunity is in the same workspace, not the same project. Its retry comparison ignores client and practice fields. Already applied on hosted, so the fix needs a new migration. | migration 20261017000001:178-179; map-packages/[packageId]/upload/route.ts:34 | P1 | prs-171-200, code-backend |
| MAP-15 | Agent-produced files become ready through service-role database calls, not the action registry. The package page has a planner review gate. Record the deviation. | migration 20261017000001:178-179 | P2 | prs-171-200, code-backend |
| MAP-16 | Map packages: 6 of 7 library files and all 3 components (1,052 lines) have no unit test. No browser test runs end to end. | tests | P2 | tests |
| MAP-17 | Maps connector exercised only with a stand-in for Claude Code, never a live model run. | Maps | P2 | prs-171-200 |
| MAP-18 | Installed Planner Agent project turns (claude-launch.mjs) pass no --effort. "All run at high effort" holds only for in-app calls. | claude-launch.mjs | P2 | prs-171-200 |
| MAP-19 | Maps has no roadmap milestone or ledger row, and the whole-product review AGENTS.md requires was not done. | ROADMAP, ledger | P2 | prs-171-200, docs-audit |
| MAP-20 | Public engagement map: self-host instructions say to rebuild after setting the variable. A runtime-only setting shows the notice, not a map. No tile extract ships with the repo. | SELF_HOSTING.md | P2 | prs-171-200 |
| MAP-21 | Map credit guard misses the public map (new gl.Map). | every-map-credits-its-sources.test.ts:20 | P1 | tests |

## Aerial and ODM

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| AER-01 | ODM jobs are in memory only: no durable intake, task-handle persistence, resumable transfer or pinned images. M5b.2 requires them. Reuse the OCR durable pattern. | odm_worker/main.py:159-173, 436-447 | P1 | code-workers, module-map |
| AER-02 | Aerial queued admission is lost after stopped-root restoration. Worker recovery is explicitly false. | #212 | P1 | prs-201-218 |
| AER-03 | Duplicate and overwritten aerial drafts after API retries (NodeODM 2.2.4). Log the defect in KNOWN_ISSUES. | #215 | P1 | prs-201-218 |
| AER-04 | Capture proceeds with --writers-quiesced even when docker stop failed. | #215 | P2 | prs-201-218 |
| AER-05 | No ODM worker runs on the hosted site. | hosted | P2 | module-map, code-workers |
| AER-06 | Admission, source-custody and engine-effects libraries (#213, #214, #216) are not imported by the worker. | #213, #214, #216 | P2 | prs-201-218 |
| AER-07 | #213: schema bootstrap runs before BEGIN IMMEDIATE, and the -journal sidecar is not validated before open. | #213 | P2 | prs-201-218 |
| AER-08 | #214: custody accepted for an entry already in phase started; photo_manifest.totalSizeBytes is never compared. | #214 | P2 | prs-201-218 |
| AER-09 | #212: transitive helper modules are missing from executed-source hash bindings. | #212 | P3 | prs-201-218 |
| AER-10 | ODM worker's eight suites never run in CI. | ci.yml | P2 | tests, code-workers |
| AER-11 | DJI controller import is unproven. | Aerial | P2 | module-map |
| AER-12 | M5b.1 and M5b.3 to M5b.6 have no worker code on main. | ROADMAP | P3 | code-workers |
| AER-13 | aerial/page.tsx uses grid-cols-4, which breaks at 390 px. | aerial/page.tsx:351 | P2 | code-frontend |

## OCR

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| OCR-01 | Six OCR suites never run in CI. | ci.yml:201-247; worker-security-regression.yml:22-25 | P2 | code-workers, tests |
| OCR-02 | English is the only installed language. The worker refuses others. Say so in the UI or add language packs. | ocr_worker | P2 | code-workers |
| OCR-03 | OCR OCR proof launches the worker from hand-rebuilt settings, not the retained environment file. | docs/reviews/2026-10-11-ocr-inventory-root-set/native_integration.py | P2 | prs-201-218 |
| OCR-04 | OCR /healthz answers to anyone. Confirm it reveals nothing beyond status. Job endpoints need a bearer token. | ocr_worker/main.py:438-440 | P3 | infra |
| OCR-05 | OCR resource limits are not recorded in the repo. | Railway ocr service | P3 | infra |
| OCR-06 | Durable SQLite WAL and FULL settings hold up. Keep. | durable.py | P3 | code-workers |

## Planner Agent and action registry

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| AGT-01 | Action registry runs in the browser, so an agent can skip it. Server approval applies only when the request declares itself agent-sourced. Without the header, the write is recorded as user-authored. Enforce approval on agent-sourced writes, or call the registry a consent record. | lib/assistant/action-approval-server.ts:241-243, 288-290; lib/runtime/action-registry.ts:40-64 | P1 | code-backend |
| AGT-02 | Registry has 12 actions against 343 routes. Only 23 routes call the verifier. Widen it or document the gap. | lib/runtime/action-registry.ts:304-317 | P2 | code-backend |
| AGT-03 | Planner Agent approval overlay is role="dialog" with no focus handling. This is inferred from code. | app-copilot.tsx:2722-2726 | P2 | code-frontend |
| AGT-04 | Audit event ids render on five sites, including the approval prompt. Move them into OperatorDetail. | app-copilot.tsx:1434, 2336, 2420, 2465, 2735 | P2 | code-frontend |
| AGT-05 | Planner Agent drawer carries 1,389 words, and the shell adds 2,839 words to every page. | app-copilot.tsx | P2 | code-frontend |
| AGT-06 | Planner Agent chat is Anthropic-only; every workspace needs its own paid key. | chat/route.ts:4 | P2 | module-map, docs-audit |
| AGT-07 | Assistant "today" is a UTC date slice. At 17:00 Pacific the prompt says tomorrow's date. Use a shared local-date helper. | openplan/src/app/api/assistant/chat/route.ts; chat-context.ts:40 | P1 | prs-201-218 |
| AGT-08 | Planner Agent cannot assign work across modules (A1 not built). | Planner Agent | P3 | module-map |
| AGT-09 | Planner Agent Activity sits fifth in the Workspace group although it is a log. | nav-registry.ts:115-120 | P3 | module-map |

## Navigation, shell and shared UI

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| NAV-01 | Three sibling plan entries remain on the rail. Merge into one (decision D4). | nav-registry.ts:124-137 | P2 | code-frontend, module-map |
| NAV-02 | Public header shows signed-in users Dashboard, Corridor Analysis and Invoices. The invoices link looks left over. | top-nav.tsx:16-19 | P2 | module-map |
| NAV-03 | /billing and /command-center are redirect stubs. Set a removal date. | redirects | P3 | code-frontend, module-map |
| NAV-04 | Command palette searches modules only, never records. | command palette | P2 | code-frontend |
| NAV-05 | Routes with one or two inbound links: /grants/bca/<id>, /programs/<id>/measure, /projects/<id>/management, /invoicing/engagements/<id>. | grants-bca-screening-section.tsx:43; project-contracts.tsx:6 | P2 | code-frontend |
| NAV-06 | Four styling systems coexist: 2,389 raw Tailwind colour utilities in 218 files; 2,941 module-* uses; 1,479 arbitrary values; 375 always-dark analysis-* uses; --muted used as a fill 261 times. | globals.css:113 | P2 | code-frontend |
| NAV-07 | About 50 unreferenced global classes, including the shell-* family. Delete them. | globals.css:586-694 | P3 | code-frontend |
| NAV-08 | No Select, Label, Checkbox or MapShell primitive. 385 raw select elements. | components/ui | P2 | code-frontend |
| NAV-09 | "Try again" does not retry. 16 of 17 error boundaries only call reset(). 11 module error files are copies. Use one ModuleError that refreshes the router, then resets. Remove "Nothing has been deleted". | grants/error.tsx:34; module error.tsx files; :27-28 | P1 | code-frontend |
| NAV-10 | Only 8 of 67 routes have loading.tsx. | routes | P2 | code-frontend |
| NAV-11 | 36 files hand-build "Back to X" links. Use one component. | components | P3 | code-frontend |
| NAV-12 | Create flows are inline, not GuidedFlow: allocation-rule-builder.tsx (798), workspace-gis-upload-wizard.tsx (670), measure-fund-setup.tsx (552), network-package-upload-form.tsx (751). | components | P2 | code-frontend |
| NAV-13 | About 1,940 lines are reachable only from tests because knip.json counts tests as entry points. Includes workflow-next-action-groups.ts (985 lines), run-figures.ts, receivable-aging-strip.tsx, ui/separator.tsx. | knip.json | P3 | code-frontend, tests |
| NAV-14 | sonner and next-themes are in package.json with no importer. | package.json | P3 | code-frontend |
| NAV-15 | 73 component files have lines over 400 characters. Worst is land-use-plan-workbench.tsx (4,954 characters). | components | P3 | code-frontend |
| NAV-16 | Public footer reads "OpenPlan · Nat Ford Planning" (decision D8). | (public)/layout.tsx:16 | P2 | code-frontend |
| NAV-17 | Help lists AI-key features and leaves out RTP reading and Maps. | help/page.tsx:168-178 | P2 | module-map |
| NAV-18 | Help says "AI theme generation is not yet available". Check and update. | help/page.tsx:168-171 | P3 | module-map |
| NAV-19 | Workspace page mixes the setup form with deployment health. Server health is administrator content on a planner page. | /workspace | P2 | module-map |
| NAV-20 | Workspace page header is 30 words. | workspace/page.tsx:99 | P3 | code-frontend |
| NAV-21 | Sign-up checklist's first highlighted step is the Anthropic key. | first-run-checklist.tsx:297 | P2 | module-map |

## Copy and plain words

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| CPY-01 | About 700 renderable strings contain em dashes (695 in app and components). Replace with commas, periods or parentheses. Add a guard. | app and components, including home heading (public/page.tsx:151) and figure-row.tsx:31 | P2 | code-frontend |
| CPY-02 | Build-note guard checks only seven phrases and skips src/lib. Add "lane", "custody", "receipt", "retain", "SHA-256", "migration", "environment variable" and extend to src/lib. | planner-pages-carry-no-build-notes.test.ts:28-36 | P1 | code-frontend, tests |
| CPY-03 | "Lane" appears in 145 strings across 45 files. | components | P2 | code-frontend |
| CPY-04 | "custody" appears in 99 strings; "receipt" in most of 139; "retain" in 693. | components | P2 | code-frontend |
| CPY-05 | SHA-256 and hash labels appear in about 25 UI strings. | components | P2 | code-frontend |
| CPY-06 | Migration strings (43) and environment variable names (19) appear in planner sentences. Move them into OperatorDetail with a guard. | code-frontend | P2 | code-frontend, prs-100-135 |
| CPY-07 | Six staff maps show environment variable names. Use a shared MapUnavailableNotice. | explore-workbench.tsx:730-731; aerial-mission-map.tsx:457-458; flight-plan-editor.tsx:846; mission-aoi-editor.tsx:409; participation-heatmap-map.tsx:244; rtp-cycle-project-map.tsx:476-477 | P2 | code-frontend |
| CPY-08 | "Does not establish" appears 20 times across 17 UI files. | UI files | P2 | prs-100-135 |
| CPY-09 | "Apply the latest migrations and it will" appears on Explore and Safety. | Explore, Safety | P2 | prs-171-200 |
| CPY-10 | "Operator queue" appears on project pages. | project pages | P2 | prs-171-200 |
| CPY-11 | "Synthetic training example loaded" (#118) and "A missing reply does not establish" (#119) are on screen. | #118, #119 | P2 | prs-100-135 |
| CPY-12 | "Prepared bytes describe saved material, not a token estimate" (#117) is on screen. | #117 | P2 | prs-100-135 |
| CPY-13 | Header word counts: workspace (30), engagement (27), land-use-plans (24), help. Build the 15-word header guard that was planned. | page headers | P2 | code-frontend |
| CPY-14 | Ten wordiest routes (static words): engagement 18,264; projects 9,407; models 6,831; rtp 5,697; grants 5,653; data-hub 5,194; explore 4,326; reports 4,036; invoicing 3,567; models list 3,524. | routes | P2 | code-frontend |
| CPY-15 | Roughly 1,062 test assertions in 216 files pin UI sentences of 40+ characters, so each copy cut edits tests. Use roles or test ids in new tests. | tests | P3 | tests |
| CPY-16 | 40 assertions require the same phrase twice or more (model-recovery-status-controls.test.tsx:33, 42; published-comparable-observation-card.test.tsx:73). | tests | P3 | tests |
| CPY-17 | Add a text-volume guard: count words per page and allow the count only to fall. | tests | P2 | tests |

## Accessibility and responsive

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| A11Y-01 | Nested main elements: (public)/layout.tsx:12 wraps pages that render their own main. | privacy/page.tsx:50; terms/page.tsx:54; contact/page.tsx:15; legal/page.tsx:64; (public)/error.tsx:22 | P2 | code-frontend |
| A11Y-02 | Planner Agent approval overlay has no focus management (inferred). | app-copilot.tsx:2722-2726 | P2 | code-frontend |
| A11Y-03 | Traffic volume and crash maps have no keyboard or table path. | Safety, Explore maps | P2 | code-frontend |
| A11Y-04 | 18 camera animations ignore reduced-motion settings. | map components | P2 | code-frontend |
| A11Y-05 | No automated accessibility (axe) check anywhere. Add one to the nightly smokes. | qa-harness | P2 | code-frontend, tests |
| A11Y-06 | Two tables have no scroll wrapper. | extraction-candidate-card.tsx:511; county-run-behavioral-kpis.tsx:108 | P2 | code-frontend |
| A11Y-07 | Static 390 px risks: grid-cols-5 and grid-cols-4 with no breakpoint. | project-spine-board.tsx:74, 218; aerial/page.tsx:351 | P2 | code-frontend |
| A11Y-08 | Aerial below 1024 px does not follow the map-first layout. | /aerial | P3 | code-frontend |
| A11Y-09 | Public pages (portal, plans, measure) have no print or screen-reader proof. | public pages | P2 | module-map |
| A11Y-10 | Engagement portal WCAG 2.2 AA is not verified with real users. | /engage/[token] | P2 | module-map |
| A11Y-11 | Resident map on a phone is unit-tested only with a fake map. | tests | P2 | tests |

## Performance

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| PERF-01 | Only 8 of 67 routes have loading states. Add loading.tsx to every module. | routes | P2 | code-frontend |
| PERF-02 | 329 inline Supabase .from() calls sit in page.tsx files. No shared fetch helper, no SWR or React Query, only 4 Suspense boundaries. | page.tsx files | P3 | code-frontend |
| PERF-03 | 338 fetch calls in 185 files and 166 router.refresh() calls on the client. | components | P3 | code-frontend |
| PERF-04 | Home page loads 13 script chunks (196 KB uncompressed). | / | P3 | infra |
| PERF-05 | Vercel functions: 60 s and 1,024 MB for three report and export routes; 17 routes set 60 or 300 s in code. | vercel.json | P3 | infra |
| PERF-06 | Unit test setup: jsdom is the default environment, which adds about 1,110 s per run. Default to node and cap workers. | vitest.config.ts | P2 | tests |
| PERF-07 | Live RLS synthesis suites take 2,058 of 2,506 seconds of the 43-minute step. | RLS job | P2 | tests |

## Tests, guards and CI

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| TST-01 | contract-completed-review-rls.test.ts never runs in CI. It is skipIf-gated and missing from the test:rls-live list. | tests/contract-completed-review-rls.test.ts:15; package.json:16 | P1 | tests |
| TST-02 | The detector package-scripts-resolve.test.ts:160 recognizes only the ternary form. 60 files using skipIf are invisible to it. | package-scripts-resolve.test.ts:160 | P1 | tests |
| TST-03 | Map credit guard matches only new mapboxgl.Map(. Add a match for new <any>.Map( and a seeded control. | every-map-credits-its-sources.test.ts:20 | P1 | tests |
| TST-04 | Hard-coded totals bumped to pass: rls-isolation.test.ts:1667 (92, after 17 bumps) with restated probes at 1664-1762; migration-schema-drift.test.ts:44 (286). Delete the restated lists. | tests | P2 | tests |
| TST-05 | Exemption lists grew: UNREAD_COLUMNS 10 to 111; UNGATED_BY_DESIGN 13 to 17; no-destructive-migration ALLOWLIST 10 to 19; EXTERNAL_CALLERS 10 to 16; PARTIAL_PATH_CALLERS 0 to 10. | a-column-nothing-reads-is-a-question.test.ts:71; workspace-write-role-gate-guard.test.ts:114; migrations/no-destructive-migration.test.ts:41; every-api-route-has-a-caller.test.ts:69, 113 | P2 | tests |
| TST-06 | 23 guards have only a floor check, 23 have neither, and 14 state a blind category. Give each a seeded control. | guards | P2 | tests |
| TST-07 | Guards with no control: active-roadmap-guard, nav-registry, product-direction-review-guard, deployment-health, package-scripts-resolve, map-default-center, one-way-to-confirm-a-destructive-action, and others. | tests | P2 | tests |
| TST-08 | Corridor light-mode test checks only two CSS selectors, so it misses a new dark-only rule. | corridor-analysis-follows-light-mode.test.ts:28-31 | P2 | tests |
| TST-09 | labels-are-sentence-case checks a hand list of 171 files. New files are unchecked. | labels-are-sentence-case.test.ts:21 | P3 | tests |
| TST-10 | gtfs-worker-cli-options.test.ts imports a script that registers SIGINT and SIGTERM handlers and never removes them. Order-dependence risk. | :21; scripts/workers/gtfs-ingestion.ts:13 | P2 | tests |
| TST-11 | gtfs-parsed-artifact.test.ts asserts on the fixture, not the decoder's output. | :27-29 | P2 | tests |
| TST-12 | Shuffled job found 7 order-dependence failures, e.g. engagement-synthesis-thematic-choice-panel.test.tsx on 10-09. | shuffled CI job | P2 | tests |
| TST-13 | Move the shuffled job off the PR critical path to main pushes and nightly. Saves about 23 runner-minutes per PR. | CI | P3 | tests |
| TST-14 | Live RLS job takes 43 minutes. Shard it or path-filter the synthesis family. | RLS workflow | P2 | tests, infra |
| TST-15 | No concurrency group cancels stale PR runs on CI, RLS or worker security. 635 CI runs in 30 days. | workflows | P2 | tests, infra |
| TST-16 | Strict up-to-date rule causes reruns and 72 cancellations. Drop strict. | branch protection | P3 | infra |
| TST-17 | 18 Python suites never run in any workflow: ocr_worker (6), odm_worker (8), activitysim (3), map-skill test_checks.py. | workflows | P2 | tests, code-workers |
| TST-18 | Worker suite floors are loose: 28 required against 154, modeling 40 against 97. Set floors to real counts. | worker CI jobs | P3 | tests |
| TST-19 | every-worker-suite-can-actually-run skips 9 of 16 tests in CI. | tests | P3 | tests |
| TST-20 | Three suites sit outside the CI glob: test_count_sources.py, test_census_key_failure.py, test_screening_metrics.py (449 lines). | scripts/modeling | P2 | code-workers |
| TST-21 | 125 candidate probes are always skipped. Nothing sets their env vars. Delete or enable. | engagement-synthesis-response-candidate-rls.test.ts:25, 1000 | P3 | tests |
| TST-22 | Nightly QA runs 6 of 12 local smokes. Land use review reporting, dual-demand grant, aerial ortho render, governed decision handoff, jurisdiction readiness are missing. | qa-harness nightly | P2 | tests |
| TST-23 | Nine production smokes run in no workflow. "Production Health" shows skipped. | qa-harness | P2 | tests, infra |
| TST-24 | Nightly local-rtp-release-review-smoke failed 10-11 (TimeoutError). #202 fixed it. The 10-07 run is stuck queued. | nightly | P2 | tests, infra, prs-201-218 |
| TST-25 | No browser tests for map packages end to end, GIS upload, measure fund lifecycle, invoicing, or the resident map on a phone. | tests | P2 | tests |
| TST-26 | Riskiest untested files: model volumes route (397); measures periods route (341); dual-demand agreement server (377); coming-up-rail (199); workspace-gis-upload-wizard (671); rtp/_packet-state (452); report-standard-detail (415). | tests | P2 | tests |
| TST-27 | 48 routes (14 percent) have no test that names them. Includes the money routes and six land-use writes (see MEA-05, OWP-21, CON-09, LUP-05). | code-backend section 8 | P2 | code-backend, tests |
| TST-28 | 345 test files mock the Supabase server client; 11 hit a live database. 151 test migration SQL as text without running it. Add live tests for money paths. | tests | P2 | code-backend, tests |
| TST-29 | Hand-built range fakes: the shared paging fake models the 1,000-row cap but only 2 files use it; 32 files build their own fakes. Map-package-routes.test.ts has no cap. | tests | P2 | tests |
| TST-30 | Mutation evidence is not repeatable. 821 Python harness scripts sit in docs/reviews, in at least 20 result formats. Write one harness in scripts/ops with a fixed format and a required negative control. | docs/reviews | P2 | tests |
| TST-31 | foundation-audit-ratchet is a static ledger, and under 5% of test files were audited. | tests | P3 | tests |
| TST-32 | "First-week browser instrument" runs Node unit checks, not a browser. Rename or fix. | CI | P3 | tests |
| TST-33 | npm audit --audit-level=low can block every merge, including hotfixes. Move it to a scheduled job or raise it to high for production dependencies. | CI | P2 | infra, tests |
| TST-34 | Restore Drill, Upgrade Path and Modeling source contracts are not required checks. Make Restore Drill or Upgrade Path required on migration PRs. | branch protection | P2 | infra |
| TST-35 | RLS test list is hand-typed in package.json, so new suites slip out. Build the list from a file-name pattern. | package.json:16 | P2 | tests |
| TST-36 | Dense one-line test style in 77 files, with 2,585 lines over 200 characters. No formatter. | tests | P3 | tests |
| TST-37 | Engagement synthesis response probes (see TST-21) have no hosted run. | tests | P3 | tests |

## Documentation and roadmap

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| DOCS-01 | Contract and roadmap say hosting is deferred and Vercel is inactive. The site is live with public signups since Oct 11. Update all four documents in one change. | V1_PRODUCT_CONTRACT.md:22; ROADMAP.md:115-116; KNOWN_ISSUES.md:6-7 | P1 | docs-audit, module-map, prs-171-200 |
| DOCS-02 | Roadmap queue is empty since about Oct 8. The Sept 7 queue still sits at lines 136-143. Write a dated "next three" list. | ROADMAP.md:77-106, 136-143 | P1 | docs-audit, module-map |
| DOCS-03 | Oct 10-11 work is missing from the roadmap, contract and most of the ledger: hosted launch, Maps, UI overhaul 1 to 4, engagement map sweep, model-default policy. | ROADMAP, V1 contract, ledger | P1 | docs-audit, prs-171-200 |
| DOCS-04 | Journey coverage: nine of 24 navigation entries have no first-week journey (RTP, Programs, Grants, Invoices, Maps, Aerial, Scenarios, Planner Agent Activity, Help). Add harness jobs. | harness; V1_PRODUCT_CONTRACT.md:193 | P1 | module-map |
| DOCS-05 | Last full harness run was Sept 6 on 648504cf. Rerun on origin/main. The rerun also closes KI-078, 079, 080 and 082. | docs/ops/V044_FINAL_FIRST_WEEK_OUTCOMES_2026-09-06.md | P1 | module-map |
| DOCS-06 | Contract says "no required paid infrastructure", but RTP reading, Maps and translation need paid AI. | V1_PRODUCT_CONTRACT.md:223 | P1 | module-map |
| DOCS-07 | KNOWN_ISSUES.md last updated Sept 30. Log the open Codex findings (18 from #100-135), the #168 defect, the #212 and #215 defects, #193, #194 and the 2 unresolved P1s. | docs/ops/KNOWN_ISSUES.md | P1 | prs-100-135, prs-136-170, prs-171-200, prs-201-218 |
| DOCS-08 | KNOWN_ISSUES header says "Reviewed 2026-09-06 against unreleased v0.44.0". | KNOWN_ISSUES.md:10 | P3 | docs-audit |
| DOCS-09 | Roadmap header says current_release v0.68.0, but the body says "remained v0.66.0" and the matrix says 0.44.0 is an unreleased candidate. | ROADMAP.md:46; matrix:39 | P2 | docs-audit |
| DOCS-10 | Direction check exits 0 while inputs are expired: jurisdiction registry (2026-09-28); matrix and registry (2026-10-05). The guard forces header bumps. | product-direction-review.mjs:403-434 | P2 | docs-audit |
| DOCS-11 | Roadmap is 855 lines and 24,007 words. Move dated release notes to CHANGELOG. | ROADMAP.md | P2 | docs-audit, module-map, prs-201-218 |
| DOCS-12 | 48 of 50 milestone Done lines need human observation, so an agent-only team cannot close any milestone. | ROADMAP | P2 | docs-audit |
| DOCS-13 | No single status table. Status lives in 49 dated paragraphs and 118 links. | ROADMAP | P2 | docs-audit |
| DOCS-14 | Roadmap M15 says "mid-term" and hosting is deferred. Add a milestone for running a public service. | ROADMAP.md:115, 142 | P2 | module-map, docs-audit |
| DOCS-15 | Ledger CORE-ENG-01 says address search and a key-free map remain. Both shipped (#185, #196). | CORE_REQUIREMENTS_LEDGER.md:33 | P2 | docs-audit |
| DOCS-16 | Ledger CORE-HOST-01 says public commissioning is unproved. The site is live. | ledger:42 | P2 | docs-audit |
| DOCS-17 | Ledger has no rows for Maps, the keyless map, land use (CORE-GEO-01) or the BCA (CORE-ANALYSIS-01). | ledger | P2 | prs-100-135, prs-171-200 |
| DOCS-18 | M1 claims that California general and specific plans share sections are stale. #127 added a separate specific-plan checklist. | ROADMAP M1; KL-2026-09-04-002; registry.ts:148-171 | P2 | prs-100-135 |
| DOCS-19 | ARCHITECTURE is five weeks stale. Line 3 says reconciled Sept 6; line 79 says maps use Mapbox only; line 129 says "Proposed hosted preview". | ARCHITECTURE.md | P2 | docs-audit |
| DOCS-20 | CHANGELOG Unreleased contradicts itself: line 57 says "A public map without a Mapbox key"; line 183 says "Not done: a map that works without a Mapbox key". | CHANGELOG.md | P3 | docs-audit |
| DOCS-21 | CHANGELOG has no entry for the UI overhaul (#186, #187, #188, #193). | CHANGELOG.md | P2 | prs-171-200 |
| DOCS-22 | CHANGELOG entries from #161 onward are operator migration notices. They tell a planner nothing. | CHANGELOG.md | P3 | prs-136-170 |
| DOCS-23 | CHANGELOG does not cover the operator CLIs (#204, #205, #208, #209). | CHANGELOG.md | P2 | prs-201-218 |
| DOCS-24 | AGENTS.md says "zero users as of September 7" beside the public-signup statement. | AGENTS.md:157 | P2 | docs-audit, prs-171-200 |
| DOCS-25 | Two "current" modeling status files. AGENTS.md:72 points to ACTIVITYSIM_RUNTIME_GAP.md; docs/README:78 points to STATUS_AND_VALIDATION.md. | AGENTS.md; docs/README.md | P3 | docs-audit |
| DOCS-26 | docs/README routing is buried. The Current authorities paragraph is about 1,500 words, and the routing table starts at line 29. | docs/README.md:11, 15, 29, 34 | P2 | docs-audit, prs-136-170 |
| DOCS-27 | README.md leads with the September 6 result and gives no hosted address. | README.md:11-14 | P3 | docs-audit |
| DOCS-28 | M3 evidence is logged in both the roadmap and the ledger, and they already drift. Keep one place. | ROADMAP:255-275; ledger:349-453 | P3 | docs-audit |
| DOCS-29 | Roadmap evidence index: 214 lines over 400 characters, longest 2,492. | ROADMAP | P3 | prs-100-135 |
| DOCS-30 | Roadmap M9 has nothing for #194 to #196. | ROADMAP | P3 | prs-171-200 |
| DOCS-31 | Roadmap has no milestone for Maps. HOSTED_LIVE calls the map-package migration "M17", which the roadmap never defines. | ROADMAP; HOSTED_LIVE_2026-10-11.md:81 | P3 | docs-audit, module-map |
| DOCS-32 | Requirements with no milestone: public service, journey per surface, AI-free path for each core job, safety action plan (ledger maps it to M6a, which does not cover it), UI overhaul, California-only program types (programs/catalog.ts:1-8), CORE-INCLUSIVE-01 languages, state and tribal agencies. | ROADMAP; ledger | P2 | module-map |
| DOCS-33 | M9b automated synthesis has five releases and no control a planner can use. Help says AI theme generation is not yet available. | ROADMAP M9b; help/page.tsx:168-171 | P2 | module-map |
| DOCS-34 | W1 Nat Ford website says "on hold" while the redirect merged Oct 11. | ROADMAP:774-778 | P2 | docs-audit |
| DOCS-35 | Session coordination notes sit in the roadmap (lines 267-275, "preserve the relaunch owner's main hold"). | ROADMAP.md:267-275 | P2 | docs-audit, prs-201-218 |
| DOCS-36 | Migration filenames look like dates but are not (see OPS-07). | migrations | P2 | docs-audit |
| DOCS-37 | Capability matrix: 0 proven, 37 partial, 62 not assessed, unchanged since Sept 6 and past its review date. | US_PLANNING_CAPABILITY_MATRIX.md | P2 | docs-audit |
| DOCS-38 | SELF_HOSTING.md omits 49 environment names. .env.example lacks OPENPLAN_COMMIT_SHA. | SELF_HOSTING.md; .env.example | P2 | infra |
| DOCS-39 | Stale hosting-deferred text: production-health.yml header, KNOWN_ISSUES header, two SELF_HOSTING passages. | files as named | P2 | infra |
| DOCS-40 | qa-harness README lists a nonexistent openplan-prod-county-scaffold-smoke.js and the wrong directory. | qa-harness/README.md | P3 | code-workers |
| DOCS-41 | None of the 12 openplan-prod smokes has a committed run report. | docs/ops | P2 | code-workers |
| DOCS-42 | docs/ grew from 93 to 6,096 tracked files (127 MB) between Aug 11 and Oct 11. About 52,700 words of required reading before work. Move logs, JSON and screenshots to release assets. | docs/ | P2 | docs-audit, prs-100-135, prs-136-170 |
| DOCS-43 | docs/reviews holds 5,787 tracked files (134 MB). Cap evidence per source line. | docs/reviews | P2 | prs-100-135, prs-136-170 |
| DOCS-44 | Executable prototypes under docs/ (#159, #160) duplicate migration 14. Move them out. | docs/reviews/.../prototype | P2 | prs-136-170 |
| DOCS-45 | Mutation logs are checked in as review records (#138: 50 or more sql logs; #127: 288 log files). | docs/reviews | P3 | prs-136-170 |
| DOCS-46 | Memory index opens with the Aug 25 v1 roadmap that was replaced 94 minutes later. Outside the repo. | memory MEMORY.md | P3 | docs-audit |
| DOCS-47 | CLAUDE.md is tracked in the repo, and it duplicates hosted guidance that AGENTS.md says must not be duplicated. Drop the CLAUDE.md hunk; keep a pointer in AGENTS.md. | CLAUDE.md (from #217) | P2 | prs-201-218 |
| DOCS-48 | AGENTS.md (#217) now publishes the Railway project id, Vercel scope and dollar figures, which will go stale. Keep a pointer to the dated ops doc. | AGENTS.md (#217) | P2 | prs-201-218 |
| DOCS-49 | Migration history: each stack PR appends a dated paragraph to ROADMAP and the ledger. The ledger has six "October 11" headings. | ROADMAP; ledger | P2 | prs-201-218 |
| DOCS-50 | Docs for #206 contradict its body on a 63-second cold build. The tracked doc is the honest one. | #206 | P2 | prs-201-218 |
| DOCS-51 | Dropped doc copy in 201-218: one date helper and one doc location per fact. | docs | P3 | prs-201-218 |

## Process and agent workflow

| ID | Item | Where | Severity | Source |
|---|---|---|---|---|
| PRC-01 | Merge holds are ignored. #190 merged while migrations 28 to 31 were unapplied, against its own body and COORDINATION.md. | #190 | P1 | prs-171-200 |
| PRC-02 | #197 merged during the hosted owner's pause request. #199 and #200 bodies said hold; both merged. #204 merged 26 seconds after the hold was posted. | #197, #199, #200, #204 | P1 | prs-171-200, prs-201-218 |
| PRC-03 | #168's own body says "do not merge separately" and documents a KPI-deleting defect. It merged anyway. | #168 | P1 | prs-136-170 |
| PRC-04 | #161, #162 and #164 recorded failed full-QA runs and then merged on partial runs. | #161, #162, #164 | P2 | prs-136-170 |
| PRC-05 | Make holds mechanical: a required check that fails while a hold names the branch; one required approval on main; a minimum open time so Codex review can post and be answered. | GitHub settings | P1 | prs-171-200, prs-201-218 |
| PRC-06 | Zero human reviews across all 119 PRs, and every merge was a self-merge. Your Sept 10 decision stands: no human review gate. In its place, the bot review must post and every P1 must be answered or fixed before merge. | all PRs | P1 | prs-100-135, prs-136-170, prs-171-200 |
| PRC-07 | 18 of 28 Codex findings in #100 to #135 are open on main (9 P1, 9 P2). Fix them before adding features. | #100-#135 | P1 | prs-100-135 |
| PRC-08 | Codex findings stay unanswered. 16 PRs in 201-218 have P1 or P2 findings with no reply. | #201-#218 | P2 | prs-201-218 |
| PRC-09 | Codex usage limit: 12 of 36 PRs in 100-135 unreviewed; 20 of 35 in 136-170; 6 of 30 in 171-176. Fund the bot for worker and migration PRs, or stop merging them in the same session. | Codex | P2 | prs-100-135, prs-136-170, prs-171-200 |
| PRC-10 | Stacked PRs: 8 of 35 in 136-170 were re-submissions, and 10 open PRs in 201-218 form one chain. One PR per unit of work, rebased on main. | PRs | P2 | prs-136-170, prs-201-218 |
| PRC-11 | Evidence is about 80% of October's added lines. Evidence runs 5.3 lines per source line. Cap evidence per source line. | PR volume | P2 | prs-100-135, prs-136-170 |
| PRC-12 | 123 worktrees. 119 have nothing unmerged but sit 40 to 1,600 commits behind main. Prune after their lanes close. | git worktrees | P3 | prs-201-218 |
| PRC-13 | Your merge hold waits on the hosted relaunch and an independent Opus review. This review may serve; your call. | COORDINATION.md | P1 | prs-201-218 |
| PRC-14 | COORDINATION.md is untracked, about 84 KB, chronological, with no current-state banner. Hold text is at lines 222, 226 and 247. Add a current-state block at the top. | COORDINATION.md | P2 | prs-201-218 |
| PRC-15 | Merged within an hour of opening, with P1s unaddressed: #173, #175, #178, #179, #180, #181, #182, #195, #200. #180 merged 11 minutes after a P1. #182 merged 25 seconds before its review posted. | PRs | P2 | prs-171-200 |
| PRC-16 | #195 merged with one P1 and two P2s unaddressed. | #195 | P2 | prs-171-200 |
| PRC-17 | Open P1s on main: #187 (dashboard dates), #193 (light mode), #194 (vote inflation), #189 (map packages). | PRs | P1 | prs-171-200 |
| PRC-18 | Agents merge through the nfredmond account, so the merger name is not evidence of review. | GitHub | P3 | prs-171-200 |
| PRC-19 | Release cadence outran review: 37 tags from v0.44.0 to v0.68.0, 11 of them on Sept 10. v0.48 to v0.66 shipped with no PR or bot review. | tags | P2 | prs-100-135 |
| PRC-20 | Auto-deploy from main with no review gate on the hosted site. Document the escape hatch. | Vercel | P2 | prs-171-200, infra |
| PRC-21 | #170 held a merge for desktop and 390 px acceptance, then merged a day later without that acceptance. | #170 | P2 | prs-136-170 |
| PRC-22 | Planner-visible UI change shipped without rendered acceptance (#169). Require it for planner-visible changes. | #169 | P2 | prs-136-170 |
| PRC-23 | Operator-only CLIs were not announced. Add to the CHANGELOG (see DOCS-23). | operator CLIs | P3 | prs-201-218 |
| PRC-24 | Written hold rule would have caught #168, #161, #162 and #164. | process | P2 | prs-136-170 |
| PRC-25 | Oct 10 "less text" directive was not applied in #139, #169 or the 201-218 PR bodies. Apply it. | PR bodies and panels | P2 | prs-136-170, prs-171-200 |
| PRC-26 | Vendored braces package added in #114. | #114 | P3 | prs-100-135 |

# OpenPlan backend review, commit c735abec (snapshot of October 11, 2026)

## Bottom line

I found no cross-tenant read or write path in the reviewed code. Row-level security (RLS) is on for every public table, security-definer functions are carefully revoked and guarded, and none of the 40 sampled routes had an IDOR.

The main risks for a public deployment are abuse and cost, not tenant isolation:

- **Anonymous Storage exhaustion.** Anyone holding an active campaign link can fill Storage with photos. The photo throttle lives in one server instance's memory, and nothing sweeps photos that were never attached to a comment.
- **Unbounded fresh signups.** A new account can create as many workspaces as it likes. Each one gets its own AI allowance, and there is no storage quota per workspace or per account.
- **Wrong engagement totals in published packets.** Report generation still reads engagement comments in a single request, so any campaign over 1,000 comments is silently understated in board packets.

Every sibling-review item I rechecked is confirmed at the cited lines. Nothing was run: no tests, builds or databases. All counts come from static parsing of the snapshot.

The scripts and their outputs are in `/home/nathaniel/.local/state/openplan-review-20261011/code-backend/work/`. That includes the earlier `classify.py`, `mig.py`, `fn3.py`, `fk.py`, `multiwrite.py`, `svcchains.py`, `routetests.py` and `sample.py`, plus new ones this session: `secdef2.py`/`secdef2.json`, `custody.py`, `queues.py`, `rowcap.py`, `dupfns.py` and `destructive.py`.

## 1. Inventory

| Item | Count |
|---|---|
| API `route.ts` files | **343**, not 342 (80,127 lines); 42 over 500 lines, 5 over 1,000 |
| Server actions | **2**, both inline sign-out (`components/top-nav.tsx:26`, `components/cartographic/cartographic-shell.tsx:94`); no `"use server"` files |
| Library modules | 895 non-test TypeScript files, 212,123 lines, 67 top-level folders; 67 pages; 108,256 component lines |
| Migrations | 405 files, 52,153 lines, `20260219000001` through `20261017000001` (file names run 6 days ahead of the calendar). Hosted has 401 applied; the four unapplied are the GTFS candidates. |
| Tables | 321: 309 `public` plus 12 `openplan_gtfs` |
| RLS | Enabled on all 309 public tables; FORCE on 0; 96 have RLS and no policy (service-role only); 514 policies |
| Permissive `USING (true)` | 3, all on reference data: `census_tracts`, `lodes_od`, `equity_tract_designations` (`20260420000062`, `20260724000001`) |
| Functions | 546 live; 361 SECURITY DEFINER, of which 297 are not triggers; 175 distinct RPC names called from the app |
| SECURITY DEFINER without `search_path` | 0 live. `execute_safe_query` was dropped in `20260418000058`. |

**Security-definer functions callable by signed-in users.** My parser lists 74 non-trigger security-definer functions as callable by `authenticated`. Every one I opened checks `auth.uid()` itself or through a helper. One example is `lock_synthesis_generation_request_scope`, in `20261014000033:40-56`.

The "callable by anon" list from the parser was entirely false positives. The cause is functions revoked through RENAME (`20260912000001:80-81`, `:144-145`) and the schema-wide revoke on `openplan_gtfs` (`20261016000028:6`, `:1016`).

**Non-additive migrations.** There are very few:

- One pair of column drops, made after the data was copied (`20260722000006`).
- No table drops.
- Nine data-rewriting UPDATE statements, all labeled. For example, the California LAPM backfill is marked `interim_unconfigured_default` (`20260727000009:76-81`).
- 105 policy drops and 135 trigger drops, which are drop-and-recreate steps.

## 2. Public-signup security

**Auth sample (40 routes, round-robin by module, seed 20261011).**

- 37 pass.
- 3 are weak:
  - `network-packages/[packageId]/versions/[versionId]/connectors/route.ts:8-31`: the GET has no `getUser`, relies on RLS alone, and returns the raw `error.message`.
  - `geographies/census-tracts/ingest/route.ts:52-76`: any signed-in account, including a viewer, writes the shared `census_tracts` table through the service role, with no role check or rate limit (8 counties per call, 60 seconds).
  - `csp-report/route.ts`: anonymous, body-limited log write with no throttle.
- No IDOR found.
- Across all routes:
  - 248 call `getUser`; most of the other 95 delegate to an access helper (21 helper variants).
  - 119 use the service role.
  - 219 use body limits.
  - 292 use zod.

**Proxy.** `src/proxy.ts` refreshes the session on every request but gates only page prefixes. API routes authenticate themselves. It accepts a client-supplied `x-request-id` as-is (`proxy.ts:15-19`).

**Rate limits.**

- 12 routes reference a limiter.
- The AI limit is per workspace: 20 calls per 5 minutes (`lib/runtime/ai-rate-limit.ts:24-25`).
- It fails open on any lookup error (`:83-99`).
- It counts events that are recorded after the model call. Parallel requests therefore all pass the check before any of them is counted.

**Unauthenticated writes.** The surface is 12 `/api/engage/[shareToken]/*` routes, `csp-report` and `auth/callback`. The engage routes have good controls:

- honeypot
- magic-byte sniffing
- EXIF stripping
- `sharp` pixel cap (`lib/engagement/photo-metadata.ts:35`)
- IP-keyed fingerprint (`lib/engagement/public-submit.ts:58-66`), which Vercel protects from spoofing by overwriting `x-forwarded-for`, but which is spoofable if self-hosted behind a pass-through proxy.

**AI keys.**

- Lookup falls back from the workspace key to the deployment `ANTHROPIC_API_KEY` (`lib/integrations/anthropic-access.ts:27`, `workspace-keys.ts:158`).
- Provider turns accept `authMode: "deployment_api_key"` (`app/api/assistant/providers/turns/route.ts:21`).
- Hosted has no shared key today, so the operator spends nothing. If one is ever set, every signup can spend it.

**CSRF.** The two server actions get Next.js's origin check. API routes rely on the default SameSite=Lax Supabase cookies; there is no override in `lib/supabase`.

**NEXT_PUBLIC variables.** Only the Supabase URL and anon key, the Mapbox token (two names, read directly in 19 files), the site URL, the style URL and one worker flag. No secrets.

**SSRF.** None found:

- Artifact reads always pass a scope, which refuses remote URLs (`lib/models/artifact-source.ts:154-157`; every caller passes one).
- Probes go only to fixed hosts (`lib/integrations/probes.ts:80,106,134`).
- GTFS fetches have their own SSRF guards.

**What a fresh confirmed signup can do and cost.**

- `handle_new_user` creates a workspace, and `/api/workspaces/bootstrap` creates more with no cap.
- Each workspace gets its own AI allowance (only when a key exists).
- Model runs are unlimited unless `OPENPLAN_MONTHLY_RUN_CAP` is set (known). The shared Railway modeling host is bounded in dollars by the $40 hard limit, but not in queue time.
- Uploads are capped per file only: knowledge-base documents 100 MB, GTFS 200 MB, aerial images 64 MB, aerial artifacts 256 MB (`lib/http/body-limit.ts:33,62,71`). There is no per-workspace total.
- With Supabase's spend cap on, filling the quota restricts every tenant.

## 3. Correctness

**Error conventions.** Consistent: 2,793 `{ error }` responses against 20 `{ ok }`. 16 routes return the raw database `error.message`; the worst is `models/.../kpis/route.ts`, with 3.

**Unknown versus zero.** Typed states are widespread ("unavailable" 192, "unassessed" 33, "inconclusive" 36), but two places violate the rule:

- `lib/reports/catalog.ts:1011-1022` turns a missing funding need, gap or reimbursement into `0`, so a missing gap reads as fully funded.
- `lib/planner-pack/atp.ts:150-154` turns missing safety, equity, climate and total scores into `0`.

**Transactions.**

- 37 routes make three or more direct table writes; 43 use RPCs.
- Invoice line replacement is a hand-written compensating transaction: delete, insert, stamp, then restore on failure (`app/api/invoicing/client-invoices/[invoiceId]/route.ts:459-540`). A function timeout between the delete and the insert loses the lines.
- Invoice status rules exist only in the route (`:267`, `:566-582`). The `client_invoices` update policy checks membership only (`20260727000010:274-284`), and non-contract invoices have no guard trigger. A member can therefore edit a paid invoice directly through PostgREST using the shipped anon key.

**Copies of the receipts and custody pattern.**

| Pattern | Count |
|---|---|
| Receipt tables | 20 |
| Custody tables | 6 |
| Command tables | 8 |
| Attempt tables | 7 |
| Tables with lease, claim or heartbeat columns (separate job queues) | 14 |
| Distinct claim, heartbeat, complete, fail or reap RPC stems | 21 (map packages 5, GTFS ingest 4, contract calculation 3, provider turns 3, ...) |
| Tables with a hash or digest column | 100 |
| Tables with a request or command id column | 61 |
| Library files named custody, receipt or journal | 11, across 8 modules |

That is about 20 separately written durable-job protocols with no shared library.

**Time zones.**

- There is no workspace time-zone column.
- 39 places derive a calendar day with `toISOString().slice(0,10)`. Financial and legal dates are among them:
  - claim `submitted_on`: `measures/[measureId]/claims/route.ts:94`, `claims/[claimId]/route.ts:228`
  - allocation `stated_on`: `periods/[periodId]/allocate/route.ts:255,398`
  - invoice "today": `client-invoices/[invoiceId]/route.ts:564`
  - statement date: `statement/route.ts:450`
- All of these turn over to the next day at 5 p.m. Pacific.

**1,000-row PostgREST cap.** `max_rows = 1000` is set in `supabase/config.toml:14`.

- Heuristic count of read chains:
  - 578 list reads with no range, limit or paging, in 140 files
  - 293 bounded
  - 18 files use `lib/supabase/paged-read.ts`
- Confirmed defect: report generation reads engagement items in one request (`app/api/reports/[reportId]/generate/route.ts:965-970`, `:1734-1737`, used at `:1796`). That is the exact class the export route fixed (`engagement/campaigns/[campaignId]/export/route.ts:181-206`).
- The campaign list has the same problem (`engagement/campaigns/route.ts:94-99`, item counts).

## 4. Action registry

- **Size.** 12 actions (`lib/runtime/action-registry.ts:304-317`), compared with 343 routes.
- **Where it runs.** The registry runs in the browser: `executeAction` calls `fetch` on relative paths (`:40-64`).
- **Server enforcement.** The server checks approval only when the request declares itself as agent-sourced through a header (`lib/assistant/action-approval-server.ts:241-243`, `:288-290`). Without the header, the write is recorded as user-authored.
- **What the binding does.** Once declared, the hash and single-use binding is sound (`:311-375`), and 23 routes call the verifier.
- **What it means.** The registry is an authorship and consent protocol, not a security boundary. An agent running in the browser can skip it.
- **Writes outside the registry.** Map-package readiness through service-role RPCs (known), the provider connector routes (bearer-scoped and with no business writes, per `assistant/providers/native/route.ts:19-20`), and every write route not among the 12 actions.

## 5. Duplication and largest files

**Copied helpers.** 55 non-exported helper names are defined in four or more files, which adds up to 259 redundant copies:

- `asNumber` 19
- `asRecord` 16
- `asString` 12
- `requireMatch` 12
- `formatCurrency` 10
- `sha256` 8
- `formatAmount` 8
- `membershipErrorResponse` 7

There are 21 authorization helper variants, and 82 files query `workspace_members` directly.

**Invoice and claim families.** Five separate money families exist: `billing_invoice_records`, `client_invoices`, `contract_received_invoices`, `work_program_reimbursement_claims` and `measure_claims`.

**Largest non-generated files.**

| File | Lines |
|---|---|
| `lib/assistant/context.ts` | 4,077 |
| `lib/assistant/respond.ts` | 3,246 |
| `app/api/reports/[reportId]/generate/route.ts` | 2,776 |
| `lib/assistant/operations.ts` | 2,710 |
| `lib/operations/workspace-summary.ts` | 2,612 |
| `lib/reports/html.ts` | 2,136 |
| `app/api/models/[modelId]/runs/route.ts` | 1,559 (22 direct writes) |

## 6. Data model

Projects are a partial spine. Plans are not a single spine: there are three separate plan concepts, `plans`, `land_use_plans` and `rtp_cycles`. `plan_links`, `program_links` and `model_links` are polymorphic `linked_id` links with no foreign key, kept clean by triggers (`20260727000007`).

| Module | Tables | Tables with a project foreign key |
|---|---|---|
| Measures | 11 | 0 |
| OWP and work programs | 18 | 0 |
| GTFS | 6 + 12 private | 0 |
| Network packages | 5 | 0 |
| Title VI | 1 | 0 |
| VMT screening | 1 | 0 |
| RTP | 7 | 0 (links only through `project_rtp_cycle_links`) |
| Land use | 19 | 1 |
| Contracts | 30 | 2 |
| Engagement | 62 | 2 |

The islands are measures, OWP, GTFS, network packages, Title VI and VMT. Measure claims cannot be tied to the projects they fund, which works against the contract requirement for "measured project outputs."

## 7. Hardcoded California and US values

**Mostly sound.** California content sits in labeled adapters (`us-ca.ts` packs, `lib/safety/sources/ccrs.ts`). The stage-gate fallback is the federal floor, not California (`lib/stage-gates/template-registry.ts:392`).

**One defect.** The US federal grant bundle carries Caltrans-specific guidance. It names Caltrans 41 times, including HSIP's Caltrans LRSM benefit-cost tool (`lib/grants/programs/us-federal.ts:15-90`), plus `:360` and `:430`. A planner in Ohio is told to check with Caltrans.

**US-only assumptions in core.** `"en-US"` appears in 175 files, `"USD"` in 17, and Census GEOID logic in 31 library files.

## 8. Backend tests

- **Size.** 1,676 test files, 386,466 lines, about 15,251 cases, 0 skipped.
- **Mocked versus live.** 345 test files mock the Supabase server client; 11 hit a live database.
- **SQL tests.** 151 files assert on migration SQL as text without running it.
- **Route coverage.** 257 test files import a route. 48 routes (14 percent) are named by no test, including 6 measures money routes (`recipients`, `periods`, `allocation-rules`, `basis-values`, `claims/[claimId]/documents`, `POST /measures`), 5 work-program routes, 6 land-use-plan writes and 6 invoicing-management routes.

## 9. Top 20 ranked by risk to the public deployment

1. **Anonymous Storage exhaustion.** The photo throttle is an in-memory `Map` per instance (`lib/engagement/photo.ts:120-139`, 15 per 10 minutes). Bytes are stored before any comment exists (`engage/[shareToken]/photo-upload/route.ts:147-151`), and no cron sweeps orphans (`vercel.json:18-30`). *Fix:* move the throttle to a database-counted limit, store photos under a pending prefix with a sweep, and add a byte budget per campaign.
2. **Engagement vote inflation (known, confirmed).** A browser-minted device token mints a fresh voter identity (`vote/route.ts:189-216`).
3. **Anonymous subscribe sends email to any address.** 12 per 10 minutes per IP per campaign (`subscribe/route.ts:56-92`, `public-submit.ts:9`). If the Vercel `RESEND_API_KEY` is the same free-plan Resend account that Supabase uses for SMTP, a flood exhausts the 100-per-day quota and blocks signup confirmations and password resets. `[VERIFY: whether Vercel has RESEND_API_KEY set]`. *Fix:* daily caps per campaign and per address, and a separate sender.
4. **Spend scales with the number of workspaces.** Workspace creation is unbounded, the AI limiter is per workspace and fails open, and there is a deployment-key fallback and a `deployment_api_key` mode (`ai-rate-limit.ts:63-99`, `anthropic-access.ts:27`, `providers/turns/route.ts:21`). *Fix:* limit per user and per installation, reserve atomically before the call, fail closed when a deployment key is in use.
5. **Run caps default to unlimited (known, confirmed)** (`run-cap.ts:80-86`).
6. **No per-workspace or per-user storage quota.** Per-file limits only (`body-limit.ts:33,62,71`). *Fix:* a `workspace_storage_usage` ledger checked before any upload URL is issued.
7. **Board packets understate engagement past 1,000 comments** (`reports/[reportId]/generate/route.ts:965-970`, `:1734-1737`; `engagement/campaigns/route.ts:94-99`). *Fix:* use `readEveryPage` with its `complete` refusal, and add a guard test that fails on unpaged list reads of growable tables.
8. **OWP and contract money defects (known, all five confirmed as cited):** `20260909000001:127`, `20260910000001:147`, `20261003000001:198-202`, `20260912000004:164`, `20260912000003:64`.
9. **Map package marked ready through service-role calls outside the registry, and the funding opportunity is checked for workspace but not project (known)** (`20261017000001:178-179`; `map-packages/[packageId]/upload/route.ts:34`).
10. **Invoice line replacement is not atomic** (`client-invoices/[invoiceId]/route.ts:459-540`). *Fix:* a single plpgsql RPC.
11. **Business rules exist only in routes, on tables members can write directly.** Invoice status and draft-only line edits are the example (`20260727000010:274-284` against the route at `:267`, `:566-582`). The write-role gate covers 192 policies on 80 tables, but only for role, not state. *Fix:* BEFORE UPDATE guard triggers for terminal states.
12. **Unknown becomes zero in funding snapshots and ATP scores** (`lib/reports/catalog.ts:1011-1022`, `lib/planner-pack/atp.ts:150-154`).
13. **UTC calendar dates on claims, allocations and invoices**, extending the known chat and grant item (claim routes `:94`, `:228`; `allocate/route.ts:255,398`; invoice `:564`). *Fix:* a workspace time-zone column and one `todayInWorkspace()` helper.
14. **`OPENPLAN_INTEGRATION_KEY_SECRET` has no rotation (known)** (`key-crypto.ts:15`).
15. **Caltrans guidance in the federal grant bundle** (`lib/grants/programs/us-federal.ts:15-90,360,430`). *Fix:* move the state pass-through text into state adapters.
16. **Any account writes the shared `census_tracts` through the service role** (`geographies/census-tracts/ingest/route.ts:52-76`). *Fix:* require a writer role and add a per-user limit, or make it operator-only like equity ingest.
17. **RLS-only GET with no 401, and raw database errors in 16 routes** (`connectors/route.ts:8-31`).
18. **Role oracle.** `contract_snapshot_can_read` and `contract_calculation_job_visible` are granted to `authenticated` with a caller-chosen actor id (`20260915000002:3-7`, `20260916000001:13-17`). A user can learn another user's contract role. *Fix:* wrap them so the caller's own `auth.uid()` is used, and revoke the two-argument form.
19. **Self-host only: links and the self-fetch target come from the request Host.** Subscribe links (`subscribe/route.ts:84`), invitation links (`workspaces/invitations/route.ts:226`) and a server-side POST that forwards the cookie (`models/[modelId]/runs/route.ts:1373-1377`). *Fix:* use `NEXT_PUBLIC_SITE_URL`.
20. **Test blind spots.** 151 SQL-text test files, 345 mocked against 11 live, the 48 untested routes above, and no shared job-queue library behind the 20 hand-written protocols.

## What is good and should be kept

- RLS on every table with live guards.
- Default-deny table grants (`20260804000001`) and blanket re-grants that compose back (`20260804000002`).
- The restrictive write-role gate (`20260728000006`).
- Security-definer functions with `search_path` set everywhere, explicit revokes, and `auth.uid()` guards.
- Invitation acceptance that requires an email match (`workspaces/invitations/accept/route.ts:91-99`), with the RPC restricted to the service role.
- The operator-token gate on equity ingest.
- Public-upload hardening: magic bytes, EXIF stripping, pixel cap.
- Scoped artifact reads.
- Body limits and zod on most routes.
- Approval hash binding.
- `readEveryPage` with an explicit `complete` flag.
- Additive migrations with labeled backfills.
- Honest outcome copy in public responses.

## What I could not determine

- Live Vercel environment values (`RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `OPENPLAN_MONTHLY_RUN_CAP`).
- Native behavior of any finding.
- Whether the 578 heuristic unbounded reads include more defects like item 7. I confirmed only the engagement cases.
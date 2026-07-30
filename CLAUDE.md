# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**OpenPlan** — a free, open-source, AI-powered **operating system for planners**. It brings transportation demand modeling, community-engagement mapping (a SocialPinpoint-style public-input platform), and project + grant management into one workbench for the people who plan and build communities: RTPAs, MPOs, cities, counties, state agencies (e.g. Caltrans), planning and environmental consulting firms, tribes, non-profits, and independent planners. The goal is one all-in-one system for transportation, urban, city, environmental, and land-use planning — the operating system for planners of the future.

**Stack:** Next.js 16 (App Router) · React 19 · Supabase (Postgres + PostGIS + Auth + Storage) · Mapbox GL JS v3 (direct, not react-map-gl) · Claude API via Vercel AI SDK · TypeScript · Tailwind CSS v4 · shadcn/ui · Vercel.

## Product non-negotiables — READ BEFORE PLANNING ANY WORK

These are binding constraints from Nathaniel, not preferences. They have been violated before; do not
violate them again. If a proposed task conflicts with one of these, say so and propose an alternative
instead of proceeding.

**0. NOTHING IS HARDCODED. Ever.**
No place, jurisdiction, agency, or organization may be baked into code as a constant. Anything that
varies between users is **configuration or data**, never a literal. If you find yourself typing a
county name, a bounding box, a FIPS code, an agency name, a specific coordinate, or "58" because
California has 58 counties — stop, and make it a parameter, a registry entry, or a database row.

The test: *could a planner in a different place, with different data, use this without a code
change?* If not, it is hardcoded, and it is a defect.

**And the architecture must not assume the United States.** The US is the current scope; **worldwide
is the eventual target**, so anything country-specific — FIPS codes, Census/ACS, TIGERweb, KABCO
severity, state DOT feeds, CCRS — belongs behind an adapter or registry, never in a core type or a
shared schema. Adding a new country, state, or data source should mean adding a descriptor, not
editing call sites. Core concepts (a study area, a crash, a claim tier) must stay
jurisdiction-neutral.

**1. It must work for ANYONE in the United States today. All of California is the floor.**
No feature ships fitted to one county, one agency, or one pilot. A planner in Ohio, Texas, or Fresno
must be able to select their own geography and have the feature work — or be told plainly and
specifically that their area is not covered and why.

- **Never hardcode a study area.** No baked-in Nevada County / NCTC / Grass Valley bboxes, county
  codes, coordinates, or FIPS. A map's initial camera position may default to the continental US
  (`CONTINENTAL_US_CENTER`); the *analysis geography* must always come from the user.
- **Reuse the existing any-place front door** — `src/lib/geographies/place-resolver.ts`,
  `/api/geographies/places`, `/api/geographies/place-boundary`, and
  `src/components/models/study-area-picker.tsx` (TIGERweb-backed: county / place / CDP / metro / micro).
  Do not invent a second geography selector.
- **Geographic limits must be disclosed, never silently applied.** Where a data source genuinely
  cannot cover an area (e.g. CCRS crash data is California-only), the UI states the limit and the
  reason. An empty result must never be presentable as "nothing found here".
- A single-state or single-source capability is acceptable ONLY if it is labeled as such and the app
  degrades honestly outside it.

**2. Deepen and connect the existing modules. Do not add new ones.**
OpenPlan already has ~16 modules and none is finished. The work is making them deeper and making them
compose — a planner should carry one piece of work across modules without re-entering it. Proposing a
new module is almost always the wrong answer; extending an existing one is almost always right.

**3. Build the product; do not plan outreach.**
Do not propose conferences, pilots, lighthouse users, demos, design partners, or "get one agency to
try it". Nathaniel drives all outreach and has explicitly cancelled that lane. The app must be good
enough for any agency or consultant to use fully and unaided **before** it is shown to anyone.

**4. Self-service is the bar, and it is now the official product posture.** Any agency, MPO/RTPA,
city, county, tribe, non-profit, or private planning/environmental consultancy — anywhere in the
United States — must be able to sign up and use OpenPlan fully on their own: their geography, their
data, no founder involvement, no hand-configured environment, no access queue. When a change requires
operator setup or a manual step, that is a defect to be designed out, not a documented workaround.

**Decided 2026-07-23 (Nathaniel):** the product is **self-serve**. The earlier "not self-serve,
request-access, founder fit-review" posture was introduced unintentionally and is **reversed**. The
public site should offer real sign-up, a workspace should be usable by a whole team without founder
involvement, and `/request-access` is no longer the intended front door.

**5. OpenPlan is free and open source. There is no paid tier and no payment step.**
**Decided 2026-07-23 (Nathaniel):** the Stripe/billing subsystem is **legacy** and not part of the
product. **REMOVED 2026-07-24:** `src/lib/billing/*`, `src/app/api/billing/*`, the checkout
components, the Stripe env vars, and the entire plan/quota/subscription seam are **deleted**. Do not
reintroduce them, and do not add plan/subscription gating to any new feature.

Why it mattered: `workspaces.plan` defaulted to `'free'`, which was not a case in the plan enum, so
every self-serve workspace normalized to "unknown" and inherited a **100-run monthly cap** that hard-
429'd corridor analysis, report generation, model runs, scenario comparison, and network ingest —
with no way to pay for more, because checkout was disabled *because the product is free*. Five of
those routes also answered **402 Payment Required** when `subscription_status` left the active set.
A free product may not ration its own core features.

What replaced it: `src/lib/config/run-cap.ts` — one OPTIONAL operator env cap
(`OPENPLAN_MONTHLY_RUN_CAP`), **unset = unlimited**, which skips the counting query entirely. It is
configuration for whoever runs a public deployment, never a tier, and its refusal names the operator
instead of offering an upgrade. `src/test/no-paid-tier-guard.test.ts` fails the build if a
`@/lib/billing/*` import, a plan/quota/subscription symbol, or a `402` reappears in `src/`.

Two things that lived under `billing/` were NOT billing and survived the deletion — do not confuse
them with it: **`billing_invoice_records`** is Caltrans **LAPM grant-reimbursement invoicing** (the
agency invoicing *its funder*), now `src/lib/invoicing/` behind `/invoicing`; and
**`ai-rate-limit.ts`** is plan-independent abuse protection on Anthropic spend, now
`src/lib/runtime/`. The Stripe tables and the `workspaces.plan` / `subscription_*` columns are left
in the database deliberately — dead schema no code reads is inert, and dropping it is irreversible
against a hosted database.

**COMMERCIAL SURFACE REMOVED 2026-07-24 (Nathaniel: "No more pricing. No more stripe. that's all
old. open source and free.").** `/pricing`, `/request-access`, and `/contact/openplan-fit` are
**deleted**, along with the Stripe paid-canary scripts and every managed-hosting / service-lane /
fit-review claim on the public site, in both READMEs, in CONTRIBUTING/SECURITY, and in the social
preview image. `/contact` survives as a plain, non-commercial help page — it is NOT a way to get
access, because nothing gates access. The assistant no longer announces a "plan tier" in its own
system prompt. `src/test/no-paid-tier-guard.test.ts` fails the build if a pricing route, a
request-access link, or managed-hosting/service-lane/subscription copy reappears on any public page.

Two things that SOUND commercial are not, and must survive: **`src/lib/invoicing/`** is Caltrans
LAPM grant-reimbursement invoicing (the agency invoicing *its funder*), and
**`src/lib/runtime/ai-rate-limit.ts`** bounds Anthropic spend. Neither charges anyone for OpenPlan.

**HISTORICAL COMMERCIAL-ERA DOCS DELETED 2026-07-27 (Nathaniel's explicit decision, reversing the
earlier "leave dated records alone" rule).** `docs/sales/` (all of it), the three 2026-05-10 anchor
proofs, the supervised-pilot/billing/launch-boundary memo clusters in `docs/ops/` and
`openplan/docs/`, and `sales-proof-claim-boundaries.test.ts` + `managed-support-proof-map.test.ts`
are **gone from the working tree — git history is the archive**. Do not restore them, and do not
recreate a sales/proof-packet lane. What was KEPT: every technical record describing systems still
in the code (modeling specs and validation evidence, county-onramp contracts, LAPM/stage-gate
provenance, security/hardening proofs, current-era shipped handoffs) — see `docs/README.md` for the
map. Rewriting a surviving dated technical record to say something it didn't say when written is
still falsification; delete or supersede, never rewrite history.

**Posture flip status (as of 2026-07-23): DONE.** The capability, the claims, and the guard were
flipped in sequence, in this order — never claim ahead of capability:

1. **Capability built:** sign up → workspace auto-provisioned by the `on_auth_user_created` trigger
   (`handle_new_user`) → teammate invites (dashboard team panel, `/api/workspaces/invitations`
   GET/POST/DELETE) → password recovery (`/auth/callback`, `/forgot-password`, `/reset-password`).
   All free, no founder, no payment.
2. **Claims changed:** the landing hero and header (`src/app/(public)/page.tsx`, `layout.tsx`) lead
   with "Create your free workspace" → `/sign-up`.
3. **Guard rewritten to the NEW truth:** `src/test/public-page-claims-guardrails.test.ts` now asserts
   the front door leads with self-serve sign-up and that no founder gate is reinstated — while KEEPING
   the modeling-overclaim and no-paid-checkout prohibitions (the product is free and still
   screening-grade). It was rewritten, not deleted.

**`sales-proof-claim-boundaries.test.ts` is deleted (2026-07-27)** along with the dated proof
packets it scanned. The honesty gates that matter now all scan LIVE surfaces:
`no-paid-tier-guard.test.ts`, `public-page-claims-guardrails.test.ts`,
`public-open-source-posture-guardrail.test.ts`, and the per-module claim guards (e.g.
`safety-claim-boundaries.test.ts`). New modules add their own claim-boundary guard over `src/`,
never a docs-scanning one.

## The ultimate goal — agentic control of OpenPlan (DEFERRED, do not start)

**Decided 2026-07-28 (Nathaniel). This is the destination the product is being built toward.**

A planner clicks the Planning Agent and can drop into a **Buzz workspace connected to OpenPlan that
completely controls it** — the way an agentic coding agent controls a repository. `block/buzz` (Block Inc.,
Apache 2.0, released 2026-07-21) is a self-hosted Rust/Nostr workspace where agents join as members with
their own keypairs and narrowly scoped authorization.

The reasoning is sound, and worth restating because it is the whole thesis: **planning narrative has the
same shape as code.** Drafts get reviewed. Every claim carries provenance. Approval gates stand between a
draft and something official. There is an append-only record of who changed what and why. And OpenPlan
already has the planning analogue of a test suite — the `[fact:id]` grounding machinery and the claim
tiers are what tell an agent whether its own output is defensible.

**IT IS DEFERRED UNTIL THE EXISTING MODULES ARE FULLY DEVELOPED — by Nathaniel's own call.** Do not start
building it. No Buzz integration, no Nostr, no second backend, until he says the modules are mature. If a
task drifts toward it, say so. He asked to be **reminded frequently that he still wants this** — raise it
at roadmap milestones, when a module is declared done, and when he asks what is next. The risk being
guarded against is forgetting the destination, not scope creep toward it.

**Two settled points. Do not re-litigate either.**

- **It does not violate non-negotiable #4.** Self-serve governs the BASE product — sign up and use
  OpenPlan unaided — not every optional advanced capability. An agency technical enough to run
  Docker/Rust/Redis/MinIO can opt in; Nathaniel also intends to offer paid setup for those who cannot,
  which is his consulting lane and touches no code. **The binding condition is that OpenPlan must remain
  fully functional with no Buzz instance anywhere.** Buzz attaches as a layer; it is never a dependency
  the app assumes.
- **It does not violate non-negotiable #2** *(deepen, do not add modules)*, because it is not a planning
  module. It is a control surface over the modules that already exist — which is exactly why it must come
  after they are deep, not before.

**What to do NOW, because it costs nothing and is the entire bridge.** The seam between today and that
future is the action registry: `src/lib/runtime/action-metadata.ts`, from which `buildAssistantOperations`
derives the `propose_*` tools, gated by `assistant_action_approvals` and
`src/lib/assistant/action-approval-server.ts` (input-hash verified, so what a planner approves is provably
what they saw). As of 2026-07-30 the registry holds **8 actions**: seven in the grants/reports/projects
lane, plus `record_stage_gate_hold` in the stage-gate spine. Still nothing for models, engagement,
scenarios, safety, RTP chapters, or the knowledge base.

> **Every new write capability gets an action-registry entry when it ships.** This is part of the
> definition of done for a feature, not separate work. Doing it makes the eventual agentic layer a switch;
> skipping it makes it a year-long retrofit across twenty modules.

**"One entry, four fields" was wrong, and knowing the real cost is what makes the rule keepable.**
Measured by mutation on 2026-07-30 while adding `record_stage_gate_hold`: adding a union variant to
`AssistantQuickLinkExecuteAction` makes the build fail in exactly **two** places (the mapped types over the
union in `action-metadata.ts` and `action-registry.ts`) plus an undocumented one — every variant must
declare `postActionWorkflowId?`, `postActionPrompt?`, `postActionPromptLabel?`, because `executeAction()`
reads them off the whole union unguarded. Satisfying the compiler is **not** enough: a "registered" action
with no zod branch, no route-side verification and no audit call type-checks fine and executes with the
approval tier enforced only in the browser. The honest cost of one action is **eight files**:

1. `src/lib/assistant/catalog.ts` — the union variant + the three post-action fields.
2. `src/lib/runtime/action-metadata.ts` — the metadata entry (five fields: `kind`, `description`,
   `approval`, `auditEvent`, `regrounding`).
3. `src/lib/runtime/action-registry.ts` — the `ActionRecord` with its fetch effect, **and** the map entry.
4. `src/lib/assistant/action-approval-server.ts` — a zod branch in `assistantApprovalActionSchema`,
   hand-maintained and not checked against the TS type. Without it the action gets no `propose_` tool.
5. `src/lib/assistant/chat-tools.ts` — a `PROPOSAL_REFERENCE_CHECKS` entry (optional; omitting it silently
   skips the workspace-scoped ownership checks).
6. **The target API route** — `verifyAssistantActionApproval` + `withAssistantActionAudit`. Now enforced by
   `src/test/every-action-route-verifies-its-own-approval.test.ts`, which resolves each action's route from
   the effect's own source and asserts the **call**, not the import.
7. `src/app/(app)/assistant-activity/page.tsx` — the ledger label.
8. A `quickLink({ executeAction })` call site in `src/lib/assistant/operations.ts` — without one the action
   exists only as a chat tool and no planner can reach it. Prove reachability with a test that drives
   `buildAssistantOperations`, **and build that test's context from the real summary builder, never from a
   hand-written fixture.** `record_stage_gate_hold` shipped with a condition no board could satisfy — it
   required a gate that was `not_started` AND carried `missingArtifacts`, and `buildProjectStageGateSummary`
   copies `missingArtifacts` off the latest DECISION row, so `not_started` (no decision) forces it empty.
   The offer could never render for anyone and its reachability test passed, because the fixture described a
   board the product cannot produce. A described fixture proves the assertion; only a built one proves the
   feature. (Fixed 2026-07-30: `StageGateSummaryItem.requiredEvidenceIds` is what the TEMPLATE asks for and
   is knowable with no decision recorded; `missingArtifacts` is what a decider WROTE DOWN. Do not confuse
   them again.)

**And the approval hash must cover the EXECUTED payload, not the offered one.**
`/api/assistant/actions/approvals` hashes the whole `executeAction`; every route hashes the action it
rebuilds from its own parsed BODY. `postActionWorkflowId` / `postActionPrompt` / `postActionPromptLabel`
exist only in the first — they steer the copilot's follow-up prompt and reach no route — so hashing them
made the two disagree and answered **403 after the planner had already approved**, on the gate hold and on
the four funding/invoicing quick links that predate it. `hashAssistantActionPayload` now strips them via
`executedActionPayload`; the chat path had always stripped the same three (`PROPOSAL_HIDDEN_INPUT_FIELDS`),
which is why only quick links were broken. Any new presentation-only field on an action must be added to
`NON_EXECUTED_ACTION_FIELDS` or it will do this again.

Plus the two test files carrying hardcoded action lists — `action-registry.test.ts` and
`action-audit-live-loop.test.ts` (a `toHaveLength(n)` and two full sets). `assistant-chat-tools.test.ts`
derives its list from `ACTION_METADATA` and so needs no edit; it is the test that catches a **missing zod
branch**, because a kind with no branch gets no `propose_` tool.

**Refused deliberately on 2026-07-30 — do not register these without re-arguing them.** Accepting a
machine translation (`translations` route, `accept`) is a provenance promotion an agent must never make:
it turns model output into the agency's own Spanish, deletes the caveat a resident was reading, and
rewrites `created_by` to the approver — in the one context where language access is legally binding.
Publishing machine wording (`publish_machine`) puts model sentences on a public portal under an agency's
name. Saving operator translations (`save`) is the agency's own words in a Title VI context, up to
25 × 8,000 characters, which is not reviewable in the approval sheet. Importing offline comments
(`items/import`) would let a model author up to 4 MB of public record. The submission geofence toggle would
let an agent narrow who may comment — and an agent optimizing for a clean comment set has a standing
incentive to do exactly that. The campaign accessibility contact was refused too, though it looks benign:
every other registered action's payload is an id the agent verified against a workspace row or an enum,
while this one would be the first whose consequential content the model authors from **outside** the
system — a published ADA/Title VI commitment whose only control is the approver noticing a plausible wrong
phone number. The safe shape exists (copy from a sibling campaign, with the route verifying the values
against the source row so the model cannot author them) and is worth building as its own change.

**The two guardrails — both now STRUCTURAL, as of 2026-07-30. Do not weaken either.**

1. **The agent is a distinct principal, never an impersonation.** Buzz's sharpest idea is that
   *authorization does not erase authorship*. **Built:** `src/lib/assistant/agent-principal.ts` defines the
   principal (`openplan.planner_agent`); migration `20260730000006` adds `actor_kind`, `actor_agent_id`,
   `approved_by_user_id` and `approved_at` to `assistant_action_executions`, with CHECKs that make an
   agent-authored row with no principal, and a half-recorded consent, unstorable.
   `verifyAssistantActionApproval` returns the authorship it derives from the consumed approval row, and
   `assistantActionAuditIdentity()` spreads all of it into the ledger in one go so a route cannot thread
   three fields and forget the fourth. `user_id` keeps its old meaning — the session the write ran under —
   and is NOT the author. A `safe`/`review` agent action records the agent as author with a null approver,
   because nobody consented; that null is the honest answer, not a gap. Guarded by
   `src/test/planner-agent-is-a-distinct-principal.test.ts`.
   **Both sides of the deploy/migrate window degrade, and they must stay symmetric.** The read
   (`loadAssistantActivityRows`) falls back and reports `authorshipAvailable: false`. The WRITE was left
   without a fallback at first, which meant a deployment between the code and `20260730000006` wrote **no
   ledger row at all** — PostgREST fails the whole insert on an unknown column, and the only consequence was
   a `console.warn`. A silent hole in the audit trail is worse than a row that cannot name its author, so
   `recordAssistantActionExecution` now retries without the four columns on PGRST204/42703 **naming an
   authorship column specifically** — never on a constraint or permission failure, which must surface as
   itself.
   **Still open:** most domain rows record only the person. `stage_gate_decisions.metadata.authorship` now
   carries it (that row is a signed verdict a funder relies on); `funding_opportunities.created_by`,
   `engagement_content_translations.created_by` and the rest do not. Add it as each lane is touched.
2. **An agent may never promote a claim tier.** The honesty firewall is what makes OpenPlan defensible; an
   agent that can mark its own run `calibrated_to_counts` destroys it. Agent proposes, evidence decides.
   **Built:** `src/test/an-agent-may-not-promote-a-tier.test.ts` derives the tier vocabulary from
   `MODELING_CLAIM_STATUSES` and from the migrations (every `CHECK (col IN (…))` whose vocabulary is a tier
   vocabulary — which finds `claim_status`, `claim_status_source` and
   `engagement_content_translations.source`), then fails if any registered action's payload names a tier
   field or carries a tier value, or if **anything the action's route can reach** writes one. It generalizes
   past modeling on purpose: promoting a machine translation to `source = 'operator'` is a provenance
   promotion wearing another module's name, and it is refused by the same guard.
   **Reading `route.ts` alone is not a boundary, and the first version of this guard did exactly that.**
   Every route here delegates its writes to a lib, so moving `claim_status` one function away — an ordinary
   refactor, not an evasion — moved it out of the guard; proven by mutation (making the stage-gate route
   call `refreshCountyRunModelingEvidence`, which inserts `claim_status`, left the file-only guard green).
   It also read only string-literal values, so a row builder with `claim_status: nextTier` passed. Both are
   closed by `src/test/helpers/reachable-write-surface.ts`, which walks the called imported symbols out of
   the route into their function bodies and extracts written columns by balanced-delimiter parsing —
   single-line, array-of-rows and identifier (`const row = {…}; …upsert(row)`) forms included. Its own
   extraction is unit-tested, because a broken walk would make every assertion above pass by finding
   nothing.

**A third rule this work established — a narrow action may not ride a wide route.** The approval hash
covers the ACTION the route reconstructs, not the request body, so a request carrying the action's fields
*plus* extra ones hashes identically to what the planner approved and writes the extras too. The planner
approves three fields and the campaign's status also changes. Use
`refuseOutOfScopeAgentRequest` (`src/lib/assistant/agent-request-scope.ts`) in any route where the endpoint
is wider than the action.

**One mechanical note on the consulting lane.** Nathaniel doing paid setup privately requires no code
change. But `src/test/no-paid-tier-guard.test.ts` fails the build on `/managed hosting/i` and
`/managed services?\b/i` appearing on any PUBLIC page. Advertising setup services inside the product is
therefore a deliberate change to that guard, made as its own decision — never worked around, and never
tripped by accident mid-feature.

## Engineering Philosophy

OpenPlan is intended to become one of the most sophisticated planning software platforms ever built.

Speed is valuable, but correctness, maintainability, clarity, and extensibility are more important. Every implementation should be approached methodically and deliberately. Never rush simply to complete a task. Instead:

- Thoroughly understand the existing architecture before making changes.
- Read relevant modules before modifying them.
- Identify interactions between subsystems.
- Consider long-term consequences of architectural decisions.
- Prefer careful design over quick implementation.
- When uncertainty exists, investigate rather than assume.
- Document reasoning behind significant technical decisions.
- Build systems that will still make sense ten years from now.

Take the time necessary to produce excellent work.

## Repository First Principle

Treat the repository as a living body of knowledge. Before writing a single line of code:

- Read the surrounding modules.
- Understand existing conventions.
- Identify architectural patterns.
- Locate related functionality.
- Determine whether similar code already exists.
- Understand why previous developers made certain decisions.
- Avoid introducing duplicate concepts.
- Avoid creating parallel implementations.
- Prefer extending existing systems over inventing new ones.
- If existing architecture appears flawed, determine whether it is intentionally designed that way before replacing it.

Every change should make the repository more coherent than before.

## Think Before You Code

You are expected to spend substantial effort thinking before implementation. Before every significant task:

1. Understand the problem.
2. Explore the repository.
3. Identify all affected modules.
4. Consider multiple implementation strategies.
5. Compare tradeoffs.
6. Select the best long-term solution.
7. Explain your reasoning.
8. Only then begin implementation.

Reasoning time is never wasted. Avoid "first solution bias." Assume there is usually a better design than the first one that comes to mind.

## Architectural Self-Critique

Before considering any implementation complete, perform an internal design review. Ask yourself:

- Is this the simplest correct solution?
- Does this duplicate existing functionality?
- Can the design be generalized?
- Does it violate existing architectural patterns?
- Will another developer understand this in five years?
- Is this solution extensible?
- Is there unnecessary complexity?
- Is there a cleaner abstraction?
- Would this scale to thousands of organizations and millions of records?

If a substantially better solution exists, recommend it before implementation.

## Cathedral Philosophy

OpenPlan should be built like a cathedral rather than assembled like a startup prototype.

- Every subsystem should feel intentional.
- Every API should feel thoughtfully designed.
- Every database table should have a clear purpose.
- Every interface should appear coherent with the rest of the platform.
- Avoid temporary solutions unless they are explicitly documented as temporary.

Assume this software will still be actively developed decades from now. Design for future developers — including future AI agents — to understand not only what was built, but why it was built.

Progress is measured by architectural quality, coherence, correctness, and long-term value — not by lines of code written or features completed.

## Git workflow — one clean `main`

Nathaniel wants **exactly one clean `main`**: no long-lived branches, no open PRs, nothing dangling. Review is done by an **agent (Claude), not a human** — do not wait on human PR review. Once a change is written and verified (lint + tests + build green, plus the relevant `workers/**/test_*.py` script for Python changes — see Commands; there is no pytest), **land it on `main`, push, and keep everything synced**; delete any working branch afterward. A short-lived working branch during a single change is fine, but converge back to `main` — keep all OpenPlan work consolidated on `main` unless there is a genuinely strong reason to hold something on a branch (and if so, say why).

## Critical gotchas

- **The Next.js app lives in `openplan/`.** There is no root `package.json`, so run every `npm`/`supabase` command for the app from that subdirectory. The one other npm project is `qa-harness/` (Playwright browser smoke checks, its own `package.json` + 25 `local-*`/`prod-*` scripts) — run those from `qa-harness/`, not `openplan/`.
- **Package manager is npm** (`packageManager: npm@11.11.0`), not pnpm — despite historical proof logs citing `pnpm`. The one exception: `qa:gate` deliberately shells `corepack pnpm@10.33.0 audit` for the dependency audit. Don't "fix" that to npm.
- **`build` uses the webpack builder** (`next build --webpack`), not Turbopack. If you run `next dev` from a git worktree with a symlinked `node_modules`, Turbopack rejects the symlink — use `next dev --webpack`.
- **Python modeling workers live in `workers/`** (not `openplan/`) — the AequilibraE screening worker, county onramp, and ActivitySim scaffold.
- **There is no pytest in this repo.** The worker suites are dependency-free stdlib scripts, each run directly: `python3 workers/aequilibrae_worker/test_count_validation.py`. Run them all with `for f in workers/aequilibrae_worker/test_*.py; do python3 "$f" || break; done` (17 files). `pytest` is not installed and not in any `requirements*.txt`.
- **`npm exec` swallows `--` flags.** `npm exec supabase gen types typescript --local` fails with *"Must specify one of --local, --linked…"* because npm consumes the flag. Use `npm exec -- supabase …` whenever passing a flag.
- **Prefer `supabase migration up` over `db reset` locally.** `db reset` re-applies every migration from scratch and destroys local data (seeded workspaces, runs, in-flight session state). `migration up` applies only the new ones and is non-destructive.

## Commands (run from `openplan/`)

```bash
npm run dev            # dev server, localhost:3000
npm run build          # production build (webpack)
npm test               # vitest unit tests
npm run test:watch     # vitest watch
npm run lint           # eslint
npm run qa:gate        # lint + test + pnpm audit + build — the full pre-ship gate
npm run test:rls-live  # live RLS-isolation test (needs OPENPLAN_RLS_LIVE_TEST=1, set by the script)

npm exec -- supabase start           # local Supabase stack
npm exec -- supabase migration up    # apply NEW migrations only (non-destructive — prefer this)
npm exec -- supabase db reset        # re-apply ALL migrations; DESTROYS local data
```

**Supabase clients are intentionally untyped — there is no `supabase gen types` step.** `src/types/supabase.ts`
does not exist, nothing imports a generated `Database` type, and the three factories in
`src/lib/supabase/{client,server,middleware}.ts` take no type parameter. This is a documented convention,
not an oversight: `src/lib/knowledge-base/documents.ts:4-6` states it — *"the passed-in Supabase client is
typed loosely and query results are cast, avoiding the Database generic"* (see also `src/lib/models/api.ts`).
Do not add a type-regeneration step to a schema change; the output would have no consumer. The practical
consequence: `.select()` strings are **not** type-checked against the schema, so a column typo surfaces at
runtime rather than at build — cast query results deliberately. Adopting generated types would mean threading
a `Database` generic through every client, which is a deliberate architectural change, not a chore.

Python worker tests (from the repo root, not `openplan/`):

```bash
python3 workers/aequilibrae_worker/test_count_validation.py           # one suite
for f in workers/aequilibrae_worker/test_*.py; do python3 "$f" || break; done   # all 17
```

Run a single test: `npm test -- src/test/<file>.test.ts` or `npm test -- -t "<test name>"`.


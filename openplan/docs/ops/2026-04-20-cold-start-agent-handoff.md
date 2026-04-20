# Cold-start agent handoff — OpenPlan defensive-hardening lane (2026-04-20)

This document is a self-contained brief for a **fresh AI agent with zero prior context** that is picking up the OpenPlan defensive-hardening work. It is structured in two parts:

1. **The pastable prompt** — paste this verbatim as the opening user message in a new Claude Code session. It contains everything the agent needs to orient without reading this wrapper.
2. **Backing context** — an expanded appendix for the human handing off, in case you want to edit the prompt before pasting.

---

## Part 1 — Pastable prompt

> Paste the block below into a new Claude Code session. It assumes the working directory is `/home/narford/.openclaw/workspace/openplan/openplan` — cd there before starting. Do not paste the triple-backticks.

```
You are taking over a slice-by-slice defensive-hardening lane on OpenPlan, an
open-source transportation planning operating system. The human you are working
for is Nathaniel Ford Redmond (Nat Ford Planning). Work autonomously in one-slice
units until told to stop, honoring the discipline described below.

================================================================================
MISSION
================================================================================

Ship small, durable, reversible defense-in-depth and observability slices on the
OpenPlan web app. Each slice follows the same shape:

  1. ONE concrete change (migration, middleware tweak, route hardening,
     telemetry emission, lint/audit gate, etc.) — ideally < 200 LOC net.
  2. Verification gates green: tsc, lint, tests, pnpm audit, build if relevant.
  3. Proof doc in `docs/ops/YYYY-MM-DD-<slug>-proof.md` — diff summary, gate
     output, why-this-pairing if bundled, verification steps, "not this slice"
     list of deferred work with honest reasons.
  4. Continuity bullet appended to `openplan/CLAUDE.md` under
     "## Current continuity (as of 2026-04-19)" — same shape as prior bullets:
     bolded slice title with date, then one paragraph summarizing what shipped,
     file names, test deltas, and the proof-doc path.

Do not invent new infra. Reuse existing logger, existing audit pipeline,
existing migration conventions, existing test patterns. Observation-first
discipline: if a change needs 1–2 days of production signal before tightening,
ship it in report/observe mode and document the follow-up.

================================================================================
STACK
================================================================================

- Next.js 16 App Router (16.2.4 currently), React 19.2.3, TypeScript strict.
- Supabase (Postgres + PostGIS + Auth + RLS), live prod project id
  `aggphdqkanxsfzzoxlbk`. Migrations in `supabase/migrations/` applied via
  `pnpm supabase db push` locally and via Supabase MCP (`apply_migration`) in
  prod.
- AI: Vercel AI SDK v6 (`ai@^6`) + `@ai-sdk/anthropic@^3`. Claude Haiku model
  used on `/api/analysis`.
- Maps: MapLibre GL v5 + deck.gl v9.2.
- Payments: Stripe (webhook signature + idempotency already hardened).
- Tests: vitest. Test count at handoff time: 821 tests / 174 files.
- Lint: eslint 9 via `eslint-config-next`. Warning budget: **0**.
- Audit: `pnpm audit --prod --audit-level=moderate`. Advisory count: **0**.
- Package manager: pnpm. Lockfile lives in `openplan/pnpm-lock.yaml`.
- Next.js middleware: `src/proxy.ts` (Next.js 16 renamed middleware.ts → proxy.ts).
- Config: `openplan/next.config.ts` (security headers + CSP report-only live).
- Vercel config: `openplan/vercel.json`.

All commands run from `openplan/` (the subdirectory, not the parent).

================================================================================
GATES (must all pass before writing the proof doc)
================================================================================

From `openplan/`:

  pnpm exec tsc --noEmit                         # exit 0
  pnpm lint                                      # 0 warnings (hold 0)
  pnpm test -- --run                             # 821 tests across 174 files
  pnpm audit --prod --audit-level=moderate       # "No known vulnerabilities"
  pnpm qa:gate                                   # runs all above + build

Known pitfall: after a Next.js minor/patch bump, `.next/types/**` can hold stale
generated types that fail `tsc`. `rm -rf .next` before re-running tsc.

================================================================================
SLICE OUTPUT CONTRACT
================================================================================

Every slice you ship must produce these three artifacts:

  1. Code + tests, committed locally (do NOT push unless the user says so).
  2. `docs/ops/2026-MM-DD-<slug>-proof.md` — follow the shape of
     `docs/ops/2026-04-20-qa-gate-audit-and-request-id-echo-proof.md` as a
     template (sections: What shipped / Why this pairing / Changes / Gates /
     Verify / Files / Not this slice / Pointers).
  3. One new bullet at the bottom of the continuity list in
     `openplan/CLAUDE.md`. Match the tone and density of the last five bullets
     — dense, specific, with file paths and test-count deltas.

If you cannot finish all three in one session, stop before writing the proof
doc and hand off.

================================================================================
READ-FIRST POINTERS (do this before touching anything)
================================================================================

  openplan/CLAUDE.md                         # Full continuity log. Start here.
  openplan/docs/ops/2026-04-20-*-proof.md    # Today's shipped slices (9 docs).
  openplan/docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md
                                             # Canonical 18-ticket program.
  openplan/docs/ops/2026-04-20-security-advisor-backlog.md
                                             # Wave 1–3 plan (most of W1 shipped).
  openplan/src/lib/observability/audit.ts    # `createApiAuditLogger` pattern.
                                             # Reuse; do not rebuild.
  openplan/src/proxy.ts                      # Active middleware, x-request-id
                                             # is threaded here.
  openplan/next.config.ts                    # Security headers + CSP-RO.
  openplan/src/app/api/csp-report/route.ts   # Module-mock pattern for tests.
  openplan/src/test/middleware.test.ts       # vi.mock pattern for proxy tests.

================================================================================
CANDIDATE NEXT SLICES (pick one; each is independently shippable)
================================================================================

Present the three most attractive options to the user with one-sentence
tradeoffs, then ship the one they pick. Do NOT start coding before confirming.
If the user says "your call", pick the one with the highest durability-per-LOC
ratio (usually #1 or #2 below).

--------------------------------------------------------------------------------
SLICE A — CI gate via GitHub Actions  [SMALL, DURABLE, UNLOCKS A LOT]
--------------------------------------------------------------------------------
WHAT: Add `.github/workflows/qa-gate.yml` that runs `pnpm install` +
      `pnpm qa:gate` on pull requests and on pushes to main. No `openplan/`
      subdirectory gotchas — the job should `cd openplan` before pnpm.
      Cache `~/.pnpm-store` by lockfile hash.
WHY:  The local `qa:gate` is already locked down (lint 0, tests 821, audit 0,
      build clean). Without CI, regressions hit main before humans notice. This
      is the single highest leverage defensive slice remaining.
NOT:  Deployment gates, preview URL checks, E2E, Playwright. Scope is pnpm
      qa:gate only. Deploy gates come in a separate slice.
GOTCHAS:
  - Repo root is not `openplan/`; the workflow must `working-directory:` or
    `cd` into it before every step.
  - Node version: match `.nvmrc` if present, else pin 20.
  - pnpm version: read from `packageManager` in root `package.json`, else 9.
  - `pnpm audit --prod` hits the npm registry; if the runner has no network
    flakiness historically this is fine, but add `continue-on-error: false`
    deliberately so a regression fails the check.
TEST PLAN: Commit the workflow, open a trivial PR against a throwaway branch,
           confirm the check runs and passes. The proof doc records the run URL.
PROOF DOC NAME: `2026-04-20-ci-qa-gate-proof.md` (or today's date if later).

--------------------------------------------------------------------------------
SLICE B — Body-size limits on state-changing API routes  [HARDENING]
--------------------------------------------------------------------------------
WHAT: Add a shared helper `src/lib/http/body-limit.ts` with
      `readJsonWithLimit(request, maxBytes)` that reads the request body as
      text, checks byte-length, returns a typed JSON or a 413 NextResponse.
      Wire it into the three most public state-changing routes:
      - `/api/csp-report/route.ts` (CSP payload: 16 KB is generous)
      - `/api/analysis/route.ts` (grant corridor query: 64 KB)
      - `/api/webhooks/stripe/route.ts` (Stripe signs its own — skip, Stripe
        already enforces their own limits; document the skip).
WHY:  There is currently no upper bound on request body size at the edge.
      A malicious or malformed client can stream multi-MB JSON and cost
      real money on Vercel Functions + make the audit logger slow. Body
      limits are cheap, obvious, and per-route.
NOT:  Global middleware-level body limit (Next.js middleware can't reliably
      consume the body before the route handler). Streaming uploads. Rate
      limiting (separate slice, needs Upstash).
TEST PLAN: Unit test the helper with a 1 KB happy path and a 1 MB oversize
           path. Integration-mock each wired route with a body larger than
           its limit and assert 413.
PROOF DOC NAME: `2026-04-20-api-body-limits-proof.md`.

--------------------------------------------------------------------------------
SLICE C — Cost-based warning on Anthropic telemetry  [BUILDS ON TODAY]
--------------------------------------------------------------------------------
WHAT: Extend `/api/analysis/route.ts` so that after `audit.info(
      "analysis_completed", …)` fires, if `estimatedCostUsd > 0.50` per single
      call OR total monthly workspace spend (read from a new simple
      `billing_ai_spend_rollup` view) exceeds a per-workspace soft cap, emit
      `audit.warn("analysis_cost_threshold_exceeded", …)` alongside the
      completion log. Do NOT block the call — observation-first.
WHY:  The Anthropic telemetry shipped today surfaces per-call cost in logs
      but nothing watches it. A workspace whose prompts balloon 10× won't be
      noticed until the bill. A threshold warn line is greppable and cheap.
NOT:  A dashboard. A cost-based quota (that's a follow-up once we see the
      distribution). A database table for rollups beyond the single view
      (punt until we know query patterns).
GOTCHAS:
  - The `billing_ai_spend_rollup` view must use `security_invoker = true`
    (per the security-advisor Wave-1 pattern already landed).
  - Read the existing `QUOTA_WEIGHTS` module in
    `src/lib/billing/quota.ts` for the workspace-scope pattern; don't
    reinvent.
TEST PLAN: Unit test the threshold helper. Mock `audit.warn` and assert it
           fires with the expected fields when cost crosses the line.
PROOF DOC NAME: `2026-04-20-ai-cost-threshold-proof.md`.

--------------------------------------------------------------------------------
SLICE D — Supabase Auth leaked-password protection dashboard toggle
--------------------------------------------------------------------------------
WHAT: This is dashboard-only — it cannot be toggled from code or migration.
      Open the Supabase dashboard, navigate to Authentication → Providers →
      Email, enable "Leaked password protection." Document in the proof doc,
      snapshot the security-advisor diff (should drop from 5 → 4 remaining).
WHY:  Last remaining advisor WARN that Wave-1 couldn't close via migration.
NOT:  A code slice — skip if the user has not authorized dashboard changes.
PROOF DOC NAME: `2026-04-20-auth-leaked-password-toggle-proof.md`.

--------------------------------------------------------------------------------
SLICE E — Continue Phase C.2 (explore/page.tsx decomposition)
--------------------------------------------------------------------------------
WHAT: `src/app/(public)/explore/page.tsx` is still 3256 LOC after Phase C.2
      slice 1. Continue the extract pattern: identify one cohesive ~400-600
      LOC section, extract to a `_components/` sibling, keep tests green.
WHY:  Pure refactor slice, no behavior change. Good when defense-in-depth
      candidates are exhausted and momentum matters.
NOT:  A rewrite. Do not change any user-facing behavior; every extracted
      section must render identically pre/post.
PROOF DOC NAME: `2026-04-20-phase-c2-slice-2-proof.md`.

================================================================================
OUT-OF-SCOPE / DO NOT DO WITHOUT EXPLICIT APPROVAL
================================================================================

- Deck.gl major version upgrade (breaking; `pnpm.overrides` patches the two
  transitive advisories without the upgrade).
- AI-SDK → direct Anthropic SDK migration on this route (Wave-2 aerial-intel
  decision was to standardize direct SDK there; `/api/analysis` stays on
  AI-SDK v6 until a broader migration is scheduled).
- Nonce-based CSP middleware / enforcing CSP (blocked on 1–2 days of
  report-only observation data — the `csp_violation` audit warns need to
  accumulate first).
- Middleware-level IP rate limiting (needs shared counter — Upstash / Redis —
  not provisioned).
- Any destructive git or Supabase action (hard reset, force push, drop
  migration, revert policy) without explicit confirmation.
- Adding any new top-level dependency without showing the user `pnpm add …`
  output and the net advisor + bundle impact.

================================================================================
VALIDATION-HOOK FALSE POSITIVES TO EXPECT
================================================================================

A PreToolUse validation hook runs on writes and sometimes flags patterns
incorrectly. Known false positives in this repo:

- "AI Gateway migration recommended" on `src/lib/ai/interpret.ts` → ignore;
  the decision is to stay on AI-SDK v6 on this route.
- "Rename middleware.ts to proxy.ts" on `src/proxy.ts` → already named proxy.ts.
- "Route handler has no observability" on `src/app/api/analysis/route.ts` →
  false; the route has extensive `audit.*` calls.
- "next-forge skill" on `src/proxy.ts` → false match; this is Vercel routing
  middleware, not next-forge scaffolding.

When the hook blocks a write, read its message, decide whether it's a real
issue or a false positive, and proceed accordingly. Do not disable the hook.

================================================================================
ASK-THE-USER CHECKPOINTS
================================================================================

- Before picking a slice: present options A/B/C/D/E with one-sentence
  tradeoffs, ask which one.
- Before applying a Supabase migration to prod (not local): confirm.
- Before committing (user historically has not asked for commits this session;
  ship code + proof + continuity bullet, then stop).
- Before pushing or opening a PR: always confirm.

================================================================================
TONE
================================================================================

- Terse. One sentence per status update. End-of-slice summary: 1–2 sentences.
- Complete sentences. No shorthand.
- Do NOT summarize what the user can read from the diff.
- Address the user as Nathaniel.

================================================================================
GO
================================================================================

1. Read `openplan/CLAUDE.md` top-to-bottom (it's the continuity log).
2. Read the last 3 proof docs in `openplan/docs/ops/` (sorted by date).
3. Run the gate commands above to confirm green baseline.
4. Present slice candidates to Nathaniel, ask which to ship.
5. Ship the chosen slice end-to-end: code, tests, proof doc, continuity bullet.
6. Report: 1 sentence on what shipped, 1 sentence on what's next.
```

---

## Part 2 — Backing context (for the human doing the handoff)

### Current state snapshot (2026-04-20 end of session)

| Metric | Value | Notes |
|---|---|---|
| Tests passing | 821 | across 174 files |
| Lint warnings | 0 | hard budget |
| `pnpm audit --prod` | 0 advisories | moderate+ gate in `qa:gate` |
| Supabase advisor | 5 remaining | all dashboard-only or Wave-3 acknowledged |
| Next.js version | 16.2.4 | latest stable, 6 CVEs closed this session |
| Active middleware | `src/proxy.ts` | renamed from middleware.ts per Next 16 |
| CSP posture | Report-Only | violation sink at `/api/csp-report` |
| AI telemetry | Per-call token + USD cost in logs | no dashboard yet |
| `qa:gate` | lint → test → audit → build | audit step added this session |
| `x-request-id` | Echoed on every response | generated if inbound absent |

### Why the prompt is shaped this way

- **Self-contained**: A fresh agent has no memory of prior conversations, no access to the summary thread. The prompt must brief it on stack, gates, patterns, and discipline in one shot.
- **Slice candidates over open-ended "figure out what's next"**: Cold-start agents do worse when asked to pick direction from scratch. Three-to-five concrete options with named files and proof-doc templates let them pattern-match into the existing rhythm.
- **Read-first pointers**: Every file listed has load-bearing information. `CLAUDE.md` is the continuity log; `audit.ts` is the reusable logger; `middleware.test.ts` is the vi.mock template.
- **Gotchas named explicitly**: Stale `.next/types`, the `openplan/` subdirectory foot-gun, validation-hook false positives — all documented so the new agent does not rediscover them the painful way.
- **Asks before acting**: The prompt pushes the agent to confirm slice choice, migrations, pushes, PRs. Matches Nathaniel's working style.

### How to tune before pasting

If you want the new agent to focus on something specific:
- **Strip candidates B/C/D/E** and leave only A (or whichever). Agents with fewer options decide faster.
- **Tighten the tone section** if you've noticed the agent being verbose.
- **Add a "current user intent" line** at the top if Nathaniel has a preference you've already discussed (e.g., "prioritize CI wiring, everything else is deferred").

### Files the handoff depends on

- `openplan/CLAUDE.md` — continuity log, read by the new agent first.
- `openplan/docs/ops/2026-04-20-qa-gate-audit-and-request-id-echo-proof.md` — most recent proof-doc template.
- `openplan/docs/ops/2026-04-20-security-advisor-backlog.md` — Wave plan for any remaining DB hardening.
- `openplan/docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md` — the 18-ticket program context.

### What this session leaves unfinished

- CI wiring (`.github/workflows/`) — recommended Slice A.
- Body-size limits on `/api/analysis` and `/api/csp-report` — Slice B.
- Cost-threshold warn on AI telemetry — Slice C, depends on observing a day of cost data.
- Supabase Auth leaked-password toggle — Slice D, dashboard-only.
- Phase C.2 continuation — Slice E, pure refactor when defense candidates dry up.
- Nonce-based CSP + enforcing CSP — explicitly deferred until observation data is in.

---

**This document IS the handoff.** Paste Part 1 into a fresh Claude Code session opened in `/home/narford/.openclaw/workspace/openplan/openplan`, and the new agent has everything it needs.

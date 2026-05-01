# OpenPlan Phase 1 Spine Smoke — Agent Handoff

**Date:** 2026-05-01
**Status:** Open — handoff prompt for the next agent session
**Target:** Phase 1 exit-gate proof from the 18-month roadmap

## Purpose

The 18-month roadmap's Phase 1 exit gate says: "A rural county can enter a project once and reuse it across RTP, funding, map, report, engagement, and evidence-packet surfaces." Today each surface has its own smoke proof, but nothing asserts the spine claim — that one `project_id` flows through all surfaces without duplicate creation. This handoff scopes the slice that closes that gap.

## Handoff Prompt

Paste this verbatim as the first message in a new agent session (`/clear` then paste, or open a new `claude` instance in the repo).

```
You are taking over OpenPlan with no prior context.

Repo:
- Root: /home/narford/.openclaw/workspace/openplan
- App source: /home/narford/.openclaw/workspace/openplan/openplan
- QA harness: /home/narford/.openclaw/workspace/openplan/qa-harness
- Branch: main, in sync with origin/main
- Latest commit at handoff: f29df0a Add restore drill approval packet
- Run app/test/build commands from openplan/ unless otherwise noted; run smoke harnesses from qa-harness/.

Read first:
1. AGENTS.md
2. docs/ops/2026-05-01-openplan-full-os-roadmap.md (Phase 1 section is the target)
3. docs/ops/2026-05-01-openplan-release-to-sale-plan.md
4. docs/ops/2026-05-01-openplan-local-rtp-release-review-smoke.md
5. docs/ops/2026-05-01-openplan-local-grants-flow-smoke.md
6. docs/ops/2026-05-01-openplan-local-engagement-report-handoff-smoke.md
7. docs/ops/2026-05-01-openplan-local-analysis-report-linkage-smoke.md
8. docs/ops/2026-05-01-openplan-local-workspace-url-isolation-smoke.md

Strategic direction:
OpenPlan is becoming an open-source, evidence-backed planning OS for regional transportation and community planning. Four systems (RTP, Grants, Aerial, Modeling) on one shared evidence spine. Sold as Apache-2.0 software plus Nat Ford managed hosting/services — supervised planning workbench, not self-serve SaaS. Do not overclaim modeling validation, legal/compliance automation, autonomous AI, or finished all-in-one suite.

This task: Phase 1 cross-surface spine smoke.

The 18-month roadmap's Phase 1 exit gate says: "A rural county can enter a project once and reuse it across RTP, funding, map, report, engagement, and evidence-packet surfaces." Today each surface has its own smoke proof, but nothing asserts the spine claim — that one project_id flows through all surfaces without duplicate creation. Close that gap.

Concrete deliverable:
1. New harness file qa-harness/local-spine-smoke.js (mirror the structure and CLI shape of the existing local-rtp-release-review-smoke.js / local-grants-flow-smoke.js / local-engagement-report-handoff-smoke.js / local-analysis-report-linkage-smoke.js).
2. The smoke must seed or use one workspace + one project, then traverse RTP cycle linkage, grants funding linkage, engagement item linkage, analysis/county-run linkage, and report modeling-county-run linkage — asserting the same project_id reappears across each surface without re-creation.
3. New npm script in qa-harness/package.json (e.g., local-spine-smoke).
4. New proof doc docs/ops/2026-05-01-openplan-local-spine-smoke.md following the existing per-surface smoke proof format.
5. Update docs/ops/2026-05-01-openplan-release-to-sale-plan.md with a new Release Gates row (Phase 1 spine gate) + open-or-PASS status linked to the new proof.
6. Run the full release gate from openplan/: pnpm lint && pnpm test && pnpm build && pnpm audit --prod --audit-level=moderate && pnpm ops:check-prod-health && pnpm ops:check-public-demo-preflight.
7. Commit + push.

Do not:
- Reintroduce broad SECURITY DEFINER query functions.
- Touch RLS or scoped RPC boundaries beyond what the smoke needs.
- Create a new product surface; this is a proof, not a feature.
- Mutate live data, billing, email, auth sessions, or external services.

First move:
Run rg to inventory existing qa-harness smokes and seed scripts. Look at qa-harness/local-rtp-release-review-smoke.js, qa-harness/package.json, and openplan/scripts/seed-nctc-demo.ts (the NCTC demo seed already creates a project linked to an RTP cycle and a county run — good starting point). Then propose a concrete spine-traversal sequence and confirm with the user before writing the harness.

Useful commands:
- cd openplan
- pnpm lint
- pnpm test
- pnpm build
- pnpm audit --prod --audit-level=moderate
- pnpm ops:check-prod-health
- pnpm ops:check-public-demo-preflight
- pnpm seed:nctc
- pnpm seed:workspace-isolation
- cd ../qa-harness && npm run local-rtp-release-review-smoke (etc.)

Engineering posture:
Prefer existing patterns. Use rg for search. Edit existing files with Edit, not Write. Respect RLS and scoped RPC boundaries. Do not revert user changes. Commit and push completed work unless blocked. For UI (probably none in this slice), follow docs/ops/2026-04-08-openplan-frontend-design-constitution.md.

Environment notes:
Vercel CLI, Supabase CLI, Supabase MCP, and Vercel MCP are available. Supabase project ref aggphdqkanxsfzzoxlbk. NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN must be a public pk.* token, never sk.*.
```

## Why This Slice Now

- Phase 0 release gates are all PASS per `2026-05-01-openplan-rc-proof-log.md`.
- The Phase 1 exit gate is the only gate that does not yet have a single-proof artifact — it is implied by the union of the per-surface smokes but never asserted as a single traversal.
- Closing it lets Phase 1 sign off honestly before any Phase 2 push, and gives buyers a single proof link for the "shared spine" claim that the buyer narrative leans on.

## Out Of Scope For This Slice

- No new product surface.
- No new RLS or RPC.
- No live data mutation.
- No staging restore drill (separate open box on the release-to-sale plan).
- No team/member self-serve UI work (separate hardening item).

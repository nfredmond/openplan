# OpenPlan Autonomous Build Protocol

**Date:** 2026-05-01
**Owner:** Bartholomew Hale
**Directive:** Keep OpenPlan moving toward the full saleable-v1 roadmap even if Nathaniel is offline for an extended period.
**Canonical scope:** `2026-05-01-openplan-full-os-roadmap.md`
**Commercial target:** open-source core + paid implementation/customization/hosting/support for rural RTPAs, counties, tribes, agencies, and planning consultants.

## Operating Interpretation

The roadmap's 18-month horizon is a conservative human-team estimate, not a binding AI-agent schedule. The scope is the v1 definition of done. The schedule should be compressed aggressively through supervised AI execution, parallel lanes, and daily proof-backed shipping.

## Prime Directive

Every day should either:

1. ship a vertical slice toward the full planning OS,
2. prove an existing slice end-to-end,
3. package the product for sale/demo, or
4. remove an execution blocker.

If a task does not move OpenPlan closer to a saleable rural-county/RTPA v1, defer it.

## Human-Attached Codex Safety Rule

The previous watchdog model was unsafe because it could interfere with an active human-attached Codex TUI. From now on:

- When a Codex/OpenAI TUI process appears active, supervision is **read-only**.
- Do not run `codex resume`, attach to a PTY/stdin, send keys, clean up, kill, restart, or assume an idle TUI is disposable.
- Do not launch a competing continuation in the same worktree unless Nathaniel explicitly asks or there is no active human-attached process.
- Use process inspection, repo status, recent session files, git logs, CI/deploy state, and docs only.
- If the active session is blocked and Nathaniel is present, ask him before steering.
- If the human-controlled Codex session shows no apparent human interaction for more than ~1 hour, Bartholomew may keep it going or take over completely, provided state is preserved first and no destructive/external approval gate is crossed.
- Safe takeover sequence after the one-hour quiet window:
  1. Record timestamp, process IDs, repo status, latest session ID, and apparent last human/Codex activity in `knowledge/Daily/YYYY-MM-DD.md`.
  2. Snapshot `git status`, latest commits, recent session transcript metadata, and any visible pending prompt/question.
  3. Prefer a non-invasive continuation/handoff over direct PTY manipulation where possible.
  4. If the TUI is clearly waiting for approval/input and the next action is safe/internal, answer or continue.
  5. If the TUI is wedged or complete-but-open, preserve state, then launch a bounded worker or continuation from the persistent OpenPlan workspace.
  6. Never cross production data, billing, customer/email, public outreach, secret, or destructive filesystem gates without explicit prior approval.
- If Nathaniel is offline and the session is clearly completed/dead, start a new bounded worker in a separate safe lane only after preserving state in the daily note.

## Autonomous Execution Modes

### Mode A — Nathaniel Present / Active Codex TUI Running

Allowed:
- read-only status checks
- summarizing current roadmap/proof gaps
- preparing prompts/handoffs for Nathaniel to paste
- updating notes/docs outside active code paths when low-risk

Not allowed:
- attach/resume/kill/cleanup Codex
- mutate the same branch while the human TUI is actively coding
- push changes that may conflict with the active TUI without coordination

### Mode B — Nathaniel Offline / No Active Human TUI

Allowed:
- spawn bounded agents for isolated roadmap slices
- run local validation gates
- commit/push stable slices to `main`
- verify production health after deploy
- update roadmap/proof docs

Guardrails:
- no destructive production data changes
- no billing/customer/email/external sends without explicit prior approval
- no secret exposure
- no unsupported legal/compliance/modeling claims
- no model downgrade below approved fallback posture unless explicitly approved

### Mode C — Offline Week / Continuous COO Build Loop

Run a 24-hour cadence with two workstreams:

1. **Build lane:** implement one vertical slice from the roadmap.
2. **Proof/sales lane:** produce buyer-facing proof, demo script, screenshots, pricing/implementation packaging, or outreach-ready material.

Keep a daily ledger in `knowledge/Daily/YYYY-MM-DD.md`:
- shipped commits
- validation evidence
- production proof
- remaining blockers
- next lane
- any human decisions needed later

## Roadmap Compression Strategy

Prioritize saleability over completeness:

1. Phase 1 spine hardening: one project reused everywhere.
2. Phase 2 rural county workflow: RTP/ATP + grants/funding + board-ready packet.
3. Phase 3 engagement/report evidence traceability.
4. Phase 4 analysis/modeling proof with explicit caveats.
5. Phase 6 admin/support/hosting proof sufficient for paid implementation.
6. Aerial/asset lanes where they strengthen demo value or buyer differentiation.

## Definition of a Good Daily Slice

A daily slice should include:

- real UI or API behavior
- real persistence, not mock-only flow
- tests or smoke script where practical
- docs/proof packet update
- commit to `main` once stable
- production health check after deploy when external-facing

## Standard Gates

Before claiming a slice done:

```bash
cd /home/narford/.openclaw/workspace/openplan/openplan
pnpm lint
pnpm test
pnpm build
```

When release/prod proof matters, also run applicable ops checks from the full roadmap.

## Delegation Pattern

Use bounded workers with explicit slice scope:

- one worker per roadmap slice
- no broad refactors without approval
- no production mutation unless scoped and approved
- return with files changed, tests run, blockers, next suggested slice

Preferred worker prompt shape:

> Implement the smallest vertical slice that advances `[roadmap phase/gate]`. Start by reading `docs/ops/2026-05-01-openplan-full-os-roadmap.md` and this autonomous protocol. Preserve civic-workbench UI rules. Do not mutate production data, billing, email, or secrets. Run lint/test/build. Commit only if clean and summarize proof.

## Sales Packaging Lane

Because Nathaniel needs revenue soon, technical work must feed buyer proof:

- one rural RTPA/county demo narrative
- implementation offer page/deck
- customization/managed-hosting pricing options
- demo screenshots/videos
- agency-specific fork examples
- honest open-source + paid-services explanation

## Decision Parking Lot

These can be drafted but not finalized without Nathaniel:

- exact pricing
- first target agencies/contacts
- outbound emails/posts
- whether managed hosting is monthly retainer, project setup fee, or both
- any commitment to 24-hour support SLA

## Current Immediate Next Move

Do not touch the active Codex TUI. While it runs, prepare the next safe handoff and roadmap-to-sprint breakdown. Once no active human-attached Codex process is running, launch/assign the next bounded slice against the highest saleable gap.

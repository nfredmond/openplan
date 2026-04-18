---
title: 2026-04-18 program retrospective update
date: 2026-04-18
program_doc: docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md
supersedes_sections_in: docs/ops/2026-04-17-program-retrospective.md
---

# 2026-04-18 retrospective update

This doc supersedes the 2026-04-17 retro's "What closed / what
deferred" and "What's on deck" sections. Everything else in the
2026-04-17 retro (patterns, findings, cold-start pointers) is still
current.

## What changed on 2026-04-18

Four deferred tickets + one on-deck product lane closed today:

| Ticket | 2026-04-17 status | 2026-04-18 status | Evidence |
|---|---|---|---|
| T1 packet generate + re-ground | unit (create live) | **live** | `2026-04-18-packet-regenerate-reground-proof.md` (5eb4bc2) |
| T17 regrounding-depth guard | unit | **integration-chain test** | `2026-04-18-t17-regrounding-depth-chain-test.md` (eda6bd5) |
| T7 primitive pilot (retro on-deck) | indirect (aerial only) | **second real consumer** | `src/components/models/model-linked-records.tsx` (7a0dd92) |
| Grants OS application-states (retro on-deck) | not started | **shipped** | migration + catalog + tone (cb941ce) |

## Updated evidence scorecard

2026-04-17 take-home: 7 of 18 tickets live, 10 of 18 unit-only, 1
deferred. With today's closures:

**Live (10/18):** T1, T4, T8, T9, T11, T12, T13, T14, T15, T17
(T17 via integration-chain, the right shape for an in-process
orchestration guard — see the chain-test doc for why a live HTTP
proof doesn't fit).

**Unit-only (7/18):** T2, T3, T5, T6, T10, T16, T18.

**Deferred (1/18):** T16 caveat-gate wiring — still blocked on a
reader-surface design call.

The 2026-04-17 retro flagged "don't open new product lanes until
T4/T13/T17 have live proofs." That gate is now cleared. The first
product lane (Grants application-states) opened today behind it.

## Updated "writer wired, reader dead" census

2026-04-17 found 4 cases. Today surfaced a fifth on the opposite
axis (writer-wired, *counter-writer* dead) and closed three:

| # | Case | State |
|---|---|---|
| 1 | T16 caveat gate (`loadBehavioralOnrampKpisForWorkspace`) | dead reader — blocked on design call |
| 2 | T4 stale banner on `<RtpReportDetail>` | **fixed** (1b24d43, proven 2026-04-17) |
| 3 | `projects.rtp_posture` body | dead (design call — timestamp renders, body does not) |
| 4 | `projects.aerial_posture` | dead (design call — mission page bypasses via recompute) |
| 5 | T1 regenerate clears `rtp_basis_stale` (inverse writer) | **fixed** (5eb4bc2) |

Three fixed, one blocked on design, two design-calls. The 2026-04-17
instruction to grep for the pattern before closing tickets remains
load-bearing.

## What's genuinely on deck (2026-04-18)

The retro's on-deck list is now filtered for what's actually
unblocked and not yet done. Items removed from the list are either
shipped today or still blocked.

**Unblocked, actionable:**

- **T10 grants decomposition audit.** The deep-dive at 2026-04-16
  reported `components/grants: 0`. Today the grants page is 677 LOC
  with 11 extracted components, so T10 is structurally done — but
  no explicit closure doc exists. A one-line audit confirming the
  deep-dive count is stale, or a short closure note pointing at the
  `components/grants/*` inventory, would close the ticket
  bookkeeping. ~15 min.

- **`projects/[projectId]/page.tsx` decomposition (2863 LOC).** Not
  a named retro ticket but is now the largest mega-page in `(app)/`.
  Biggest single structural hygiene target. ~full day if attempted
  as one slice; better as 2-3 extractions following the T7+T10
  pattern. Low urgency — no bug, no blocker.

- **Form UI primitive.** T7 originally specified "missing: table,
  form, inspector, data-grid." Table/inspector/worksurface shipped;
  **form is still missing.** Grants and projects pages have many
  inline form patterns. Worth building when the next real consumer
  exists — don't build speculatively.

- **`getProjectPosture(projectId, workspaceId)` repository.** Called
  out in 2026-04-17 retro finding #3 as a candidate. Today's
  variant-reader audit (2026-04-17) showed posture-column reads are
  narrower than originally diagnosed — only `/rtp/[rtpCycleId]`
  reads `rtp_posture_updated_at`, and it's a timestamp-only read.
  The three-surface duplication the retro flagged was **project-row
  reads**, not posture-column reads. Low urgency until a concrete
  bug or schema change forces the issue.

**Still blocked:**

- **Browser-GIF of the write-back loop.** Chrome extension pairing
  (environmental).
- **Teammate prod-audit.** Needs Nathaniel's explicit go-ahead.
- **T16 caveat-gate wiring.** Needs reader-surface design call.

## What *not* to do next (unchanged from 2026-04-17, re-confirmed)

- Don't open a second new product lane until the unit-only 7 at
  least have named plans. Grants states was the first lane; the
  binding constraint remains integration discipline over breadth.
- Don't wire the caveat gate without a reader surface spec.
- Don't rely on mocked vitest alone for close-the-loop work.

## Suite + repo state at doc time

- `pnpm tsc --noEmit` clean.
- `pnpm test --run`: 710/164 green (+4 from 2026-04-17:
  +1 T17 chain test, +3 model-linked-records board tests).
- `origin/main..HEAD` contains today's 4 commits, all pushed-ready:
  - `5eb4bc2` fix(reports): regenerate clears rtp_basis_stale + T1 proof
  - `eda6bd5` test(runtime): T17 recursive-chain coverage
  - `cb941ce` feat(grants): expand decision states
  - `7a0dd92` refactor(models): pilot DataTable primitive on linked-records

## Pointers

- 2026-04-16 program source of truth:
  `docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md`.
- 2026-04-17 retro (patterns + findings still current):
  `docs/ops/2026-04-17-program-retrospective.md`.
- 2026-04-18 evidence docs:
  - `2026-04-18-packet-regenerate-reground-proof.md` (T1)
  - `2026-04-18-t17-regrounding-depth-chain-test.md` (T17)

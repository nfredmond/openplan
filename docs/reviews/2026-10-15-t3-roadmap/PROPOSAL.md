# T3 Code concepts: roadmap disposition

**Status: approved by Codex after corrections, October 15, 2026 UTC.**
See [REVIEW.md](REVIEW.md) for the approval and its limits. Drafted October 15, 2026
(UTC) by Claude Opus 5.5 (`claude-opus-5-5`, high reasoning) as the drafting
agent. The author does not approve this record. Branch
`work/t3-roadmap-integration-20261015` from `8a180c377`; main at
`1b2fefe0f0e98f99700fc77e99146fe697b43ee7`.

This is a decision record, not a queue. The [roadmap](../../ROADMAP.md) is the
only active queue. Scope and proof for each adopted item are in the
[October 15 amendment in MILESTONES.md](../../product/MILESTONES.md#october-15-2026-amendment-operating-patterns-from-the-t3-code-review),
rows T1 to T16. Where the two-month [plan](../2026-10-12-two-month-review/PLAN.md)
sequences the same work differently, this dated amendment governs that specific
sequencing; the plan remains evidence and is not edited.

## Sources and limits

Every T3 fact here comes from the [research report](../2026-10-15-t3code-concepts/REPORT.md),
the [lead review](../2026-10-15-t3code-concepts/LEAD_REVIEW.md) and the
[package README](../2026-10-15-t3code-concepts/README.md). Item numbers below are
the report's section 3 numbers. This record adds no source research. The drafting agent ran no T3
or OpenPlan code; Codex runs the bounded documentation checks in REVIEW.md.
No deployed, browser, provider, practitioner or scientific result is claimed. The original draft used the research record, dated
[known issues](../../ops/KNOWN_ISSUES.md) and the
[requirements ledger](../../product/CORE_REQUIREMENTS_LEDGER.md). Codex then
checked main source for PR 326, deep health, migration drift and shared-key
metering. Its corrections and verification are in [REVIEW.md](REVIEW.md).
This is not a new hosted-settings or deployment audit.

PR 327 (Node worker process observations, real transport cancellation and
candidate migration 20261017000015) and PR 328 (optional previous integration
secret for rotation) are separate, unmerged work. They are known from the
research supervisor's note and the parent session's instruction; the drafting agent did
not inspect them and this amendment does not treat them as delivered.

## What does not change

- The binding [v1 contract](../../product/V1_PRODUCT_CONTRACT.md) and every v1
  outcome: all 50 states and DC, California depth, explicit territory, tribal
  and overlapping authority, and separate use-specific validation of
  AequilibraE and ActivitySim, never averaged.
- Free and open source, independent installation and customer data portability,
  with no paid gate or required paid service.
- Exact-action approval, original actor and workspace, approved-payload hashes
  and source custody. Nothing here weakens them.
- A process heartbeat or observation shows a process is alive. It never shows a
  job completed.
- Self-service restore on a second host stays open. Nathaniel has no second
  Linux machine, and a same-host rehearsal does not close it.
- Stage A operating closure and the twelve first-week journeys come before
  Stage B. No roadmap status is promoted by this record.
- Nathaniel's September 4 direction: provider choice for already-proven Planner
  Agent tasks (A0) is an early priority and does not wait for every module or
  for broad chat (C8).
- Any MCP action surface waits until the underlying workflow works without an
  agent ([ADR-004](../../ADRs/ADR-004-mcp-server-surface.md)).
- Version numbers in the plan are indicative and never cap scope.

## Dispositions of the 15 report candidates

"Adopt" means the item enters an existing milestone's scope and proof. It does
not schedule implementation beyond what the roadmap states.

| # | Candidate | Disposition | Home (amendment row) | When | Reason |
|---|---|---|---|---|---|
| 1 | Tested CLI compatibility record, replay fixtures, "limited until reset", owning-installer guidance | Adopt | A0b (T1) | Early lane beside Stage A | Exact pins keep refusing newer CLIs, so the proven project task stops working as CLIs update. Refusal of untested versions stays. |
| 2 | Declared caller authority for every agent-reachable tool; outside-agent sign-in | Adopt | A1a, ADR-004 successor (T2) | Before any MCP exposure; may start inside A1a | Writes already declare metadata; reads do not. An MCP layer must not reach anything the in-app agent cannot. |
| 3 | Durable assignment mechanics | Adopt into the A1b design | A1b (T3) | Stage C8, after PR 327 is verified | Reuse PR 327 observations and cancellation rather than add a second state owner. |
| 4 | Pending human decisions on the visible owner and My Work | Adopt with item 3 | A1b with M2c (T4) | With A1b | A wait for a person must never read as progress. |
| 5 | Hidden characters in AI-bound untrusted text | Adopt, modified for scripts | M9b moderation first, then the shared AI context projection (T5) | Early Stage B | Public input is live. Add inspection with existing evidence framing and preserve legitimate multilingual text. The study establishes no new reproduced Stage A defect; new consequential evidence can move this earlier. Inspection alone cannot establish injection resistance. |
| 6 | Guided change review with code-enforced coverage | Adopt as a deterministic complete difference; AI narration optional | M12a, M2d.1, M2b (T6) | Stage C (C1, C10) | Code computes, models narrate. Needs reviewed extraction first; unresolved coverage prevents a complete-review claim (KL-2026-09-04-028). |
| 7 | Source watches: code detects, people judge | Adopt | M13e first, then G1a and M6a (T7) | Stage B4 | Fits grant deadline changes. Complete hashes can establish unchanged bytes without validators; unverifiable reads stay unknown. Repeated unchanged checks do not retire the watch. |
| 8 | Third-party license inventory and notices | Adopt | M0 release checks; reused by M5b.5 and M15c (T8) | Stage B | Supports independent adoption review. Tool choice was not evaluated by the research. |
| 9 | Auditable notification decisions | Adopt, lower priority | M2c (T9) | Stage B, with M2c deadline work | Keeps consequential exceptions visible while allowing justified duplicate suppression and bounded delivery retries. |
| 10 | Self-service triage playbook | Adopt as redacted read-only operator triage | M3a, M15c (T10) | With M3/M15 operations; independent proof in Stage D | Self-service recovery must not depend on Nathaniel. |
| 11 | Visible provenance for layered rules and settings | Adopt | M1, then G1 (T11) | Stage C6 | Exposes workspace-home inheritance (KI-2026-10-12-025, KL-2026-09-04-001). |
| 12 | Effective-permission visibility | Adopt, lower priority | M4; M13a recipient roles (T12) | With M4/M13 recipient roles | Explains denials without granting access or exposing other users' roles to unauthorized callers. |
| 13 | Upgrade preflight for independent installs | Adopt | M15c, M3 (T13) | Before relevant M3/M15 upgrades; independent proof in Stage D | Refuse before downtime. Does not close second-host restore. |
| 14 | Accessible Planner Agent transcript | Adopt | A0 and A1 interfaces; accessibility campaign (T14) | With each agent interface change; observed in Stage D | Needs real screen-reader observation. |
| 15 | AI usage with explicit unknowns | Adopt | A0, M15a (T15) | With A0b | Main already refuses shared-key calls when metering fails. Stage A verifies configured behavior; this row adds honest usage records, not a cap. |

## Addition from the lead review: bounded web draft and write recovery

The research report placed native apps and offline caches among the families it
would not prioritize. The lead review disagreed on product fit and proposed a
narrower web pattern tied to CORE-INCLUSIVE-01 and ORG-01. Both positions stay
unchanged in the research record.

**Disposition: adopt the bounded web pattern (T16).** On the merits: the shared
definition of done already requires slow and interrupted connections and upload
retry; CORE-INCLUSIVE-01 and ORG-01 require low-bandwidth use by a small or
rural office; and KL-2026-09-04-020 records a concrete participant draft
continuity gap on a public route that is now live. OpenPlan already keeps some
unconfirmed saves for exact retry (OWP reporting, synthesis review), so this
extends an existing pattern. First application is participant comments (M9a),
then municipal reports (M13b), documents (M2b) and field records (M10c).

Bounds: a local draft is never a submission or backdated filing. Local,
uncertain-send, accepted-with-receipt and failed states remain distinct. Retries
keep command identity and revalidate the actual signed-in or public participant
context, workspace/campaign, permissions and campaign state. Draft consent,
storage limits, retention, clearing and account changes need explicit handling;
a shared device cannot expose another account's private draft. Native apps, offline caches and full offline synchronization stay
deferred, consistent with both reviews and with the existing statement that the
shared definition of done does not imply unrequested full offline sync. Tribal
data stored on a device needs its own authorized case (ORG-02).

## Deferred families (report section 6)

Deferral is a prioritization judgment, not a new ban. Each family can return
through an appropriate scoped review. A new module or consequential change in
product direction requires the existing whole-product review.

| Family | Disposition | Reason and what would reopen it |
|---|---|---|
| T3 Connect relays, managed tunnels, held webhooks | Not adopted | Requires outside paid accounts; OpenPlan's outbound connector already avoids inbound tunnels. |
| Push notifications, Live Activities, widgets | Deferred | Needs relay and push credentials; the current requirement is 390px web plus email. Reopen on an observed need email cannot meet. |
| Native iOS and Android apps, offline caches | Deferred | Bounded web recovery (T16) covers the stated requirement. Full offline sync remains a separate design choice (see M10c.1). |
| Agent-authored HTML pages and MCP Apps | Deferred | ADR-004 defers MCP Apps until read and propose lanes are proven; executable HTML in an evidence or publication path needs its own custody review. Agent narration and reviewed visualization are not ruled out. |
| AI-reviewed automatic approvals; full-access default | Not adopted | The contract requires a responsible human and exact approval for consequential actions. This is an existing boundary, not a new ban. |
| Plugin runtime and marketplace | Deferred | Not on the current roadmap. Worldwide extensibility through adapters and registries remains an architecture requirement; a reviewed extension mechanism is not ruled out. |
| Task graphs across machines | Deferred | A1b's bounded state machine comes first; LangGraph JS stays the recorded fallback if a measured case needs it. |
| Turn provenance and selective rollback | Not adopted | Immutable history and exact approvals already cover the need. |
| Webhook-triggered agent runs | Deferred | Inbound triggers widen the attack surface; A1d scheduled internal review where authorized is the existing path. |
| Product analytics through PostHog | Not adopted | The audit ledger records agent actions; no stated planner need. |
| Wholesale reuse of the Effect orchestration engine, Electron shell, terminal | Not adopted | Effect-coupled and coding-specific. Reuse means reimplementation, apart from small MIT pieces with attribution. |

From the report's section 7 list of older and rejected proposals: #8491 informs
T9; #15464's asymmetry (an agent may decline, only a person approves) is in T2;
#15040 and #14354/#14714 are A1d design inputs (scheduled work never exceeds its
author's authority; run caps); #7708/#7135 fit the broader M15c transfer
preparation, whose second-host acceptance stays open. No other section 7 item is
adopted.

## Sequencing rationale

The roadmap states the order; this explains it.

- **Stage A, now.** Unchanged and first: remaining operating items and the
  twelve journeys. PR 327 and PR 328 match two existing Stage A1 items in the
  plan (Node queue heartbeats; second-key support for the integration secret)
  and land only through their own verification and, for PR 327, the
  coordinated migration order.
- **Early A0 lane.** T1 with T15 for the already-proven project task, beside
  Stage A without displacing it. Broad chat stays C8.
- **Stage B.** T5, T7 (grants, B4), T8, T9 and T16 (participant comments first).
- **Stage C.** T2 before any MCP exposure, T3 and T4 after PR 327 is verified,
  T6 with C1 and C10, T11 with C6.
- **With the owning work.** T10 and T13 accompany M3/M15 operation before
  upgrades; T12 accompanies M4/M13 recipient permissions; T14 accompanies agent
  interface changes. Stage D consolidates independent proof, rather than first
  adding those controls.

## Lead decisions after reviewing the draft

Codex accepts A0b as an early next action beside Stage A. The roadmap now permits
sourced next-action updates without changing completion grades. This corrects
the old self-conflicting rule rather than making a special exception.

The draft's source-watch termination and validator rules were too strong. T7 now
keeps unchanged watches active and permits complete hash comparisons. T9 keeps
exceptions visible while recording legitimate suppression and uncertain delivery.
T2 separates responsible human decisions from existing approved execution.
T3 uses bounded retention that protects unresolved recovery and held records.
T5 preserves legitimate language controls without blanket script exemptions.
T6 exposes unsupported extraction; T11 does not let a setting override law;
T12 preserves authorized administrative inspection. T16 adds public participant
context and device/account privacy. No new action is authorized by those edits.

Codex checked the source on main and removed stale next actions claiming that
PR 326's deep-health/drift/error-report implementation or shared-key metering
refusal is missing. Production configuration and operational proof remain open.
The next-three list requires a Stage A report to Nathaniel before Stage B;
simply recording a gap cannot waive a release blocker.

Fixture recording must use an explicitly selected, authorized account with its
allowance disclosed. This roadmap amendment does not start native recording or
make paid calls. T5 starts with Stage B unless new consequential evidence requires
earlier work. October 15 UTC is the record date, October 14 in Pacific time.

Final approval and the exact checked artifacts are recorded in [REVIEW.md](REVIEW.md).

## Checks the reviewer should run

- `npm run product:direction:check` in `openplan/`.
- `npx vitest run src/test/active-roadmap-guard.test.ts src/test/docs-mechanical-cross-references.test.ts src/test/product-direction-review-guard.test.ts`
  in `openplan/` (marker, path and relative-link checks over the edited files).
- Confirm the roadmap header (`reviewed_commit`, `review_by`, `current_release`)
  and every status cell are byte-identical to `8a180c377`.
- Confirm no edit to the v1 contract, the research package, the two-month plan
  or any review date.
- Search the changed files for em dashes.

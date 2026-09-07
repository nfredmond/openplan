# OpenPlan documentation

Use this index to distinguish current instructions and priorities from historical
evidence. The application is in `openplan/` beneath the repository root.

## Current authorities

| Question | Read |
|---|---|
| How should contributors and agents work? | [Repository AGENTS.md](../AGENTS.md), then [Contributing](../CONTRIBUTING.md). CLAUDE.md is a pointer to the same entry point |
| What must v1 deliver? | [V1 product contract](product/V1_PRODUCT_CONTRACT.md) |
| What is next, and what establishes completion? | [Roadmap](ROADMAP.md), the sole active queue |
| What works, and what remains unproved? | [Capability matrix](product/US_PLANNING_CAPABILITY_MATRIX.md) and [known limitations](ops/KNOWN_ISSUES.md) |
| Why this direction? | [September 7 OWP direction review](reviews/product-direction/2026-09-07-work-program-review.md), [comprehensive review](reviews/TECHNICAL_PRODUCT_REVIEW_2026-09-06.md), and preserved independent reports linked there |
| How is it implemented? | [Architecture](ARCHITECTURE.md) and current source |
| What shipped? | [Changelog](../CHANGELOG.md), Git tags and the release's actual CI/acceptance evidence |

The [review protocol](product/PRODUCT_DIRECTION_REVIEW_PROTOCOL.md) requires
periodic independent reassessment. Its check validates required records and
evidence bindings; it cannot certify professional usefulness or scientific truth.
The old [shared manual](product/AGENT_OPERATING_RULES.md) is a compatibility
pointer to AGENTS.md, not a second rulebook.

## Evaluate and operate

- [README](../README.md): local one-computer evaluation.
- [Self hosting](../openplan/docs/SELF_HOSTING.md): deployment profiles,
  configuration, external data flows and unfinished agency-operation proof.
- [Team commissioning](../openplan/docs/FIRST_DEPLOYMENT.md): what an independent
  operator must establish before real team use.
- [Runbook](../openplan/docs/ops/RUNBOOK.md): diagnosis and recovery boundaries.
- [September 7 OWP review and amendments](reviews/2026-09-07-owp-review/VERIFICATION.md): exact-version decisions, retained baselines, inspected exports and bounded engineering acceptance.
- [September 6 workspace/control checkpoint](reviews/2026-09-06-housekeeping/VERIFICATION.md): retained local archives, native layout and isolated update/recovery evidence.
- [Backup and restore](../openplan/docs/ops/BACKUP_AND_RESTORE.md): durable state,
  existing mechanisms, representative drills and missing full-recovery proof.
- [Security](../SECURITY.md) and [license notice](../LICENSE-NOTICE.md).

Local Supabase CLI evaluation, a developer's walkthrough instance and a supported
agency production installation are different environments. Current docs must
name which they describe. Do not infer free provider eligibility or production
readiness from an old setup guide.

## Practice requirements and current limitations

The [core requirements ledger](product/CORE_REQUIREMENTS_LEDGER.md) prevents restored requirements from disappearing. It maps full OWP, contract budgets, prior-RTP updates, capital/tax/grant administration, procurement, engagement, aerial work, agent providers, hosted trials and appearance to the single roadmap. The [workflow handoffs](product/WORKFLOW_HANDOFFS.md) identify the owning record and receiving role. These are requirements and gap assessments, not claims that every workflow exists.

Use the [current modeling status](modeling/STATUS_AND_VALIDATION.md) before interpreting old model metrics. The [September 6 shared-campaign handoff](reviews/2026-09-06-handoffs/SHARED_CAMPAIGNS.md) separates coverage/privacy repairs from incomplete browser file delivery. The [September 6 consolidation verification](reviews/2026-09-06-consolidation/VERIFICATION.md) separates implemented maintenance from deferred redesign. The [September 6 ODX and WaypointMap assessment](reviews/2026-09-06-handoffs/ODX_TRANSITION_RESEARCH.md) supplies the current processing-trial and controller-workflow references for M5b. The [preserved research packet](reviews/2026-09-04-pre-handoff/README.md) contains the full LAPM chapter review, selected other-state/federal manuals, competitor/reuse research and explicit reading limits.

## Planning and engineering references

- [Reading an adopted plan](../openplan/docs/READING_AN_ADOPTED_PLAN.md): sourced
  document extraction and human-reviewed use in a plan.
- [Architecture decisions](ADRs/): dated design rationale, including modeling,
  crash-source acquisition and the future MCP server boundary.
- [Operations records index](ops/README.md): source contracts, release evidence,
  migration proof and historical handoffs.
- [Human observation protocol](product/PLANNER_OBSERVATION_PROTOCOL.md): actual planner/recipient and public-participant research, separate from simulated users.
- [First-week harness](../qa-harness/FIRST-WEEK-HARNESS.md): agent discovery,
  outcome verification, evidence capture and limits.
- [Model observation/validation research](modeling/VALIDATION_OBSERVATION_UNCERTAINTY_RESEARCH_2026-08-25.md),
  [frozen nationwide protocol](modeling/NATIONWIDE_VALIDATION_PREREGISTRATION_V1.json)
  and [engine landscape](modeling/OPEN_SOURCE_MODEL_LANDSCAPE.md).

Workers have different environments and contracts. Start with their current
instructions under `workers/`, linked from the self-hosting guide. A successful
one-family suite is not all-worker or full scientific acceptance.

## Historical evidence

[Archived plans](archive/plans/) preserve superseded queues. The [September 6 archive](archive/2026-09-06-consolidation/INDEX.md) retains replaced instructions and guides with original-byte hashes.
[Dated reviews](reviews/), [modeling studies and research](modeling/)
and [ADRs](ADRs/) retain what was known and decided at the time. A later review
may supersede a recommendation without changing the old finding or frozen bytes.

The August 25 independent reviews proposed smaller release sequences; the full
v1 contract supersedes those scope proposals. The September 6 consolidation
supersedes earlier active-roadmap and operator-guide wording where identified
in the review. Historical success claims remain bound to their original source,
build and evidence quality.

Do not commit raw session histories, credentials or confidential client/acceptance
records. Record sanitized findings, source paths, dated review coverage and
appropriate exact evidence hashes. Prior commercial-era deletions remain in Git
history; this consolidation does not repeat a mass deletion.

- [OWP preparation implementation and verification](reviews/2026-09-06-handoffs/OWP_PREPARATION_IMPLEMENTATION.md) — bounded Programs preparation increment and unfinished acceptance evidence.

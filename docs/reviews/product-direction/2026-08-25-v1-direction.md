# OpenPlan v1 direction after the Claude and Codex reviews

<!-- openplan-product-direction-review
review_date: 2026-08-25
review_by: 2026-09-25
reviewed_commit: cb445c4b
current_release: v0.41.0
independent_contexts: 2
trigger: full-codebase-v1-review-and-owner-decision
perspectives:
- transportation-and-travel-model-science
- land-use-statutory-and-development-planning
- environmental-climate-resilience-and-equity
- community-engagement-title-vi-and-public-decisions
- capital-programming-grants-delivery-and-reimbursement
- rural-tribal-small-and-capacity-constrained-agencies
- gis-data-evidence-and-public-records
- agency-operations-accessibility-and-recovery
- adversarial-product-strategy
decisions:
- ultimate-us-planning-operating-system
- all-planner-types
- all-fifty-states-and-dc
- california-gold-standard
- nationwide-validated-dual-demand-model
- no-calendar-or-runtime-scope-reduction
- preserve-independent-disagreement
- recheck-old-agent-decisions
- self-service-free-open-source
- human-control-and-evidence
paths:
- AGENTS.md
- CLAUDE.md
- docs/product/V1_PRODUCT_CONTRACT.md
- docs/product/AGENT_OPERATING_RULES.md
- docs/product/PRODUCT_DIRECTION_REVIEW_PROTOCOL.md
- docs/product/US_PLANNING_CAPABILITY_MATRIX.md
- docs/modeling/VALIDATION_OBSERVATION_UNCERTAINTY_RESEARCH_2026-08-25.md
- docs/ROADMAP.md
- docs/reviews/OPENPLAN_V1_CODEX_REVIEW_2026-08-25.md
- docs/ops/2026-08-25-v1-review-and-roadmap.md
-->

Nathaniel compared independent full-repository reviews from Claude and Codex,
then rejected the smaller shared premise that an honestly disclosed screening
model was sufficient for v1.

## What the reviews agreed on

- OpenPlan's evidence and operational discipline are unusually strong.
- The old roadmap did not define the finished product.
- External GIS/workbook handoff, team approvals, point-of-use model evidence,
  and an independent self-service install remain real gaps.
- The two demand methods must remain separate and must never be averaged.
- Runtime is not an accuracy constraint and six-minute promises were wrong.
- Agentic control must preserve human approval and the fully functional base
  product.

## What they disagreed on

Claude ranked serious-injury data outside California first and proposed four
releases before a stranger test. Codex's live review ranked product coherence
and partly reached outcomes first, expanded the acceptance suite, and verified
that the national FARS fatal-only boundary is already disclosed before live
safety results and in downstream corridor evidence.

The factual safety disagreement is resolved in Codex's favor. Broader injury
sources remain required nationwide coverage work, but the current disclosure is
not absent.

## Nathaniel's decision

The v1 target is not an honest minimum. It is the ultimate operating system for
planning practice, free to the profession, usable by any type of planner in the
United States. All states must work, California must be the gold-standard
implementation, and the travel demand model must be fully working and validated
nationwide. A year or more of additional work is acceptable; finishing this
decade is more important than cutting v1 soon.

Nathaniel also delegated product and engineering trajectory to future agents.
Past agent decisions and repository rules may be amended when fresh evidence
shows they constrain the goal. A new agent receiving "do what's next" must
start at the 30,000-foot product contract, challenge stale assumptions, then
select and begin the highest-leverage completed outcome.

## Engineering interpretation

"Ultimate" is made testable through coverage, not asserted as marketing copy.
The v1 gate covers planner roles, organization types, core practices, every
state, geographic archetypes, artifacts, accessibility, operations, and
independent adversarial review. Missing and unassessed cells fail.

"Validated nationwide model" means every state and required geographic
archetype passes preregistered untouched holdout gates for the use claimed. A
national average cannot hide regional failure. The repository's 43.3% median
APE was measured on the roughly 30% selection holdout from a 57-station,
one-county dataset, not an independent national acceptance set. The blocker is
that nationwide accuracy is unknown. It is not repaired by a scalar sweep or
by fitting noisy observations exactly.

"California flawless" means full configured depth, every geography and core
journey, no undisclosed Blocker or High defect, usable artifacts, and proven
recovery. It cannot honestly mean that every estimate equals an unknowable true
value.

The former absolute ban on new modules is narrowed. Existing modules remain the
default home. A periodic product-direction review may require a new module when
a core planning need has no coherent owner and existing code or a suitable
open-source library cannot fill it.

## Mechanism added

The product-direction protocol requires fresh independent opinions at least
monthly, at roadmap milestones, and when stronger models appear. A local command
generates the evidence packet without spending money. The release gate fails
when the latest review expires or loses required perspectives, decisions, or
source references.

The local `AGENTS.md` and `CLAUDE.md` files are now short harness shims pointing
to one tracked operating manual. This removes duplicated dated history and makes
future rule changes reviewable and pushable instead of allowing the last local
writer to win silently.

This record supersedes the release counts and scope order in both independent
reports. Their original conclusions remain visible as evidence of what each
reviewer concluded before Nathaniel decided the product direction; later
correction notes and the HTML companion identify the supersession rather than
silently presenting the smaller scope as current.

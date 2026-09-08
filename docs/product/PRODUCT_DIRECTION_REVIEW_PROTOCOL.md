# Product-direction review protocol

OpenPlan must keep asking whether it is becoming the ultimate planning operating
system rather than merely completing the nearest module backlog. This protocol
turns that obligation into a recurring check.

## Triggers

The [development release policy](DEVELOPMENT_RELEASE_POLICY.md), adopted by
Nathaniel on September 7, 2026, governs interim releases.

Review direction when a substantial scope decision needs it, evidence contradicts
the roadmap, or Nathaniel requests reassessment. Aim for a monthly check-in as a
reminder. A new model's availability is an opportunity to reconsider difficult
questions, not an automatic interruption of development. Routine fixes and
bounded features do not require a new whole-product review.

`npm run product:direction:check` checks evidence integrity and reports overdue
reviews and intervening changes as reminders. Review dates remain historical;
never advance them just to clear CI. The command is available explicitly, while
its integrity tests remain in QA. Strategy freshness is not a release gate.

## Prepare the evidence packet

Run from `openplan/`:

```bash
npm run product:direction:packet > /tmp/openplan-product-direction-review.md
```

The command captures the current release, commit, tags, recent history, codebase
inventory, canonical contract, roadmap, and the questions below. It does not
call a model, spend credits, or publish anything.

For a full independent strategic review, give the packet to two fresh-context
agents when the decision warrants that cost. Bounded maintenance can use a
single technical review. Do not tell
later reviewers the earlier conclusion before they produce their own. Each may
read the repository and histories, but must begin from the evidence packet and
reconstruct current state.

## Required perspectives

The combined review must explicitly examine:

- transportation and travel-model science;
- land-use, statutory, and development planning;
- environmental, climate, resilience, and equity practice;
- community engagement, Title VI, and public decision-making;
- capital programming, grants, delivery, and reimbursement;
- rural, tribal, small-agency, and capacity-constrained use;
- GIS, data interoperability, evidence custody, and public records;
- agency operations, collaboration, accessibility, installation, and recovery;
- adversarial product strategy: what obvious high-leverage need has every prior
  agent missed?

## Questions every fresh review answers

1. If you were a planner contributing this software to the profession for free,
   what would make it the ultimate planning operating system?
2. Can every type of US planner do their core work here? Name the missing or
   shallow jobs, including ones outside the current module map.
3. Does every state work in substance, not merely degrade honestly?
4. Is California the gold-standard implementation across all its geographies
   and agency types?
5. Are both travel models scientifically validated for every published use, in
   every state, without a national aggregate hiding regional failure?
6. What is the simplest overlooked idea with the largest product effect?
7. Which old rule, agent decision, architecture, or roadmap item is now wrong?
8. What should be removed, joined, or made deeper before anything new is added?
9. What evidence would prove the recommendation wrong?
10. What is the highest-leverage next completed outcome, viewed from v1 rather
    than from the nearest code seam?

## Synthesis rules

- Preserve independent reports unchanged.
- Separate agreement, disagreement, Nathaniel's product decisions, and the
  synthesizer's engineering judgment.
- Do not vote, average, or choose the smaller scope because it is easier.
- Check every factual disagreement against source or live behavior.
- Convert accepted direction into the product contract, roadmap, coverage
  matrix, executable checks, and a dated review record.
- Record uncertainty and the evidence that would settle it.
- When changing a guard, prove a relevant broken record is rejected and a
  harmless change survives. Repeating mutation work for an unchanged guard at
  every documentation checkpoint is not required.

## Dated record format

Records live under `docs/reviews/product-direction/` and contain one
`openplan-product-direction-review` metadata block. The checker requires a
review date, review deadline, release, real Git commit, independent-context
count, required perspectives, decisions, and source paths. The latest dated
record is the active one; older records remain honest history.

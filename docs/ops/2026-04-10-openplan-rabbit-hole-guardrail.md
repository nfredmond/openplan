# OpenPlan Rabbit-Hole Guardrail and Next Execution Sequence

Date: 2026-04-10  
Owner: Bartholomew Hale  
Status: Active execution guardrail

## Why this note exists

The recent RTP registry work materially improved operator usability, but the queue-summary lane is now close to diminishing returns.

That means the decision rule changes here:
- keep the RTP queue/operator surface **useful and shippable**,
- stop spending cycles on low-compounding sidebar polish,
- move to the next slice that strengthens the broader OpenPlan operating spine.

## Current judgment

### Good enough to stop polishing for now
The RTP registry now has:
- packet queue triage,
- row-level and bulk actions,
- queue trace health,
- recommended next action guidance,
- ranked lane navigation.

That is enough operator signal for the current RTP packet queue lane.

### Not yet good enough in the broader product
The project controls shell still lacks the single most important operator affordance described in prior planning docs:
- **one recommended next action** tied to current milestone, submittal, and invoice posture.

That gap matters more than another round of RTP queue cosmetics because project controls compound into:
- RTP delivery,
- grants workflow,
- reimbursement/invoicing,
- stage-gate readiness,
- and later LAPM-oriented operator support.

## Immediate execution rule

### Stop doing, unless a real defect appears
- additional RTP queue-card ornamentation,
- more badge/chip rearrangement,
- more count reshuffling without new workflow value,
- duplicated shortcut patterns that do not change operator throughput.

### Start doing now
1. Add **recommended next action** to the project controls shell.
2. Add a reusable deadline / attention posture layer for project controls.
3. Feed those project-control signals back into RTP and grants surfaces later.

## Next sequence

### Slice 1
**Project controls shell — recommended next action**

Acceptance target:
- project detail clearly answers: what is the next safe operator move right now?
- action is derived from milestone, submittal, and invoice posture
- output is plain-language and visibly honest

### Slice 2
**Project controls shell — attention/deadline layer**

Acceptance target:
- upcoming / overdue control items are grouped in one operator-ready view
- deadlines are reusable across milestones, submittals, invoices, and later grants

### Slice 3
**Cross-module reuse**

Acceptance target:
- RTP and grants can consume project-control posture instead of inventing parallel health logic

### Slice 4
**Standards-first scenario/data spine**

Acceptance target:
- OpenPlan has explicit baseline/branch/assumption contracts for scenarios
- data/network package flows follow shared provenance and standards-aware rules instead of accumulating one-off module logic

### Slice 5
**Reusable indicator contracts**

Acceptance target:
- accessibility, equity, and environmental outputs can be stored and reused across modeling, RTP, reports, and public-facing plan narratives

## Research-driven guardrail update (2026-04-10)

The new deep-research synthesis changes what counts as high-compounding follow-on work after the control-room lane.

### Also defer unless it clearly compounds
- isolated dashboard ornamentation with no scenario or operator value,
- one-off data integrations that ignore reusable standards/contracts,
- modeling UI expansion that is not tied to a shared scenario/evidence contract,
- product-language drift that implies a full planning super-app before the shared data/scenario spine is real.

### Prioritize next after the current control-shell lane
1. shared scenario/versioning contracts,
2. standards-first data and network package contracts,
3. reusable accessibility/equity/environment indicator posture,
4. modeling and RTP/grants integration through those shared contracts.

## Decision rule

If a next slice improves:
- trust,
- operator throughput,
- cross-module reuse,
- or control-room determinism,

it is in scope.

If it only improves local cosmetics inside the RTP queue card, defer it.

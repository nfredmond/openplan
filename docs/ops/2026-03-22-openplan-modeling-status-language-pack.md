# OpenPlan — Modeling Status Language Pack

**Date:** 2026-03-22  
**Author:** Elena Marquez, Principal Planner  
**Lane:** Governance / claims control only  
**Basis:**
- `docs/ops/2026-03-22-openplan-nevada-county-modeling-truth-memo.md`
- `docs/ops/2026-03-22-openplan-nevada-county-observed-count-validation-setup.md`

## Purpose
This note standardizes the only three modeling status labels that should be used right now:
1. `internal prototype only`
2. `bounded screening-ready`
3. `not ready for outward modeling claims`

This is a **language-control document**, not a modeling-method document. It adds **no new assumptions** and does not change the governing methodological record.

---

## Governing truth constraints
Any modeling language must preserve the following facts from the current governing record:
- the Nevada County lane is currently **screening-grade**, not behavioral demand,
- the current run is **uncalibrated** and **closed-boundary**,
- the canonical run has **no observed-count validation completed yet**,
- the current run leaves a material share of demand **unroutable**,
- current ActivitySim work is **not proven execution**, and
- no outward claim should imply calibration, validation, behavioral realism, or client-ready forecasting.

---

## 1) Status: `internal prototype only`

### Use when
Use this status when any of the following are true:
- observed counts are still missing,
- the count-to-link crosswalk is not complete,
- fewer than 3 observed sites can be matched cleanly,
- the first validation slice is not yet complete,
- or the initial comparison does not show directionally credible screening performance.

This matches Adrian’s current gate posture.

### Approved internal wording
- "OpenPlan currently has an internal Nevada County modeling prototype for AequilibraE-based screening workflows."
- "The current lane proves a real artifact-producing screening run, but it is still internal prototype status until the bounded observed-count validation slice is completed."
- "This is screening-only prototype work, not behavioral demand and not validated forecasting."

### Approved outward/client-safe wording
Use only restrained wording if modeling must be referenced at all:
- "OpenPlan includes an early internal prototype for transportation screening workflows."
- "Current modeling-related work is still in internal prototype review and is not being presented as validated forecasting."

### Required caveats
Always preserve:
- internal prototype,
- screening-only,
- uncalibrated,
- not behavioral demand,
- not validated.

### Allows
- internal planning discussions,
- internal artifact review,
- internal method/governance conversations,
- narrow mention that an early prototype exists.

### Disallows
- any claim of validated model performance,
- any claim of behavioral demand capability,
- any claim of client-ready forecast quality,
- any claim that observed counts have already been matched,
- any strong outward marketing language centered on modeling capability.

---

## 2) Status: `bounded screening-ready`

### Use when
Use this status **only if Adrian’s validation gate is met**, meaning:
- the validation slice is run on the canonical Nevada County OSM bundle,
- at least 3 observed count locations are matched cleanly,
- the results are directionally credible under the documented rubric,
- and all language still preserves screening-only / uncalibrated / closed-boundary limitations.

This is not a behavioral or forecast-ready status.

### Approved internal wording
- "The Nevada County lane is bounded screening-ready for a narrow, caveated discussion of assignment/accessibility outputs on the validated slice."
- "The current run remains uncalibrated and non-behavioral, but the first observed-count slice supports bounded screening discussion on the matched facilities."

### Approved outward/client-safe wording
- "OpenPlan has a bounded screening prototype for selected network assignment/accessibility discussions, with explicit caveats and without validated forecasting claims."
- "Current modeling outputs are appropriate only for limited screening discussion on a narrow validated slice, not for full forecasting or behavioral demand claims."

### Required caveats
Always preserve:
- bounded,
- screening-ready,
- uncalibrated,
- closed-boundary,
- not behavioral demand,
- not client-ready forecasting,
- limited to the validated slice / matched facilities.

### Allows
- narrow outward mention that a bounded screening slice exists,
- limited internal/external discussion of assignment/accessibility prototype capability,
- explicit discussion of what the validated slice does and does not support.

### Disallows
- claiming countywide validation,
- claiming calibrated network performance,
- claiming scenario/forecast credibility beyond the validated slice,
- implying ActivitySim or broader behavioral stack readiness,
- implying full product feature superiority on modeling breadth.

---

## 3) Status: `not ready for outward modeling claims`

### Use when
Use this status whenever the safest governance posture is to **exclude modeling from public value claims entirely**.
This status is especially appropriate when:
- the proof exists only as internal prototype evidence,
- validation is incomplete,
- package/run integrity caveats are still prominent,
- or outward messaging can succeed without leaning on modeling.

### Approved internal wording
- "The modeling lane should not be used in outward claims at this time."
- "Keep modeling in internal governance and technical review only until the next proof gate is passed."

### Approved outward/client-safe wording
Preferred approach: **do not foreground modeling at all**.
If a reference is unavoidable, use only:
- "Additional modeling-related capabilities remain under internal evaluation and are not part of the current outward claim set."

### Required caveats
Always preserve:
- not outward-claim ready,
- under internal evaluation,
- no validated modeling claim,
- no behavioral or forecast claim.

### Allows
- silence on modeling in public-facing materials,
- product/value positioning around proven planning, workflow, reporting, or engagement surfaces instead,
- internal-only discussion of modeling next steps.

### Disallows
- modeling-led marketing language,
- comparisons implying modeling breadth leadership,
- any statement suggesting forecast-grade readiness,
- any statement suggesting the modeling lane is already a differentiated external selling point.

---

## Current recommendation
### Recommended current internal status
**`internal prototype only`**

Reason:
- Adrian’s truth memo states that the current lane proves a real screening workflow but not a behavioral, calibrated, or client-ready model.
- The observed-count validation setup explicitly says to keep the lane at `internal prototype only` if observed counts are still missing.
- The current blocker remains: **no observed-count inputs are present locally and the first bounded validation slice has not yet been completed.**

### Recommended current outward status
**`not ready for outward modeling claims`**

Reason:
- outward modeling claims would currently outrun the evidence,
- the strongest honest near-term position is still prototype/internal,
- and current public-facing differentiation should not depend on modeling language until the bounded validation gate is passed.

### Upgrade rule
Do **not** upgrade to `bounded screening-ready` until the canonical observed-count validation slice is completed and passes the documented rubric.

---

## Bottom line
For now, the cleanest truthful posture is:
- **internally:** `internal prototype only`
- **externally:** `not ready for outward modeling claims`

If the observed-count validation slice lands cleanly, the lane may be upgraded to **`bounded screening-ready`** — but only for narrow, caveated screening language, not for behavioral or forecast claims.
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

## Update — 2026-03-23
Observed counts are now present locally and Nevada validation has been executed, including experimental v2/v3 demand/connector iterations. The lane still does **not** clear the documented `bounded screening-ready` gate, so the recommended statuses remain unchanged: **internally `internal prototype only`, externally `not ready for outward modeling claims`**.

For the current checkpoint record, see:
- `docs/ops/2026-03-23-openplan-screening-validation-tooling-checkpoint.md`

## Update — 2026-03-24
Nevada reusable-runtime validation improved materially after:
- removing the node-renumbering defect,
- tightening the count-station definitions to mainline-only matching,
- and applying a **Nevada-specific overall-demand scalar**.

Current best documented Nevada result:
- `docs/ops/2026-03-24-openplan-nevada-bounded-screening-ready-scalar-0369.md`
- status label: **`bounded screening-ready`**
- median APE: **27.18%**
- max APE: **49.77%**
- matched stations: **5 / 5**

This is a **real upgrade in the Nevada screening lane**, but it does **not** replace the core truth constraints below. The upgrade is narrow and conditional:
- Nevada-specific,
- screening-grade only,
- dependent on a county-specific scalar (`0.369`),
- not transferable to other counties without local validation,
- and still **not ready for outward modeling claims** unless the outward statement explicitly preserves those limits.

---

## Governing truth constraints
Any modeling language must preserve the following facts from the current governing record:
- the Nevada County lane is currently **screening-grade**, not behavioral demand,
- the current run is **uncalibrated** and **closed-boundary**,
- observed-count validation now exists locally and the current Nevada-specific run can satisfy the provisional `bounded screening-ready` gate,
- that pass depends on a **Nevada-specific overall-demand scalar** and therefore does **not** imply default runtime readiness elsewhere,
- current ActivitySim work is **not proven execution**, and
- no outward claim should imply calibration, behavioral realism, county-transferable validation, or client-ready forecasting.

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
- "The current Nevada run remains uncalibrated and non-behavioral, but the corrected mainline observed-count slice supports bounded screening discussion on the matched facilities."
- "Nevada currently clears the provisional bounded screening gate only under a county-specific overall-demand scalar, so this is a local screening control setting rather than a default runtime claim."

### Approved outward/client-safe wording
- "OpenPlan has a bounded screening prototype for selected Nevada County network assignment/accessibility discussions, with explicit caveats and without validated forecasting claims."
- "Current Nevada modeling outputs are appropriate only for limited screening discussion on a narrow validated slice, not for full forecasting or behavioral demand claims."
- "This Nevada screening result reflects a county-specific prototype setting and should not be read as a universal model-validation claim."

### Required caveats
Always preserve:
- bounded,
- screening-ready,
- uncalibrated,
- closed-boundary,
- not behavioral demand,
- not client-ready forecasting,
- Nevada-specific / county-specific when referring to the current pass,
- dependent on the validated slice / matched facilities,
- and not transferable by default to other counties.

### Allows
- narrow outward mention that a bounded screening slice exists,
- limited internal/external discussion of assignment/accessibility prototype capability,
- explicit discussion of what the validated slice does and does not support.

### Disallows
- claiming countywide validation beyond the documented Nevada slice,
- claiming calibrated network performance,
- claiming scenario/forecast credibility beyond the validated slice,
- implying ActivitySim or broader behavioral stack readiness,
- implying full product feature superiority on modeling breadth,
- implying that the Nevada-specific scalar is a general runtime default.

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
**`bounded screening-ready`** for the **Nevada-specific validated slice only**

Reason:
- the corrected mainline observed-count slice now passes the provisional bounded screening gate under the documented Nevada-specific overall-demand scalar of `0.369`,
- the run is reproducible in the reusable runtime,
- and the current remaining guardrail issue is scope control, not basic pass/fail on the documented Nevada slice.

### Recommended current outward status
**`not ready for outward modeling claims`** unless the statement is extremely narrow and caveated

Reason:
- outward modeling claims would still be easy to overstate,
- the current pass is Nevada-specific rather than universally transferable,
- and the safest public/default posture is still to avoid modeling-led claims unless the exact caveated Nevada slice is what is being discussed.

### Upgrade rule
Use `bounded screening-ready` only when the statement explicitly preserves the documented constraints of the current Nevada result. Do **not** generalize the upgrade to other counties or to behavioral / forecast-ready claims.

---

## Bottom line
The cleanest truthful posture is now:
- **internally (Nevada validated slice only):** `bounded screening-ready`
- **externally/default public posture:** `not ready for outward modeling claims`

That is not a contradiction. It reflects the actual evidence:
- Nevada now has a narrow, caveated, county-specific bounded screening result,
- but public/default modeling language should still remain highly restrained unless the exact Nevada slice and its caveats are being stated explicitly.
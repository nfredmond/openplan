# OpenPlan Engagement — Bounded UX / Design Support Audit

**Date:** 2026-03-22  
**Owner:** Camila Reyes  
**Lane:** OpenPlan Priority #2 — Engagement support only  
**Posture:** design/UX guidance artifact only; no builder-file or implementation overlap with #1 LAPM / PM / invoicing

---

## Purpose

This memo provides a **bounded engagement-surface design audit** intended to improve the operator-facing and public-engagement quality of OpenPlan’s Engagement lane **without colliding with #1 execution work**.

It is deliberately limited to:
- information hierarchy,
- moderation/operator UX,
- submission-flow clarity,
- campaign presentation quality,
- engagement-to-report handoff clarity.

It does **not** prescribe billing, PM, invoice, or builder-flow changes.

---

## Executive Assessment

OpenPlan Engagement is already positioned as a credible operator lane because it now supports:
- campaign catalog,
- campaign detail,
- category/item handling,
- moderation state,
- and report handoff.

The biggest opportunity is **not more feature breadth**. It is **clarity**.

The engagement surface should feel like:
1. a trusted planning-operations intake surface,
2. a moderation console with clear decision posture,
3. a traceable bridge from input → campaign review → report packet.

Right now, the highest-value UX/design improvement is to make the lane more legible around **campaign status, moderation workload, category clarity, and handoff readiness**.

---

## Recommended UX Priorities (bounded)

### Priority A — Stronger campaign hierarchy on catalog and detail

#### Why it matters
Operators need to understand campaign state at a glance before acting. A campaign list that is merely "a list of campaigns" forces unnecessary scanning.

#### Guidance
Each campaign card/row should visually prioritize, in this order:
1. **Campaign title**
2. **Project linkage**
3. **Campaign status** (`draft`, `active`, `closed`, `archived`)
4. **Engagement type**
5. **Open moderation workload**
6. **Recent activity / last updated cue**

#### Design implication
The catalog should read like an operations dashboard, not a neutral database table.

#### Smallest recommended presentation upgrade
For each campaign card/row, add a compact metadata stack:
- Project name
- Status badge
- Type badge
- Pending items count
- Last activity timestamp

---

### Priority B — Make moderation workload visually explicit

#### Why it matters
Moderation is the operator pressure point. If pending/flagged/rejected states are visually weak, the Engagement lane loses its operational usefulness.

#### Guidance
On campaign detail, elevate a **moderation summary strip** above the item list:
- Pending
- Approved
- Flagged
- Rejected
- Uncategorized (if applicable)

#### Design implication
The user should understand the moderation situation before reading individual items.

#### Smallest recommended presentation upgrade
A compact status summary row with counts and urgency treatment:
- `Pending` = primary attention state
- `Flagged` = caution state
- `Approved` = stable state
- `Rejected` = low-emphasis archival state

---

### Priority C — Clarify category meaning so engagement data is reviewable

#### Why it matters
If categories are present but semantically weak, public input becomes hard to review, summarize, and defend.

#### Guidance
Each category should be visually and semantically legible as a planning theme, not just a label.

Recommended category presentation fields:
- label
- short description
- item count
- sort order/context

#### Design implication
Category blocks should help the operator understand what the campaign is actually collecting.

#### Smallest recommended presentation upgrade
Where categories are listed, include a one-line description and item count. Avoid showing categories as bare chips only.

---

### Priority D — Improve item readability for real moderation work

#### Why it matters
Engagement items need fast triage. Operators should not need to decode each record line-by-line.

#### Guidance
Each item row/card should clearly separate:
1. **What was submitted**
2. **How it was classified**
3. **What moderation state it is in**
4. **Any spatial/source context**

#### Preferred item hierarchy
- item title or short excerpt
- body snippet
- category
- source type
- status
- location context (if available)
- submitted/updated timestamp

#### Smallest recommended presentation upgrade
Give each item a readable two-zone layout:
- left = content/excerpt
- right = status/category/source metadata

This preserves density while reducing review friction.

---

### Priority E — Make report handoff readiness explicit

#### Why it matters
The 2026-03-17 handoff slice is strategically important. If the UI does not clearly signal handoff readiness, the engagement lane remains operationally under-expressed.

#### Guidance
The campaign detail view should make it obvious when a campaign is ready to become a handoff report.

Recommended readiness cues:
- linked project present
- categories defined
- items moderated to a reviewable threshold
- campaign status is appropriate for handoff

#### Design implication
The handoff action should feel like a natural transition from review → packet creation, not a hidden power-user step.

#### Smallest recommended presentation upgrade
Add a compact **Handoff readiness** panel with simple yes/no checks:
- Project linked
- Categories present
- Reviewed items present
- Campaign active/closed

This is a design-surface recommendation only; no data-model expansion required.

---

## Public/input-side clarity guidance

Even if V1 is still operator-led, the submission surface should read as trustworthy and specific.

### Submission clarity principles
1. Tell the user **what this campaign is about** in one sentence.
2. Tell them **what type of input is useful**.
3. Tell them **what happens after submission**.
4. Tell them **whether location, category, or follow-up info is optional**.

### Recommended submission framing block
Every submission surface should answer:
- What are we collecting?
- Why are we collecting it?
- How will it be used?
- What should a good submission include?

### Smallest presentation upgrade
Use a short “Before you submit” helper block above item intake instead of relying only on field labels.

---

## Operator UX guidance for campaign detail

The campaign detail page should visually support this workflow order:
1. understand campaign context,
2. assess moderation workload,
3. review categories,
4. scan recent items,
5. decide whether to moderate or hand off.

### Recommended panel order
1. Campaign header
2. Moderation summary
3. Handoff readiness
4. Category registry
5. Recent / pending items
6. Operator actions

This ordering improves engagement review without creating overlap with reporting or invoicing work.

---

## Information hierarchy recommendations

### Engagement catalog
Use a three-level hierarchy:
- **Primary:** title + project
- **Secondary:** status, type, summary
- **Operational:** counts, moderation burden, last activity

### Campaign detail
Use a four-level hierarchy:
- **Context** — what campaign is this?
- **Workload** — what needs review?
- **Structure** — how is input organized?
- **Action** — what should the operator do next?

---

## Copy guidance

### Prefer
- "Pending review"
- "Ready for handoff"
- "Linked project"
- "Reviewed items"
- "Category coverage"
- "Recent public input"
- "Operator notes"

### Avoid
- overly generic labels like "Data" or "Manage"
- unlabeled count pills
- status language that does not indicate operational meaning

---

## Recommended non-colliding next design slices

These are deliberately chosen to avoid overlap with #1:

### Slice 1 — Engagement catalog clarity pass
Documentation + design-only guidance for campaign card hierarchy, status treatment, and moderation burden signals.

### Slice 2 — Campaign detail moderation/readiness wire guidance
Documentation + design-only guidance for panel ordering and readiness cues.

### Slice 3 — Submission clarity microcopy pack
Short helper copy recommendations for input quality and expectation-setting.

---

## Explicit boundary

This artifact does **not** recommend or authorize work in:
- LAPM / PM / invoicing builders,
- billing/auth expansion,
- schema redesign,
- AI synthesis features,
- modeling features,
- dashboard work,
- unrelated OpenPlan product lanes.

It is intended as a **mergeable design support checkpoint** for Engagement only.

---

## Most useful immediate handoff

If Nathaniel wants the smallest viable engagement-support output, the best immediate use of this artifact is:

1. treat it as the **design review reference** for the Engagement lane,
2. pull only the **catalog clarity**, **moderation summary**, and **handoff readiness** recommendations first,
3. keep all implementation separate from #1 builder work.

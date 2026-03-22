# OpenPlan — Priority Order Governance Lock

Date: 2026-03-22  
Author: Elena Marquez, Principal Planner  
Status: Active standing operating policy (governance / closure support lane)

## Canonical execution order
Nathaniel has set the OpenPlan execution order as follows:

1. **LAPM / PM / invoicing** — clearest near-term operational value
2. **Engagement** — strongest public-facing differentiation
3. **AI copilot** — valuable once app surfaces are stable
4. **Modeling combo** — highest upside, but easiest to let balloon

This order is now the governing priority stack for OpenPlan support work unless Nathaniel explicitly overrides it.

---

## Governance application rules

### Rule 1 — No lower-priority expansion while #1 or #2 is blocked
If **LAPM / PM / invoicing** or **Engagement** has an unresolved blocker, do not open new feature scope in:
- AI copilot
- Modeling combo
- adjacent “nice to have” platform ideas

Allowed work below #1/#2:
- only documentation, evidence capture, or tightly bounded dependency clarification needed to unblock higher priorities.

### Rule 2 — Smallest viable unblock path only
If something is blocking #1 or #2, support should surface:
1. the exact blocker,
2. why it blocks the priority,
3. the **smallest viable unblock path**,
4. who owns it,
5. what evidence closes it.

No broad redesign recommendations when a smaller unblock path exists.

### Rule 3 — Migration / application order follows value order
When sequencing migrations, implementation, or release-gate attention:
- first protect **LAPM / PM / invoicing** surfaces and dependencies,
- then protect **Engagement** surfaces and dependencies,
- then allow **AI copilot** only where upstream app surfaces are stable,
- keep **Modeling combo** explicitly bounded to avoid scope ballooning.

### Rule 4 — Client-safe claims must track actual surface readiness
Do not let public/internal language imply that OpenPlan is broadly “AI-powered” or “full-stack modeling-ready” if the operationally valuable surfaces still needing proof are #1 and #2.

Claim posture should stay honest:
- operational value first,
- engagement differentiation second,
- AI/copilot value only where actually shipped and stable,
- modeling claims only where bounded, evidenced, and non-inflated.

### Rule 5 — No side quests
Support work should be rejected or deferred if it does not clearly do one of the following:
- unblock #1,
- unblock #2,
- document a release gate for #1 or #2,
- reduce claim risk for #1 or #2.

If it does not help those outcomes, it is not current-priority work.

---

## Priority-specific governance lens

### #1 LAPM / PM / invoicing
Primary governance questions:
- Is the workflow operationally usable end to end?
- Are release gates tied to real municipal/project-management value?
- Are migration/application steps sequenced to protect billing, PM discipline, and staff usability?
- Are claims framed as actual workflow support, not vague admin transformation?

### #2 Engagement
Primary governance questions:
- Is engagement support concrete and externally differentiating?
- Does it improve what agencies/public users can actually see or do?
- Are claims client-safe and evidence-backed?
- Is it being shipped after, not instead of, #1 operational closure?

### #3 AI copilot
Primary governance posture:
- keep bounded,
- require stable upstream surfaces,
- do not let copilot language outrun actual workflow quality.

### #4 Modeling combo
Primary governance posture:
- highest risk of scope creep,
- no ballooning,
- only tightly scoped movement after #1 and #2 are credibly advancing.

---

## Escalation standard
Surface an escalation immediately if any of the following occurs:
- lower-priority work is consuming attention while #1 or #2 has unresolved blockers,
- release claims outrun demonstrated readiness,
- migration/application order puts lower-value surfaces ahead of LAPM / PM / invoicing,
- modeling scope begins expanding without a bounded proof plan,
- engagement work becomes generic rather than differentiating.

Escalations should be crisp:
- blocker,
- risk,
- smallest viable correction,
- owner.

---

## Bottom line
The team should now behave as though OpenPlan success is defined in this order:
1. **make the operational core real and usable**,
2. **make engagement visibly differentiated**,
3. **layer AI only on stable surfaces**,
4. **contain modeling ambition until the first three are honest.**
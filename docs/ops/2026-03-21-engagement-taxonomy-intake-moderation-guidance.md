# OpenPlan Engagement — Taxonomy, Intake-Source, and Moderation Guidance

**Date:** 2026-03-21  
**Status:** ready for operator use  
**Scope:** Lane A support only; aligned to current shipped schema

## Why this guidance exists

The current engagement module already supports real campaigns, categories, item sources, moderation statuses, map coordinates, and handoff reporting.

The main remaining risk is **operator inconsistency**, not missing theory:
- similar campaigns named different ways,
- categories created ad hoc with no durable structure,
- source types used inconsistently,
- moderation statuses interpreted differently by different reviewers,
- report handoffs weakened by uncategorized or poorly documented items.

This guide standardizes those choices without requiring schema changes.

---

## 1) Campaign taxonomy

## Use the current `engagement_type` values as campaign archetypes

### `map_feedback`
Use when the campaign is primarily about **place-based comments tied to a location**.

Best fit:
- corridor safety issues
- sidewalk and crossing gaps
- bikeway comfort concerns
- transit stop access problems
- downtown curb/loading issues
- place-specific improvement ideas

Operator expectation:
- geolocation should be pursued whenever feasible
- categories should support spatial summarization
- report handoff should mention mapped coverage and non-geolocated residuals

### `comment_collection`
Use when the campaign is primarily about **general feedback, priorities, tradeoffs, or reactions** that may not map cleanly.

Best fit:
- plan vision comments
- alternatives feedback
- general concerns/support
- priorities ranking comments captured manually
- web or social response summaries

Operator expectation:
- category discipline matters more than map coverage
- `submitted_by` and `source_type` need to be especially clean for traceability

### `meeting_intake`
Use when the campaign is primarily an **operator-owned intake lane for meetings, open houses, workshops, walking audits, or stakeholder sessions**.

Best fit:
- workshop notes
- breakout-board transcription
- pop-up event comments
- focus group notes
- agency/stakeholder meeting observations

Operator expectation:
- `source_type` will often be `meeting`
- `submitted_by` should reference the meeting/session source, not necessarily a named individual
- moderation notes should distinguish direct comments from staff interpretation or consolidation

---

## 2) Campaign naming convention

Use this structure whenever possible:

`[place / corridor / project shorthand] — [decision topic] — [phase or window]`

Examples:
- `Downtown & School Access — Safety Map Feedback — Spring 2026`
- `SR 49 Corridor Plan — Community Priorities — Alternatives Window`
- `Westside Transit Plan — Open House Intake — Round 1`

### Naming rules
- Lead with the place, corridor, or project people actually recognize.
- Make the decision topic plain-English, not internal jargon.
- Include the phase, round, or time window when the campaign is not one-off.
- Avoid vague titles like `Community Input`, `Feedback`, or `Workshop Notes` by themselves.

---

## 3) Category taxonomy

Categories are currently freeform labels. That is good for speed, but only if operators reuse strong starter kits instead of inventing labels every time.

## Universal category design rules

Every campaign should aim for categories that are:
- understandable to a planner and non-planner,
- broad enough to reuse across many comments,
- narrow enough to separate materially different issues,
- auditable in a future report.

Avoid categories that are:
- duplicate near-synonyms,
- too vague (`general`, `misc` as a primary bucket),
- really status labels in disguise,
- really source labels in disguise,
- internal-only shorthand that a future reviewer cannot decode.

## Recommended starter kit — transportation / place-based map campaigns

Use these first for `map_feedback` unless the project clearly needs something else:
- `Crossing safety`
- `Sidewalks and accessibility`
- `Bicycle comfort and network gaps`
- `Transit access and stops`
- `Speeding and driver behavior`
- `Parking, loading, and curb use`
- `Maintenance, lighting, and visibility`
- `Public space and placemaking`
- `Support / positive signal`
- `Other / needs follow-up`

## Recommended starter kit — general comment campaigns

Use these first for `comment_collection`:
- `Safety concerns`
- `Access and connectivity`
- `Project support`
- `Project concerns / tradeoffs`
- `Equity and inclusion`
- `Parking and traffic operations`
- `Transit and mobility options`
- `Land use / place quality`
- `Implementation / funding questions`
- `Other / uncoded`

## Recommended starter kit — meeting intake campaigns

Use these first for `meeting_intake`:
- `Participant priorities`
- `Safety issues`
- `Access / ADA`
- `Transit and active transportation`
- `Operational constraints`
- `Questions needing follow-up`
- `Support / consensus signal`
- `Concerns / opposition signal`
- `Implementation ideas`
- `Staff observations`

## Category description guidance

Descriptions should explain **what belongs in the category**, not just repeat the label.

Examples:
- `Crossing safety` → `Crosswalk visibility, crossing distance, turning conflicts, school pickup conflicts, and near-miss locations.`
- `Parking, loading, and curb use` → `Short-term parking, delivery access, pickup/drop-off activity, curb conflicts, and loading turnover concerns.`
- `Support / positive signal` → `Comments expressing support, appreciation, or reinforcement of a proposal without a separate primary issue.`

---

## 4) Source type guidance

The current source types are enough if they are used consistently.

## `public`
Use when the input came from a public-facing feedback path or is being treated as direct public comment.

Examples:
- web form submission
- map pin left by a participant
- comment card transcribed as direct public comment
- phone feedback entered as a verbatim public comment

Do **not** use `public` for:
- staff summaries of a meeting unless the actual intake lane was a meeting
- internal synthesis memos
- email threads between project team members

## `meeting`
Use when the comment came from a meeting or event context.

Examples:
- workshop sticky note transcription
- open house board comment
- walking audit note
- focus group observation
- pop-up booth input

Use `submitted_by` like:
- `Open house board A`
- `Walking audit participant`
- `Stakeholder roundtable note`
- `Workshop breakout table 2`

## `email`
Use when the intake record came from email, whether from a resident, stakeholder, or organization.

Examples:
- resident email forwarded to project inbox
- business-owner email comment
- advocacy group written feedback

Use `submitted_by` like:
- `Resident email`
- `School district email`
- `Business owner email`

Do not paste unnecessary personal contact information into the item body.

## `internal`
Use when the item is an operator-created internal record rather than direct external submission.

Examples:
- staff observation from a site visit
- internal synthesis note that still belongs in engagement traceability
- duplicate consolidation record
- QA/test content in a non-production environment

### Important rule
If a member of the public said it directly, prefer `public`, `meeting`, or `email` over `internal`.

`internal` should not become a lazy default for everything manually entered.

---

## 5) Recommended `submitted_by` conventions

Keep `submitted_by` short, useful, and privacy-aware.

Prefer:
- source label
- participant role
- event name
- organization label when relevant

Examples:
- `Resident web comment`
- `Open house participant`
- `Workshop table 3`
- `Business owner email`
- `Staff site visit note`
- `Parent near school pickup`

Avoid:
- full personal addresses
- phone numbers
- unnecessary email addresses
- editorial labels like `angry resident` or `confused stakeholder`

---

## 6) Moderation-status guidance

These statuses should be treated as **internal review states**, not public verdicts on whether a person was “right.”

## `pending`
Use for items that still need operator review.

Typical reasons:
- new and unread
- needs category assignment
- needs location verification
- may be duplicate but not yet resolved
- needs clarification before planning handoff

Default rule:
- new items should normally enter as `pending`
- do not skip straight to `approved` unless the intake process is supervised and clearly ready

## `approved`
Use when the item is suitable for downstream planning review and reporting.

Approval means:
- the item is legitimate and in scope,
- the content is understandable enough to retain,
- category assignment is complete or intentionally left uncategorized with a clear reason,
- any moderation notes needed for context have been added.

Approval does **not** mean:
- the project team agrees with the comment,
- the comment is representative of all participants,
- the recommendation will be implemented.

## `rejected`
Use when the item should stay out of planning synthesis.

Typical reasons:
- spam
- abusive or threatening content
- duplicate record replaced by another retained record
- entirely off-topic submission
- privacy-sensitive content that should not be propagated

Rule:
- add moderation notes whenever rejecting an item
- rejection should be auditable and specific, not arbitrary

## `flagged`
Use when the item needs special operator attention before approval or rejection.

Typical reasons:
- possible safety or legal sensitivity
- personally identifying information needs review
- potentially duplicative but unclear
- inflammatory content with some potentially relevant substance
- unclear location or category with high value if cleaned up

Rule:
- `flagged` is a holding state for exceptions, not a trash bin
- a flagged item should usually end with either `approved` or `rejected`

---

## 7) Moderation notes — what to write

Moderation notes should explain the operator decision in neutral, future-readable language.

Good note examples:
- `Approved after removing personal contact details from summary and assigning to Crossing safety.`
- `Flagged for duplicate review; appears to describe the same school pickup conflict as item entered from meeting board.`
- `Rejected as spam / not project-related.`
- `Approved as positive support signal; no precise location provided.`

Bad note examples:
- `weird`
- `probably fake`
- `too emotional`
- `not useful`

---

## 8) Public-safe status translation

If a later public-facing workflow needs plain-English wording, use these translations instead of exposing internal jargon directly:
- `pending` → `Under review`
- `approved` → `Included for planning review`
- `rejected` → `Not included`
- `flagged` → `Needs staff review`

Do not expose a public label like `flagged` without explanation.

---

## 9) Minimum data quality rules for planning-ready handoff

An item is strongest for report handoff when it has:
- understandable body text,
- correct source type,
- category assignment,
- status set to `approved`,
- moderation note when any exception or cleanup occurred,
- location data when the issue is spatial.

A campaign is strongest for report handoff when:
- the project link is correct,
- most in-scope items are categorized,
- `flagged` and `pending` counts are low or explained,
- rejected items have reasons,
- category labels are stable and not overlapping,
- geolocated comments are captured where spatial signal matters.

---

## 10) Optional `metadata_json` guidance for future consistency

The current schema allows `metadata_json`, even though it is not yet surfaced heavily in the UI. Operators and builders should converge on a small, useful convention rather than stuffing arbitrary blobs into it.

Recommended keys:
- `intakeChannelDetail` → e.g. `project website`, `open house board`, `district email`
- `eventName` → e.g. `Round 1 open house`
- `eventDate` → ISO date when relevant
- `locationNote` → plain-English place reference when exact coordinates are absent
- `duplicateGroup` → shared token when consolidating duplicates
- `languageCode` → e.g. `en`, `es`
- `districtTag` → neighborhood / beat / study area shorthand
- `sensitivity` → e.g. `privacy_review`, `youth_comment`, `staff_entered`
- `enteredByRole` → e.g. `planner`, `intern`, `facilitator`

Avoid using metadata for:
- unverifiable sentiment scoring,
- hidden moderation logic,
- sensitive personal data storage.

---

## 11) Fast operator decision tree

When entering a new item:
1. Was this place-based? If yes, prefer `map_feedback` campaign structure and add coordinates if known.
2. Where did it come from? Choose `public`, `meeting`, `email`, or `internal` honestly.
3. Is it usable now? If not sure, leave `pending`.
4. Does it require special review? Use `flagged` and explain why.
5. Is it clearly unsuitable? Use `rejected` and document the reason.
6. Is it planning-ready? Use `approved` and assign a category.

---

## 12) Recommended default for the next few campaigns

To accelerate consistency, the next several real campaigns should all start from one of these three starter patterns:
- `map_feedback` + transportation/place-based starter kit
- `comment_collection` + general plan-feedback starter kit
- `meeting_intake` + workshop/stakeholder starter kit

That will give the builder lane cleaner real-world examples and better downstream report consistency than allowing every campaign to invent its own taxonomy from scratch.

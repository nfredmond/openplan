# OpenPlan Engagement — Submission Flow Clarity Support Memo

**Date:** 2026-03-22  
**Owner:** Camila Reyes  
**Lane:** OpenPlan Priority #2 — Engagement support only  
**Posture:** bounded UX/design support artifact only; no builder-file edits, no #1 overlap, no broad redesign

---

## Purpose

This memo focuses on one bounded question only:

**How should the public engagement submission flow be presented so users understand where to start, what is required, what is optional, what happens after submit, and why the flow is worth completing?**

This is intentionally limited to submission-flow clarity guidance. It does **not** prescribe schema, implementation, billing, PM, or builder work.

---

## Executive Summary

The public engagement submission flow should feel:
- calm,
- trustworthy,
- specific,
- low-friction,
- and visibly finite.

Most submission drop-off risk does not come from one extra field. It comes from uncertainty.

Users abandon submission when they do not know:
1. whether they are in the right place,
2. what kind of input is wanted,
3. how much detail is expected,
4. which fields are required,
5. what will happen after they click submit.

The best design move is to make the flow answer those questions **before** the user hesitates.

---

## Core design objective

The submission experience should make it easy for a first-time participant to say:

> “I know what this campaign is, I know what they want from me, I know what I have to fill out, and I know what happens after I send this.”

---

## Recommended submission flow structure

### Step 0 — Orientation block
Before the form itself, provide a short orientation block that answers:
- **What is this campaign about?**
- **What kind of input is useful here?**
- **How will my input be used?**
- **How long will this take?**

### Step 1 — Main input
The primary input area should focus on the actual substance of the submission first.

### Step 2 — Context / optional metadata
Location, category, and contact/follow-up fields should come after the main input unless absolutely required.

### Step 3 — Review expectations
Before submit, provide short language on what happens next.

### Step 4 — Confirmation state
After submit, show a clear success state with next-step expectations.

---

## Where the user starts

### Recommendation
The start of the flow should never be a raw field stack.

The user should begin with a short framing section containing:
- campaign title,
- one-sentence summary,
- one “best type of input” prompt,
- estimated completion effort (for example, “2–3 minutes”).

### Why this matters
The user needs orientation before effort. If the first screen is only a form, the cognitive load starts too high.

### Smallest viable presentation pattern
Use a short top block with four lines:
- **Campaign:** what this is about
- **Share with us:** the kind of input wanted
- **Optional details:** whether location/category/contact are optional
- **Time:** expected completion time

---

## What the user is being asked for

### Recommendation
The form should ask for the main contribution in plain language before any administrative metadata.

### Preferred primary prompt
Use a prompt such as:
- **What would you like us to know?**
- **What issue, opportunity, or concern are you seeing?**
- **Tell us what you noticed and why it matters.**

### Avoid
- technical/internal wording
- category-first framing
- labels that sound like ticketing software rather than civic input

### Why this matters
People can answer a human question more easily than a database field.

---

## Required vs optional fields

### Recommendation
Required and optional fields must be visibly differentiated in three ways:
1. label treatment,
2. helper text,
3. section grouping.

### Required fields
Keep required fields to the minimum needed for a valid submission.

Preferred rule:
- one main content field required
- everything else optional unless the campaign explicitly needs structure

### Optional fields
Optional fields should be clearly labeled as optional where they appear, not only in fine print.

Examples:
- **Category (optional)**
- **Location (optional)**
- **Your name (optional)**
- **Email for follow-up (optional)**

### Why this matters
Users often overestimate form burden. Explicit optional labeling reduces abandonment.

---

## Suggested submission information hierarchy

### Section A — Why you are here
- campaign title
- short summary
- what kind of input helps most

### Section B — Your main input
- title or short subject (optional, if used)
- main submission text (required)

### Section C — Helpful context
- category (optional)
- location/context (optional)
- source type if needed internally, but avoid exposing operator language unnecessarily

### Section D — Follow-up
- name (optional unless campaign requires it)
- email/contact (optional unless campaign requires it)

### Section E — Submission expectations
- how input will be reviewed
- whether moderation occurs
- whether follow-up is guaranteed or not

---

## What happens after submit

### Recommendation
The submission flow should explicitly answer:
- Will the submission be reviewed?
- Will it appear publicly?
- Is there moderation?
- Will the user receive a response?
- Is follow-up guaranteed or not?

### Preferred confirmation message structure
After submission, show:
1. **confirmation** — your input was received
2. **review expectation** — submissions are reviewed before use/public display if applicable
3. **next-step expectation** — what the team may do with the input
4. **optional return path** — link back to campaign or thanks page

### Why this matters
Uncertainty after submit makes the whole flow feel less legitimate.

---

## Drop-off prevention guidance

The design goal is not to make the form decorative. It is to reduce hesitation.

### Most likely drop-off causes
1. unclear purpose
2. too many fields too early
3. weak required/optional signaling
4. fear that the input will disappear into a void
5. fear that the system is more complicated than it really is

### Practical UX guidance
- put the main content field early
- move optional context after the main input
- avoid internal jargon
- use short helper text instead of long paragraphs
- show finite scope (“takes 2–3 minutes”)
- show a visible end state after submission

---

## Recommended helper copy patterns

### Top-of-form helper copy
> Share a specific issue, opportunity, or idea related to this campaign. A short clear note is enough.

### Optional field helper copy
> These details help us review and organize input, but they are not required unless noted.

### Post-submit helper copy
> Your input has been received. It may be reviewed, categorized, and included in engagement summaries or project reporting.

### If moderation applies
> Submissions may be reviewed before they appear in campaign summaries or public-facing materials.

---

## Calmness / trust guidance

A public submission flow should feel administratively credible, not startup-casual and not bureaucratically cold.

### Use
- plain civic language
- short sentences
- clear headings
- visible progress from start to finish

### Avoid
- dense instruction blocks
- unexplained required fields
- abrupt success states with no next-step context
- internal operator terminology exposed to the public

---

## Smallest bounded recommendations to implement first

These are the most valuable clarity moves with the least overlap risk:

### Recommendation 1 — Add an orientation block above the form
A short pre-form block covering purpose, input type, optionality, and expected time.

### Recommendation 2 — Make only the main submission field required by default
Unless campaign-specific rules demand more structure.

### Recommendation 3 — Explicitly label optional fields in-line
Do not make the user infer which fields can be skipped.

### Recommendation 4 — Add a short “what happens next” statement before and after submit
This materially improves trust and completion confidence.

### Recommendation 5 — Treat location/category/contact as secondary context
Do not let metadata overshadow the actual public input.

---

## Explicit boundary

This memo does **not** recommend or authorize:
- schema changes,
- implementation changes to #1 LAPM / PM / invoicing,
- billing/auth work,
- broad public portal redesign,
- survey-engine expansion,
- moderation implementation changes,
- dashboard work,
- unrelated OpenPlan feature work.

It is a bounded engagement UX/design support artifact only.

---

## Most useful immediate use

If Nathaniel wants the smallest viable next step from this memo, the best use is:

1. use it as the submission-flow clarity reference for Engagement,
2. apply only the orientation + optionality + post-submit expectation guidance first,
3. keep implementation separate from #1 builder work.

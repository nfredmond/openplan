# OpenPlan Engagement — Campaign Closeout and Handoff Runbook

**Date:** 2026-03-21  
**Status:** operator-ready  
**Scope:** current engagement module and current report handoff flow

## Purpose

This runbook defines a practical, low-drama way to close an engagement campaign and hand it off into planning/reporting.

It is designed for the current OpenPlan flow where operators can:
- link a campaign to a project,
- classify and moderate engagement items,
- review counts on the campaign detail page,
- click `Create handoff report` to seed a report packet.

This runbook does **not** assume a future public portal, survey builder, AI summarizer, or advanced export tooling.

---

## 1) What “closeout” means in OpenPlan

A campaign is ready for closeout when the team has reached the end of a defined engagement window and needs to convert intake into a usable planning record.

Closeout should produce three outcomes:
1. the campaign record is internally coherent,
2. the remaining moderation backlog is either resolved or explicitly documented,
3. the linked project gets a usable handoff packet.

---

## 2) Minimum preconditions before starting closeout

Before beginning closeout, confirm:
- the campaign exists in the correct workspace
- the campaign is linked to the correct project whenever planning handoff is expected
- the campaign title and summary are accurate
- categories reflect the actual intake themes
- recent items have been reviewed at least once

If the campaign is not project-linked, the operator can still clean it up, but the current `Create handoff report` path will remain blocked.

---

## 3) Closeout checklist — operator sequence

## Step 1 — Confirm campaign basics

Check and correct:
- campaign title
- summary
- engagement type
- linked project
- current campaign status

Recommended status posture during cleanup:
- keep as `active` while review is still underway
- move to `closed` once the intake window is over and moderation is substantially complete
- use `archived` only after the campaign is no longer an active operating record

## Step 2 — Review the moderation queue

From the campaign detail page, inspect:
- `Actionable review`
- `Pending`
- `Flagged`
- `Needs category`
- `Planning-ready`

Recommended target before handoff:
- `pending` near zero
- `flagged` near zero
- uncategorized items minimized, especially among in-scope items

If the queue cannot be fully resolved, note why in campaign summary or report notes.

## Step 3 — Triage every remaining `pending` or `flagged` item

For each unresolved item, decide:
- `approved`
- `rejected`
- remains `flagged` with a clear note

Do not let unresolved items sit without explanation at closeout.

## Step 4 — Finish category assignment

Focus first on items that are:
- approved,
- likely to appear in planning review,
- high-value geographically,
- repeated across multiple comments.

Rule of thumb:
- an approved item without a category weakens downstream reporting more than a rejected item without a category

## Step 5 — Improve spatial signal where it matters

For place-based campaigns:
- add latitude/longitude where known
- use moderation notes or metadata for location clues when exact coordinates are unavailable
- distinguish truly non-spatial comments from comments that are spatial but incomplete

## Step 6 — Audit rejected items

Before final handoff, verify that rejected items have neutral, auditable reasons such as:
- spam
- duplicate
- off-topic
- privacy concern
- abusive/threatening content

Avoid unexplained rejection.

## Step 7 — Review source mix for credibility

Look at the source breakdown and check for obvious miscoding.

Common cleanup items:
- convert manually entered public comments from `internal` to `public`
- keep workshop notes as `meeting`
- keep email submissions as `email`
- reserve `internal` for actual staff-originated records

## Step 8 — Mark campaign `closed`

Once the intake window is no longer open and the queue is acceptably resolved, set campaign status to `closed`.

Do not use `archived` yet if the team is still actively referencing the campaign during report preparation.

## Step 9 — Create the handoff report

Use `Create handoff report` from the campaign detail page.

Current seeded report structure:
- `Project overview`
- `Campaign and project snapshot`
- `Engagement campaign summary`
- `Methods and provenance`

This is the fastest current path from engagement record to planning packet.

## Step 10 — Finalize the packet

After report creation, review and tighten:
- report title
- summary language
- methods/provenance text
- project context accuracy
- whether the packet accurately reflects queue status and remaining caveats

---

## 4) Recommended definition of “handoff-ready”

A campaign is strongly handoff-ready when:
- project link is correct
- campaign status is `closed`
- approved items are mostly categorized
- most actionable queue items are resolved
- rejected items have reasons
- flagged items are exceptional, not routine
- summary text explains what the campaign covered
- source mix looks credible
- mapped campaigns have reasonable location coverage

A campaign may still be handoff-ready with some remaining exceptions, but those exceptions should be explicit.

---

## 5) Minimum handoff packet contents

Every engagement handoff packet should allow a planner to answer:
- what campaign this was
- what project it belongs to
- what kind of input it collected
- when and how input was collected
- how much intake came in
- how much still needs review
- what themes/categories emerged
- what caveats remain

## Recommended packet elements

### A. Campaign identity
- campaign title
- linked project
- engagement type
- campaign summary
- active window or meeting round if known

### B. Intake and moderation posture
- total items
- approved count
- pending count
- flagged count
- rejected count
- uncategorized count
- geolocated share for spatial campaigns

### C. Source mix
- public vs meeting vs email vs internal mix
- note any skew or limited outreach context if relevant

### D. Theme/category pattern
- top categories
- categories with high pending or flagged counts
- positive-signal/support category if used

### E. Caveats
- unresolved moderation items
- low map precision
- duplicate consolidation assumptions
- meeting-only or email-heavy bias
- small sample limitations

### F. Planner next-step cues
- what deserves immediate technical follow-up
- what should inform alternatives, concepts, or report framing
- what should be treated as anecdotal rather than representative

---

## 6) Suggested `Methods and provenance` text

Use or adapt the following in the seeded report:

`This engagement packet summarizes current campaign records captured in OpenPlan, including category assignment, moderation state, source mix, and available location signal. Items marked for planning review reflect operator-reviewed campaign records, not automatic consensus or statistical representativeness. Reviewers should treat the packet as structured engagement evidence to be considered alongside technical analysis, policy context, and project constraints.`

---

## 7) Suggested campaign summary pattern before handoff

A strong campaign summary should cover:
- what area/topic the campaign covered
- what type of input was invited
- what planning purpose the intake supports
- any major limitation

Example:

`This campaign captured location-specific safety and access feedback related to downtown circulation and school access, including web comments, open-house input, and staff-entered meeting notes. The purpose of the campaign is to surface recurring problem locations, access barriers, and community priorities that should inform project review and downstream reporting. Comments should be read as structured community input, not as a statistically representative sample.`

---

## 8) When to use `archived`

Archive only after:
- the handoff packet exists,
- the team no longer expects active intake,
- the campaign is no longer under active review,
- a future operator can safely treat it as record history rather than live work.

Suggested posture:
- `draft` → setup only
- `active` → intake and moderation in progress
- `closed` → intake window ended; packet/report work underway or complete
- `archived` → historical record

---

## 9) Common closeout failure modes

Watch for these:
- campaign closed with many uncategorized approved items
- too many direct public comments marked as `internal`
- rejected items with no explanation
- categories that overlap too heavily to summarize cleanly
- project not linked, blocking report handoff
- map campaign with almost no geolocated items
- summary text that implies consensus or certainty the data does not support

---

## 10) One-page operator checklist

Before closeout:
- [ ] Campaign title and summary are accurate
- [ ] Linked project is correct
- [ ] Engagement type is correct
- [ ] Categories are usable and non-overlapping
- [ ] Pending queue reviewed
- [ ] Flagged queue reviewed
- [ ] Approved items mostly categorized
- [ ] Rejected items have reasons
- [ ] Source types are cleaned up
- [ ] Location data added where feasible

At closeout:
- [ ] Campaign status moved to `closed`
- [ ] Handoff report created
- [ ] Methods/provenance text reviewed
- [ ] Remaining caveats documented

After handoff:
- [ ] Campaign archived only when active operations are done

---

## 11) Operating principle

The closeout goal is not to force every comment into a polished story.

The goal is to produce a campaign record that is:
- honest,
- structured,
- reviewable,
- useful to planners,
- explicit about what is still unresolved.

That is enough to materially strengthen the current Lane A workflow right now.

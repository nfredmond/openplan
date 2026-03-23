# OpenPlan Engagement — Suggested Public-Facing Copy and Guardrails

**Date:** 2026-03-21  
**Status:** draft copy pack for Lane A  
**Use case:** future public intake/share flows, campaign launch pages, intake prompts, outreach copy, and moderation disclosures

## Important posture

This document supports a more public-facing engagement workflow, but it does **not** imply that a full public portal is already shipped.

The copy below is meant to help the builder lane and operators move faster when they add public-entry surfaces, share links, or outreach materials.

Everything here should remain:
- plain-English,
- honest about what feedback will and will not do,
- careful about privacy/public-record expectations,
- clear that moderation exists.

---

## 1) Core public voice rules

Public-facing engagement copy should sound:
- welcoming, not bureaucratic
- specific about what input is needed
- realistic about influence and limits
- respectful of local knowledge
- short enough for small screens

Avoid language that sounds like:
- predetermined consensus
- automatic implementation promises
- opaque data harvesting
- generic civic-tech fluff

---

## 2) Recommended campaign intro copy

## Default headline
`Share what you see, use, and need in this area.`

## Default subhead
`Help the project team understand safety issues, access needs, and location-specific opportunities. Your feedback will be reviewed alongside technical analysis and other community input.`

## Alternate version for corridor / transportation work
`Tell us where travel feels safe, stressful, convenient, or difficult.`

## Alternate version for plan alternatives
`Tell us what works, what worries you, and what should shape the next round of planning.`

---

## 3) Public map-intake prompt copy

## Prompt title
`Drop a pin or describe the location`

## Prompt helper text
`Share the specific corner, block, stop, route, or place you want us to understand. If you are not sure of the exact location, describe it in plain language.`

## Comment prompt
`What is happening here, and what should the project team know?`

## Optional follow-up prompt
`If you have a suggested improvement, tell us what change would help most.`

## Small-print reassurance
`Specific, concrete examples are more useful than broad statements.`

---

## 4) Public comment-collection prompt copy

## Prompt title
`Share your feedback`

## Prompt helper text
`You can tell us what is working, what is not working, what concerns you, and what you want the project team to prioritize.`

## Suggested question set
- `What feels most important to address?`
- `What should the project team avoid making worse?`
- `Who or what should be considered before decisions are made?`

---

## 5) Meeting / event intake copy

## Event board header
`What should this project understand from your experience?`

## Event board prompt set
- `Where do you feel safe or unsafe?`
- `What access issue matters most to you here?`
- `What improvement would make the biggest difference?`
- `What are we missing?`

## Facilitator script snippet
`Please share location-specific issues, barriers, or ideas in your own words. We review comments for relevance and privacy before they are included in project materials.`

---

## 6) Moderation / review disclosure copy

## Short version
`Comments are reviewed before they are included in project materials.`

## Medium version
`We review submissions for relevance, safety, privacy, and duplicate content before including them in planning analysis or public summaries.`

## Fuller version
`Submissions are reviewed by project staff before they are included in planning analysis, reports, or public summaries. Comments may be excluded if they are spam, threatening, off-topic, or contain sensitive personal information.`

---

## 7) Privacy / public-record language

Use only language that is true for the actual workflow. If there is any uncertainty, default to the more cautious version.

## Cautious default
`Please avoid sharing personal contact information or other sensitive details in your comment.`

## Public-record aware version
`Submitted comments may become part of the project record. Please avoid including personal contact information or other sensitive details unless specifically requested.`

## If location and comment are stored
`Location information and comment text may be used in planning analysis, maps, and reports.`

## If staff may summarize comments
`Project staff may group similar comments together for analysis, while retaining the original concern or theme.`

Do not promise:
- anonymity, unless it is actually designed and verified
- deletion on demand, unless policy and tooling support it
- encryption or confidentiality claims that have not been reviewed

---

## 8) Confirmation / thank-you copy

## Simple thank-you
`Thank you. Your feedback has been received.`

## Planning-aware thank-you
`Thank you for sharing your experience. Your input will be reviewed alongside other community feedback and project analysis.`

## If follow-up is not guaranteed
`We may not respond individually to every submission, but each comment is reviewed as part of the project record.`

---

## 9) Campaign closed copy

## Default closed-state headline
`This feedback window has closed.`

## Default closed-state body
`The project team is reviewing submitted input and preparing the next planning step. You can still review project information here, but new comments are not being accepted in this campaign.`

## If another phase is coming
`This comment period has ended. A future round of engagement may open as the project advances.`

---

## 10) Outreach snippets

## Short website / social snippet
`Share location-specific feedback and community priorities for this project. Help us understand what is working, what needs attention, and where improvements matter most.`

## Email/newsletter snippet
`We are collecting community feedback to better understand safety concerns, access needs, and improvement priorities related to this project. Participants can submit location-based comments or general feedback during the current engagement window.`

## Meeting flyer snippet
`Tell us what you experience on this corridor or in this area: safety issues, access barriers, travel patterns, and ideas for improvement.`

---

## 11) Public-safe guardrails

## Guardrail 1 — never imply a comment equals a decision

Say:
- `Your feedback will inform planning review.`
- `Comments will be reviewed alongside technical analysis.`

Do not say:
- `Your feedback will directly shape the final design` unless that is tightly qualified
- `We will make changes based on every comment`

## Guardrail 2 — never imply representativeness you do not have

Say:
- `This feedback is one input into the planning process.`
- `Community comments help highlight issues, priorities, and tradeoffs.`

Do not say:
- `The community wants...`
- `Residents agree that...`
without actual evidence and appropriate methodology

## Guardrail 3 — separate collected input from staff interpretation

When summarizing publicly, distinguish between:
- what people said,
- what staff grouped together,
- what the project team recommends.

## Guardrail 4 — explain moderation in neutral terms

Use terms like:
- `reviewed`
- `included`
- `not included`
- `needs staff review`

Avoid public-facing labels like:
- `flagged`
- `rejected`
without explanation

## Guardrail 5 — do not overclaim privacy

If the intake is not truly anonymous and policy-reviewed, do not suggest it is.

## Guardrail 6 — ask for specific observations, not only opinions

Best prompt pattern:
- what happened,
- where it happened,
- who it affects,
- what change would help.

This yields stronger planning input than broad sentiment prompts alone.

## Guardrail 7 — keep accessibility and plain language first

Use:
- short paragraphs
- action-oriented prompts
- visible disclosure copy
- no unexplained planning acronyms

---

## 12) Public-safe wording for internal moderation states

If a future UI needs status language visible to the public, use:
- `Under review` for internal `pending`
- `Included for planning review` for internal `approved`
- `Needs staff review` for internal `flagged`
- `Not included` for internal `rejected`

Do not expose:
- `approved` as if it means endorsed by the agency
- `rejected` without a policy explanation
- `flagged` as a standalone public label

---

## 13) Copy QA checklist before launch

Before any public-facing copy goes live, verify:
- the campaign purpose is specific
- the prompt asks for usable planning input
- moderation is disclosed
- privacy/public-record posture is not overstated
- the copy does not promise direct implementation
- the copy does not imply consensus
- the URL and project references are correct
- the copy still makes sense if read quickly on mobile

---

## 14) Recommended default starter copy block

Use this as the safest general-purpose starter:

`Share what you see, use, and need in this area. Help the project team understand safety issues, access needs, and location-specific opportunities. Comments are reviewed before they are included in planning analysis or project materials, so please avoid sharing personal contact information in your submission.`

That block is short, honest, and compatible with the current operator-first engagement posture.

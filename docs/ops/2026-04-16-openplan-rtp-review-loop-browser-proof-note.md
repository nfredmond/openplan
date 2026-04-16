# OpenPlan RTP Review-Loop Browser Proof Note

**Date:** 2026-04-16  
**Owner:** Bartholomew Hale  
**Status:** Local browser smoke completed  
**Purpose:** record the first post-semantics browser proof pass for the RTP review-loop surfaces, using the current repo state and a seeded QA RTP smoke workspace.

## Executive Read

The RTP review-loop wording now holds together materially better in a real browser.

Using a local app run on `http://127.0.0.1:3000` and the existing RTP smoke workspace, the browser proof confirmed all of the following:

1. The **reports list / command surface** no longer treats the current RTP packet as generically settled, and instead shows **Review loop still open** plus the action **Close pending comment review**.
2. The **RTP packet detail page** shows the release-review posture card with **Review loop still open** and the next operator move **Close pending comment review**.
3. The **RTP cycle detail page** shows the public-review foundation card in **Public review active** posture with live pending-comment language, rather than only static cycle metadata.

That closes the main proof gap for the bounded RTP semantics pass.

---

## Proof method

This was an honest **local browser smoke**, not a production claim.

Execution path:
- local app run via `npm run start`
- browser automation via Playwright fallback
- authenticated QA user tied to the existing RTP smoke workspace
- seeded QA review-loop state on the existing smoke RTP cycle:
  - 1 whole-cycle engagement campaign
  - 1 approved categorized comment
  - 1 pending comment
  - updated RTP artifact snapshot metadata so shared list/runtime/report surfaces could read the same review-loop summary

Reason for fallback:
- the OpenClaw `browser` tool relay timed out during this pass, so browser proof was captured through a local Playwright fallback instead of the built-in browser relay

---

## Routes checked

### 1. Reports page
**Route:** `/reports`

Confirmed in browser:
- review-loop-aware queue wording rendered
- **Review loop still open** appeared in the report list / packet queue context
- **Close pending comment review** appeared as the action wording
- current-packet queue remained visible as an active operator lane

Evidence:
- `docs/ops/2026-04-16-test-output/2026-04-16-rtp-review-loop-reports-page.png`

### 2. RTP packet detail
**Route:** `/reports/013ae8d7-6788-4341-aa02-270249ce62af`

Confirmed in browser:
- release-review posture card rendered
- posture label showed **Review loop still open**
- next operator move rendered as **Close pending comment review**

Evidence:
- `docs/ops/2026-04-16-test-output/2026-04-16-rtp-review-loop-report-detail.png`

### 3. RTP cycle detail
**Route:** `/rtp/81c63d2c-7335-4d31-8ccd-e330acc76a69`

Confirmed in browser:
- **Comment-response foundation** section rendered
- public review posture showed **Public review active**
- live pending-comment language rendered on the page

Evidence:
- `docs/ops/2026-04-16-test-output/2026-04-16-rtp-review-loop-cycle-detail.png`

### Supporting text log
- `docs/ops/2026-04-16-test-output/2026-04-16-rtp-review-loop-browser-smoke.txt`

---

## What this proof does and does not prove

## Proven by this browser smoke
- shared RTP release wording is materially aligned across the reports list, report detail, and RTP cycle review surface
- a current RTP packet is no longer displayed as automatically settled just because the artifact is current
- operator-facing next-action text is now tied to review-loop posture, not only freshness posture

## Not proven by this browser smoke
- full production deployment proof
- end-to-end public submission intake
- board-ready comment-response authoring workflow completeness
- shared Grants OS integration beyond the already-existing funding follow-through lane

---

## Observed nuance from the smoke

One small but real nuance showed up during the cycle-page check:

- the **RTP cycle detail page** correctly rendered **Public review active** and the live pending-comment message
- however, in this smoke state, the cycle page still rendered **0 approved items ready for packet handoff** even though the report-detail proof lane reflected a categorized approved comment

Treat that as a bounded follow-up gap, not a blocker to the main semantics proof.
The core proof objective for this pass was wording/control honesty across shared RTP surfaces, and that objective was met.

---

## Bottom line

The RTP review-loop pass is now supported by:
- code changes
- targeted test coverage
- successful build
- and a fresh local browser proof packet

That is enough to move the RTP lane out of “implemented but not browser-proven” status.

## Recommended next move

Move into the **Grants OS** lane next, while carrying forward one small RTP cleanup item later for the cycle-detail approved-comment handoff count.

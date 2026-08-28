---
id: 10-governed-decision-handoff
title: Freeze, return, replace, and approve one exact agency package
account: run
approver: true
files: none
maxTurns: 220
---

You are preparing one California small-agency project package for another
authorized person to review. The approver must be a different person from the
person who creates and submits the bundle.

Sign in at {{BASE_URL}} with {{EMAIL}} / {{PASSWORD}}.
When the job tells you to act as the assigned approver, sign out and sign in
with {{APPROVER_EMAIL}} / {{APPROVER_PASSWORD}}. These are two distinct people;
do not approve while still signed in as the preparer.

**What you need to have done:**

1. Start from the signed-in landing page, reach Projects through visible
   navigation, open one project, and reach its Evidence area. The project needs
   one linked plan and one current board/report PDF before it can be governed.
2. Review the evidence inventory, select the exact linked plan and exactly one
   PDF, confirm the selection, freeze the bundle, and download it. Record the
   immutable bundle SHA-256 and the statement that freezing does not approve,
   adopt, publish, or validate anything.
3. Submit that exact hash to a different owner or admin. Sign in as the assigned
   person, find the pending review through My Work, and return it with a reason.
4. As the preparer, find the returned item in My Work, freeze a replacement
   bundle, and submit the replacement. As the assigned approver, find the new
   pending item in My Work and approve it.
5. Download the approved bundle and immutable receipt. Confirm the receipt names
   the exact bundle hash and says approval did not publish, adopt, or validate
   the package. If any source has changed, stop and freeze a new bundle rather
   than approving the historical one.

The outcome is reached only when the visible two-person path completes through
My Work, the replacement receives an immutable approval receipt, and both the
approved ZIP and receipt are downloadable for use without OpenPlan.

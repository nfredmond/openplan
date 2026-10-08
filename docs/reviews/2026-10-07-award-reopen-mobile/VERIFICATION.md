# Reopen form at 390px

Production build `431c8927`, build ID `d57xw8bCIwz-NEeKD5CRq`, runs from the
owned award-reopen-choice checkout on port 3510. Its process cwd and health
response identify that build. The GitHub main-update head `3e42b4b3` has the
same complete file tree, `9756a4cd576bf57967ad734ac1b37c1b7634f8fb`.

T3 desktop and 390px My Work show both synthetic closed awards with distinct
closure-basis warnings and their equal-date milestones. The imported award link
opens the project's funding tab. A transient reminder read reports JWT issued
at future; full navigation clears it. Reminder scheduling correctly remains
unconfigured. No live reminder email is sent.

Mobile navigation through More and Grants opens the existing award control.
The corrected selector starts blank. Confirming without a reason is refused;
entering a reason without choosing a status is also refused. A native select
key call reports a tool failure, but the settled DOM confirms Not started.
Canceling and reopening clears the status while retaining the draft reason.
No reopen request is submitted and both synthetic awards remain closed.

The image reveals clipped fields despite document scroll width equaling 390.
The panel occupies about 473 CSS pixels inside a 270-pixel grid area. Giving
that grid child a zero minimum width fits the fields but leaves long closure
badges overflowing. A temporary browser-only style experiment also wraps those
badges: panel client/scroll widths both become 269, and the enclosing section's
both become 351. The temporary styles are cleared by full navigation. This is
diagnostic evidence, not acceptance of a rebuilt artifact.

The source correction adds `min-w-0` to the closeout panel and permits its two
long provenance badges to wrap within their container. The generic refusal
heading becomes Award update refused, covering both closeout and reopening.
No mutation route or financial record changes.

All 19 component tests and targeted ESLint pass. A harmless comment passes;
restoring the wrong action heading fails the explicit refusal assertion; the
restored source passes again. These component tests do not render CSS geometry.
Production-build desktop/390px acceptance remains required. Private evidence
lives in `award-reopen-choice-20261007-proof/browser-431c8927-partial.json`
and `award-reopen-mobile-20261007-proof/`. The failed screenshot ends in
`muz1gky3-449032ee.png`. Failed duplicate/hidden-link selectors are corrected
before the successful native navigation and are not counted as product failures.

## Rebuilt artifact and native reopen

The production build at `57a97530109059f47fec690e0886633b2cc02ec9`
passes on October 8, 2026, from 04:33:51 to 04:36:29 UTC. The owned service
`openplan-award-mobile-prod-57a97530.service` serves port 3511 from the
`v068-evidence-20261007/openplan` checkout. Process 3334479 has that cwd;
invocation `448f6ab7e094486dad4f55191fbbfc94` identifies the service instance.
Health reports commit `57a975301090` and version `0.68.0`. This identifies the
artifact, not a completed release or a database health check.

T3 navigation from My Work to Grants opens the imported synthetic award's
reopen form. At desktop size, a written reason without an explicit status
produces the corrected Award update refused heading. The saved image ends in
`muz1owh4-aeedbc51.png`. At 390 CSS pixels, the saved image ending in
`muz1p2xq-63d362b2.png` shows the complete fields and buttons inside the card.
The panel's client and scroll widths are both 269; the enclosing article's
are both 351. Document width and scroll width are both 390. The image is
inspected, rather than treating document width alone as evidence of fit.

The native selector chooses Not started. Confirm re-open succeeds at
04:39:48 UTC. Authenticated API readback returns HTTP 200 and confirms:

- The imported synthetic award now has `spending_status=not_started`.
- Its current closure fields are null, and its reopen reason, actor and
  timestamp are recorded.
- Its October 1 obligation deadline is unchanged.
- The other synthetic award retains `fully_spent`, `earned_coverage`, its
  prior closure timestamp and deadline, with no reopen record.

Native navigation back to My Work and Unassigned retains both obligation
milestones. The closed award still carries the obligation-review warning.
The reopened award's matching milestone represents its deadline without a
stale closed-award warning. The separate conflicting-date fixture still
shows its discrepancy. No real award, payment or reminder email is involved.

Post-submit screenshot capture fails on four attempts, including after
reopening the T3 preview. Resize then times out, and a text-only snapshot on
the health page also fails. Status, navigation, DOM reads and API readback
continue working. Post-submit images and final console review remain open;
the successful earlier images do not establish either. Private readback
evidence is `award-reopen-mobile-20261007-proof/browser-57a97530-reopened.json`.

The success notice also repeats “recorded as” for the imported closure basis.
That wording defect remains recorded for correction. These synthetic checks
do not establish practitioner acceptance, actual obligation compliance or
the complete grant-administration requirements. GitHub QA and live isolation
checks remain running when this checkpoint is written.

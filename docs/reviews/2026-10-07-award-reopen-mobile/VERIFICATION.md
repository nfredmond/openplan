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

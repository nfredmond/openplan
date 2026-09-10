# Planner Agent action follow-up recovery

Continuation after published v0.49.0; A1a prerequisite for A0 provider choice.
This is a bounded client-dispatch repair, not completion of A1a or A0.

## Demonstrated defect

The existing dispatcher awaited the action effect, marked the action completed,
then refreshed context. A failed context read propagated into the caller's
ordinary execution catch, overwriting success with failure. Both quick links
and chat proposals used this pattern. A fake-HTTP probe of the original
`generate_report_artifact` dispatcher observed HTTP 200, completion callback,
then an ordinary exception. No real writes were made by that initial probe.
The first funding-opportunity probe did not reproduce because that action's
metadata specifies no context refresh; that boundary remains intentional.

## Implementation

A typed follow-up error records which post-effect step failed. The action effect
and approval refusal remain outside this boundary. Both UI callers preserve the
successful request status and retain a warning. A context-only recovery control
reads the current records without repeating the effect or follow-up prompt.
Completion wording describes the request; it does not assert a launched job has
finished or that an audit record was independently inspected.

## Initial evidence and remaining boundaries

- Focused regression run: 34 tests across the existing dispatcher and
  AppCopilot suites. New tests exercise all five follow-up callback failures,
  a true effect refusal, both UI callers, repeated context unavailability and
  successful context recovery with one effect call. Cancellation text inside a
  failed context read must not return an already executed proposal to pending.
- These tests mock HTTP. They cannot establish database persistence, endpoint
  idempotency, real navigation or browser usability. At that initial checkpoint browser acceptance, full QA and CI were outstanding; the final results below supersede that status.
- Exact approvals, route-local authorization, audit persistence, server-side
  idempotency and durable assignment gaps are not repaired by this client change.
- Worktree: `~/.local/state/openplan/planner-action-followup-recovery-2026-09-10`.
  Own files: shared action dispatcher, AppCopilot, their focused tests and this
  evidence directory. Base main `b16bf2ea`; no PR and no human release gate.

- Seven mutation runs: harmless comment survives; six targeted failures detected
  (erased boundary, misclassified effect, either caller loses success, swallowed
  prompt failure, and recovery skips its read). Failure logs inspected separately.

## Additional findings during QA

The deterministic follow-up prompt helper caught its own HTTP errors, so the
dispatcher could not report that stage. It now propagates only when called as
an action follow-up; ordinary standalone prompts retain their existing error
display. A refused-effect and failed-prompt UI test distinguish the outcomes.

The first full QA run found the copy ratchet increased `record` from 265 to 266.
The new success sentence was rewritten; the existing guard and baseline were
not relaxed. The historical first-run failure remains in local logs.

Synthetic browser fixtures were created through current workspace bootstrap,
RTP-cycle and report APIs in the explicitly retained disposable target
`openplan-restore-target-3390964` (API 22301), in a new workspace and account.
They do not alter the original OWP fixture. No AI provider is used for the
deterministic report generation/context recovery journey.

Release preparation initially missed the JSON capability-registry version while
updating the three Markdown authorities. The direction check caught the mismatch;
only the current-release marker was corrected, without re-dating reviews.

## Browser findings before acceptance

The first browser assertion rejected an unstamped production server (commit
`unknown`). It made no action writes. The server was restarted with the known
build's commit, then health and serving directory matched `ff52db9f62f4`. The
identity helper wrongly treated the same-directory unstamped production process
as a live dev server; that helper defect is recorded for follow-up, not accepted
as proof. The independent browser SHA assertion caught it.

The initial Reports link locator omitted the existing `#packet-release-review`
anchor. It was corrected to follow the actual catalog link. Desktop generation
then succeeded and the context-only retry produced one artifact after repeated
503 context reads. However, the subsequent Send click was outside the viewport:
status/history expanded an unbounded fixed header, pushing the composer and
recovery area offscreen. Keyboard activation alone had hidden this layout defect.
This is a real acceptance failure, not an approved browser pass.

The panel now keeps its title/close control above a scrollable body containing
status, history and suggested actions, with the composer in the remaining fixed
row. The title can shrink on a narrow screen. Outdated composer text claiming
all actions occur on another page was corrected. Focused UI/dispatcher/copy
checks pass 38 tests after this layout fix; full rerun and browser checks pending.

The first layout screenshots still showed two columns. Initial computed style
looked correct before preview loading; after the report preview loaded, its
`.grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 20px 0; }`
overrode the application. `RtpReportDetail` inserted the entire exported document
into the host DOM. It now uses the existing `ReportArtifactPreview` scriptless
iframe, as other report previews already do. This preserves exported bytes and
existing parent-owned link handling while isolating document styles.

The expanded focused run passes 41 tests across five suites. A harmless comment
survives; restoring the direct HTML insertion fails the RTP preview test. Browser
layout checks now require one column, composer below conversation, and a visible
composer. They also inject/remove the actual exported stylesheet as an adverse
control. The earlier offscreen-control probe initially survived because it sampled
a CSS transition before displacement; restoration also animated. The instrument
now disables transitions for both movements, rather than treating those results
as an application defect or accepted control evidence.

Desktop acceptance then completed both entry points, including real saves,
checksum checks and layout controls, but 390px failed: an implicit grid column
expanded to 518px. A narrow browser probe isolated Radix's inner `display: table`
minimum width; changing it to ordinary block flow restored text wrapping.
The same probe showed the mobile navigation covering part of Send because the
modal inherited the launcher's z-index-35 stacking context beneath the rail.

The conversation now uses native vertical overflow, an explicit single flexible
column, and a focusable named region. The modal uses a React portal into the
body, leaving the launcher in its existing slot. The narrow live layout probe
showed 389px content inside the 390px viewport and an unobstructed composer.
A harmless portal comment survives; replacing the portal with in-place rendering
fails its focused regression test. Four focused suites pass 41 tests. The last
full local QA at `8708b92d` passed 13,467 tests plus build/audit; final CI must cover
these subsequent layout changes and the additional portal test before tagging.

The stricter final overflow check also found existing quick-link cards forcing
713px of content into the desktop panel: two cards per row, nonwrapping preference
controls, and raw audit identifiers. Cards now use one column inside the bounded
panel, controls wrap, and audit identifiers break across lines. A read-only live
CSS probe measured content fitting both 559px and 389px panel widths; screenshots
were inspected at desktop and 390px. Final production acceptance remains required.

## Final local acceptance

Production build `6f804210f8b5`, version 0.49.1, Next 16.3.4, served from the
identified worktree at `http://127.0.0.1:3273`. Independent browser health assertions
matched the build SHA before mutation. The final application source remained clean.

Both real-navigation journeys passed at 1440×1000 and 390×844: public landing,
sign-in, Dashboard, Reports (keyboard module search on narrow screens), actual
report link and Planner Agent. Each exercised a quick-link action and an approved
chat proposal with real approval/effect endpoints. The chat stream was explicitly
synthetic; no provider or model capability is claimed.

Each journey deliberately generated two artifacts. Three injected context HTTP
503 failures, including a failed retry, added no artifacts. Keyboard recovery read
context without repeating the effect. Both original and subsequent artifacts
downloaded through the authenticated application route with HTTP 200 and SHA-256
matching retained HTML. The first artifact remained byte-identical after the second
save. Counts were 7→9 desktop and 1→3 narrow; earlier instrument attempts explain
the nonzero baselines and were not deleted. `artifact-recheck.json` records an
independent read-only re-download of both new artifacts at each width.

Final screenshots were visually inspected, including the narrow exported HTML.
The conversation fits one column without horizontal overflow, the composer stays
in the viewport, and sampled control corners are unobstructed. Harmless outlines
survive; moving Send offscreen and leaking the exported stylesheet into the host
are rejected for the intended reasons. Console inspection found only the three
injected 503 messages per journey; no unexpected warning/error or page error.
This is bounded keyboard/pointer evidence, not comprehensive accessibility proof.

Final shuffled seed 914092 passed 1,232 files / 13,468 tests (33 files / 299 tests
skipped). Full local QA at `8708b92d` passed 13,467 tests, build and dependency audit;
subsequent portal/card changes passed their focused suites, final production build
and final shuffled run. Live isolated RLS passed 40 files / 321 tests against the
owned disposable target. Final-main CI must cover the combined release before tag.

The checked-in harness uses case-specific local paths and synthetic fixtures.
Private login and environment files are intentionally absent; running it requires
an explicitly disposable stack and a separately provisioned synthetic account.
No credentials, real client records or production data are included.

## Release checkpoint and following work

Engineering browser acceptance is complete. Publication still awaits the final
main commit's CI and upgrade checks; no human sign-off is a release gate.
A1a remains incomplete: server audit outcome truthfulness, optional-consent,
durable recovery and scoped external-agent/MCP behavior are separate work.
The unstamped production identity-helper defect remains a concrete follow-up.

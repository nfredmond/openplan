# Execution results in the staff workflow

Work in progress on `work/engagement-execution-progress-20261006`, based on
`408e6e9f`. The execution-permission acceptance checkout stays unchanged.

## Intended job and design

After saving permission, staff needs to distinguish missing output, failed
output and material ready for the next analysis stage. Reuse the existing
authenticated history reconstruction for contribution, context and thematic
work. No new execution system, dispatch, automatic retry or approval is added.

Keep the current Space Grotesk body and heading type. Use existing theme tokens,
including ink `#1a1a1a`, muted text `#716b63`, white panel `#ffffff`, accent
`#c03f1c` and secondary accent `#1f6b5e`; theme variants remain authoritative.
Progress uses text and counts, without a green completion badge or decorative
cards. The distinction between output checks and accepted findings governs
the design.

The view remains left aligned in the selected request, beside its existing
preparation and permission controls. A compact collapsed entry avoids another
automatic expensive read. Opening it shows the stage outcome, checked time,
task-state counts and the next required analysis or review step. Labels wrap
at 390 pixels. Unknown or unavailable reads clear private results and offer
an explicit refresh.

```text
Prepare this source for analysis
Review execution permission
Inspect saved analysis results
  Contribution outputs are ready to combine
  Checked [time]                  Refresh results
  Complete output checks         4 tasks
  Context combination still required; meaning remains unassessed.
```

This follows the existing request record rather than introducing a dashboard
or a percent-complete estimate. It reports a verified saved snapshot, not a
live worker connection. Completed context and thematic work remain unreviewed
machine material. Browser acceptance remains pending.


## Verification and defect found

The final focused run passes 94 tests across six files. The changed-source ESLint
check passes. Evidence is retained in [execution-progress](execution-progress/).
The mutation runner accepts an application directory and a new output directory.
A harmless comment control passes; 16 targeted mutations fail. Each source file
is restored byte for byte. The pagination and account-remount failures use their
specific runtime and DOM assertion messages, rather than a generic assertion label.

Authenticated reads against the owned API on port 29821 reconstruct four segment
outputs, 13 context outputs and five thematic outputs. These are synthetic fixture
records. Their statuses are respectively ready for record consolidation, complete
context frames and complete machine proposal. Meaning and staff acceptance remain
unassessed. The read rejects the wrong campaign and the preserved failed plan.

The first native probe found that a historical request without selected attempts
could report reconstructed task counts without comparing its retained plan.
The added plan reader checks the saved header, every paginated task and the seal
against the reconstructed plan. It reads the seal first to avoid treating a
concurrent partial preparation as sealed. Missing or partial preparation has an
unknown task count, distinct from zero. Corrupt retained bytes remain unavailable.
A native mutation that bypasses this comparison accepts the preserved failed plan
and fails the probe. Restoring the comparison passes against the same database.
No historical plan, provider output or selection record is changed.

The initial standalone TypeScript run exhausted its default 4 GB heap. A second
run with 6 GB found a manifest-status type mismatch. Schema parsing now narrows
the status at the server boundary. The final standalone TypeScript check passes with the 6 GB allowance.
Production build `42976a78` passes with an unchanged clean checkout. It predates
the subsequent BCA integration; a combined production build remains pending.

These checks do not establish rendering, keyboard access, console health,
provider semantics, practitioner acceptance or a released capability. The T3
preview remains available but hidden. Its latest screenshot attempt also fails.
The existing execution-permission checkout stays frozen at `408e6e9f` while
acceptance evidence remains incomplete. This new checkout has no browser claim.
Dependent context and thematic request creation in the staff workflow remains
separate unfinished work.


## Integration checkpoint

Main `c369d4bc` contains the merged BCA workbench from PR #118. Merge `291be2d6`
incorporates it without conflicts. The combined focused run passes 143 tests
across eleven files, covering progress, preparation, execution permission and
BCA engine, routes and recovery controls. PR #119 targets main to trigger the
main-only GitHub workflows; PR #117 remains its dependency until accepted and
merged. No source changes occur in the frozen PR #117 acceptance checkout.


## Production reads at 103a67fd

The combined clean-checkout production build passes. Its owned server runs on
port 3481 with PID 1638323 and the progress worktree as its verified cwd.
The health response identifies `103a67fd2312`, version 0.67.0. The browser follows
Overview, Engagement, the synthetic consultation, Analysis and its saved source.
Request-history controls expose the new progress view. Actual HTTP reads return
200 with `private, no-store` for segment, context and thematic stages. The DOM
shows the expected 4, 13 and 5 output counts and their distinct review boundaries.

T3 reports success for a locator click that does not navigate. DOM activation
of the observed links and buttons performs these checks. Screenshots and text
snapshots fail. The hidden renderer leaves resize animations at time zero,
including a 240-pixel sidebar offset. A fresh 390-pixel page load puts the main
area at zero and gives the progress panel a 300-pixel width, with both buttons
inside it. This is measured DOM geometry, not visual, pointer, keyboard or
console acceptance. Detailed evidence is `execution-progress/browser-103a.json`.
The owned progress server is stopped before subsequent source corrections.
The separate PR #117 acceptance server remains unchanged.

## Broad-check failures and corrections

The shuffled GitHub run at `103a67fd` fails three checks while 18,511 tests pass
and 1,529 skip. Two task counts omit an explicit locale. Two phrases increase
the existing copy ledger. The generic plan reader also adds a projection the
structural query guard cannot inspect, bringing its skipped set to 250.
The original failures remain in `execution-progress/ci-103a-failures.txt`.

The count formatters now name `en-US`. Staff copy uses saved material and
preparation. The seal and header queries name their tables and projected fields
at their call sites. The query guard now checks them against the schema; its
limits and the copy baseline remain unchanged. The component assertion follows
the revised unknown-count wording and still refuses a zero-count interpretation.

The repaired subset passes 155 tests across 14 files. A harmless comment passes;
five targeted faults fail for unpinned counts, internal wording, an unknown count
shown as zero, an omitted header field, and an opaque projection. Both source
files are restored. Fresh native reads pass for all stages and preserve the
wrong-campaign and damaged-plan refusals. Full GitHub reruns and final browser
acceptance remain pending.

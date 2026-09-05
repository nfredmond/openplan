# Safety map scale correction

## Discovery and release status

The computer reboot interrupted the clean, pushed `ca3acf18` acceptance run.
Its saved results survived. The resumed run preserved completed journeys and
archived the previous partial project attempt. Logs now live on persistent
storage rather than `/tmp`. A 12 GiB ceiling applies to the QA subprocess tree,
not scientific assignment settings. The crash cause remains unknown.

The latest scheduled RLS run `33968966248` failed before tests because port
54322 was occupied. Attempt 2 passed on the same commit. Main CI `33965436728`,
Upgrade `33969165825`, and browser checks `33967657951` also passed.

The resumed project journey remained partial. Its new missing-bundle-control
claim was not reproduced: a front-door browser journey reached Projects,
Evidence, and the review dialog at desktop and 390px, without console errors
or overflow. A linked plan remains required. The original partial attempts
remain failed, regardless of that finding's disposition.

Safety reached its outcome, retained the selected acquisition, and downloaded
the updated report. The preview-refresh finding repeats KI-2026-09-05-040.
The source's unknown exact cutoff is an honest limitation. A claimed missing
progress message was contradicted by its own screenshot, which showed a
retrieval in progress at 14 seconds; it completed at 28 seconds.

Independent inspection then found a new false-output blocker on page 11 of
the downloaded Safety report. The county boundary was stretched to fill a
wide frame. `street-context-svg.ts` fitted longitude and latitude separately,
but calculated a single scale bar from longitude. North/south distances did
not share that scale. The same renderer serves the Safety screen and reports.
The acceptance runner was interrupted during the corridor journey, exit 130.
Four reached outcomes, one partial project outcome, and all interrupted or
unrun jobs do not constitute a release pass. No tag was created.

## Correction

The shared renderer now follows the packet geography figure's local,
latitude-adjusted projection approach. One pixels-per-meter scale fits both
axes; unused frame space remains empty. Local antimeridian crossings unwrap
across the shortest longitude interval. Point-only extents do not invent a
scale. Invalid coordinates are not rendered. Broad latitude ranges whose
parallel scales differ by more than the existing two-percent local-drawing
criterion omit the scale bar. The drawing remains approximate, not survey-grade.

The screen and report print that limitation outside the SVG as ordinary text.
No source records, old report artifacts, model defaults, acceptance criteria,
frozen studies, or holdouts changed. There is no new application write path or
database migration.

## Evidence that the checks can fail

All 12 initial regression cases failed on the original renderer. The restored
focused suite has 50 passing tests. A comment-only mutation survived 41 tests.
Ten separate semantic mutations failed for their intended reasons:

- Independent horizontal stretching: five distance/proportion failures.
- Removing latitude compression: four distance/proportion failures.
- Removing date-line unwrapping: the local crossing reversed and expanded.
- Allowing the broad-extent scale: the omitted-scale assertion failed.
- Miscentering a point-only extent: the center-coordinate assertion failed.
- Doubling the scale bar: five distance-to-bar failures.
- Removing coordinate validation: four invalid-coordinate failures.
- Removing frame validation: four invalid-frame failures.
- Removing the visible screen note: the rendered paragraph assertion failed.
- Removing the report note: the actual report HTML assertion failed.

All mutations were restored by editing. The tests compare known synthetic
local east/north distances at several latitudes and frame shapes. They do not
establish survey accuracy, source-road correctness, or visible browser layout.
Real browser and newly generated report verification remain required.

## Retained before evidence

Local evidence root:
`/home/nathaniel/.local/state/openplan/release-checks/v044-2026-09-05/`.

- `reboot-project-navigation-settled/`: desktop and 390px review screenshots,
  inspected by the main agent. The first helper attempt checked its URL before
  navigation settled and failed. That error was reported; its evidence remains
  separately in `reboot-project-navigation/`.
- `reboot-project/`: nine-page earlier board packet, all pages inspected.
  The five readiness statuses, applicability statements, limitations, registry
  hash, and evidence hashes agree with its downloaded JSON. No bundle ZIP was
  produced by this partial journey. Existing page-break issues remain queued.
- `reboot-safety/selected-crash-packet.pdf`: the 12-page before-fix artifact,
  with pages 9-12 inspected for the safety section and map. Its browser bytes
  match stored artifact `fed69284-e59e-4e63-9bb9-9f62fb6fac6e`, 483,687 bytes,
  SHA-256 `379168ac227c8a0a6039ec5b0d7fd178ed433cee97de4644e57584b68b7ac9fc`.
  The independent Storage comparison accepts a no-op copy and rejects altered
  or truncated bytes. This is not a preregistered report hash.
- `safety-scale-before.log`, `safety-scale-noop.log`, and the ten named
  `safety-scale-mutation-*.log` files retain the regression results.

Full QA, current-commit remote checks, rendered after evidence, and a complete
fresh twelve-journey outcome gate remain pending. The distributed-loading
candidate remains retired and inconclusive.

## Boundary and build follow-up

The first full QA attempt on `4ea45648` passed app tests, all 135 live isolation
tests, and the zero-vulnerability production dependency audit. The build failed
at Node's 2 GiB heap limit, before an after-build browser check. This was not a
new computer crash. The next run explicitly gives Node an 8 GiB heap within
the QA scope's 12 GiB process-tree ceiling.

A final boundary review also found the old scale helper forced a minimum
one-meter bar. On a sub-meter extent, that bar extended beyond the frame.
The helper now supports fractional distances and explicit-locale,
significant-digit labels so a small nonzero distance is not printed as zero.
Two sub-meter fixtures reject the old minimum; a separate formatter mutation
rejects loss of label precision. Both mutations are restored. The complete
focused suite now passes 52 tests. Survey-grade precision is still not claimed.

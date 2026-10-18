# Independent review approves the bounded retained-extent source change

October 16, 2026. Reviewer: GPT-6.1 Sol, high reasoning. No nested agents.

## Verdict and required response

**Bounded source approval. No P1 or P2 finding in the candidate delta.**
No production correction is required by this review. Approval covers the retained
designation extent validation and its selected test evidence. It does not approve
a visible workflow, release, integration, or closure of KI-2026-10-12-025.

This is a new independent reading of the exact component, shared reader, lifecycle
helper, callers, test assertions, author report, and retained execution records.
It does not infer correctness solely from the author's successful check summary.
The reviewer does not import application modules or rerun the test campaign.

## Exact identity and ownership

The reviewed candidate is `4031e31460cfc6cb32f9ba836dd09e72f440c8d1`.
Its parent is `ec0fd7f49c9db24a4516c3c60f4d1b5201357b6a`.
The candidate application tree is `7483792458e9ce8601c5beaafceb23297f2e2776`.
The full candidate tree is `635a003727c1457e544a68fadaa8d67a45739709`.

The author checkout is
`/home/nathaniel/.local/state/openplan/project-budget-reviewed-combined-20261016`.
It is clean at the candidate during inspection. All eight source files named in
the author's EVIDENCE.json match both candidate Git bytes and current author bytes.
The changed component is 6,752 bytes, SHA-256
`e7b0f5d06443470d706437251e4e930ac7cebbd62e1d0ece37e34afd45db336d`.
The new test is 4,913 bytes, SHA-256
`db1d65c6a2f464470b97e4e88006b5fc5ecf00f6fb443c5a8b562b6e471f4528`.

The reviewer preserves the assigned T3 checkout
`/home/nathaniel/.t3/worktrees/openplan/t3-67e536c6` and branch
`t3/review-designation-map-extent`. Its starting commit is
`05dd3e8da4a4572437f06e771b0a2477873e681f`, rather than the candidate.
Review uses exact Git objects without switching or rebinding this checkout.
The live thread configuration confirms `gpt-6.1-sol` and `reasoningEffort=high`.

The candidate delta contains one production component, one new test, and the
author's two review files. The shared reader, existing selected tests, APIs, RPCs,
migrations, queries, providers, legal assertions, and retained data do not change.
Reviewer ownership is limited to this new review directory and
`/home/nathaniel/.local/state/openplan/designation-map-extent-independent-20261016`.

The reviewer reads applicable AGENTS instructions and the planner-writing,
prove-it, and any-place skills. The task's explicit source/metadata restriction
controls execution. No compiler, dependency install, direction command, lock,
service manager, Docker, native application, browser, SQL, or HTTP runs here.

## Source reasoning

At component line 46, the unchanged `readWgs84Bbox` replaces the local four-number
test. For dense retained arrays, the reader checks finite values, each coordinate's
WGS 84 range, and west/east and south/north ordering. Missing, malformed, nonfinite,
out-of-range, and reversed values therefore become `null` before camera construction.
The reader creates a tuple without rewriting the input. It performs no I/O.

The `useMemo` dependency is the incoming `bbox` reference. Notice updates within
the component reuse the validated tuple, so the new tuple does not cause effect
cleanup and reconstruction after every viewport response. The effect depends on
`extent` and `endpoint`. Replacing invalid data with a valid tuple changes that
dependency and runs the existing teardown before constructing the replacement map.
Two invalid values both yield `null`; retaining the same fallback map then fits
the intended behavior. A parent supplying a fresh valid array may still recreate
the map, as the original bbox-reference dependency did. This is not deep equality
or support for mutating a prop array in place.

Cleanup still invalidates pending responses, stops sizing, removes the map, and
clears the map reference. The unchanged `startMap` cancels a pending MapLibre load
when its effect is cleaned up. The selected tests exercise the synchronous mocked
Mapbox branch, so async MapLibre and React StrictMode behavior remain source
reasoning, not newly executed lifecycle acceptance.

At lines 55 and 56, invalid or missing extents keep `[0, 20]` and zoom `1.5`.
This is the pre-existing display camera, permitted by any-place guidance. It does
not become saved geography, jurisdiction, legal applicability, or an analysis
boundary. The new line 126 disclosure identifies the retained extent as unavailable
and asks the reader to choose a view. It remains independent of fetch notices,
including an empty viewport response. Existing engine-unavailable and startup-failed
branches disclose map unavailability instead of showing an interactive camera.

Valid extents keep their arithmetic midpoint and zoom `9`. The original line 102
condition skips fitting only when both dimensions collapse. Points retain their
center without a zero-size fit. Either kind of line still receives the existing
fit options: padding `36`, maximum zoom `14`, and duration `0`. No country-specific
selector, coordinate restriction, or data source is added. Polar and world-edge
coordinates remain within the reader contract; actual engine behavior there is
not proved by mocked camera arguments.

Wrapped extents with west greater than east are deliberately unavailable under
the unchanged ordinary-rectangle reader. The component does not invert or silently
expand them. The original `publicViewport` world-copy clamp and ordinary server
rectangle query remain unchanged and unfixed. This is not antimeridian support.

An inherited reader boundary also remains: JavaScript sparse arrays can bypass
the reader's `map`/`every` checks at missing indexes. The old local parser shares
that weakness. The inspected callers pass retained JSON extent data and introduce
no sparse-array construction. This is not a new P1/P2 in the scoped retained-data
change. Approval does not assert rejection of every possible JavaScript object;
any shared-reader hardening needs its own scope and evidence.

## Retained evidence supports the selected assertions

The reviewer reads the full committed author REPORT.md and EVIDENCE.json and
independently hashes all 2,529 manifest entries. None is missing or mismatched.
The manifest SHA-256 is
`12c29ff7030c8f69900d478a63d0e44be8efa113d4a2b690e8f99f3aafb00415`.
All 26 files in the trial02 seal also match. Trial03 source pins, mutation bytes,
focused type configuration, and path-normalized Vite configuration match trial02.
The preparation seals match their named files. These checks establish byte custody,
not independent execution of the historical commands.

The failed records remain failed. Trial01 is
`PERMANENT_HARNESS_CONFIG_STARTUP_FAILURE_EXIT1`, invocation
`c7fd59acb20d4cce9bc0aba26057fb4d`, with no test execution. Its stderr identifies
the donor React plugin's missing `vite/internal` export. The preserved draft and
prepared config also show the transform-receipt ID correction before execution.
Neither the draft nor the startup failure counts as a test result.

Trial02 removes that plugin in a separate private config and uses automatic JSX
transformation. Its harmless comment transform and baseline each record 40 passing
assertions across three files, exit zero. It then remains
`PERMANENT_HARNESS_READER_FAILURE_EXIT1`, invocation
`6420483df18b459ca11c8a428a8077bd`. Its unscoped NaN oracle is ambiguous across
component and helper tests. No broken mutation is dispatched in that trial.

Trial03 narrows selection to the exact component test group and reuses the sealed
40-plus-40 context. The reviewer compares the actual reports, transforms, receipts,
controller logic, and named failure messages. These are assertion failures, not
startup failures reclassified as mutation kills.

| Trial03 variant | Selected report | Named intended failure |
| --- | --- | --- |
| Restore the weak parser | 23 cases, nine fail, exit 1 | NaN case fails its fallback-camera assertion at test line 54. |
| Hide extent disclosure | 23 cases, 15 fail, exit 1 | Completed empty-query case finds no disclosure at line 84. |
| Discard valid extents | 23 cases, eight fail, exit 1 | Invalid-to-valid replacement fails teardown count at line 93; valid camera cases also fail. |
| Restored source | 40 cases in three files, zero fail, exit 0 | Exact selected names match the harmless/baseline selection. |

The count is 23 new component cases, six existing recovery cases, and 11 existing
reader cases. The actual component and reader are imported by those historical
tests. Mapbox operations, sizing, and fetch are mocked. The mutation plugin targets
only the exact component path and records the find/replace bytes; it never writes
the production file. Every selected module source pin matches at final readback.

Scoped type checking, lint of the component/new test, and nested direction checking
record exit zero. The direction stderr retains expired registry/matrix reminders
and review-version/intervening-change reminders. That exit is not whole-product
readiness. No new test or guard is written or changed by this reviewer.

Trial03 entry binds invocation `320d08ceb62643a88c7735a19e48f855` to eight source
pins, memory limit 1 GiB, zero swap limit, CPU `50000 100000`, and Tasks `64`.
The retained entry/mount data support read-only root/source/donor mounts, the
private writable evidence mount, network isolation, and the wrapper's PID-isolation
configuration. The wrapper binds `/dev/null`; no host-wide exclusive-writability
claim follows. Final resource samples report peak `338092032` bytes, zero swap,
PID peak `43`, and zero memory/PID limit events.

The author reports service wall time `30.089` seconds and CPU `14.978` seconds.
This reviewer does not query the service manager or independently observe those
service timings. The controller separately records approximately `29.976` seconds
for its stages and `29.982` seconds through final readback. Those clocks are not
interchangeable. The entry and resource records support the stated bounded run;
they do not establish browser or native acceptance.

## Remaining objections and claim limits

The scoped source fix needs no minimal corrective patch. Preserve these open
boundaries when carrying it forward:

- No identified-build browser journey, desktop or 390px view, console inspection,
  real map engine, actual viewport service, or usable-artifact acceptance occurs.
- The focused tests cannot establish tile/style loading, WebGL, real camera fit,
  polar rendering, async MapLibre cancellation, or every prop transition.
- Wrapped selection and world-copy queries remain unsupported. Publication-pointer
  races, TIGERweb dependence, and native saved-context proof remain separate work.
- KI-2026-10-12-025, M1, and full V1 remain open. Source approval is not an
  integration, hosted-operation, release, or scientific-accuracy decision.

Private exact-source snapshots, selected receipt copies, manifest readbacks, and
metadata observations live in the reviewer's private evidence directory.
[EVIDENCE.json](EVIDENCE.json) records their identity. Only the new review documents
are committed locally. Application bytes, dependencies, author evidence, main,
remote branches, pull requests, and release state are not changed.

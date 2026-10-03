# Combined integration, October 2, 2026

Main now includes the retained thematic import backend, the current UI work and
the independent review corrections. PR113 merged as
`a8f7183090378f8b7d124299da31f3c9eeb75958`; GitHub also marks PR112 merged.
The merge has the identical file tree to tested candidate
`3d507a1f3d5b570e949b7c03c00fac384e28160d`.

The candidate joins main `8cb534f5`, thematic checkpoint `a77b3cc5` and independent
corrections `ca3e442c`. Changelog conflicts preserve both records. The native
command includes the union of all 88 test files. No other package script or
dependency differs between the two input package files.

Local QA exits zero: 17,514 application passes with 1,446 explicit skips;
387 connector passes with four skips; lint, configured deadcode, dependency audit
with zero reported vulnerabilities, webpack and TypeScript. The first attempt
used the default test pool and exhausted available memory. It was interrupted
with exit143. The successful unchanged run uses four Vitest workers.

The complete isolated native suite exits zero: 88 files, 1,350 passing tests and
125 explicit skips, in 2,280.10 seconds. Finance and Storage migrations
20261015000001 and 20261015000002 were applied additively to the owned restore-target
stack alongside thematic migrations through 20261015000010. No reset was used.
Six focused worker suites and nine fault/control checks pass on the combined
source. Their checks run in disposable source copies and preserve the existing
scientific evidence boundary.

Exact-candidate GitHub checks pass:

- [Application, shuffled order and broader Python suites](https://github.com/nfredmond/openplan/actions/runs/37027405231)
- [Live RLS isolation](https://github.com/nfredmond/openplan/actions/runs/37027404842)
- [Full restore drill](https://github.com/nfredmond/openplan/actions/runs/37027405026)
- [Worker security and cancellation](https://github.com/nfredmond/openplan/actions/runs/37027404890)

Main CI is separate from those candidate results. Worker37033349612 and both
upgrade runs37033349971/37033379316 pass. CI37033349885 also passes, including normal and shuffled application checks.
Native37033349660 also passes on exact main a8f71830, confirmed again after the crash. No release tag is created, v0.66.0 remains unchanged, and the
canonical checkout and demo are not updated.

The Analysis UI continuation lives separately on `work/thematic-import-ui`.
Its discovery, preview, recovery and evidence-display work is not part of this
landed candidate. No new browser acceptance or complete M9b claim follows from
this merge. Large-history performance, final-task resource limits, semantic
quality and the full v1 contract remain open.

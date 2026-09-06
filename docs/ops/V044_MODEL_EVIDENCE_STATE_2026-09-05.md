# Model evidence state correction

Release acceptance is incomplete. The full first-week run
`2026-09-06T02-47-39-941Z` on clean, pushed `bcd6bbde` stopped during model job
05 after two confirmed false-output findings. Its original results remain:
four completed yes outcomes, Safety partly, model work interrupted, and later
jobs blocked by the stopped server. Neither interruption nor partly is a pass.

## Actual contradictory record

Model `f42351d0-e955-4b03-a385-713d460e8025`, baseline run
`2cef8a43-0b23-4bef-9ae8-38fd592ccdbd`, has zero matched count stations and no
median APE. Its raw validation explicitly says the study area is outside count
coverage and validation did not run. The same worker packet calls independent
validation failed. The visible evidence panel repeats that false failure.

The route also inferred no transit configuration from the absence of a separate
transit skim download. The actual worker records transit modeled, nine GTFS
routes, 75 stops, and zero of twenty OD pairs served. A missing downloadable
skim cannot establish whether transit was modeled.

The original raw packet's SHA-256 is
`7bd9a6badcd77f0c3eb9dc050cf11cc5ff95ac43b5e0f0c556234d8435096331`.
Its private stored bytes and the local worker artifact match. No artifact is
rewritten. The separate scientific assessment remains inconclusive.

## Bounded correction

The worker and existing evidence reader distinguish zero matched stations as
not run from incomplete metrics as inconclusive. Measured passes and failures
retain the existing rules. Nonfinite metrics cannot support a claim. The reader
retains the original status and reason in the downloadable record and does not
mutate its input. Missing station counts remain missing, not zero.

The existing route now describes the missing transit download without inferring
transit execution or configuration. The actual modeled-transit record is retained.
The evidence panel explicitly renders the inconclusive state. There is no new
write route, default, acceptance threshold, model averaging, or holdout access.

## Verification and its limits

The original defects failed six new app checks and the worker regression before
the correction. The final focused app run passed 72 checks across six files;
the worker credibility script passed ten checks. Two harmless controls survive.
Eighteen deliberate changes fail for their expected reasons: bypassing the
reader, ignoring zero stations or missing metrics, promoting unsupported claims,
losing original status or reason, mutating source input, replacing measured
outcomes, restoring the transit inference, denying an existing transit download,
ignoring worker zero or missing metrics, accepting nonfinite values, worker
promotion, replacing measured worker outcomes, losing the inconclusive state
or badge, and turning missing worker stations into zero. All are restored.

The first attempt to add the final three mutations used a partial line as a
patch target and was refused before changing source. Those targets were corrected
and rerun. This is not counted as a killed mutation. An earlier test incorrectly
expected transit in the validation-only Markdown download; it now checks transit
in JSON and validation in both formats.

Mocked route tests do not establish storage permissions, real worker execution,
browser layout, model accuracy, or full first-week completion. The original
desktop and 390px browser proof shows the contradiction with zero console errors
and zero app writes. Corrected-build browser proof, full QA, worker execution,
remote checks, and another complete first-week run remain required.

Local evidence is under
`~/.local/state/openplan/release-checks/v044-2026-09-05/`:
`model-evidence-*`, `BROWSER_COMPAT_FULL12_ACCEPTANCE_DRAFT.md`, and
`CURRENT_FINAL_CANDIDATE.md`. Exact `bcd6bbde` CI 34007116388, RLS 34007116375,
upgrade 34007170192 and nightly 34007171383 succeeded. These results predate
this correction.

## Other outcomes retained

The preceding engagement journey completed. Independent anonymous desktop and
390px checks show the approved response body, with no authentication cookies,
console errors, or writes. Safety produced a twelve-page native screening PDF;
all pages were inspected and desktop/390px downloads match private storage at
SHA-256 `895e2c40bd1cc0909087983d44632ce22dc80975b1c91cee0f771a018f7760af`.
The Safety agent nevertheless reported partly because construction treatments,
costs, and benefits were not established. That result is not relabeled and no
engineering claims are invented. The unchanged job must be rerun with the full gate.

Additional queued findings are guidance before retrieving Safety data without
a project area, report freshness summaries that disagree, bulk workbook selection
skipping unknown-year rows despite manual selection working, transient GIS
inventory counts, and narrow report/print legibility. Their evidence does not
establish data loss. Existing issues cover stale report state, crowded model
columns, missing-area summaries, and PDF pagination.

The failed distributed-loading candidate remains retired and inconclusive.
Frozen studies, sources, networks, defaults, and untouched holdouts are unchanged.

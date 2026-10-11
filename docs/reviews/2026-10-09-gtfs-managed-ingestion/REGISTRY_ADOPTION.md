# Completed imports and adopted versions

T3 review of frozen source `d6fd7d00fc88` finds a false statement in the feed
registry. The CTA import is ready and retains 1,678 route and 74,517 stop service
rows. Its feed has no current version. The completed-version card correctly
offers review and adoption, but the registry says it derives no service levels.
The same statement appears in identified desktop and 390px captures.
[The observation record](registry-adoption-observed-defect.json) retains their
hashes. It records a defect, not a passing journey.

The registry now says no version is in use and directs the planner to review
and adopt a completed version. A pending feed with no current pointer displays
`Not adopted`. A failed feed keeps its recorded status. If a current pointer
exists but its version details are missing, the registry reports those details
as unavailable. Recent versions remain separate from current service results.
This changes displayed copy, not saved results, processing or adoption.

[The rendered controls](registry-adoption-controls.json) run the complete
43-test panel suite from the actual nested application directory. Baseline,
harmless source and test comments, and restored bytes pass. Seven deliberately
broken behaviors fail the intended assertions, including treating recent
versions as current and treating unavailable details as no adopted version.
The serial service has a 1 GiB cap, no swap and one CPU. Its rounded peak is
299.6M. Selected-file lint and scoped TypeScript pass. The latter records actual
exit zero in 7.150 seconds and a rounded 510.6M peak. Its first configuration
omits the existing Vitest matcher declarations and fails; adding the existing
test setup file corrects that check configuration without source edits.
A corrected-source production/browser read remains pending. These mocked API
checks do not establish native adoption or planner acceptance.

## Preserved keyless join evidence

[Frozen d6 integration](keyless-join-checks.json) passes product direction,
118 operations tests, key/restore/workflow controls, equity and client controls,
selected lint and scoped TypeScript. The selected regression has 144 files,
2,869 passing tests, 45 skipped and none failed. Its largest observed memory
peak is 809,930,752 bytes under a 1 GiB cap. This is a selected regression,
not the complete QA gate.

[The second production build](keyless-build.json) captures actual child exit
zero in 88.123 seconds. It generates 140 pages with build ID
`dqkHWviYmJc1vpkhKohd-`. It uses the first run's retained cache, a 6 GiB heap,
10 GiB service cap, no swap and one worker. The largest observed peak is
5,951,483,904 bytes; the final journal reports a rounded 5.5G. The first run's
output completes, but its child status was not retained before the transient
unit unloaded. That first run retains output-only evidence with unknown exit
status. A copied child-status wrapper with a forced success code fails its
control. No complete d6 browser journey is claimed after the observed defect.

Main subsequently advances to `8e721db11acf`, and remote PR190 joins it at
`40b8c682795f`. The clean source worktree fast-forwards before this correction.
The frozen d6 checkout and its proof remain unchanged. Its evidence does not
establish acceptance of that later hosted-main join. Hosted GTFS migrations,
schema-first coordination, current CI, main integration and release remain
separate unfinished boundaries.

## Joined build, upgrade and stricter language guard

[Frozen f381 production](adoption-build.json) passes with actual exit zero in
235.354 seconds. Its fresh build output has 140 pages and ID
`dZmpB54A7m8SyF8jZYOzs`. One worker, a 6 GiB heap and a 10 GiB service cap
produce a rounded 6.5G final peak. The largest sampled peak is 6,992,461,824 bytes.
The build uses its own locked dependencies and no previous `.next` output.

[The selected recovered-preview upgrade](adoption-preview-upgrade.json) applies
only reviewed M32 SQL with SHA-256
`dc26f3316ed88dcd480990fd76f60977d1e76d29bd475e8ee14d711a42af27b7`.
Default CLI refuses the older missing file without changing rows or history.
Explicit `--include-all` reaches exactly 405 migrations; a repeat changes
nothing. Checked project, model and transit table counts/hashes stay unchanged,
and the two exact receipt functions retain `extra_float_digits=3`.
[33 pure scope and preservation controls](adoption-preview-upgrade-controls.json)
pass. The actual upgrade service peaks at a rounded 214M under 1 GiB.
This does not apply any migration to hosted services.

[The broader f381 regression](adoption-join-regression-failure.json) passes
2,915 tests, skips 45 and fails one planner-language equality assertion. The
wording correction removes one `ingest` occurrence, so the actual count falls
from eight to seven. The retained baseline still says eight. The correction
tightens that one counter to seven; it does not change detection or runtime
application code. [Four focused language tests and controls](registry-copy-controls.json)
pass for baseline, harmless comments and restored bytes. Reintroducing the old
sentence, restoring the stale counter or setting an incorrect lower counter
each fails that equality assertion. Lint passes. The original broader failure
remains failed evidence; no complete passing f381 integration is claimed.

Earlier d6 [full GitHub CI](earlier-d6-ci.json) now passes all five jobs,
including the executed shuffled suite. Its QA gate passes 21,765 tests and
skips 1,603. [Separate live RLS](earlier-d6-rls.json) passes 104 files and
1,499 tests with 125 skipped. Those earlier source results do not establish
later-source CI acceptance. The corrected visible journey, later CI, full
archive, schema-first hosted disposition and release remain unfinished.

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

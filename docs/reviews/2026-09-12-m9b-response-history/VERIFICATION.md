# v0.56.0 candidate: retained response history

Publication is pending. This is a bounded M9b increment, not completion of M9b
or v1. v0.55.2 is already published and must not be tagged again.

Source ff65825b was exercised in the identified worktree on localhost:3255 using
installed Chrome, with only the isolated openplan-restore-target-2026091050 stack.
The identity receipt confirms the actual Next dev process checkout. Application
source stayed fixed during acceptance. The demo and root checkout were untouched.
All browser contexts and the owned proxy/dev process stopped after acceptance.

At 1440px and 390px the runner signed in, entered Engagement, created a synthetic
campaign and response through the UI, corrected the answer, removed the response,
and returned through real navigation to its retained history. Original checksum
and all history rows matched before and after two injected RPC failures and
keyboard retries. Anonymous API requests returned 401; no horizontal overflow or
page exceptions were observed. Separately both widths reopened these originals
and the preserved 1,005-response campaign, selected its last option by keyboard,
and showed the truthful legacy-baseline warning. No fixture from earlier accepted
journeys was edited. Screenshots of original, corrected/removed and baseline
copies were opened and inspected; receipts and hashes are in browser/.

Desktop console included the deliberately injected 503s, intermittent
ERR_NETWORK_CHANGED, and related workspace/cartographic fetch warnings. Their
underlying network cause remains unknown. The small mobile journey recorded only
the two injected 503 errors. The additional original/large reader captures checked
page exceptions; they do not establish a clean browser console. No complete map
or public-engagement workflow claim is made from these journeys.

Two initial runner issues were corrected: the edit-field label lookup timed out
although the field and its accessible name were present, then an unscoped checksum
locator matched identical corrected/removal snapshots. The latter correctly have
the same checksum. Fresh journeys passed after using the editor placeholder and
scoping the checksum assertion to its revision. These are not demonstrated app
defects. Initial screenshots and full diagnostics remain private.

Focused checks: reader/API/schema/current-builder 36 tests passed, history UI four
passed; TypeScript and changed-file lint exited 0. Initial root-directory test
invocation was invalid and is not app evidence. SQL mutations: harmless survivor
plus five matched failures. Reader/API mutations: harmless survivor plus thirteen
matched failures. UI mutations: harmless survivor plus four matched failures.
Initial mutation harness diagnostics are retained: null-user access crashed rather
than producing the intended assertion; Testing Library reports a missing alert as
an element error, not an AssertionError. Corrected probes reran from restored
source and matched the specific intended failures. See IMPLEMENTATION.md and the
mutation scripts/receipts for scopes and restored-source hashes.

The applied isolated database has 321 migrations through 20261014000002. The
pre-apply SQL probes must not be rerun unchanged against it. Previous foundation
RLS covered 479 tests; complete final QA/shuffle/RLS/worker and populated upgrade
checks, then exact main CI, remain pending at this checkpoint. Older queued upgrade
run 34737449570 targets 5d8268a1, not the final reader; do not treat it as final proof.

Limits: checksums establish retained bytes, not truth or responsible approval.
Schema retention cannot reconstruct earlier edits. Reasons, stale-write conflicts,
durable mutation retries, translation-version custody and complete decision linkage
remain the next implementation work. No human review gates software release.


## First full candidate checks and corrections

Source a038ba70 completed full QA and seed-913562 shuffle with eight failures,
14,123 passes and 450 skips. Both found the same three preparation gaps: release
metadata still named v0.55.2 in the contract/roadmap/matrix/registry, migration names
had moved out of Unreleased before tagging, and two new interface phrases raised
the existing plain-language baseline. No guard was weakened. Current-release
metadata is aligned without changing review dates or scientific claims; Unreleased
again names both migrations; the empty/error phrases use plain response wording.
Focused replay is required after those corrections. Worker checks on a038ba70
completed all 52 suites with zero failures/not-run; those worker sources did not
change in these corrections. RLS was still active when this paragraph was written.

Two additional focused cases now independently break duplicate history identity
and retained-copy campaign scope. The earlier duplicate-row case also broke the
revision sequence, so it did not isolate the identity guard. Fresh reader/API
mutation results have one harmless survivor and fifteen matched failures. No
previous positive result is being used to claim those extra cases were covered.

Corrected focused replay completed 43 tests across six files. RLS on a038ba70
completed with status 0; the same migrations and RLS suite remain unchanged by
the subsequent metadata, interface wording and additional offline test corrections.
Final browser and full QA/shuffle replay are still pending on the corrected commit.

## Corrected candidate acceptance at 03c1fe38

Fresh desktop and 390px journeys passed on 03c1fe38 after the wording correction;
see browser-final/ for identified process, receipts, scripts, screenshots and hashes.
Both retained identical originals and complete history through correction, removal,
two injected 503 reads and keyboard recovery. Screenshots were opened and inspected.
Desktop console contained three preload warnings and two injected 503 errors;
mobile contained only those two injected errors. Neither had page exceptions or
horizontal overflow. The earlier 1,005-entry selector and baseline checks still
cover the unchanged reader and selector implementation.

An initial cold development run exceeded the empty-history assertion's five-second
timeout while Next was compiling. Its screenshot showed Loading response history,
not a false empty result. The assertion now allows 45 seconds, matching other
runner actions; the fresh complete runs passed. The cold-run diagnostics are
retained privately. This is not a measured production-performance claim.

Corrected shuffled tests, seed 913562: 14,133 passed, 450 skipped, 1,261 files passed
and 43 skipped. Full-checks.json retains the earlier failures and terminal RLS
(479 tests/50 files) and worker (52 suites) receipts with private log hashes.
Full QA replay on 03c1fe38 is running. Source/migrations must stay fixed until it
finishes. Main remains the published v0.55.2 commit; v0.56.0 is not yet released.

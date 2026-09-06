# Independent second review of desktop-control repair

September 6, 2026. Source-only review in the isolated landing checkout. Read the changed panel, refresh script, direct tests and CI invocation. No GUI, process control, refresh command, test, mutation, database or network call was executed. Repository files were not edited by this reviewer.

## Material findings in the initially reviewed patch

### Stop can leave an owned server running when an intermediary exits

`openplan/scripts/ops/openplan-control-panel.py` lines 207-219 initially ordered only the npm leader last and rechecked that leader before every child signal. The selected children can include an intermediate shell as well as the Next process. If TERM ends that shell and npm exits in response before the next iteration, `owned_session_alive` becomes false and the remaining child is never signaled. This is a source-derived execution scenario, not a reproduced live process test. It avoids a foreign signal but can leave the owned server orphaned and make later automatic Stop unavailable.

Minimal repair: acquire and validate all owned target pidfds before sending TERM; revalidate the leader before the first effect; then finish signaling only those pinned targets even if the original leader exits as a consequence. Close every acquired handle on refusal and exceptions. Add a fake regression with two children where the first signal ends the leader and both originally owned children must still receive TERM. Root delegated this correction to the control agent; final review is recorded below when available.

### Failed cleanliness inspection still continues refresh

`refresh-walkthrough-instance.sh` lines 42-45 places `git status` inside a command substitution used by an `if` test. A nonzero status query with no stdout makes the outer string test false. Bash's `set -e` does not make this conditional fail closed. The script can continue to fetch, move the checkout and build even though cleanliness was never established.

Minimal repair: capture the status output with an explicit failure branch, then test whether it is nonempty. Add a fake nonzero git-status regression asserting no fetch, merge, build or restart. This is an existing adjacent defect, not caused by the new migration failure check.

### Migration CURRENT does not establish complete local inventory

`refresh-walkthrough-instance.sh` lines 82-89 accepts a nonempty array with arbitrary equal nonempty strings, or remote-only rows, as CURRENT. It does not verify a complete set of on-disk migration versions. For example, a complete-looking response containing one matched row cannot disclose that a required local file is absent from the response. The fake happy path in `tests/test_control_panel.py` lines 227-258 creates no migration files, so it cannot distinguish a full inventory from this truncated response.

Minimum immediate tightening is valid timestamp shapes and a local row. The stronger bounded correction enumerates on-disk migration versions and requires every one to have the same local and applied remote version, refusing missing/duplicate/unreadable identity. Remote-only applied history is a separate compatibility question and should not replace local coverage. Add matched/full, missing-local, truncated, malformed and duplicate fake responses against temporary migration files. This is a source-inspection gap; I did not query a real CLI response or claim the real CLI currently truncates it.

## Process identity and signal-race assessment

The initial patch validates the stored leader PID, session and `/proc` start tick and checks `Popen.poll`. It identifies session members, obtains a pidfd, checks identity again, and sends through the stable handle. It never falls back to a port PID or process-group kill. I found no concrete foreign-process signal path through ordinary PID reuse in this design. A PID reused before acquisition fails the recorded identity check; reuse after acquisition does not retarget the pidfd. This is source reasoning, not a live kernel race test.

A TERM request is not proof of process exit. A process can ignore TERM or spawn after the member snapshot. Current normal Stop says requested, which is appropriate; closing the window after requests does not establish full cleanup. Preserve this limitation rather than claiming reliable shutdown. A process which has left the session or whose leader already exited is intentionally refused.

## Test isolation and headless CI

The panel uses Tkinter, not GTK. The test installs an inert `tkinter` module before compiling the panel, and assigns a non-main module name, so the source's guarded main does not construct a native window. The test registers its module for dataclass processing. Current CI invokes each `test_*.py` as a separate Python process, so the Tk stub does not leak across sibling suites. These tests do not establish real Tk rendering, events, thread behavior or desktop usability.

Controller `setUp` redirects log paths into `TemporaryDirectory` and provides fail-fast default fakes for Popen, run_quiet, http_health and signal calls. The tested start path additionally fakes Path.open. The actual signal test branches replace pidfd open/send/close together. This fixes the formerly live log path for the reviewed calls. It is not a universal sandbox for all OS calls or future controller tests; direct filesystem or subprocess.run code elsewhere would need equivalent coverage if exercised.

Refresh tests copy the script beneath a temporary instance and explicitly pass that instance path. The copied script therefore derives its canonical environment path inside the same temporary tree. Git/npm/systemctl/curl/sleep commands resolve to test fakes. Bash, Node and file utilities are real but their reviewed file targets remain inside that temporary instance. No live service command is reached by the present source paths. Retaining the host PATH means an added operational command would need a new explicit fake; this does not itself establish a current escape.

## Refresh fail-closed improvements and remaining limits

The new migration pipeline checks command failure with pipefail, so valid-looking JSON from a failed query cannot establish success. Unreadable/empty/pending verdicts terminate before dependency install/build/restart. A mismatched served identity now ends in failure after restart. This may require recovery and is correctly disclosed. Environment completeness, old-build compatibility, independently served bundle bytes, database operation and browser acceptance remain unproved. Nothing in the helper establishes release readiness.

## Final correction review

The control agent's revised `stop_owned_session` now acquires each selected pidfd, verifies its recorded identity, and completes that collection before sending any TERM. It checks the original leader once immediately before the effect phase. It then signals only the pinned handles, without requiring the leader to survive a previously requested child termination. An outer `finally` closes collected handles on refusal or exception. This resolves the identified anchor-exit gap by source inspection. No new foreign-process signaling path was identified in this revision.

I sent this conclusion directly to the control agent before ownership release. I then read the saved `test_pinned_children_still_stop_when_first_term_exits_leader` and `test_later_handle_failure_closes_prior_handles_without_signals` at test lines 129-151. The first has two children and a leader, requires all handles open before any signal, marks the leader exited on the first child TERM, still requires the second child TERM, tolerates the dead leader and checks all closures. The second proves the intended cleanup/no-signal assertions on a later PermissionError. These are suitable fake regressions for the reported scenarios. I did not execute them; test results and final mutation evidence remain owned by that lane/root. Real shutdown and native Tk behavior remain unverified.

Reviewed panel file SHA-256 at this follow-up: `aea26ab270a5e05ca8cdb85cf0b94e608eae6edb25c654562dcbe6d83538cd53`.


## September 6, 2026 addendum: final refresh corrections

Source-only follow-up before commit. The original findings above remain unchanged as the record of what was found. I read the revised refresh script and saved fake regressions, and did not run the script, tests, mutations, GUI or any live service probe.

Both reported refresh gaps are resolved in the reviewed source:

- Lines 42-48 explicitly capture `git status` and abort on its nonzero exit before testing cleanliness or reaching fetch. `test_failed_checkout_status_stops_before_fetch` supplies a failing status command and asserts failure plus no fetch/npm invocation. The saved mutation changes that abort into continuation and targets this test.
- Lines 85-111 validate fourteen-digit version strings and enumerate the selected app's actual migration filenames. An unreadable or empty inventory, malformed SQL filename, duplicate on-disk version, missing/duplicate local response version, mismatched count or substituted local identity produces UNREADABLE. Each expected local version must have a corresponding remote version to reach CURRENT; missing applied versions produce PENDING and abort. Remote-only extra history is conservatively refused rather than treated as proof of compatibility. This resolves the prior incomplete-response and arbitrary-string acceptance paths.
- The refresh fixture now creates a real temporary migration directory and SQL filename. `test_migration_response_must_match_actual_file_versions` exercises remote-only, arbitrary equal strings, wrong local versions and extra remote-only history. The existing matched-source case remains the success control. The saved inventory-removal mutation targets this test. These assertions match the source defect; I did not execute them or independently inspect mutation output.

Root separately reported inspecting the actual local CLI response as single-line JSON with `migrations` and `message`, containing 246 local/remote string rows. I did not perform that query. It supports the observed response shape without turning this source review into a production migration or refresh acceptance claim.

No further material defect found in these two corrections within the requested bounded source review. The earlier limits remain: TERM requests do not prove exit; the helper checks migration identities rather than database object correctness or old-code compatibility; a post-restart failure can need recovery; no native Tk/browser/deployment acceptance was established. Fake tests remain confined to the reviewed temporary fixture paths and replaced operational commands.

Reviewed source SHA-256 values:

- refresh script: `80b00cb73893f967089460a49a6e77e9790918d896f609cf633b8bb095fd127c`
- direct tests: `ef50db1c8a958358d9819d9154801eb2c428b1952688452852ce38e2f1164122`

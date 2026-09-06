# Post-handoff desktop control repairs

September 6, 2026. Work performed only in the isolated landing checkout after the development handoff. Owned source files: `openplan/scripts/ops/openplan-control-panel.py`, `openplan/scripts/ops/refresh-walkthrough-instance.sh`, and new direct test `openplan/scripts/ops/tests/test_control_panel.py`. No commits or branch changes made. Other agents' documentation and guard changes are preserved.

## Test-isolation incident

I made an isolation error in the initial mutation run. The deliberately broken port-conflict guard reached `DEV_LOG.open("w")` before the fake process launcher refused execution. This opened/truncated `/home/nathaniel/.cache/openplan-control/dev-server.log`. Its observed metadata was 0 bytes, modified **2026-09-06 09:56:01 -0700**. Prior size and contents were not captured, so whether prior diagnostic text was lost is unknown. No restoration was attempted or claimed. I reported this immediately to the root agent and in commentary.

No application process was launched or signalled. The fixture now redirects `LOG_DIR` and `DEV_LOG` to a per-test temporary directory before any controller action, including mutations. Every process launch, signal, pidfd operation, command collector and HTTP call is inert or fails loudly unless a particular test supplies a fake. Refresh tests copy the script into a temporary instance and supply fake git/npm/systemctl/curl/sleep executables through PATH. They run the actual JSON validator with Node and harmless shell/file operations only against the temporary instance. Bytecode writes are disabled. The entire mutation harness was rerun after this correction.

## Implemented behavior

- Stop and close-window cleanup no longer derive signal targets from the port. A window records the session created by its own `Popen(start_new_session=True)`, verifies its live leader and Linux start time, and enumerates only that session's members. The complete target pidfd set is acquired and validated before any signal, and the original leader is checked again before the first signal. All handles close on refusal or acquisition failure. Once stopping begins, termination of the leader does not prevent signals to already pinned children. There is no numeric PID or process-group fallback. Children are requested to stop before the leader. An exited/reused leader, missing ownership or unavailable pidfd support refuses automatic cleanup. The panel reports a stop request, not proof that every child has exited.
- Start refuses an occupied port or an unreadable socket table, including listeners whose PID/cwd cannot be inspected. During startup, a responding foreign listener does not trigger the automatic browser opening. External sessions remain protected even if they use the same checkout.
- GitHub status explicitly queries the latest main-push CI run for the checkout's exact commit. Missing, malformed, different-commit, queued/running, skipped and unknown results cannot become a green CI success. The latest nightly is separately identified by commit/date/link. The row explicitly says other workflows and uncommitted edits are unassessed; it no longer asserts that every workflow passed from a forty-run sample. Existing historical classifier tests remain untouched.
- Status refresh keeps one timer and at most one collector worker. Closing during an active action is refused. Demo comparison checks ancestry and no longer recommends blindly deploying newer development code.
- The panel reports update-command completion separately from matching the running build, database readiness and browser acceptance. It removes blanket assurances that nothing can be lost.
- The refresh script fails before dependency installation/build/restart when querying migrations fails or the response is unreadable, empty, malformed, inconsistent or pending. Migration IDs must be valid 14-digit versions and the reported set must match the actual migration SQL filenames, including no missing, duplicate or extra reported versions. A failed Git status inspection refuses even the fetch. A missing/mismatched running-build stamp fails after restart and cannot reach Done.

## Verification and its limits

Commands run from the landing checkout:

```sh
python3 -B openplan/scripts/ops/tests/test_control_panel.py
python3 -B openplan/scripts/ops/tests/test_control_panel.py --prove-mutations
python3 -B openplan/scripts/ops/tests/test_automated_checks.py
git diff --check -- openplan/scripts/ops/openplan-control-panel.py openplan/scripts/ops/refresh-walkthrough-instance.sh openplan/scripts/ops/tests/test_control_panel.py
```

The new suite passed **26 tests**; the existing classifier script passed its checks; the focused whitespace check passed. An initial controller fake exhausted its `poll()` sequence; this was corrected to represent the intended process exit before the passing run. No runtime bug is inferred from that fixture error.

The mutation harness first reported a harmless comment mutation **SURVIVED**, then **15 consequential mutations KILLED**. Actual failure reasons were inspected:

| Removed protection | Observed failure |
|---|---|
| Session membership filter | Fake foreign PID appeared in the opened-handle list |
| Child PID reuse check | Signal mock was called when it must remain untouched |
| Leader identity check | Refusal returned true instead of false |
| Occupied/unknown port refusal | Fake launcher raised `live process forbidden` |
| Exact CI commit match | Different-commit result became green |
| Running CI branch | In-progress evidence was classified as failed rather than pending |
| Collector overlap check | Two worker threads were requested instead of one |
| Panel build-mismatch disclosure | Required unverified-identity result disappeared |
| Unreadable migration refusal | Script exited zero and reached fake build/restart |
| Failed migration-command refusal | Success-shaped output from a failed command exited zero |
| Runtime build-mismatch refusal | Script exited zero instead of failing |
| Requiring the leader after the first requested termination | The two-child shutdown regression returned false and missed remaining targets |
| Handle cleanup on acquisition failure | Opened handle was not closed |
| Failed Git-status refusal | Script continued and exited zero |
| On-disk migration inventory comparison | Remote-only, missing-expected and extra-version responses reached success |

Mutation copies exist only in temporary directories. The harness compiles source directly and uses `-B`/`PYTHONDONTWRITEBYTECODE=1`, avoiding stale bytecode. The tests use inert Tk widgets and do not require a display or Tk package in CI. The shell tests require Node, already part of the app toolchain; they install nothing.

This is fake-process/controller verification, not native GUI or live-service acceptance. No existing browser, app, worker, service, test account or database was operated. Xvfb was not available; I did not install it or use the live desktop as a substitute for an isolated visual review. No new screenshot, desktop-size/keyboard proof or end-to-end demo-update claim is made. Current upstream CI results and final main integration belong to the root agent; these local test results are not GitHub CI evidence.

## Still open

The migration check still assumes the local Supabase target is the instance's actual database; it does not prove the configured runtime database's identity or migration-file content hashes. It now reconciles the on-disk version inventory. The update still modifies/builds in the serving checkout and selects origin/main, with no accepted-release selection or atomic rollback. Browser acceptance, safe update interruption/recovery, cross-window update locking, redacted diagnostics, full worker readiness and native GUI layout remain outstanding. The pidfd path is Linux-specific; automatic cleanup intentionally refuses when identity cannot be established or the original session leader exited before the complete target set was verified. Processes that create a new session or appear after enumeration may remain running. Those limits are preferable to signalling an external process, but require further recovery work before claiming complete desktop self-service.

## Independent-review follow-up

A second engineering review found a reliability defect in my initial stop algorithm: signalling an intermediate shell could make npm exit, causing a subsequent per-child leader check to refuse before the Next server was stopped. The revised two-phase algorithm and new two-child regression repair that case. All three handles must be open before the first TERM; that first TERM makes the fake leader exit, and the remaining pinned child still receives TERM. A separate test makes a later pidfd acquisition fail and requires all prior handles to close without sending any signal. The independent reviewer read and accepted this correction and the test design; their review is source evidence, not an additional live execution.

I verified the installed Supabase CLI version and command help without accessing the database: version 2.111.0, with migration list --help explicitly supporting --output-format json. The root agent separately reported a successful read-only migration list with a dictionary containing migrations/message, 246 rows and local/remote/time keys. My on-disk inventory independently found 246 migration SQL files, all with 14-digit versions. Thus the test response shape is supported by the actual installed CLI, rather than inferred solely from fakes. Neither observation proves that this local database is the deployment's configured runtime target. Public raw-source URLs for the attempted 2.111.0 tag returned 404; no public-source verification of that release is claimed.

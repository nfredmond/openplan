# Running-request cancellation and release checks

Continues `df8ea20c` in `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`, branch `work/translation-command-workflow`. The previous goal turn made progress by saving and pushing the completed-output browser evidence and reset checkpoint. This turn verifies running-request cancellation and additional release checks. The translation increment and full V1 objective remain unfinished. No application behavior has been changed by this evidence increment.

## Real browser and worker boundary

`translation-running-resolution-browser.cjs` enters through root, sign-in, Engagement, new campaign and Setup using keyboard activation at 1440px and 390px. It saves a manual baseline, queues a real request with a lost acknowledgement, and starts the actual worker with the actual SDK against a held, process-local synthetic provider transport. No paid provider call is made. It checks the worker is still live and the database/journal state is running before closing the request through the editor.

Both original baseline journeys passed. Closing the damaged stored and page-held copies stops the active provider signal. The worker retains an interrupted terminal result with no generated output. Lost resolution acknowledgement, archive quota failure and exact retries preserve both copies until their receipts are saved and downloaded. Downloaded receipts match the database bytes and hashes. The saved request remains discoverable, reads as interrupted, has no publication button, and leaves the original wording and its sole history row unchanged. Wrong-workspace, anonymous and late-original-creation attempts remain 403, 401 and 409.

Desktop and mobile interrupted-request/archive screenshots were visually inspected. Text and controls wrap within the viewport; mobile is narrow inside the existing nested panels but the status, source, saved revision and download action are legible. The prior completed-request desktop output and mobile archive screenshots were also inspected this turn. That earlier completed output remains publishable with its machine label. These screenshots are recorded evidence, not a new run of the completed-output journey.

## Verification corrections

The first harmless worker-comment control failed on an HTTP 503 while reading the running request, before resolution. The worker later hit the synthetic transport's bounded deadline, so that run proves neither cancellation nor a fault kill. SQL readers deliberately return PT503 when custody locks conflict; worker status takes the exclusive common scope lock. This makes contention a plausible explanation, but the route's generic 503 does not establish the exact cause. No SQL guard was changed or weakened.

The runner now retries only that exact read on 503, at most five times, recording every status. It immediately returns permission failures and still requires a successful complete read. The actual extracted helper passed baseline and harmless controls and rejected four targeted faults: skipping the unavailable retry, retrying permission failures, omitting status evidence and exceeding the five-read bound. `running-read-retry-controls.json` records the evidence. This changes test orchestration only, not application retry behavior.

The next harmless full browser run passed both widths. Removing only `current.state !== "running"` from the real worker's status guard then caused the exact intended failure: expected `provider_abort_observed`, received `provider_abort_not_observed`. The first result collector nevertheless failed because it expected a custom assertion label that this Playwright error renderer omitted. The collector now checks the actual expected/received values. Failed attempts remain in the private evidence directory; neither is reported as a successful control run.

The synthetic provider transport records dispatch and either abort or deadline to a flushed local event file. It never returns model output. A worker can independently fail closed on another error; the event assertion prevents an interrupted database row alone from being mistaken for proof that the provider observed cancellation. These checks do not establish live provider billing or arbitrary provider/network behavior. Dedicated fault controls for every inherited completed/archive assertion are still not supplied by this increment.

The final full control runner exited 0. Its harmless change passed both widths and the removed state guard failed on the expected provider-abort difference. Production worker bytes were restored exactly. See `running-resolution-browser-controls.json` and `running-resolution-browser-evidence.json`.

## Other checks

The immutable QA worktree at `125bf2a3` completed all 52 worker suites, zero failures and zero not run, with saved exit 0. The shuffled suite at seed 913058 also completed with saved exit 0: 1,294 files passed, 49 skipped; 14,995 tests passed, 496 skipped. Its working tree remained clean. Native worker virtual environments were reused without installing dependencies. Fresh full RLS at the preceding checkpoint passed 525 tests; it was not rerun during browser writes. The aggregate QA exit-status limitation in `COMPLETED_RESOLUTION_RESET_CHECKPOINT.md` remains until the final implementation gate is run with a durable exit marker.

`product:direction:check` passed with reminders that the dated review covers v0.44 while the package is v0.58.1. Remote main remains `ef16f166447ab477ea36588a5c01620f61560b19`; CI 34779793816 and RLS 34779793752 both report success. Main's earlier Upgrade Path 34778947466 passed on `b330bcc8`. None of these remote runs validate this unfinished branch. No merge or tag was made.

At the final checkpoint, the isolated stack has six completed, 29 cancelled and nine interrupted fields, with none queued/reserved/running. The synthetic server is stopped. Ordinary dev server PID 2893472 on 3260 was identified as this worktree; process environment contains neither the synthetic provider key/model nor the network preload. Its tool handle is 7654 and log is `translation-normal-server-after-running-resolution.log` under the private evidence parent. Recheck liveness/identity after a reset. All test/control processes from this turn are terminal.

## Continue here

Read the terminal evidence manifest beside this note for the final control disposition and process state. Preserve the original checkout and demo, which have another active session. Do not restart old releases. Direct verified main releases, no PRs, no human-review release gate and free local operation remain authorized. Preserve the pending reminder constraint.

Next reproduce and correct old generation-editor lifecycle handling. `translation-generation-panel.tsx` uses timeout signals without its own unmount/access cancellation for send/list/view/recover. In particular, send can finish a later read and retire browser recovery after unmount. This is a source-based concern, not yet a reproduced defect. Add delayed real React cases at acknowledgement/body/read stages, lose access or unmount, and verify retained copies and absence of stale follow-up actions. The new resolution controller already has a scoped operation guard; reuse its relevant pattern without rewriting working custody helpers.

Then complete public-comment durable generation/reservation/recovery, remaining browser and transport coverage, upgrade and final release checks. The current public producer still directly generates and meters afterward without awaiting. Full nationwide planning and separate AequilibraE/ActivitySim validation remain in scope. The complete V1 goal stays active.

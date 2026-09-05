# Older model-evidence downloads and interruption custody

Release acceptance remains incomplete. This corrects two failures found after
the report-corrected twelve-job run on `b46f0a61`.

## Reproduced download failure

Run `2026-09-05T21-02-59-699Z` reached ten outcomes. Land-use's first attempt
reported partly after confusing a different process form with the implementation
action; its own screenshot, stored action, frozen report and independent
desktop/390px reload all retain completed. That false finding remains preserved.
The final model-evidence job downloaded all 42 v0.44 artifacts, then stopped
during the older-study links and model navigation. Its recorded outcome is no.

The agent called this a server failure. That cause was not established. Health
still responded, and an authenticated request retrieved the exact 30,873,249-byte
match audit in 411 ms. Its SHA-256 was
`b68775eabd7cea8c28d9a30210bda9b64ea51c82a4815bfdb130e58ff207bf1c`.
This HTTP diagnostic was not counted as a native browser download.

An independent front-door browser reproduced the failure on `b46f0a61`:
observations downloaded, five subsequent controls produced no native files,
and the model link did not navigate. Requests showed attachment endpoints being
prefetched as page data. Adding a download attribute to the already-loaded DOM
did not repair that session. These failed controls remain retained; the exact
internal router state was not established.

The v0.40, v0.41 and v0.43 panels now use native attachment anchors, matching the
existing v0.44 panel. The v0.41 panel also shows the exact filename and existing
frozen hash beside each artifact. Missing custody says unavailable. No frozen
study, source, network, observation, worker, scientific rule or default changed.

## Rebuilt browser evidence

The first production build of this correction used parent `b46f0a61` plus the
explicit working-tree diff. It is not represented as a clean release checkout.
From visible navigation at desktop and 390px, all twelve selected legacy files
downloaded and matched independently read frozen bytes and hashes. This covers
both v0.43 methods, the v0.41 study/instrument/AequilibraE files, and one v0.40
diagnosis. The model page then opened normally. No attachment page-data requests,
console errors or overflowing artifact text were recorded. Main-agent review of
all eight panel screenshots confirms readable wrapped hashes and controls.
This is focused regression evidence, not the complete model-evidence outcome.

Evidence is under `~/.local/state/openplan/release-checks/v044-2026-09-05/`:
`model-navigation-reproduction-corrected/`, `model-navigation-native-dom-control/`,
`model-navigation-native-build/`, `legacy-native-desktop/`, and
`legacy-native-mobile/`. The first reproduction mistakenly looked for a sidebar
link named Models instead of Travel modeling; that failed check is preserved
in `model-navigation-reproduction/`. No application repair was inferred from it.

Thirteen focused tests pass. The new panel tests admit a harmless change and
reject missing native download attributes in each older panel, each missing
instrument/input/basis/assessment hash, shortened hashes and false missing-hash
text. The TypeScript check initially caught a browser-only matcher option in a
unit test; it was removed. The production build passes. Unit tests do not prove
browser navigation or visual legibility; the separate checks above supply that.
An additional rendered-component check rejects restoring page-navigation links
in each of the three panels even when they retain a download attribute. Its
harmless control survives. It checks the actual component call, not an import
string; `page-navigation-mutations.json` preserves all four results.

## Zero-exit interruption is not completion

The sequential land-use retry was intentionally stopped through its owned
process group so the confirmed blocker could be repaired. Its CLI returned zero
without a final completed-turn event. The old classifier called that completed
because an early report existed. Its planner outcome still did not pass, but
this exposed a route by which a stopped agent's early yes could have passed.

The classifier now requires the final JSONL event to be `turn.completed` for
Codex journeys. Recorded completion is rechecked against the original stream,
without changing the evidence files. Empty, partial, failed, truncated and
quoted completion events remain inconclusive. Claude's separate result format
is unchanged. The event names are documented in the
[official non-interactive-mode guide](https://learn.chatgpt.com/docs/non-interactive-mode).

A harmless control survives. Bypassing the final-event requirement, trusting a
stale completion record, or accepting completion text inside another event each
fails the intended regression. The actual interrupted retry now reads as
`blocked_execution_record`; the genuinely finished model job retains completed
execution and its unsuccessful planner outcome. This gate verifies execution
custody, not whether the agent's substantive claims are true.

Full QA, exact clean-build browser acceptance, all twelve fresh outcomes and
final remote CI remain required before tagging v0.44.0.

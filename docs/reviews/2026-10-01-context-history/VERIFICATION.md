# Current-staff context history verification

October 1, 2026. Local verification on the resumed synthesis branch. This is
server-side preparation within M9b, not a release or a completed staff workflow.

The implementation landed on main at `a6f0376e6b9742038646ebfe90095b43f122e985`.
[Exact-commit application CI](https://github.com/nfredmond/openplan/actions/runs/36962820262)
passed on October 1, including shuffled tests and Python jobs. The separate
[full native isolation run](https://github.com/nfredmond/openplan/actions/runs/36962820261)
also passed on October 1. The UI agent subsequently
advanced main to `e15e2b93`; that commit has separate checks. No release tag changed.

## Behavior and defects found

The history reader reconstructs the original parent selection and context plan,
checks retained frames and their seal, authenticates selected attempts and
captures, and replays the complete dependent chain. Current staff permission is
checked before private reads and again before returning them. Reading cancelled
or departed-requester work does not fetch current credentials or authorize a call.

The prototype caught every `Error` from continuation processing and reported
invalid provider output. A test reproduced an internal `TypeError` being hidden.
Only `SynthesisContextOutputError` now becomes retained `invalid_output`; internal
faults propagate. Malformed JSON/schema, incomplete coverage and lost prior state
remain explicitly invalid provider output.

Three deterministic concurrent-read probes initially failed. A seal or unsealed
frame pair could commit between component reads, and a dispatch/output pair could
arrive between execution reads. The reader now observes the seal before immutable
dependencies, requests a retry for an inconsistent unsealed prefix, and rereads a
missing immutable dispatch after seeing its output. A genuinely absent dispatch
still rejects the output. These are separate reads, not a transactional snapshot.

Three additional tests reproduced rejection of valid 4,000-code-point reasons
containing supplementary Unicode characters. PostgreSQL's `length(text)` counts
characters, while the readers used a UTF-16 code-unit limit. Context cancellation,
context selection and the reused parent-selection reader now count code points,
retaining the original bytes and rejecting 4,001-character values. The focused
suite now passes 208 tests across five files. Native, full QA and shuffled checks
were repeated successfully for this correction.

## Checks and evidence limits

- Focused input/history/continuation/worker/selection tests passed: 208 tests.
  Mock transport tests assert consequential projections; they cannot prove
  PostgreSQL permissions or HTTP serialization.
- Native SQL history checks passed: seven tests covering the baseline, a harmless
  local-variable rename and five targeted permission/pagination/original-text faults. Current
  staff can inspect retained context after requester cancellation, demotion or
  workspace-membership removal. Viewer, outsider, wrong-campaign, anonymous and
  service-role direct history calls are denied. Each transaction rolls back. These fixtures do not
  exercise the complete TypeScript reader or browser.
- Authenticated HTTP tests passed for completed output after lost acknowledgement,
  cancellation and requester departure, and for uncertain dispatch without output.
  A separate current staff user can replay the final capture; revocation denies
  the next read. The first completed-output run failed because a new assertion
  referenced a nonexistent journal field. The corrected assertion compares the
  independently replayed original output; its rerun passed in 191 seconds. The
  final Unicode cancellation variant also passed, in 176 seconds, retaining all
  4,000 original supplementary characters through native storage and history.
- Full `qa:gate` passed: lint, configured dead-code analysis, 16,739 application
  tests across 1,375 passing files, 382 connector tests, zero reported dependency
  vulnerabilities and production build/typecheck. The application suite explicitly
  skips 1,173 tests across 71 files; the connector suite skips four tests. The
  full RLS gate was not enabled; native checks above ran separately on the isolated
  stack. The shuffled suite also passed all 16,739 tests with seed `661002`.
- Native status faults produced both expected assertion failures: reporting a
  completed chain as incomplete fails the output-recovery case; reporting an
  acknowledged dispatch as merely claimed fails the dispatch-loss case. The
  source was restored to its pre-fault SHA-256 before shuffled verification.
- No browser or live external model acceptance is claimed. The HTTP fixture uses
  the real local worker and database with a synthetic loopback model response.

## Mutation record

The [mutation results](mutation-results.json) retain every probe run, including
initial diagnostic outcomes. The local evidence directory is
`~/.local/state/openplan/approval-resume-2026-09-27/`. It contains baseline and
fault logs under `t3-context-history-*`; raw logs are not public product evidence.
Every mutation run restores original source bytes in `finally` and records hashes.

A harmless comment change passed. Targeted removals failed the named tests for
final permission recheck, predecessor blocking, manifest capture/result hashes,
selection page/request/anchor/cursor, selection hash/identity/range/sequence,
duplicate receipt identity/sequence, retained input byte count and binding,
predecessor identities, grant limits, original frame/reference integrity,
cancellation integrity and read-race handling.

The first selection-range mutation survived because the deliberately bad first
index also triggered the ordering check. Moving the bad index to the final entry
exposed the missing upper-bound check, and the rerun failed for that reason.
Removing the duplicate-attempt check or the local task-checksum check still
rejected the bad record through downstream identity/hash checks. These two
survivors establish overlapping protection, not independent sensitivity of each
local condition. They are retained in the evidence and are not counted as kills.

The dispatch-reread and typed JSON/schema mutations failed with the expected
runtime error at the intended test. The harness initially labelled those results
unconfirmed because it recognized assertion exceptions only. The saved failure
messages distinguish these semantic failures from runner/compile failures; do
not report the harness's raw total as a perfect mutation score.

The additional probes detect false preparation/completion states, conflated
claimed/awaiting/provider/invalid states, lost cancellation, altered output
whitespace, ignored storage failures, and changed header/reference identities.
Omitting the frame-byte or capture-hash projection causes the expected schema
failure for the missing field. Those runtime failures also fall outside the
harness's narrow assertion-only classifier. None of these checks measures
semantic interpretation, all possible transaction interleavings or provider use.

The three Unicode cases failed against the earlier code-unit limits. After the
correction, a harmless comment change passed all three cases; removing each
4,000-character bound caused the corresponding over-limit rejection assertion
to fail. [Unicode fault evidence](unicode-faults.json) retains those outcomes and
restored source hashes. [Native status fault evidence](native-status-faults.json)
records the separately executed HTTP failures.

## Outstanding boundaries

Local checks are recorded in [check receipts](local-checks.json). Exact-commit
GitHub CI and landing remain separate. The reader is not yet used by thematic proposal
processing or a staff interface. Proposal retention, explicit review import,
identified desktop/390px journeys, interpretation quality and the remaining full
v1 contract remain open.

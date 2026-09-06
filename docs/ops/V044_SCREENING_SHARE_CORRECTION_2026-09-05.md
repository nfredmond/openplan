# Screening-note percentage and interpretation correction

Acceptance is incomplete. The fresh twelve-job run on clean `2a547887` was
intentionally stopped after a confirmed false-output finding in job 05.

## Confirmed defect

Run `2026-09-05T23-27-25-327Z` reached four outcomes. Safety's completed result
is partly and remains unaccepted. During the following model journey, the note
displayed 0.3% within-zone travel and said traffic-count comparisons could
establish something. The adjacent panel displayed 29.7% and the opposite advice.

Independent local readback of both actual AequilibraE runs confirms the stored
`intrazonal_trip_share` is `0.2972`, unit `share`, with five zones. The worker
deliberately stores a fraction and leaves interpretation to the application.
The note treated that fraction as a percentage and defaulted missing stored
advice to affirmative. This is distinct from queued stale-state finding 044.

Model: `c56181a2-21ed-40ec-a5c6-79647258885e`. Runs:
`1bfd4b1f-11a7-489b-bb4a-b4a8ce3a0b8d` and
`c9f7743b-9dc3-4675-a2a0-37bc51c4557c`.

Only the owned test server and active journey process group were stopped. The
runner retained stdout and recorded job 05 as blocked_server with SIGTERM;
remaining jobs failed their server preflight. This was an intentional stop for
repair, not an unexplained outage. Both modeling workers were left running.
No original findings, artifacts or outcomes were rewritten.

## Correction and limits

The note now uses the same fraction-to-percentage conversion and existing
`bandIntrazonalShare` function as the zone-resolution panel. Optional stored
verdicts and text no longer override that shared interpretation. No threshold,
worker arithmetic, scientific outcome, frozen evidence, holdout or default
changed. The heuristic is not an acceptance rule or proof of model accuracy.

Nine new component tests cover the actual fraction contract, contradictory or
absent stored advice, the existing boundary, zero, one and unmeasured evidence.
Together with adjacent panel and help tests, 22 tests pass. A harmless comment
change survives. Removing the percentage conversion fails six cases; restoring
the optional stored verdict fails five; restoring stale text fails seven;
converting a null measurement to zero fails the unmeasured-evidence case.
All mutations are restored. These tests cannot prove producer arithmetic,
browser reachability, layout or scientific validity.

The first test draft incorrectly unpacked an array-valued parameter and failed
with an invalid mock payload. The fixture was corrected, not the application.
The first full QA invocation correctly refused the unbound substantive change;
the direction review must bind the correction before QA can continue.

Browser proof, full QA, exact-commit remote checks and a fresh complete outcome
gate remain required. Evidence and mutation logs are retained under
`~/.local/state/openplan/release-checks/v044-2026-09-05/`, prefix
`screening-share-`. The interrupted run's raw evidence remains under its original
first-week directory.

## Safety result retained

Safety's notes say the screening attachment is complete but a construction
case needs outside engineering, costs and program-specific evidence. That
partly result is not promoted to yes. Its suspected count discrepancy is not
confirmed: the full 1,408-row native CSV contains exactly 97 unclassified crashes.
Its PDF-delay finding includes a snapshot with the correct PDF link already
present. The final 11-page PDF was independently inspected and its 433,081 bytes
match private Storage and SHA-256
`b8c1bcf095e16e675db7a1088b5670a040e8a142a4cb03e6da18e7355133ed80`.
Report `4b475362-90de-4e2e-aed1-70c404c0bc82`, artifact
`12cd8f01-48fd-4efe-a619-a4af4729fe90`. This does not substitute for a completed
fresh outcome. Previously planned same-build Safety retry is superseded by the
confirmed model blocker and the next complete run.

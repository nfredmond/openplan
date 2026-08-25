# 2017 NHTS mandatory-tour successor result

**Decision: inconclusive. No default changed and no candidate was registered.**

The evaluator durably wrote the one-opening receipt at
`2026-08-25T03:01:43.868617Z`, then terminated before it committed an aggregate result. At resume,
the evaluator process and result were absent while the receipt remained. The frozen contract says
that any failure after the receipt consumes the opening. The 2017 source therefore cannot be read
again to recover acceptance metrics.

This is not a substantive rejection of the candidate. It is also not evidence of transfer. No
national gate, transfer-cell gate, rare-cell gate, or nine-division safety gate produced a durable
result, so registration is unauthorized.

## Interruption evidence

- Opening lock SHA-256: `5f84e07a57e73d24ee9f444cb06ce5a2c7a2b52e464bdbed2261fe3528daf24d`
- Opening receipt SHA-256: `598b3166ed04098ae15cef22f1d684e3fcf12b8ce08eb2cd468415d88eecd9d6`
- The receipt identifies the exact core and replicate archive hashes and says
  `failure_consumes_receipt: true`.
- The system journal recorded severe memory pressure and killed Chrome near the interruption. It
  did not identify the evaluator as the killed process, so the evaluator's direct termination
  cause is unknown.
- The evaluator loaded complete CSV members into in-memory row lists. That was a resilience defect
  in the sealed design. It cannot be repaired and rerun against this consumed source without
  invalidating the exercise.

The canonical aggregate record is
`data/modeling/mandatory-tour-frequency-2017-successor-result-2026-08-24.json`. It contains no
person, household, trip, or replicate-level data.

## Scope consequence

The existing ActivitySim behavior-source limitation remains. This exercise does not validate any
ActivitySim component or local corridor result, and it triggers neither a release nor a default
change. Another evidence exercise would require a genuinely untouched source and a new frozen,
streaming evaluator; the consumed 2017 opening is closed permanently.

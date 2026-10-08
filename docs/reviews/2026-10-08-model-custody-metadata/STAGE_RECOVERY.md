# Retained stage preparation

October 8, 2026. This continues roadmap M3/S1 after the assessment delivery
checkpoint. The V1 contract and scientific acceptance requirements remain intact.

## Remaining restart problem

`stage_artifacts` currently generates a new model-output UUID and performs
multiple artifact and KPI writes before assessment custody. Recovering one
assessment receipt does not make replaying that stage safe. Its original output
identity, source bytes and settings must remain available, and each earlier
write needs its own retained request and checked receipt.

## Preparation component

`model_stage_preparation.prepare` uses the existing private SQLite journal's
WAL/FULL connection and adds a separate `stage_preparations` table. The primary
key binds deployment, run and stage. Within one immediate transaction, first
preparation saves canonical source-file facts, input settings and a generated
output UUID. Repeated exact preparation returns the saved UUID. Changed inputs
are refused rather than assigned a new output identity. Returned values are
detached from the caller's objects. Invalid or corrupted UUIDs and malformed
source byte identities are refused.

The component accepts caller-supplied size/hash facts. It does not read or verify
files, establish current stage ownership, authorize replay, fence another worker
or acknowledge a database artifact. It is not yet called by the normal stage.
Stage replay must also account for cancellation, retained artifact/KPI writes,
assessment records, publication and terminal updates before it is enabled.

## Verification

Five tests pass. They cover exact repeat and changed settings, changed source
facts, distinct deployment scope, four independent Python processes using the
same journal, invalid inputs and a corrupted saved identity. The process test
proves matching results under concurrent launch; it does not observe a database
lock wait or simulate power loss. SQLite durability settings are reused from the
existing journal, not independently re-proved here.

Baseline, harmless and restored controls pass. Omitting input comparison,
generating another UUID on retry, omitting deployment scope, accepting a corrupt
saved UUID and accepting a boolean byte size each fail their targeted tests.
Private results are in
`model-command-client-20261008-proof/stage-preparation-controls.json`.

This work owns `work/model-stage-recovery-20261008`. PR #164's assessment checkout
remains unchanged while its full QA gate runs at `f5ebdf56`. The new preparation
component does not change scientific outputs or claim tiers.

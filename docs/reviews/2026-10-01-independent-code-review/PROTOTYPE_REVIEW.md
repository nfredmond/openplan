# Bounded review of unfinished synthesis context history

October 1, 2026. This is a source review of the preserved pause snapshot only. It does not review the active development files, establish acceptance or report acknowledged missing tests as new released defects.

## Exact boundary

Historical snapshot directory:

`/home/nathaniel/.local/state/openplan/approval-resume-2026-09-27/pause-2026-10-01-context-history/`

Historical manifest baseline: `891a0d89a848133d44b9e4f314a76a922cd71ace`. These four files were uncommitted and unpublished at the pause. I read the pause manifest and handoff as historical evidence, not instructions to resume implementation.

Before reading source, I hashed each historical file and its corresponding file in `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`. All four historical hashes match the manifest. All four active files differ. The active files were hashed only; this review makes no claims about their newer behavior. Exact comparisons are retained in `evidence/science-prototype-hashes.json`.

| Historical file, relative to snapshot | SHA-256 |
|---|---|
| `openplan/src/lib/engagement/synthesis-context-history-inputs.ts` | `7612da8dfde28ef7b40b5a5c532845e7e07213785eb5e62094662abc60607050` |
| `openplan/src/lib/engagement/synthesis-context-history-server.ts` | `74dba9fb8106a5c4f189581a9ea633fcf5f8c7d9170ec6b5dc63b73282d288d6` |
| `openplan/src/test/engagement-synthesis-context-history-inputs.test.ts` | `f3d52f59adc4494736af4ab409b9fc6ee4e926e1033ed45d332cae6aaf7a4e6b` |
| `openplan/src/test/fixtures/engagement/synthesis-context-history.ts` | `8a43c6680eec836bb3d630c038a3b73af9b3ddc4ba91252554612c12776d1044` |

## What the source establishes

The input reader authenticates the current reader through request, parent-history and source reads before reading retained storage with the service client. It reconstructs context and compares frame bytes, reference hashes, byte counts and chain state. It distinguishes not prepared, staging and sealed states. It repeats the request-access read before returning and checks immutable request/context identity. Cancellation is retained as custody, without becoming authority for dispatch.

The outer reader pages selected history at a fixed sequence, checks receipt identities and duplicate selections, loads retained attempts and authorization records, verifies dispatch and output hashes, and replays frames in order. It keeps claimed, awaiting-output, provider-incomplete, invalid-output and predecessor-blocked states distinct. The source contains no new provider call or selection write. These observations describe the code, not proof that its database permissions or complete replay work.

The input fixture mocks transport while invoking reconstruction code. Its first test asserts the exact frame, task, header and seal projections and filters, which avoids the missing-projection blind spot common to loose database mocks. Other cases cover immutable-byte changes, missing frames/tasks, failed reads and final access refusal. The fixture also expressly disclaims native permission coverage.

## What remains unestablished

No new demonstrated prototype defect follows from this bounded read. The handoff already identifies the broad catch around `processor.accept`, concurrent preparation reads, outer-reader tests, mutation controls, authenticated native context-history RPC support and browser integration as unfinished. I did not count those again as new findings.

I did not execute the reported 45 preliminary input tests, inspect new active changes, run outer-reader replay or mutate this prototype. I did not test database authorization, complete selections under pagination, revoked original requesters, concurrent staff selection changes, resource limits or UI recovery. A source-level final-access check is not proof of native RLS. Byte comparison is not evidence of practitioner usability. Completion must be established against the current development version after its owner finishes that work.

No source or test was copied into the review application's runtime. No command ran in the development checkout. This review changed only its owned report and evidence files.

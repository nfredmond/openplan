# Context continuation candidate

September 30, 2026. Locally verified implementation after main `6eb041f5`. This
increment adds a pure context plan and continuation processor. It does not add
native staging, authorization, provider calls, a durable worker or staff controls.

The separate recipe is `openplan.engagement.synthesis.context.v1`. Its canonical
SHA-256 is `1ef05631ff83fbf8a85e08110c800f820586580b91c76824728de944d0d88abc`.
Segment recipe v1 remains unchanged. The plan reconstructs the complete context
content from the saved source, selected original results and task plan, then
compares the request's parent, sequence, result/context/content hashes, target,
frame bound and source identity. It also checks campaign and workspace. Its
header binds the new actor, exact intent/context-request hashes, recipe, complete
content manifest, frame count and task byte limit.

Each successive task contains one complete content frame and the exact preceding
response text and result hash. The processor accounts for every frame part in
order. Returned notes have stable sequential identities, exact scalar-part quotes
and references to earlier notes. A subsequent response must retain the entire
previous notes and uncertainties arrays as unchanged prefixes. New qualifications
and contradictions append notes with links to earlier interpretations. They do
not erase an earlier position or uncertainty. Quotes may use the current or a
previous frame, but not a future or unknown part.

The complete encoded task includes its instructions, output schema, current
frame and previous output. Exceeding the requested task byte limit returns
`resource_limit` with the required size and retained predecessor. No frame,
previous response, note or uncertainty is clipped. A provider's transport
wrapper, tokenizer and input/output context fit remain separate checks for the
future adapter. Code-point text limits match the frozen JSON schema; original
unusual Unicode remains retained and may still be unusable for staff import.

Accepted results retain the exact output text, task hash, plan/header identity,
frame index and predecessor result hash. Replay reconstructs every task and
checks every result before preparing a successor. A partial or truncated output,
changed citation, changed prior state or inconsistent replay does not advance
the cursor. Completing the frames reports `machine_unreviewed`, not a reviewed
synthesis, meaningful interpretation or representative participation.

## Engineering verification

The related suites pass 43 tests across four files, including 18 continuation
cases. TypeScript and changed-file lint pass. Full QA and shuffled tests each
pass 16,444 tests, with 1,073 skipped. The production build passes and the
dependency audit reports zero vulnerabilities. Main `91eec38b` passes both
[CI](https://github.com/nfredmond/openplan/actions/runs/36789251288) and
[RLS isolation](https://github.com/nfredmond/openplan/actions/runs/36789251307).
[Recorded verification](context-continuation-proof.json) preserves source hashes,
initial survivors, corrected probes and final local evidence.

The initial harmless control passes. Of 38 targeted faults, 30 fail and eight
survive. Two survivors expose missing tests for mutation of returned nested
recipe data and retained-history copies. Those tests now catch both faults.
The other six survive because exact reconstructed replay rejects the same
corruption independently. Removing each check together with that backstop, then
running only its named corruption test, causes the intended failure. A separate
recipe formatting control passes; changing an instruction fails the frozen recipe
checksum. All original source bytes are restored.

These are pure protocol tests. They do not establish native result authenticity,
permission, provider billing, durable writes, machine usefulness or staff
acceptance. The caller must anchor replayed results to retained original provider
responses. A self-hashed result object is not proof that a provider produced it.

## Next implementation

Add native context plan/staging and explicit resource authorization tied to this
header and recipe. Keep the old segment executor refusal. The worker must rebuild
the context from native selected originals, verify requested hashes, and bind each
dispatch to the exact current task and predecessor selection. Preserve the
original provider response before interpreting it, including rejected or
incomplete output. New attempts after an unknown dispatch require explicit staff
choice. Recovered output delivery must not issue another provider call.

The cumulative state can reach a configured ceiling. This leaves the retained
request incomplete and explains the required size; it does not establish a
capacity claim for arbitrarily large context. Full resumable contextual execution,
complete thematic proposals, exact membership and explicit staff import into a
new review revision remain required. Preserve approvals on their original
revision and the complete M9b and V1 scope.

## Native storage investigation

Migrations 34 and 35 already retain generic immutable plan, task, seal,
authorization, attempt, dispatch, output and selection rows. Their command
contracts, rather than the table shapes, enforce the segment recipe. Reuse may
avoid a parallel ledger, but requires context-specific scope, plan, claim and
dispatch commands. Keep the existing segment scope refusal in place.

The current output-retention command stores exact opaque UTF-8 capture bytes,
requires its worker/attempt and authorized dispatch, and compares exact retries.
It deliberately avoids PostgreSQL JSON conversion. Its byte custody can serve
context output if the context reader independently verifies the correct binding
and original provider receipt. The old execution-status command calls the
segment authority check and therefore cannot monitor context execution.

Native staging still needs a verified complete frame prefix and seal, including
cumulative frame bytes and a deterministic chain. A context dispatch adds the
actual continuation-task hash and an anchored predecessor output to the static
frame identity. Later selection changes must not silently replace that
predecessor or invalidate the retained original. These are implementation
requirements, not implemented database behavior.

The subsequent [native staging candidate](CONTEXT_STAGING.md) implements retained
frame preparation. Authorization and context dispatch remain open. The storage
investigation above records the requirements before that implementation.

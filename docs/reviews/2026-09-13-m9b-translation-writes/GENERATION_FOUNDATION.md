# Captured translation attempts and credentials

Continuation after `5995b05f` in the owned translation checkout. This is unfinished M9b implementation, not a translation release. The existing translation helper now explicitly disables SDK retries. The new credential and generation adapter await the durable queue/worker integration described below. Existing synchronous producers otherwise remain active.

## Implemented

`integrations/translation-credentials.ts` uses the existing integration-key encryption to seal one workspace/request/credential identity, selected key source, native Anthropic model and versioned recipe. Changing those identities, the outer recipe/hash or ciphertext is refused. Decryption never consults an ambient or replacement key. These encrypted records are private service data, not public receipts. An operator encryption secret is required even when the selected provider key comes from the environment.

`prepareWorkspaceTranslationCredential` in the existing workspace-key module performs a scoped provider read with the full identity/ciphertext projection. It only selects the environment after a successful empty read. Read errors, malformed/duplicate/wrong-scope rows, failed decryption and empty keys refuse preparation instead of changing the payer. Request identity/model scalars are captured before the asynchronous read. The existing general integration context's fallback behavior is unchanged for other callers.

`engagement/translation-generation.ts` captures a canonical packet containing workspace, campaign, durable field identity, exact source words and target language. Its binding also names request, attempt, reservation, credential/configuration, packet hash and lease deadline. It decrypts only the captured credential and consumes the callable once, including failures, expiry, cancellation and concurrent invocation. SDK retries are disabled. Completion after the lease deadline is refused even before the timeout callback runs.

A returned result retains raw output, hashes, configured and reported models, provider response identity, finish reason and token counts. Missing/invalid counts remain unknown. Incomplete, empty, overlong, NUL-containing or malformed-Unicode output is retained as incomplete evidence, never publishable wording. Valid output preserves whitespace and counts the 8000-character limit in Unicode code points. Input is bounded at 32000 UTF-8 bytes without truncation and uses the existing machine-language refusal registry. No language policy changed. SDK/provider exceptions have a consumed, uncertain outcome; a worker must retain that status/reservation rather than attempt another call.

## Verification and errors

The two new suites use the real AI and Anthropic SDKs with every fetch intercepted in-process, and a mocked database credential query whose table, projection and both scope predicates are asserted. The final focused run passed six suites and 101 tests, including existing translation and integration tests. TypeScript and changed-file ESLint both exited zero.

The mutation runner completed 50 expected outcomes against 68 tests: baseline plus five harmless survivors and 44 targeted failures. It catches SDK retries in both the new adapter and existing helper, repeated invocation, expired/late completion, changed source/output, inappropriate completeness, character units, unknown-count coercion, wrong hashes, ambient credentials, caller mutations, packet/identity mismatches, replaced credential envelopes, incomplete query projection, read errors, duplicate/wrong-scope rows, decryption fallback and late capture of caller identity. The case named `plaintext-storage` is an explicit exact no-op control, not a plaintext-storage defect or kill; its retained name is awkward but its survivor is intentional. See `translation-generation-controls.json` and `generation-foundation-evidence.json`.

Two preparation errors are retained. The first file-writing script used unavailable `python`; rerunning it with `python3` wrote the files. The first SDK test incorrectly expected a result when Anthropic's required usage fields were null. The real SDK refused that malformed response before the adapter could retain a completion. The corrected suite preserves that as an uncertain consumed-dispatch case and separately checks invalid numeric counts become unknown. Initial logs are retained, not presented as passes.

These checks cannot establish database authorization, actual dispatch reservations, key-revocation behavior, leases across workers, process restart recovery, live provider usefulness, HTTP/UI reachability or retained publication. No database schema/grants changed, no browser acceptance is claimed for this increment, and no model request reached a provider. Structural completion does not prove faithful translation.

## Next implementation join

Continue with additive engagement generation request/field/attempt records and the existing connector lock/private-journal worker pattern. A packet's `fieldId` must identify an immutable durable field record containing the exact staff source address/version or public contribution snapshot. The adapter does not authorize that mapping. Bind actor/campaign/workspace, all source snapshots, target language, selected credential and explicit generation request before queueing. Exact retries return the original request; changed payloads under the same id refuse.

Claim under source/authority checks and separate staff/public dispatch allowances. Reserve before invoking, distinguish prepared/reserved/actually dispatched/uncertain outcomes, and do not count missing credentials as an actual model call. Recheck the selected credential configuration at claim; replacing/removing a key or changing provider configuration must prevent subsequent dispatch under a stale saved snapshot. Decide and test that invalidation in the database/worker join, not by silently refreshing the saved envelope. Worker cancellation/access-loss monitoring and an expired attempt must never create a replacement billable attempt automatically.

Persist the running journal before calling this adapter; persist returned per-field output/receipt before delivery. A recovered running journal reports an uncertain interruption without generation. A recovered completion redelivers the same words and receipt without generation. Validate exact database acknowledgements before retiring private journal data. Retain incomplete/unknown states honestly, including an SDK refusal before receipt metadata is available.

Then implement `publish_generated` through the existing transactional translation command, using the retained result and exact current source/translation versions. Convert staff suggestions/machine publication and the public comment translator/cache. Preserve the public cache RPC's atomic language merge and source/publication recheck; legacy cache provenance stays unknown and must not trigger automatic paid regeneration. Keep the command's ordinary authenticated execution revoked until every producer has a supported path. Complete machine acceptance and the remaining desktop/390px recovery journeys, then full feature QA/shuffle, isolated RLS/worker/upgrade/restore checks and final main CI before release. Manual local authoring remains available without provider credentials.

## Main publication follow-up

The separate v0.58.1 header patch was already published. Its publication-note main commit `ef16f166447ab477ea36588a5c01620f61560b19` now has successful CI and every job, including full QA and shuffled tests, plus successful live RLS:

- https://github.com/nfredmond/openplan/actions/runs/34779793816
- https://github.com/nfredmond/openplan/actions/runs/34779793752

The larger translation checkout has not been merged into main or released. The original checkout and demo remain untouched. Continue the complete V1 goal, without a PR or human-review release gate, using local/free operation and preserving the pending reminder constraint.

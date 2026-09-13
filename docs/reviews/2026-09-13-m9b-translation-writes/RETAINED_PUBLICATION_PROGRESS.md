# Retained translation publication checkpoint, September 13, 2026

This continues pushed catalog checkpoint 5c4c7f4b in the owned translation
worktree. Migration 16 implements publish_generated in the existing exact-source
write command. Execution stays revoked until the API, editor, pending recovery
and history readers are joined. The user workflow remains unreleased.

## Implemented

A publication entry supplies only its original address/source/saved baseline and
an immutable generation reference: request, field, attempt and delivery digest.
The private helper checks retained scope, exact original address/baseline,
digest, completed job/output/accepted state, words hash and configured model.
It reads words/model from retained records. There is no new provider call, key
lookup or model selection. Publication uses the current staff member's authority;
loss of the generating actor's membership does not erase completed output.

The saved row stays machine-authored and records the publishing actor. The
immutable write receipt includes the exact requested generation reference and
returns the original generation actor and output hash. History links that write
receipt. An exact retry returns its original result even after source changes.
A different request cannot rebase old output onto a newer saved version.

A distinct generation publication receives a history revision even when words,
model and publishing actor are unchanged. The ordinary history trigger skips
content-identical updates, so the command explicitly records this decision if
that trigger did not advance the revision. Existing save/accept/withdraw behavior
is otherwise preserved; the old manual command probe runs against the replacement.
Required change reasons now use the existing JavaScript-compatible whitespace
set; Unicode-only whitespace can no longer satisfy the SQL reason guard.

translation-publication.ts supplies a client-safe intent and receipt contract.
Its receipt reader checks batch and row identity, publishing and generation
actors, exact viewed words/model, output/delivery identity, original observed
source and saved baseline, terminal status and the new revision. The generation
reads must come from the existing server's verified reader. This is acknowledgement
verification, not an alternate authority for SQL writes.

## Proof target and limitations

The SQL probe targets database openplan_translation_command_proof_20260913 in
supabase_db_openplan-restore-target-2731143. It applies migrations 14 and 16 inside
BEGIN/ROLLBACK. The first publication uses an actual previously retained completed
output with opaque provider metadata, including unsupported Unicode escapes.
The result is passed through the native generation decoder and new publication
receipt checker. It compares exact words, digest, actor identities and history.
The selected key and generating actor's membership are removed only inside the
transaction; another current owner publishes. All removals roll back.

Crafted private-row clones independently test contradictory scope, states,
hashes and models, missing output, and identical-word publication history. They
are explicitly projection/guard fixtures, not newly executed model jobs. A batch
with one valid and one invalid entry must leave no receipt, translation or history
from either entry. A confirmed retry must preserve its original output after
source changes. Anonymous, viewer, outsider and removed-member commands are
refused. The helper's execute privilege is checked separately from private-table
permissions. Its invoker table denial alone does not establish an absent grant.

The old proof database already grants the old command to authenticated fixtures.
The first probe incorrectly assumed it was revoked there and stopped before
changes. The runner now records and compares the actual original function/ACL.
It verifies migration 16 revokes execution before granting it transactionally
for the probe. The app database's command remains revoked, and the new helper is
absent there. Final rollback verifies the old function/ACL, absent new functions
and absence of the synthetic publisher and write receipt.

The first reference-shape mutation survived because overlapping required-key
validation still refused malformed input. The control now removes the whole
reference-validation block and separately tests extra fields/digest shape.
Removing the helper REVOKE also survived through existing permissions/private
table denial. An explicit unwanted execute grant is the targeted failure, and
the test checks the actual privilege separately from calling the helper.

The first receipt test launch repeated the repository-root mistake: npm --prefix
selected the executable but left Vitest in the wrong cwd. It ran no tests. All
recorded package runs and mutation subprocesses use the actual openplan cwd.
The first native source-mismatch fixture shared a nested source object between
the retained read and requested intent, so editing one changed both. It now clones
the observed address; their source versions can actually disagree.

No browser publication, application migration activation, new worker/model run,
concurrent publication transaction or whole-product release gate is claimed.
Neither engineering evidence nor machine attribution declares professional
translation quality or agency approval. No paid resources were used.

## Continue integration

The old translationWriteIntentSchema, write result reader, pending-translation.ts
and history receipt validation still accept only save/accept/withdraw. Integrate
the new publication contract without silently weakening their recovery checks.
The commands route also needs executable refusal for unregistered agent writes
and the browser-origin boundary used by generation before activating publication.

Connect CampaignTranslationsPanel to the durable queue/catalog and saved output,
replace the legacy staff machine producers, and preserve exact pending identity,
viewed output and old baselines through retries/storage loss. Avoid an import
cycle when extending history schemas: translation-publication.ts currently uses
retainedTranslationSchema from translation-history.ts. Shared reference schemas
should move to an independent file if both history and publication need them.

Migration 16 deliberately leaves the authenticated command grant revoked. Only
activate after the producer/recovery join is exercised. Use the identified local
build for desktop/390px navigation, keyboard, console and interruption evidence.
Run full QA, shuffle, isolated RLS, workers, upgrade/restore and final-commit CI
before the next direct main release. No PRs or human-review gate. Keep the full
V1 contract, free/local operation, original checkout, demo and pending reminder
constraint intact.

## Final verification

Eight focused suites passed 291 tests. TypeScript and focused ESLint passed. The
SQL controls completed 31 cases: two baseline/harmless survivors and 29 targeted
failures, all expected. Native receipt controls completed 38 cases: two survivors
and 36 targeted failures, all expected. The final migration, SQL probe, native
source and test hashes match their control reports after restoration.

retained-publication-restored.json records the final SQL/native receipt run and
rollback containment. The legacy manual command probe also passed against
migration 16; its old blanket unsupported-generation expectation is adapted to
require refusal of publication without a retained reference. Its other checks
are unchanged, and the historical probe file was preserved.

The proof database's original old-command authenticated grant and function were
restored. The application database remains through migration 12: authenticated
command execution is false and the new publication helper is absent. No new
functions or fixtures from the publication probe survive in the proof database.

Private evidence remains under
/home/nathaniel/.local/state/openplan/response-write-probe-20260913:
- retained-publication-controls-native-final.log
- publication-receipt-controls.log
- retained-publication-combined-final.log
- retained-publication-types-final.log
- retained-publication-lint-final.log
- retained-publication-native-latest.log

The control JSON files name their timestamped detailed logs. Test/probe commands
are terminal. No app, worker, demo or unrelated process was stopped or restarted.
This checkpoint changes neither main nor the v0.58.1 release claim.

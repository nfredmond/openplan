# Latest retained-output checkpoint

Read [GENERATION_OUTPUT_PROGRESS.md](GENERATION_OUTPUT_PROGRESS.md) first. The codec and SQL retention now have exact-byte and concurrent-delivery evidence against the actual migration. Worker and public workflow integration remain unfinished. This is the weekly usage reset checkpoint.

# Latest queue checkpoint

Read [GENERATION_QUEUE_PROGRESS.md](GENERATION_QUEUE_PROGRESS.md) first. The staff queue candidate has serial and held-transaction PostgreSQL evidence; it is installed only in a separate proof database. Completion delivery, worker and public producer integration remain unfinished.

# Latest generation checkpoint

Read [GENERATION_FOUNDATION.md](GENERATION_FOUNDATION.md) first. The generation adapter and strict credential preparation are implemented and tested; durable queue/worker integration and producer conversion remain unfinished. Main publication-note CI is now fully green.

# Latest recovery checkpoint

Read [PENDING_STORAGE_DELETION.md](PENDING_STORAGE_DELETION.md) first. The separate header patch v0.58.1 is published. Continue the unfinished translation workflow from the recovery and generation boundaries recorded there.

# Current access checkpoint and patch release

Read [ACCESS_PROGRESS.md](ACCESS_PROGRESS.md) first. Header-only commit 05aa194b is ready for independent main-build verification and a v0.58.1 patch; the larger translation work remains unfinished.

# Current request recovery checkpoint

Read [WRITE_STORAGE_PROGRESS.md](WRITE_STORAGE_PROGRESS.md) first for the latest implementation, browser evidence and remaining work.

# Current usage reset checkpoint

Read [STORAGE_RECOVERY_PROGRESS.md](STORAGE_RECOVERY_PROGRESS.md) first. It records the latest saved implementation, terminal browser checks and remaining work.

# Current history continuation

Read [HISTORY_RECEIPT_PROGRESS.md](HISTORY_RECEIPT_PROGRESS.md) first for the latest
implementation, installed migration, browser evidence and remaining work.

# Current continuation

Read [EDITOR_RECOVERY_PROGRESS.md](EDITOR_RECOVERY_PROGRESS.md) first for the latest
implementation, browser evidence, repaired defects and remaining work.

# Latest checkpoint

[Usage reset handoff](USAGE_RESET_HANDOFF.md) supersedes the editor integration
status below. The complete remaining workflow below still applies.

# Translation writes after the history release

[Current inventory implementation and lock findings](READ_PROGRESS.md) continue
this complete workflow in a separate checkout. They are not a release or an
exact-version write guarantee.

[Transaction and concurrency progress](COMMAND_PROGRESS.md) records the staged
command, repaired probes, real competing sessions and remaining application join.
[Exact snapshot progress](SNAPSHOT_PROGRESS.md) records tested development
migrations, complete HTTP reads and the application source/version contract;
editor and generation integration remain.

[Write boundary progress](WRITE_BOUNDARY_PROGRESS.md) is the newest continuation:
manual routes and local request recovery now have boundary tests and mutation
evidence. The editor still needs to use them; generation remains unfinished.

Continue the existing M9b editor and translation services. The complete V1
contract and roadmap remain binding. No PRs or human-review release gate; local
and free operation, native scope constraints and private retained originals stay
intact. This is the next unreleased work, separate from v0.58.0 publication.

## Observed boundary on installed schema 328

stale-save-probe.sql uses an actual authenticated role on the explicitly named
disposable restored database supabase_db_openplan-restore-target-2731143. It
creates synthetic rows inside one transaction and rolls them back. A legitimate
correction passes its control. The current route-shaped upsert then replaces it
without an expected version. Changing the source title does not stop a later
write from naming the old source hash. The original and newer correction remain
in immutable translation history. This is silent replacement, not loss of the
retained copies. It is a serialized SQL reproduction, not simultaneous clients or
HTTP/browser evidence. Final inspection found zero probe users or workspaces.

The baseline and harmless comment reproduce both behaviors. Adding an expected
history-version condition to the probe stops the stale replacement and causes
its old-behavior assertion to fail. Adding a source condition stops the old-source
write and changes that assertion. See stale-save-controls.json. These are
controls on the diagnostic, not an implemented application fix or new migration.

## Existing pieces and implementation seam

The current translations route resolves campaign-owned fields, but manual save
and machine publication use direct upsert, acceptance loops over direct updates,
and withdrawal uses direct delete. The existing CAMPAIGN_TRANSLATION_COLUMNS
projection omits row id, updated_at and retained revision, so the editor cannot
currently send an expected current identity/version. The source inventory's text
helper trims strings. hashTranslationSource trims too. A source hash cannot
reconstruct the original source words, and SQL btrim is not interchangeable with
JavaScript trim for every Unicode whitespace character.

Extend this same projection/editor. Retain raw source wording separately from
trimmed display text and the existing compatibility hash. Send an exact source
snapshot and expected translation identity/revision with each proposed write;
use an explicit absent state for creation. Old observed history remains unchanged
and unknown source words are not backfilled from guesses.

Reuse the response-write receipt, recovery UI and verified history patterns.
Read the final installed definitions, including migrations 20261014000006 and
20261014000007, not just the historical 000003 function: conflicts use PT409 and
unknown receipt outcomes use PT503, not manually raised 40001. Campaign/workspace
and target relationships remain enforced by migration 000008.

Implement one transactional translation command contract for save, accept,
withdraw and publication of an exact retained generated result. Bind request id,
authenticated actor, campaign, operation, reason, expected source/translation
versions and exact content. Recheck authority before receipt access; an identical
confirmed retry returns its original result before revalidating the now-changed
current row. A reused id with different content is refused. Whole batches either
commit together or report a conflict without partial changes.

Derive and test a consistent source/translation lock order against the existing
configuration-capture and source-deletion triggers. The diagnostic above does not
prove that order. Include simultaneous corrections, creation of the same absent
address, source changes/deletion, acceptance versus correction and request replay.
Retained request/history evidence must record actual reasons, checked source text
and machine origin without treating acceptance as proof that a human wrote the
machine's words. Use the existing trusted unfinished-receipt lookup pattern when
linking history; a caller-controlled session setting alone is not authority.

Retire direct authenticated writes only when every producer has a supported
transactional path. Leaving the old model-publish/upsert path active would leave a
bypass around the new conflict guard. Test direct PostgREST refusals as well as
route behavior, with harmless controls and targeted failures.

## Generation and saved-work recovery

Keep generation and publication separate. The existing route generates up to 25
strings sequentially in a request, which can exceed 60 seconds; use the existing
resumable worker/lease conventions for durable generation. Persist the exact
source and requested generation before work begins, retain completed wording and
its model/completion provenance, and publish that retained result without another
model call. An interrupted acknowledgement or uncertain worker outcome must not
silently repeat a billable generation. Manual authoring stays available locally
without an API key. Do not invent a successful model result when none exists.

The public comment cache currently accepts text/sourceHash without completion
provenance, bypassing the new helper on cache hits. The producer RPC is
engagement_cache_reviewed_translation in 20260908000003. Preserve its atomic
per-language merge and source/publication recheck while introducing verified new
cache provenance; existing cached words must not be retroactively declared
complete. Avoid automatic paid regeneration merely because an old cache lacks
proof. Decide the visible recovery behavior together with durable attempts.

Public usage is currently recorded only after a successful model result and is
fire-and-forget. Staff generation records successful batches. Reserve/count
actual attempts durably before spend and preserve separate public and staff
allowances. A missing key is not a billable attempt. Concurrent requests, failed
outputs, cache-write failure and lost acknowledgements need separate evidence.

## Completion evidence

Require route and actual installed PostgREST checks, caller/actor scope,
whole-batch atomicity, source and translation conflicts, original/corrected/
accepted/withdrawn/recreated custody, complete reads beyond 1000 entries and
interrupted save/generation/publication recovery. Every changed guard gets a
harmless survivor and targeted failure. Then identified desktop and 390px
keyboard journeys from real navigation, console inspection and retained artifacts,
full QA/shuffle, applicable isolated database/worker/upgrade checks and exact main
CI before tagging. Do not call the full translation workflow or M9b complete
based on the history journal alone. Broader source-to-decision work and the
roadmap's other early planning obligations remain open.

# Continue here: v0.56.0 candidate, full QA replay running

v0.55.2 is published at 3455207b5723c6394ff95b9fbbd274c79e7d3c36. Its final
CI/RLS/upgrade and release receipts are in this directory. Do not tag it again.
The full v1 goal remains active. No PR or human review gate is authorized/needed.

Use worktree /home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10,
package openplan/, branch work/engagement-response-snapshots. The root checkout
and demo remain untouched. This thread owns the worktree; no subagents or other
active coding session were observed. Recheck actual ownership before editing.

The v0.56.0 response-history candidate is implemented and browser-tested. Read
../2026-09-12-m9b-response-history/VERIFICATION.md, IMPLEMENTATION.md, NEXT.md and
full-checks.json. Package/contract/roadmap/matrix/registry current-release metadata
all name 0.56.0; review dates and scientific claims are unchanged. Unreleased
names both migrations until tagging. Runtime source is 03c1fe38f9674b19f7cce35d23bd7751627954ea;
subsequent checkpoint commits only retain evidence and these restart instructions.

## Pending and completed checks

Full corrected QA is LIVE: tool session 79549, wrapper
/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/m9b-history-corrected-check.cjs qa.
It captures source 03c1fe38, writes m9b-history-reader-corrected-qa.log and a terminal
.result.json. Poll this same session and inspect the receipt/process; do not
restart solely because observation times out. Avoid runtime/schema changes until
it finishes. If it fails, inspect the actual diagnostic before choosing a fix.

Completed corrected seed-913562 shuffle: 14,133 tests passed, 450 skipped;
1,261 files passed, 43 skipped. Full RLS: 479 tests/50 files passed against only
openplan-restore-target-2026091050, and worker checks: all 52 suites passed. The
RLS/worker source was a038ba70; their source/schema did not change in the later
metadata, interface wording or offline-test corrections. Types and changed-file
lint were green earlier; full QA's build remains the final type/build check.
Focused corrected checks passed 43 tests across six files. Mutation receipts
record harmless survivors and targeted failures, including two stronger identity
and retained-campaign tests added after noticing overlap in the earlier cases.

Initial full QA and shuffle failed eight tests from stale release metadata,
premature migration-name removal from Unreleased, and new plain-language terms.
These failures are retained in full-checks.json. Do not mistake them for test-order
dependence or the earlier missing history reader. The old missing reader is fixed.

Upgrade Path 34737449570 remains queued on older source 5d8268a1. It is NOT final
reader evidence. Inspect its actual status before taking action; do not duplicate
that same dispatch. Main push of the final candidate should trigger its own exact
CI/RLS/upgrade jobs. Inspect those separately before tagging v0.56.0.

## Browser and database custody

No owned browser/app/proxy remains. Final owned dev/proxy session 39521 ended with
status 0 after SIGTERM to the process started by this thread. Browser-final/ in the
history review records fresh 1440px and 390px real navigation, UI creation,
correction/removal, private history, checksum preservation, two failed reads and
keyboard recovery on 03c1fe38. Screenshots were opened and inspected. Earlier
browser/ captures additionally show all 1,005 history options and keyboard selection
of the last, plus original and legacy-baseline copies. Final desktop console has
preload warnings and injected 503s; final mobile has only injected 503s. No page
exceptions or horizontal overflow were observed. Earlier network warnings and
runner failures remain documented; do not claim a universally clean console.

Named disposable stack openplan-restore-target-2026091050 has 321 migrations through
20261014000002, API 29821 / DB 29822. Both new migrations are applied. Do not reset,
reapply, or run pre-apply SQL mutation scripts unchanged against this stack. The
original 1,005-response fixture a3c41566-bfd4-40f2-b467-96ee79054ec6 is preserved.
Synthetic original/correction/removal cases and hashes are in the browser receipts.
Never bypass immutable-history guards to remove fixtures. Private account/config
files under the private directory above must not be printed or committed.

## Next landing and implementation

After full QA succeeds, checkpoint terminal results, verify remote main has not
moved unexpectedly, and fast-forward the verified work directly to main. No PR.
Inspect exact final CI, RLS and populated-upgrade runs; tag and publish v0.56.0 only
when green. v0.56.0 is a retained-history increment, not completed M9b or v1.

Continue immediately into reasoned, conflict-safe response writes and durable
identical-request retries, preserving automatic source withdrawals and private
translation history. NEXT.md maps current producers and proposed transaction seam;
its initial v0.55.2 release-status text is explicitly historical. Cross-module RTP
and land-use capped readers are source findings, not live reproductions yet.
Preserve the pending reminder constraint, free/local operation, all-state/DC and
territory/tribal/overlapping scope, and separate AequilibraE/ActivitySim validation.

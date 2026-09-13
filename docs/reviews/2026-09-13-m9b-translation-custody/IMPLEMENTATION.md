# Translation custody implementation checkpoint

This is unreleased work after published v0.57.1. The complete next increment still
includes exact-version atomic writes, durable retry receipts, retained source
text and durable generation. Do not describe the current implementation as that
complete workflow.

The translation helper sends supported text intact, refuses input above its
32,000 UTF-8 byte bound before calling a model and refuses any non-stop completion.
Its existing 1500 output-token ceiling remains. This avoids presenting a prefix
or incomplete answer as a complete translation; it does not guarantee machine
translation availability or quality for every supported source.

Migration 20261014000009 retains full private translation rows before correction,
acceptance and withdrawal, including recorded model and original author metadata.
Observed legacy baselines have no invented actor. Identity/address changes and
reuse after removal are refused. The private reader verifies exact retained JSON
text checksums, complete counts and per-identity sequence, campaign/workspace scope,
immutable addresses and unknown legacy actors before returning any rows. The
translation panel opens history independently of current fields and refreshes it
following confirmed saves. Earlier source words and reasons remain unrecorded;
hashes cannot reconstruct them.

Installed only on named disposable app stack
supabase_db_openplan-restore-target-2026091050: 328 migrations through 09. All 277
existing public/auth/storage tables retained their row hashes; one existing
translation became an exact observed baseline. Full backup is private and has not
itself been independently restored. The retained restored stack remains at 327.
See installed-328.json. Do not rerun the pre-install mutation runner against 328.

Focused application tests, type checking and focused lint pass. Application
mutation controls include a surviving harmless comment and targeted prefix,
completion, input-size, checksum, count, scope, sequence, identity, baseline actor,
address, viewer-access, failed-read, foreign-UI and stale-refresh failures. The
migration's baseline/harmless controls and five targeted failures also pass. An
actual authenticated SQL fixture exercised create/accept/correct/remove/recreate
and >1000 complete private revisions inside a rollback transaction before install.
Full installed RLS subsequently passed; browser acceptance remains incomplete.
See RESUME.md for the later evidence and exact stopping point.

Initial diagnostics are retained privately: npm exec with --prefix ran from the
repository root and found no configured imports; a UI assertion matched both an
option and its displayed copy; the mutation reporter expected the wrong foreign-UI
test label; type checking caught a missing workspace argument in one test. These
were corrected without changing the intended failure behavior.

Owned checkout: /home/nathaniel/.local/state/openplan/engagement-response-writes-2026-09-12,
package openplan/, branch work/engagement-response-writes. Original checkout and demo
remain unchanged. Private logs/scripts are in
/home/nathaniel/.local/state/openplan/response-write-probe-20260913.
Full RLS uses history-full-rls-328.log (tool session 14310). Recheck its actual
process/terminal outcome; a quiet log is not a failed process.

Next: finish the installed live controls (including source-removal retention and
empty-fixture/census mutations), identified desktop/390px keyboard/error/retry
history journeys, full QA and shuffled checks, and retained-stack upgrade checks.
Continue atomic reasoned writes and durable generation as specified in NEXT.md.
No PR or human-review gate. Keep the full v1 contract active.

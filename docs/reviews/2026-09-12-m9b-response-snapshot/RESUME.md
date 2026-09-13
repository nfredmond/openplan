# Continue here: response history after published v0.55.2

v0.55.2 is published at 3455207b5723c6394ff95b9fbbd274c79e7d3c36. Its final CI
34735821419, RLS 34735821475 and Upgrade Path 34735821483 all succeeded. Remote
annotated-tag target and published release were read back. Do not tag it again.
See v0552-final-*.json, v0552-publication.json and VERIFICATION.md.

Worktree /home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10,
package openplan/, branch work/engagement-response-snapshots. The root checkout
and demo are untouched. No other agent was observed; no subagents were spawned.
The later source history work is unreleased and not part of the v0.55.2 tag.

Read ../2026-09-12-m9b-response-history/IMPLEMENTATION.md and NEXT.md for the
implemented foundation, retained failures, exact tests and next work. The new
migration retains immutable source history and is integrated with the live RLS
inventory. Offline 40 tests/20 skipped and live 37 tests passed, with SQL and live
inventory mutations. Types and changed-file lint passed. The next steps are
staff history access and conflict/retry-safe, reasoned writes, preserving source
withdrawals, translations and frozen reports. Full QA/shuffle/RLS/upgrade and
browser acceptance remain before calling this new increment complete or released.

The named disposable stack openplan-restore-target-2026091050 now has 320
migrations through 20261014000001, API 29821 / DB 29822. Do not reset or reapply
that migration. The pre-apply history-mutations.py intentionally expects the
history table absent and must not be rerun unchanged against this stack.
All owned browser/proxy/app and test processes finished; recheck live ownership.

Private directory /home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12
contains full logs and account/config files. Never print api-settings.env or
api-settings-account.json. The 1005-response original browser fixture is
 a3c41566-bfd4-40f2-b467-96ee79054ec6; preserve it and the older accepted originals.
Do not bypass history guards to delete fixtures. Retained checks and failure
boundaries are separate from actual agency usefulness or complete v1 capability.

Continue directly to main after verification; no PR or human-review gate. Preserve
the pending reminder constraint, local/free operation, the full all-state planning
contract, and separate AequilibraE/ActivitySim validation. The v1 goal remains active.

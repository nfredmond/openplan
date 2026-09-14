# Exact saved review approval protocol, development checkpoint

September 14, 2026. This is internal protocol code for the next M9b increment. It is not a released or browser-accessible approval workflow. v0.62.0 remains the current release. The complete V1 contract is unchanged.

## Implemented rules

`openplan/src/lib/engagement/synthesis-approval.ts` defines strict approval and withdrawal commands tied to the consultation/workspace, review, retained source/preparation hashes, exact revision ID/hash/number, actor, request, reason and previous approval event ID/hash. Existing immutable `staff_draft` content is untouched.

Retained event packets have an exact-byte SHA-256 and a fixed internal-staff-synthesis purpose. Complete chronological history must reconcile count, sequence, head, nonforking predecessor hashes and immutable revision identities. A correction remains unapproved. Earlier approvals remain attached to their exact earlier versions. Withdrawal names the current approval-history head and its exact approved revision; it remains possible after a later correction. Another explicit approval can follow withdrawal. Staff identity remains visible in the event, including self-approval; this protocol does not establish an independently assigned reviewer.

Receipt validation compares the complete command, including actor and reason, before accepting either a fresh result or an old acknowledgement. This is only a receipt check. Durable retry behavior still requires the native writer and access checks.

## Evidence and limits

The focused run covers 46 tests across the new approval protocol and unchanged review-content/server suites. The new protocol contributes 29 tests. The executable proof `prove-approval-domain.py` ran 43 cases: baseline, a harmless comment change and 41 targeted faults, all with the expected outcome. `approval-domain-mutations.json` retains each result, assertion names and the exact restored production-source hash. The runner requires a parsed Vitest report and a named assertion failure, not merely a nonzero process exit. Source bytes are restored even if a case fails.

Focused ESLint and the configured dead-code check passed; the existing unused-export/type warning inventory remains. The first standalone TypeScript run failed at Node's default approximately 4 GB heap limit, without completing the check. The same `tsc --noEmit` check then completed successfully with `NODE_OPTIONS=--max-old-space-size=8192`. No compiler setting or source requirement was relaxed. Private local logs retain both attempts under `/tmp/openplan-approval-types.log` and `/tmp/openplan-approval-types-8gb.log`. The mutation runner removes each old report before invoking the next case, so a crashed runner cannot reuse an earlier case's results.

Targeted faults include carried approval on a correction, wrong revision identifiers/hashes/numbers, each scope/hash boundary, changed history predecessors, duplicate approval, wrong or repeated withdrawal, altered event bytes, a broader authority claim, malformed/empty/overlong reasons, changed receipt intent, missing/reordered/forked history, reused revision identity and selecting the oldest event after withdrawal/reapproval. Some malformed-history mutations lose the intended diagnostic while another later validator can still refuse the record; they do not all demonstrate acceptance of bad data.

Blind categories remain explicit: these are pure protocol tests, not database locking, RLS, revocation, transaction retry, route authentication, real browser recovery, planner usefulness or export evidence. A hash proves byte consistency, not approval authority. A forged internally consistent count/head/history requires comparison with the authoritative database. No publication, adoption, funding, representative-support or scientific authority follows from internal synthesis approval.

No migration, database mutation, API, assistant action or approval interface is included in this checkpoint. The module is prepared for those consumers; no capability rating or roadmap completion changes.

## Next implementation

Add the native approval event table and service-only retention RPC, with private staff event/history readers. Migration 27's correction writer uses `engagement-synthesis-review-request:<request>` followed by `engagement-synthesis-review:<review>` advisory transaction locks. Approval must share the second lock with correction writes. Current staff membership must be checked before exact-request recovery. Compare exact existing intent before any stale-head rejection, then enforce the current review revision and current approval-history predecessor in the same transaction. Retain original event bytes, actor and clock on replay.

Use the named isolated `supabase_db_openplan-restore-target-2026091050` stack, which remains installed through migration `20261014000027`. First prove any additive migration 28 in rollback candidate transactions, including harmless controls, targeted database failures, both approval/correction orders and concurrent identical/competing requests. Then connect the production TypeScript reader/writer and API to these RPCs, followed by account/source-scoped browser command recovery and desktop/390px navigation. Do not claim private access or recoverability from this protocol alone. Keep executable assistant-write refusal until an exact-payload action is deliberately registered.

Continue the full M9b source-to-response/decision and reviewed-export connection, optional complete resumable model generation and the remaining V1 roadmap after this increment. `NEXT_APPROVAL_BOUNDARY.md` contains the broader design and existing-mechanism comparison.

Main publication-document commit `e53e851193d5867afe31707632395d46b928e8ef` was checked live: CI `34908852644` and RLS Isolation `34908852712` are completed/successful. Those results cover that prior commit, not this new protocol checkpoint.

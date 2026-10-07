# Implementation report recovery checkpoint, 2026-10-07

The old report route used separate inserts. It now invokes the atomic transaction from PR #131 with the exact bounded request bytes. The report control retains a request in browser storage before sending it. Unknown outcomes retain the original command for an explicit check or retry. Recovery stays scoped to the actor, workspace and plan. Imported copies do not send automatically. Confirmed reports link to the saved artifact even if refreshing the plan fails.

The route checks same-origin context, current write permission, actor/workspace headers, command schema and the actual UTF-8 body limit. Agent headers receive an explicit refusal. Receipt checks verify the scope, original command hash and replay status before removing the matching pending request. The report reader authenticates the original PostgreSQL JSONB text through a narrowly projected service-only receipt after authorized plan/version reads. Legacy report hash semantics stay unchanged.

The control preserves edits made while a prior request is pending, serializes repeated events, aborts on scope change and distinguishes a saved report from a failed view refresh. Recovery controls remain available on earlier editions; creation requires the current adopted edition. These operations do not certify agency work, approve findings or publish a plan.

## Checks

- 230 focused tests pass in eight test files; lint passes on all changed TypeScript files.
- Whole-package TypeScript passes with incremental mode disabled, a 5120 MiB Node heap and a 6 GiB service memory cap, with no swap. The earlier 4096 MiB heap run aborted. It is retained as failed evidence. An earlier type error in a test header fixture was corrected before the successful run.
- All 52 targeted mutations fail their named assertions. Five harmless source edits survive in each phase, and restored production source passes. Two earlier survivors exposed weak tests: malformed UTF-8 also changed a schema key, and an edit-preservation assertion ran before the receipt digest finished. Both tests were corrected; the original survivor reports remain in the private checkpoint and their outcomes remain in the summary.
- The recovery import limit is 262144 bytes so a valid whitespace-heavy exact command can round-trip through its JSON recovery envelope.

These checks do not establish native database isolation, HTTP transaction behavior, browser storage/layout, usable rendered artifacts or practitioner acceptance. Production build and identified-build desktop/390px native acceptance remain required before merge. No database migration or new browser acceptance is claimed in this checkpoint. PR #131 supplies the additive database transaction; this branch connects the route and recovery control to it.

The evidence folder retains the source hashes, command outcomes, final named mutation failures and unresolved categories. Full private logs remain under the dated report-recovery checkpoint. The roadmap remains the sole product queue, and full V1 remains open.

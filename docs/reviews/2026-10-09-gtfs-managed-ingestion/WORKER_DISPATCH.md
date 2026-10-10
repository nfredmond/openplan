# Durable GTFS command dispatch checkpoint

The dispatcher now connects all nine worker mutation operations to the private
attempt journal and installed Supabase SDK. Command preparation supplies the
native function name, checked arguments and a pure receipt verifier. Existing
service methods retain their signatures and use these same prepared commands.
Fresh and retained responses therefore follow one set of identity, archive,
output, tract, completion and adoption checks.

Each delivery captures the original context and inputs before asynchronous I/O.
The journal retains workspace, feed and actor context with those inputs, while
its own identity supplies version and attempt token. An initial preparation
validates inputs before a command record is allocated. The saved command ID,
never the validation placeholder, goes to the native command. The dispatcher
also checks the payload supplied for delivery against the captured request.

Raw JSON responses reach the journal without being replaced by a transformed
view. The journal invokes the prepared verifier before resolving the request and
again on retained reads. Invalid replies remain unresolved. Unknown transport
outcomes retain the original identity for an explicit later delivery. A retained
receipt does not establish current ownership or authorize further computation.
Claim, read and renewal still query the live service and remain outside this
receipt cache. Ordinary adoption continues to send null review acceptance.

## Verification

- The existing service suite passes 100 tests after the preparation refactor.
  [Its current source controls](dispatch-service-controls.json) record three
  passing controls and 48 intended assertion failures. Source and test hashes
  identify the refactored candidate; prior records remain historical.
- The new dispatcher suite passes 33 tests using the installed SDK and actual
  private journal files and locks. It checks all nine endpoint names and complete
  argument bodies, durable identity before dispatch, foreign fresh and retained
  replies, withheld adoption, immutable caller input, invalid input before
  allocation, unsupported operations and changed delivery data. An uncertain
  batch reply is followed by the same token, command ID and arguments. Retained
  reads make no network request.
- [Dispatcher controls](worker-dispatch-controls.json) record 19 runs. Baseline,
  harmless comment and restored source pass; 16 targeted variants fail. Each
  operation is disabled separately. Other variants remove receipt validation,
  payload comparison, input cloning or early validation, or replace the version,
  token or command ID. Positive endpoint checks explicitly require the promise
  to resolve, so missing operations produce assertion failures.
- [Native read snapshots](dispatch-service-native.json) confirm that the current
  verifier accepts actual PostgreSQL running, completed and cancelled response
  shapes. The candidate and fixtures roll back, and a separate connection checks
  schema absence. This remains a read-response bridge, not native HTTP mutation
  or committed restart evidence.
- Scoped TypeScript with installed Node and Next declarations, ESLint and diff
  checks pass. The initial service test invocation from the repository root
  failed alias resolution. Reported results use the nested package's installed
  Vitest 4.1.11.

## Remaining connection

No route or managed worker is enrolled. The caller still must construct its
service for the recorded installation and target, obtain actual attempt context,
confirm live ownership before work, and reconcile actual Storage bytes before
archive confirmation. The journal and dispatcher do not provide those facts.
Next, connect polling and claim recovery to this dispatcher, retained artifacts,
parser supervision, ordered output mapping, lease renewal and terminal handling.

Native HTTP/database command recovery, concurrent ownership and promotion lock
order, late Storage writes, operation budgets, populated upgrade/restore, full
branch CI and identified desktop/390px T3 journeys remain unfinished. This
checkpoint changes no published scientific claim and does not establish
resumable imports or v1 acceptance.

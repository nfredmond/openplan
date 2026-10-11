# Private GTFS worker journal checkpoint

The new attempt journal retains a token before the first claim and binds it to
the configured database target, installation ID and feed version. Each named
command has its own private directory and immutable command ID and payload.
Separate records avoid rewriting every prior batch when a feed grows. The caller
sets the maximum bytes per command record; an oversized record fails before
dispatch. This is an operational bound, not a supported-feed size claim.

The implementation reuses the connector's private-file checks, atomic file
replacement, file and directory sync, and process lock. It also syncs the attempt
directory after creating a command subdirectory. Target credentials, query strings
and fragments are refused. Commands cannot cross attempts, deployments or
installations, and path traversal cannot become a command slot.

An unresolved command resends its original identity and cloned payload only when
the caller explicitly invokes delivery. The caller must use the bounded typed
service and validate the returned receipt before the journal resolves it. Retained
receipts are revalidated without dispatch. Verification receives a clone and cannot
rewrite the saved server response. A saved receipt describes a past result, not
current lease ownership. Claim calls are deliberately excluded from receipt
caching; the worker must check the retained attempt token against live state.

The callback holds the attempt lock until started deliveries settle. A callback
that neglects to await a delivery is refused and its signal is aborted. Sessions
refuse later work after release. A file or acknowledgement error leaves the exact
request recoverable; it does not invent a failed database outcome or a new token.

## Verification

The focused suite passes 40 tests against actual private files and process locks,
with controlled delivery and injected disk errors. It checks identity and payload
reuse, deployment changes, private modes, symlinks, malformed files, configured
size limits, cancellation, same-slot contention, lock exclusion, session closure,
mutable caller inputs, and both fresh and retained receipt validation.

[The control record](worker-journal-controls.json) contains 27 runs. Baseline,
harmless comment and restored source pass. Twenty-four targeted variants fail
assertions, including omitted attempt/command/receipt writes, missing parent sync,
scope and payload guard removal, skipped verification, mutable evidence, cached
claims and cancellation. An initial pre-cancellation mutation survived because a
later check still stopped dispatch. The refined test also checks that cancellation
prevents creation of the process-lock file. The mutation then fails for that
boundary. Disposable candidates leave the tracked implementation intact.

[The native process record](worker-journal-native.json) identifies a separate
Node process killed after prepared synthetic dispatch. The runner observes actual
OS-lock release, verifies the unresolved record, then starts a new process that
reuses both identities. A third process returns the retained receipt without
dispatch. This uses real files, sync calls and process termination, with synthetic
delivery. It is not a database, live HTTP, machine reboot or power-loss test.
Only the runner's own child is terminated.

Scoped TypeScript compilation includes installed Node and Next declarations.
ESLint and diff checks pass. The first test invocation used the repository root
instead of the nested package and failed module resolution; the reported tests
use the installed package's Vitest 4.1.11. No candidate database change occurs.

## Next connection

The journal is not enrolled in imports. Connect an operation-specific dispatcher
that validates retained responses with the same rules as fresh service responses,
uses the saved attempt token for live claim/renewal, and never treats a retained
claim as permission to continue. Callbacks must use bounded service calls; this
storage helper does not place a separate timeout on arbitrary caller functions.
After that, connect polling, parser supervision, artifact reconciliation and
ordered batch publication. Actual command recovery through PostgreSQL/HTTP,
concurrent ownership, cancellation during Storage writes, long-operation budgets,
upgrade/restore and T3 desktop/390px evidence remain unfinished. Full branch CI
has not run. This checkpoint makes no resumable-import or v1 acceptance claim.

Reproduce from the owned repository root, using a new output directory:

```bash
python3 docs/reviews/2026-10-09-gtfs-managed-ingestion/verify_worker_journal_controls.py /private/journal-controls
python3 docs/reviews/2026-10-09-gtfs-managed-ingestion/verify_worker_journal.py /private/journal-process
```

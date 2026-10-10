# Typed GTFS worker mutation checkpoint

The worker service now exposes typed calls for stage changes, archive preparation
and confirmation, output preparation, guarded batches, tract computation,
completion, failure and ordinary adoption. Each call validates its input before
dispatch and checks the returned command or version identity. Archive paths bind
workspace, feed and version. Output manifests require ordered, contiguous route
and stop batches with totals matching the declared plan. Completion retains the
actual tract outcome, including failed computation with null values.

Ordinary worker adoption always sends a null review. It cannot accept material
feed shrinkage for a person. The response must match the incoming counts and the
existing collapse assessment. The private attempt response now includes the
original actor ID so a background worker can bind ordinary adoption to that
submitter. Member status still excludes private worker and source fields.

These calls retain the existing ten-second acknowledgement deadline, immutable
submitted arguments and no automatic retry or failure command. An unavailable
reply leaves the database outcome unknown. Archive confirmation still requires
the caller to verify actual private Storage bytes first.

## Verification

- The installed-SDK suite passes 100 tests. Nine new mutation endpoint names and
  argument bodies are inspected, along with foreign, inconsistent and truncated
  receipts, input scope, manifest ordering/totals, immutable payloads, failed
  tract outcomes and withheld adoption. The exact 20 percent boundary remains
  allowed; an injected review argument cannot become worker approval.
- [Worker controls](worker-mutation-controls.json) record 51 runs. Baseline,
  harmless comment and restored source pass. Forty-eight broken variants fail
  assertions, including removal of each explicit cross-field guard. Disposable
  candidates leave tracked source intact. Source and test hashes match this
  checkpoint.
- [Native SQL controls](worker-mutation-sql-controls.json) record 121 runs,
  including three passing controls and 118 targeted failures. The added mutation
  omits the original actor projection and fails the active-attempt assertion.
  Each candidate and fixture runs inside a rollback transaction in the isolated
  proof database. A separate connection checks candidate-schema absence.
- [Native response evidence](worker-mutation-native.json) records actual
  PostgreSQL running, completed and cancelled snapshots accepted by the current
  TypeScript verifier in a separate Node process. This checks the added actor
  projection and actual timestamp/null shapes. It does not execute the new
  mutation wrappers through a live HTTP server.
- [The pinned Supabase advisor comparison](worker-mutation-advisor-summary.json)
  records 1,675 baseline findings and 1,694 candidate findings. Twenty newly
  identified entries are INFO only, for unused indexes and intentionally private
  RLS tables without policies. No new warning, error or unindexed foreign key is
  reported. An initial scan invocation lacked the separator after the upstream
  query and rolled back on a syntax error; the corrected invocation completes.
- Scoped TypeScript compilation with the actual Next global declarations,
  ESLint and diff checks pass.

## Unfinished boundaries

This is an isolated, unfinished checkpoint outside v0.68. No import route or
worker is enrolled, and the candidate migration is not persistently installed.
Controlled SDK transport and transactional SQL proofs remain separate evidence;
they do not establish live HTTP authorization, committed restart recovery or
concurrent execution.

Durable private journals must preserve exact command identity and reconcile
unknown outcomes before retry. The actual worker still needs polling, lease
renewal, archive reconciliation, parser supervision and row mapping. In-flight
Storage writes must settle or reconcile before cleanup acknowledgement. Managed
and legacy promotion lock order must agree before concurrent enrollment. Large
feed tract runtime, RPC acknowledgement and lease budgets need measurement and
coordination; the current ten-second limit is not evidence that those operations
finish within it. Upgrade/restore, full branch CI and identified desktop/390px
T3 journeys remain open. No resumable-import or v1 acceptance claim is made.

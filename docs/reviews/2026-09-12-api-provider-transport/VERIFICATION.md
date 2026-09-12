# API transport and credential foundation, September 12

This increment is internal code for roadmap A0b. It is not a reachable API
connection workflow and does not close A0 or A1. No external provider was called.

## Transport and interruption

The real AI SDK 6.0.278 and compatible adapter 2.0.75 ran through owned loopback
HTTP fixtures. HTTPS fixtures exercised trusted, untrusted and wrong-hostname
certificates. Actual global proxy configuration could not redirect the private
agent. DNS tests cover all answers, private addresses, metadata addresses, pinned
lookup and IPv4 fallback from an unavailable approved IPv6 listener. The original
response must name its exact model and response ID before SDK normalization.

The transport campaign completed 51 cases: one harmless comment survived and 50
faults failed their named checks. `transport-mutations.json` records each result.
The original 45-second mutation subprocess timeout was inadequate because Vitest
sets a 20-second limit per test. Removing socket cancellation hung three tests,
so the outer runner stopped before it could record their failures. The first correction added explicit
five-second per-test limits. That completed the mutation run, but the subsequent
full shuffled run correctly rejected those limits through the repository's
minimum-timeout guard. It had 13,906 passed, one failed and 401 skipped tests.

The final correction keeps the global timeout and asserts that cancellation
settles within five seconds while the independent request deadline is 30 seconds.
A repeated harmless plus all five cancellation/deadline faults now gives named
assertion failures: the deliberately broken requests exceed the response limit
instead of rejecting with `api_request_interrupted`. The mutation subprocesses
exit normally. `transport-mutations-selected.json` retains these six final cases.
`transport-mutations-initial-cancellation.json` preserves the intermediate result.
The default reporter now accompanies JSON, whose timeout stacks alone did not
explain the failure. The first full QA was deliberately interrupted because its
unit phase overlapped source mutation; it is not final acceptance evidence.
The old partial checkpoint is historical evidence, not the final result.

## Credential custody

`provider-api-credentials.ts` reuses existing AES-GCM integration encryption. Its
encrypted envelope names the workspace, immutable revision ID and configuration
hash alongside the key. Moving ciphertext between those identities, changing an
endpoint/model/timeout/label and recomputing the public hash, tampering, losing or
rotating the secret, and supplying a legacy bare key all fail explicitly. There
is no deployment-key fallback. Keyless local configurations require an explicit
null key and work without an operator encryption secret. Configuration parsing
itself makes no network request. Network policy is checked at generation time.

The credential campaign completed 23 cases: one harmless comment survived and 22
faults failed. `credential-mutations.json` records named checks and failures.
Restored focused tests passed 155 cases across transport, credentials and the
shared outbound classifier. TypeScript and changed-file ESLint passed before
mutation execution; final full checks are recorded at the next checkpoint.

## Limits and next implementation

These helpers do not establish workspace authorization, immutable database rows,
member-visible metadata, saved request identity, execution ownership or recovery.
Those require additive database functions, routes, a durable execution path and
visible controls in the existing project provider workflow. No browser acceptance
or real provider availability/usefulness is claimed. Cancellation closes local
requests but cannot undo computation accepted upstream; DNS can finish after
cancellation without opening a socket. A compromised server/operator secret is
outside the credential envelope's protection. Existing shared URL fetching was
not changed and retains its separately documented limitations.

Private logs remain under
`/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12`.

## Final local checks

Source `a86a1cd9` passed full QA: 13,907 app tests with 401 declared skips,
382 connector tests with four native opt-in skips, lint/dead-code checks, zero
dependency audit vulnerabilities and the production webpack build. Shuffled
seed 912054 passed the same app counts. The named disposable restore stack
passed 430 live database checks in 46 files. All 52 Python worker suites passed
with none omitted. Final focused tests passed 157 cases including the repository
minimum-timeout guard. `local-checks.json` binds counts and retained log hashes.
No migration was added; an upgrade drill for new API tables remains part of the
future integrated increment. Main/CI landing is separate from these local checks.

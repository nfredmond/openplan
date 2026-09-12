# Saved API generation adapter, September 12

Internal A0b implementation, following the accepted settings at main `100216a3`.
That commit's CI 34720524596, RLS Isolation 34720524628 and Upgrade Path
34720524696 all completed successfully before this implementation began.
No provider generation option has been added to the browser yet.

`createProviderApiGeneration` captures a claimed-attempt binding, saved revision,
encrypted credential, canonical project packet and question. It returns a single
invocation that consumes itself even on failure. The actual installed compatible
SDK uses the existing restricted transport, structured project answer schema and
draft-submittal proposal parser. The receipt names the turn, attempt, connection,
revision, configuration hash, packet hash, endpoint, protocol, model and key mode.
No application key fallback, external tool or business write is available here.

The adapter has 28 local HTTP fixture cases. They use the real SDK with synthetic
responses and keys, and inspect the actual request body and authorization header.
Keyless and saved-key requests preserve the same frozen project and proposal
format. Tests reject changed identity, foreign revision/packet, tampered packet,
oversized canonical input, lost decryption secret, invalid output, foreign
proposal, wrong model and incomplete completion. Cancellation, timeout, lease
expiry, concurrent duplicate invocation and retry after completion are separate
cases. Returning a proposal does not execute it.

## Errors and coverage corrections

The initial happy-path expectations incorrectly included canonical default
`status: draft` and `submittalType: other` fields. Existing approval normalization
omits those defaults. The corrected test checks the exact established payload
and uses a nondefault progress-report type. The first typecheck also caught a
fixture variable inferred as Node's UUID template type; its stored-revision type
is now explicit. Neither correction changes existing approval behavior.

The first mutation campaign exposed two incomplete workspace tests: changing
the binding workspace exercised both the revision and packet comparisons, so
removing either one alone survived. `initial-mutations.json` preserves those
results. Separate validly encrypted foreign-revision and correctly hashed
foreign-packet cases now isolate each boundary. Both mutations must fail.
The harmless comment control must survive before targeted results count.

An initial five-second per-test timeout conflicted with the repository's shared
timeout policy. This was caught by reading the prior transport evidence before
full QA. The final tests retain the shared runner timeout and independently
require cancellation to settle within five seconds. Mutation failures therefore
identify the missing cancellation instead of merely relying on a runner timeout.

The final 22-case campaign retained one harmless survivor and 21 targeted
failures. `mutations.json` records assertion names and messages. Source was
restored, then 137 focused cases passed across generation, transport,
credentials and the repository timeout-policy guard. Full QA and shuffled seed
912128 are running; they are not yet acceptance evidence.

## Boundaries and continuation

These tests cannot establish database authorization, current connection state,
durable execution ownership, completion delivery after process loss, ordinary
RLS, browser reachability or actual provider usefulness/billing. The input binding
is validated here but is not proof of a database claim. A caller must claim first,
observe current membership/revocation/cancellation and deliver results through
the existing database validator. The one-invocation closure is process-local;
the worker's retained journal must prevent regeneration after restart.

Continue the lifecycle join described in
`../2026-09-12-api-connection-storage/EXECUTION_JOIN.md`. Add optional immutable
API revision references to the existing turns, service-only claim/status and
completion checks, then reuse the native connector's private journal primitives.
Wire the existing project panel only after this worker path is executable.
Keep settings' generation-unavailable disclosure until then. No UI acceptance,
live paid API call, new migration or release is claimed by this adapter increment.

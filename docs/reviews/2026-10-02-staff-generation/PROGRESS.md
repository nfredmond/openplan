# Staff generation continuation

October 2, 2026. Isolated work from c64d87a8 while PR114 remains under CI.
This checkpoint adds authenticated request read/create/cancel adapters over the
existing native commands. Exact intent bytes and cancellation receipts remain
verified. A saved request does not authorize preparation, provider dispatch,
charges, interpretation, approval or publication.

The restored adapter passes 38 mocked transport tests and strict lint. A harmless
comment control survives; 29 targeted faults fail with assertion evidence in
[the mutation record](request-adapter-mutations.json). The first test run has one
incorrect error-message pattern, corrected without changing the verifier.

Repeated client crashes interrupt the TypeScript observation. Its log is empty
and the earlier process handle is missing, so no completed type-check result is
claimed. The two source files survive and the adapter hash matches the restored
mutation source. Heavy local checks remain stopped at this checkpoint.

Next connect HTTP authentication, origin and stale-account protection, exact
request recovery and explicit refusal of unregistered agent writes. Then connect
durable worker preparation/status and separate plan execution authorization,
followed by the dependent context/thematic stages and existing proposal import.
No new HTTP route, worker pickup, browser control or migration exists here yet.
Native RLS, actual HTTP recovery, browser usability, installed CLI provider choice,
large-history capacity and semantic quality require separate evidence. The full
v1 contract and roadmap remain unchanged.

## Authenticated request HTTP entry point

The new synthesis/generation GET and POST handlers read, create and cancel exact
requests through the authenticated client. Actor and workspace come from current
access checks. Both expected-account headers are required. Writes require same
origin, a streamed 24 KiB body limit and strict commands, and refuse every marked
unregistered Planner Agent execution. Responses remain private and uncached.
Audit records omit intent text, cancellation reasons and native error messages.
No handler prepares a plan or dispatches a provider.

The route and adapter pass 72 tests with one worker. Strict lint passes. The
[route mutation record](request-route-mutations.json) contains a surviving harmless
control and 22 detected faults. Explicit malformed UTF-8 inside an otherwise
valid JSON command exercises fatal decoding; a standalone invalid byte alone
would also fail JSON parsing and would not distinguish that behavior.

The interrupted whole-package TypeScript check is repeated in a user service
with an 8 GiB memory ceiling, zero swap and two-core CPU quota. Its first result
finds a test header union that permits undefined values; the test now declares
a string-record generic. The corrected check exits 0, peaks at 1.7 GiB and uses
no swap. [Check records](request-route-checks.json) retain both logs.

This checkpoint has no browser controls or queue pickup yet. Native access,
request cancellation before creation, lost HTTP acknowledgements and stale
identity recovery still need an installed-stack journey through these handlers.
Continue durable preparation and explicit execution authorization before
claiming a usable staff generation workflow.


## Installed request HTTP recovery

The identified 522fcca7 server passes 18 checks through actual HTTP and the owned
isolated database. [The native record](request-native-http.json) preserves each
result and hashes the local script and logs. Exact creation recovers after a
discarded acknowledgement; altered original bytes fail. Cancellation replays,
precedes creation and prevents a late creation. Foreign account/workspace,
anonymous, cross-origin and unregistered agent requests fail. Neither synthetic
request produces a plan or execution authorization.

The owned server stops successfully after this journey. Its memory peak is 1 GiB,
with no swap use; port 3478 has no remaining listener. This closes the earlier
HTTP-check boundary, not queue preparation, browser usability, provider execution,
role-transition coverage, semantic accuracy or large-consultation capacity.
The full workflow remains unfinished.

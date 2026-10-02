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

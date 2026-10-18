# Current application packet has a health identity mismatch

Parent source review finds F2, P2, in unexecuted packet `f29968d67c8177f33122691ad5879c675d457e08`. The attestor expects a full 40-character application SHA from `/api/health`. The actual pinned application's `safeCommitSha()` intentionally returns the first 12 characters in lowercase. A correctly running application would fail `attest-http-identity`.

The existing synthetic startup fixture supplies a full SHA. It does not reproduce this producer contract. Passing those controls does not establish that the attestor can accept the actual endpoint. The application health route itself needs no change.

The correction must compare the endpoint value with the exact expected 12-character prefix while retaining full-SHA checks for checkout, build, environment and process identity. A wrong prefix, unknown value, wrong type or wrong migration expectation must still refuse. The correction must exercise the actual health route's commit formatting and feed its payload into the real attestation consumer with external process/service boundaries replaced. A second copied health fixture is insufficient.

No application checkout, build or start executes. The existing packet remains immutable. A separate Sol-high implementation child prepares a new versioned packet. The ongoing independent review still examines the original f299 snapshot, including prior finding F1 concerning actual dependency and cache confinement. Another independent round will assess the corrected packet before execution.

Parent structural readback confirms all installed/public template, input, helper and completed active-receipt hashes, the single commit environment delta and the unchanged 419-migration binding. Those checks cannot resolve F2. The previously reviewed REST replacement remains separate evidence.

A third Sol-high child performs a read-only diagnosis of the existing T3 snapshot timeout. It does not retry the failing browser step, operate another session's tabs, change T3, switch browsers or establish desktop/390px acceptance. The current preview build and visible journey remain unfinished.

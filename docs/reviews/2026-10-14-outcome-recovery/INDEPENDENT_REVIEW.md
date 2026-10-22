# Outcome recovery static review, October 14

The existing read-only reviewer inspects two immutable source snapshots.
The reviewer does not execute the campaigns or establish native acceptance.

The first review identifies nested SQLite write transactions during status,
unowned reads, a canonical byte-binding test that stopped at another guard,
unnecessary current authority after a historical acknowledgement, and a general
pipeline fallback when a saved command disappears. The implementation closes the
status transaction before recovery reads, requires the lifetime owner, uses
canonical changed bytes for the binding test, and retries the exact pinned
terminal command directly. Historical acknowledgement repairs private records
without another POST. Pending refusal preserves the known original engine facts.

The second snapshot adds exact task, metadata hash, code and state assertions
for failure paths. It requires an actual recovery record and released hold after
historical acknowledgement, and a sentinel against general pipeline fallback.
The reviewer finds no additional concrete source defect.

Review of the imported failure parser identifies a separate test-result limit:
zero or contradictory FAILED counts and repeated summaries could be accepted.
The local controller now requires a unique Ran/FAILED pair and positive counts
matching FAIL/ERROR headers. Added trials challenge zero counts, mismatched
counts and duplicate summaries. Multiple same-test subtest headers remain valid.
This correction does not change the historical helper or its other callers.

Source execution, live database execution, joined-build checks and default
integration carry separate evidence. This review does not declare release,
practitioner, scientific or V1 acceptance.

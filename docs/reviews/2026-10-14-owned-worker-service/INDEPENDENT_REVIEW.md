# Frozen independent service review

The existing independent artifact reviewer reads two frozen source snapshots on
October 14. Each snapshot includes source hashes and unchanged Python graph
dependencies. The reviewer runs no tests, services or mutations.

## Initial findings

The initial review identifies four concrete defects. A two-second handler-join
timeout can release the lifetime owner while an authenticated admission still
runs. Handlers read the cached `_service` role while validation checks `service`.
Mutable socket bounds take effect before the settings guard. SQLite admission
errors escape the unavailable-response branch.

The corrections retain ownership until handlers exit and expose delayed shutdown
as a diagnostic. Cleanup reaches handler drain even after an earlier cleanup
error. A captured original-service accessor validates both aliases before auth,
admission or download. Header, body and response bounds use captured accepted
values. SQLite contention returns a structured 503.

## Corrected snapshot

Snapshot02 finds no further concrete defect in the bounded source, test and
controller review. Actual-handler tests cover a delayed admission beyond the
diagnostic threshold, another writer's refusal while ownership remains held,
replacement cached credentials, changed socket bounds and real SQLite contention.
The source campaigns separately exercise the broken versions of those behaviors.

The cleanup-error fixture raises after actual listener shutdown completes. It
proves handler drain despite that exception, not arbitrary failure to stop a
listener. JSON processing and diagnostic size have no separately measured CPU or
output budget. Deadlines apply per stage. Full application, default integration,
capacity, hosted operation and independent installation remain unverified.

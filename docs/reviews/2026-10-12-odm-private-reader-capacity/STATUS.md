# Maximum private originals now survive publication and recovery

This candidate follows reader PR #260 at `85c5eadce`. A real local maximum
request exposed a defect: capture accepts its exact 32 MiB original, but the
escaped saved receipt exceeds the shared writer's 64 MiB metadata default.
The first failed trial remains in the private proof directory. This change
adds an explicit, bounded publication option. Original custody selects its
existing 193 MiB receipt ceiling. Other metadata keeps the 64 MiB default.
The original and response ceilings stay unchanged.

The [capacity proof](evidence/capacity-controls.json) passes 14 cases through
actual owned local HTTP processes. Baseline, harmless and restored readers each
capture and save an exact 32 MiB original, accept a 193 MiB response and reload
a relocated runtime without another request. The saved hash and original job
scope match. One-byte original and response overflows refuse before saving;
declared and undeclared response lengths run separately. Cancellation closes
the held connection and leaves no original. A deliberate whitespace-stripping
fault fails the exact-byte assertion. Eight [classifier controls](evidence/capacity-oracle-controls.json)
reject zero exits, unrelated errors and missing diagnostics. Source restoration
and [bindings](evidence/capacity-source-bindings.json) match current files.

The final capacity unit records [peak memory](evidence/capacity-resources.json)
of 1,073,811,456 bytes against a 1,073,741,824-byte limit, with 2,732 max/reclaim
events and zero OOM events. The unit includes the fixture, client, HTTP child
and charged file cache. Maximum client resident memory is 501,829,632 bytes;
the largest child resident peak is 230,326,272 bytes. These separate process
peaks are not simultaneous totals. The unit stops successfully. This is a
bounded single-reader observation with memory pressure, not production or
concurrent worker capacity acceptance. The earlier passing trial also reached
its cgroup limit and remains retained.

The shared publication checks pass 44 tests and [59 controls](evidence/source-controls.json).
Four harmless, ordinary and restored controls survive; 55 selected faults fail.
The new faults remove explicit-bound selection and permit an invalid bound.
Original-custody checks pass 33 tests and [45 controls](evidence/custody-controls.json),
with four survivors and 41 selected faults. Removing the original's explicit
bound fails at the intended publication refusal. Eight custody classifier
controls pass. An earlier test patched the metadata bound too broadly and
failed an unrelated runtime read. That failed trial remains retained; the
corrected test patches only the actual publication call.

All 28 [aerial workflow run steps](evidence/workflow-results.json) pass serially
in an isolated Python 3.11 environment. This replay uses
`bash --noprofile --norc -e -o pipefail -c`, including each multiline workflow
block. Nineteen unittest suites report 510 cases; seven scenario programs also
pass. Current reader checks retain 43 tests and 60 controls. All worker source
hashes match after restoration. Three nested documentation files pass 14 tests,
and product direction passes with existing review reminders. The runner takes
313.795 seconds including environment setup and documentation checks. Its
[peak](evidence/workflow-resources.json) is 942,747,648 bytes under one GiB,
with no max or OOM events. The owned unit stops.

The installed [private RPC recovery regression](evidence/native-rpc-controls.json)
passes 14 cases and eight classifier controls after the writer correction.
Exact capture precedes source fetching; relocation uses retained originals;
current revoked access remains false. Fresh revoked, wrong-target and anonymous
reads refuse, and the stalled installed read obeys its shared 0.8-second client
deadline. Both synthetic fixture services [stop](evidence/native-rpc-stopped.json)
without OOM. Source and engine adapters remain supplied fixtures. This proof
does not establish native engine operation.

Default worker activation, engine transport permission and the hosted database
stay unchanged. Migration03 is not applied by this correction. Exact-head
GitHub acceptance remains separate. Public DNS/TLS, hosted response and database
capacity, full installation restore, power-loss durability, atomic external
revocation, browser journeys, practicing-planner acceptance and scientific
validation remain unproved. The size fixtures cannot measure concurrency or
native processing; local classifier controls cannot establish those boundaries.

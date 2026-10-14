# Complete fixture receipts across forced owned-child shutdown

Main CI38379638499 fails after PR281, at main
`ef378501ad05434591e5905b9ac3f7745cd19bf9`. The app suite passes 22,180 cases
with 1,630 skipped. The subsequent connector gate fails while parsing the owned
OpenCode fixture's shutdown receipt, with `Unexpected end of JSON input`.
This candidate changes the fixture and its checks, not production shutdown code.

## Reproduction and correction

The preceding fixture rewrites its receipt in place. Opening that path truncates
the preceding JSON before the next complete bytes arrive. A forced child kill
can interrupt this interval. The deterministic control opens the real receipt
path, reaches a file-publication barrier and stops the actual owned child there.
The reader then encounters the same empty-JSON failure class. The CI log does
not capture the exact file size or syscall phase, so its particular interruption
point is not established.

The fixture now writes a same-directory temporary file and renames it after
complete data and descriptor closure. Interrupted updates leave the preceding
complete receipt. This is fixture visibility across process interruption, not
physical power-loss durability. Partial scratch files remain for diagnosis.

The shutdown test observes the real child object's signal calls and delivery
results, requires SIGTERM followed by SIGKILL, waits for close and checks that
the owned child is gone. It no longer treats a child-written termination marker
as proof that the parent performed escalation. A separate test forces publication
interruption and preserves the preceding complete receipt. Startup, request,
authentication, cancellation and lifetime checks stay present.

## Current local evidence

The process suite has 32 passing cases, no failed/cancelled/skipped cases.
Four full positive cohorts pass, including harmless fixture/helper/test comments.
Five faults fail their intended named checks: in-place publication, publication
before data, wrong initial signal, wrong escalation signal and missing actual
publication barrier. The typed TAP oracle rejects wrong exits, tests, counts,
cancelled results, missing diagnostic fields and stdout decoys. All mutated
source restores exactly, including the unchanged production adapter.

The connector suite passes 404 of 408 cases; four remain skipped. The owned
provider unit uses a 1 GiB cap and zero swap. Its reported peak is 378.8 MiB.
The current controls use a 256 MiB cap, report an 84.3 MiB peak and zero swap.
Exact cgroup memory-event counts are not measured for these short units.
Every owned fixture child and local check stops. This does not establish an
installed OpenCode backend, live provider/network operation or full A0/M3/v1.

The first control trial rejects a premature-rename fault because it exits the
fixture during startup, before the intended interruption assertion. The corrected
fault applies at termination publication and fails at the named receipt check.
That rejected trial remains private. No matcher is relaxed to accept it.

## Main and production hold

Normal main merges remain held. This verified corrective PR can fix main under
the existing stop-and-fix rule, after its own exact-head required checks pass.
Fresh corrected-main CI and exact public health precede any further merge.
Public health at 10:36 UTC still reports the last checked `ea95495bdc87`, with
app `ok` and database `not_checked`. No alias, environment, migration, default,
production bound or release tag changes here.

Private CI logs, controlled child output and failed trials remain under
`~/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/opencode-receipt-fixture-20261013/`.

[Source controls](evidence/controls.json),
[typed failure-oracle controls](evidence/oracle-controls.json),
[restored source bindings](evidence/source-bindings.json) and
[connector summary](evidence/provider-summary.json) retain the local results.

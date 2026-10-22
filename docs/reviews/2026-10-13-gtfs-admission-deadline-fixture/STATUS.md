# GTFS admission deadline fixture correction

The prior test times the complete admission against 180 milliseconds, while the
production 50-millisecond timer begins at upload. The earlier work includes
private byte custody, source resolution, database admission and status reads.
A controlled 200-millisecond source-resolution delay reproduces the preceding
fixture failure. The actual failed shuffled job 115119622282, run 38343525329 on
PR 275, records 229.821421 milliseconds against 180 with seed 792213. That log has
no per-phase latency; the exact CI delay is not determined.

The revised test retains the same 50-millisecond production timer and deliberately
slow source resolution. It observes the requested timer delay, an actual aborted
upload signal with its deadline reason before archive reconciliation, and refusal
before the controlled late reply. The cancellation case similarly observes the
transport's signal before its reply and refuses before the late acknowledgement.
Final cleanup therefore cannot mask absent physical cancellation. Pending test
promises settle before fixture removal, including deliberate early failures.
No production code or budget changes.

[All 37 source controls](evidence/source-controls.json) pass: four survivors and
33 selected faults. The [five deadline/cancellation observations](evidence/targeted-deadline-assertions.json)
identify the precise assertion failures. Missing caller/deadline propagation,
a changed timer budget and omitted bounded waiting each fail for their intended
reason. Baseline, harmless comment, redundant validation and restored source
survive. Source hashes restore exactly. All 42 admission cases pass.

The [shuffled cohort](evidence/shuffled-summary.json) passes 62 admission/docs/release-
ordering cases with seed 792213. Scoped TypeScript, changed-file lint and product
direction pass. The [follow-up unit](evidence/followup-resources.json) stops with a
434,331,648-byte peak under 1 GiB, zero max/OOM events and no extra swap. The
final control unit stops; systemd records a 218.8 MiB peak. Its cgroup events were
not retained, so they are not inferred from the exit result.

The first controller trial fails at the file-sync fault because the new test waits for an upload
that the faulty source never reaches. The second controller trial fixes that race, then exposes
an unbounded cancellation mock when bounded waiting is deliberately removed.
Both are rejected incomplete trials. The third controller trial uses controlled late replies and
settles pending promises, then completes all 37 controls. Their retained logs and
source restoration remain separate from accepted evidence.

The fixture uses a mocked Storage/PostgREST transport and real private filesystem
writes/fsync. It establishes deadline scheduling, abort ordering and late-reply
refusal, not exact wall-clock latency under an OS or event-loop stall. It does
not establish real public DNS/TLS, live Storage/RLS, large-feed capacity, browser
or planner acceptance. Recurring retired-key cleanup remains required for actual
late server writes. Complete M3 and v1 remain open; no activation, hosted write
or release tag accompanies this correction.

Private proofs remain under
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/gtfs-admission-deadline-fixture-20261013/`.
The original shuffled log is retained in the combined candidate's
`corrected-join-05/gtfs-admission-shuffle-115119622282-private.log`.

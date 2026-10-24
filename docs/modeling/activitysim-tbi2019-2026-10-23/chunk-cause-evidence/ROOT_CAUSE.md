# Trip scheduling changes when failed legs share a chunk

October 24, 2026 UTC. ActivitySim 1.5.1, CPython 3.11.15. This investigation reads
synthetic model inputs and outputs only. It does not open TBI travel outcomes.
The installed engine files remain unchanged.

## Mechanism

The discrepancy starts in retry cohort composition, not a row-order seed change.
ActivitySim groups complete tours into chunks, then retries failed legs inside
each chunk. Successful opposite-direction legs leave the retry cohort.
`run_trip_scheduling` resets the time bounds on every retry. If any outbound leg
remains in that chunk, it calls `update_tour_earliest` for the entire chunk.
Under the inherited logic version 1, an inbound-only failed leg then receives
a missing earliest departure because its successful outbound leg is absent.
The existence of another tour's failed outbound leg therefore changes this leg's
feasible departures.

The missing earliest bound clips every departure probability to zero. The fail
alternative gets probability one, but the chooser still consumes its next random
number. Once the chunk has no failed outbound legs, the reset earliest bound
survives. The inbound leg finally succeeds using a later random draw. With a
smaller chunk, it can reach this condition on an earlier retry.

Installed source anchors, byte-verified against the v1.5.1 tag in
[source custody](source-custody.json):

- [Trip scheduling, lines 565–614](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/abm/models/trip_scheduling.py#L565-L614): tour-based chunks, then the retry loop inside each chunk.
- [Trip scheduling, lines 616–629](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/abm/models/trip_scheduling.py#L616-L629) and [failed cohorts, lines 17–36](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/abm/models/util/trip.py#L17-L36): retain failed legs rather than whole tours.
- [Trip scheduling, lines 377–406](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/abm/models/trip_scheduling.py#L377-L406): reset time bounds and condition the inbound update on any outbound row in the chunk.
- [Trip scheduling, lines 158–191](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/abm/models/trip_scheduling.py#L158-L191): logic version 1 assigns the missing outbound maximum to the inbound earliest bound. Logic version 2 retains the initialized bound when the maximum is missing.
- [Probability clipping, lines 37–62](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/abm/models/util/probabilistic_scheduling.py#L37-L62), [fail probability, lines 195–198](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/abm/models/util/probabilistic_scheduling.py#L195-L198), and [drawing, lines 293–311](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/abm/models/util/probabilistic_scheduling.py#L293-L311): missing bounds remove all finite departure alternatives, and the all-fail row still reaches the random choice call.
- [Random channel, lines 88–109](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/core/random.py#L88-L109) and [draws, lines 174–245](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/core/random.py#L174-L245): seeds use row identity, and offsets advance per drawn row.

## Native reproduction

Two isolated copies of the existing 64-household checkpoints resume after
`trip_purpose_and_destination`. The Python profiling hook observes calls and
returns without replacing functions, changing arguments or drawing random
numbers. Both scopes use 9 GiB and zero swap. The unchunked replay matches all
seven original final tables under the adopted criterion.

For household 1128682, person 2789209, tour 114357608:

| Execution | Retry | Any outbound row in retry chunk | Earliest bound used for inbound choices | Trip 914860869 | Trip 914860870 |
|---|---:|---|---|---:|---:|
| Both | 1 | Yes | 9 | Fails | 18, discarded with failed leg |
| Unchunked | 2 | Yes | Missing | Fails | Fails |
| Unchunked | 3 | Yes | Missing | Fails | Fails |
| Unchunked | 4 | No | 14 | 16 | 18 |
| Chunked replay | 2 | No | 14 | 18 | 19 |

The initial seeds are 2520619197 and 2520619198, with offset zero. Both executions
use the same first draws, approximately 0.9562184948 and 0.4010213330. Both also
use the same second draws, approximately 0.1777651802 and 0.7020008388. The second
draws select failure in the unchunked run because its feasible probabilities
are zero, but select periods 18 and 19 in the chunked run. The unchunked run
reaches offset three before success, using approximately 0.0520247104 and
0.3487326294. The hook's pandas JSON output retains ten decimal places; final
CSV comparisons retain round-trip float precision. Seed and offset values are
integers and exact.

The diagnostic training run computes different adaptive chunk boundaries from
the historical whole-model training run. This is expected from live memory
sizing, and is not an exact replay of its boundaries. It reproduces both target
departures and also changes trip 568664413 from 15 to 17 and trip 568664414 from
16 to 19. These additional records remain in
[reproduction comparison](reproduction-comparison.json). The original failure
and all its outputs remain untouched. This diagnostic failure does not admit
any chunked execution path.

## Documented setting probe

The [installed logic-version setting](https://github.com/ActivitySim/activitysim/blob/v1.5.1/activitysim/abm/models/trip_scheduling.py#L56-L69)
is a behavioral change, not an execution-only repair. Setting it to 2 on the
unchunked reference checkpoint completes but changes the same four departures:
568664413, 568664414, 914860869 and 914860870. It therefore fails the frozen
legacy-reference choice criterion. The setting is not adopted.

A first setting probe used a reduced checkpoint list and stopped at stock
`write_data_dictionary` with `CheckpointNameNotFoundError: "checkpoint
'trip_scheduling' not in checkpoints."` Its log and directory remain retained.
The separately named `logic2-64-complete` probe restores stock
`checkpoints: true`; it supplies the completed comparison above. This is an
instrument correction, not a parity success or an engine-source patch.

TripSchedulingSettings has no per-component dynamic chunk-disable field.
Global `chunk_training_mode: disabled` is the fully unchunked path that cannot
fit the full population here. Global `explicit` is another documented chunking
regime, but it requires component-specific sizing for earlier memory-intensive
steps and does not retain the requested production-cache prefix. The evaluated
successor uses the user's next listed path: a production prefix, checkpoint,
and fully unchunked suffix. It preserves logic version 1 and all coefficients.

## Execution preparation failures remain retained

The first hybrid prefix uses a minimum chunk ratio of 1.0 with a 64 MiB target.
It completes without splitting a chooser table. The existing actual-split guard
rejects it before the suffix. The successor restores the stock 0.05 ratio and
passes both 64-household comparisons, with every final value exact.

The old 64-household training cache then lacks two branches encountered in the
2,000-household prefix: `mandatory_tour_scheduling...tour_2.univ` and
`joint_tour_scheduling...tour_2`. ActivitySim warns that their initial row size
is zero. The investigation stops its own scope, retaining exit code -15 and
partial logs. No terminal peak-memory receipt survives that operator stop;
no measured peak is inferred. The suffix and choice comparison do not run.
This is a cache-coverage failure, not a differing-choice result.

The replacement cache comes from a separate native training prefix on the frozen
2,000 households and 4,971 persons. Its explicit training target is 512 MiB,
minimum chunk ratio 1.0, initial chooser count two, and hard scope limit 9 GiB
with zero swap. It stops before trip scheduling. It completes in 778.760 seconds
at a 2,025,246,720-byte cgroup peak, without OOM events. Cache SHA-256 is
`365ccfdc636f0662108ea8b930407c0163c501afe5057fc641984fad5b6a16eb`.
The subsequent production proof uses the original 64 MiB target and stock 0.05
ratio. Reference reuse requires matching final-file and configuration hashes
and a successful run receipt. These preparation corrections do not relax the
choice criterion, cache refusal, actual-split guard or four-comparison census.

## Result and boundary

The replacement-cache hybrid passes both frozen subsets for both coefficients.
All choices and row counts match. The 2,000-household current arm has two
admitted one-ULP destination-logsum differences; every other exported value in
the four comparisons is exact. [Hybrid summary](hybrid-summary.json) retains
the counts, differences and stage memory receipts.

Both full arms then fail with systemd-confirmed OOM kills in the production
prefix's grade-school location logsums at the 9 GiB cap. Neither reaches the
trip-scheduling checkpoint. [Full health](full-run-health.json) reports the
failed attempts and unavailable final counts/shares. The investigation proves
the subset execution parity and the retry mechanism, but does not demonstrate
a completed full-population path within 9 GiB or full-scale suffix memory.

# GTFS parser measurements, October 9, 2026

Two publisher downloads parse successfully at checkout `091861d72c866c4ac13c904c0e7d51dda6b58190`. These are single-run measurements, not national capacity or transit-service validation.

| Feed | Archive bytes | Stop-time rows | Parse seconds | Process peak RSS, KiB | Derived stop rows |
| --- | ---: | ---: | ---: | ---: | ---: |
| BART | 892,312 | 57,188 | 0.608 | 112,944 | 717 |
| TriMet | 43,392,539 | 3,403,393 | 18.215 | 203,212 | 39,272 |

Both runs use the production parser and default resolved limits. Each systemd process has 768 MiB maximum memory, no swap, one CPU quota, a 512 MiB Node heap and a 120-second external deadline. The parser retains its default 180-second cooperative budget. The external deadline would stop a slow process before the parser budget, without establishing a graceful refusal. Neither run reaches either deadline. Node is v24.21.0. Peak RSS covers the Node process, not the complete service cgroup. This busy development host is not a controlled benchmark machine.

## Sources and reproduction

[BART publishes its feed here](https://www.bart.gov/schedules/developers/gtfs), under its [developer agreement](https://www.bart.gov/schedules/developers/developer-license-agreement). [TriMet publishes its static feed here](https://developer.trimet.org/GTFS.shtml), with [terms here](https://developer.trimet.org/terms_of_use.shtml). Source JSON records download time, resolved URL and archive hash. Raw feeds remain local and are not redistributed with this evidence.

Run `profile.mts` with `tsx` from the measured checkout's `openplan/` directory, passing a local archive path. `trimet-execution.json` records the exact bounded command and exit code. BART uses the same caps, as recorded in `measurement-custody.json`. The script measures outcomes; it is not a pass/fail gate. Archive SHA-256 values match both source manifests and parser output. `source-hashes.json` identifies the measured GTFS source files. Mutable publisher downloads may no longer match these hashes.

The first TriMet download exceeded a 40 MiB sampling cap. The completed attempt streamed to local disk with a 192 MiB cap and 120-second download deadline. Two Sacramento Regional Transit URLs failed TLS certificate verification before measurement; verification remained enabled. Their URLs and failures remain in the custody record. They supply no parser evidence.

## Consequence for M3

Keep the architecture's resumable-worker requirement. These samples show that parsing alone fits the measured bounds. They do not measure the complete import, including the 39,272 derived TriMet stop rows, database batches, object storage, promotion, cancellation or recovery. Profile persistence before choosing worker batch sizes or timeouts. Reuse the existing feed-version identity and retained archive rather than creating a second authoritative ingestion record.

The cleanup and late-write repairs in PR #174 address a separate race. They do not provide worker ownership, heartbeat renewal, resumption or durable execution. Age-based cleanup still cannot establish that a parser process has stopped. A worker must bind writes to its owned attempt and recover interrupted work without promoting partial records.

Neither feed exercises frequency-based trips. Larger feeds, malformed archives, concurrent imports, memory pressure, worker interruption and full browser journeys remain open. These measurements do not change parser defaults, the roadmap queue or any published capability claim.

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

Keep the architecture's resumable-worker requirement. These samples show that parsing alone fits the measured bounds. The native persistence measurement below covers database batches and promotion for TriMet. Object storage, cancellation, recovery and concurrent imports remain unmeasured. Complete those measurements before choosing worker batch sizes or timeouts. Reuse the existing feed-version identity and retained archive rather than creating a second authoritative ingestion record.

The cleanup and late-write repairs in PR #174 address a separate race. They do not provide worker ownership, heartbeat renewal, resumption or durable execution. Age-based cleanup still cannot establish that a parser process has stopped. A worker must bind writes to its owned attempt and recover interrupted work without promoting partial records.

Neither feed exercises frequency-based trips. Larger feeds, malformed archives, concurrent imports, memory pressure, worker interruption and full browser journeys remain open. These measurements do not change parser defaults, the roadmap queue or any published capability claim.

## Native persistence follow-up

The same TriMet archive passes through production `beginGtfsFeedVersion`, stage update, `writeParsedFeedVersion` and promotion helpers at the same source commit. A private PostgREST schema exposes workspace-filtered views over the owned proof database. The gateway runs with a 128 MiB memory cap, half a CPU and a one-connection pool. The database is an existing isolated populated clone; its resources are not capped by this measurement. The Python/Node service has a 768 MiB memory cap, no swap, one CPU and a 150-second external deadline. The child command has a 110-second timeout. No shared demo or acceptance database is written.

Parsing takes 18.442 seconds; row mapping, 42 derived-row insertion requests, tract computation and ready finalization take 3.579 seconds. Promotion runs afterward and is outside that persistence duration. Node peak RSS is 254,440 KiB. Each complete 1,000-row stop batch is roughly 704 to 713 kB of JSON. `trimet-persistence.json` retains individual HTTP request sizes, status and elapsed time. Request timing ends when response headers arrive; the outer persistence measurement includes awaited production helper work.

A separate native SQL readback counts 1,023 route rows and 39,272 stop rows, and confirms the ready feed points to the new version. This goes beyond trusting the version's declared counts. The actual tract function returns zero rows. No populated study-area tract coverage is established, so zero is not evidence that the region lacks transit service.

This is a service-role helper measurement, not route authorization, RLS isolation or a browser workflow. The workspace is synthetic; production helpers create the feed and version. No archive is uploaded or falsely assigned a storage path. The source archive remains local. Consequently this does not prove full ingestion, retained-object recovery, scientific validity or normal full-schema gateway capacity. `persist-profile.py` records the exact local setup, and `trimet-persistence-custody.json` identifies the isolated target and source. The temporary gateway is removed after the run; the synthetic records remain in the owned proof database.

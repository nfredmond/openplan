# Interruptible transit source downloads

October 10 development checkpoint on the isolated managed-ingestion branch.
This change prepares source intake for the existing M3 worker design. It does
not connect a worker or enable managed import routes.

`fetchGtfsFeedBytes` and `fetchCappedBytes` now accept a worker `AbortSignal`.
Cancellation rejects with that signal's reason so loss of ownership does not
become an invented feed failure. Callers that omit the signal retain the
existing result vocabulary, byte limits, deadline and per-hop URL checks.
The download deadline also bounds waiting for DNS and redirect-body disposal.
An underlying DNS promise can continue, but its later answer cannot open a
connection after cancellation. A transport response arriving late is discarded.

Body interruption cancels the reader and releases its lock. The caller does
not wait for an unresponsive producer to acknowledge cancellation. A partial
body cannot become a successful archive. These changes also keep an oversized
body refusal from waiting indefinitely for producer cleanup.

## Evidence

The new suite checks pre-cancelled requests, interrupted and stalled DNS, late
transport responses, partial bodies, stalled producer cleanup, listener and
reader-lock release, redirects and the existing URL validation path. Its local
HTTP case uses Node's real fetch and observes the server's response close after
the downloader has locked that body for reading. Public URL validation uses a
controlled DNS answer, and the test transport maps the validated URL to its own
loopback listener. This does not test public DNS, TLS or a publisher's server.

[Mutation results](fetch-cancellation-controls.json) record eleven runs. Baseline,
harmless-comment and restored sources pass. Eight altered implementations fail
at their intended assertions: dropped wrapper signal, unbounded resolver wait,
connection after abandoned DNS, undisposed late response, missing body cancel,
awaited producer cleanup, retained listener and retained reader lock. The runner
restores both source files in `finally`. It uses one test worker and a 1 GiB
service limit. The observed service peak is 213 MiB over 21 seconds.

[Regression results](fetch-cancellation-tests.json) record 38 files and 1,015
tests: 998 pass, 17 live-database cases are skipped and none fail. Scoped
TypeScript and changed-file lint checks pass. The final service takes 78 seconds
and peaks at 398.5 MiB. The skipped live-database cases remain unproved by this run. No SQL changes, native
Storage changes, browser evidence, full branch CI or release claim accompanies
this checkpoint.

Source intake still needs private durable bytes before archive preparation,
exact-byte reconciliation after an uncertain upload, and connection to the
owned attempt. The installed Storage upload helper does not forward an upload
AbortSignal. Its worker transport must therefore carry cancellation explicitly;
racing only the upload promise would leave that external request running.
The recurring retired-key cleanup remains necessary for late uploads.

Reproduce the controls in this owned checkout, with no concurrent source reads
or edits:

```bash
python3 docs/reviews/2026-10-09-gtfs-managed-ingestion/verify_fetch_cancellation_controls.py /private/new-control-directory
```

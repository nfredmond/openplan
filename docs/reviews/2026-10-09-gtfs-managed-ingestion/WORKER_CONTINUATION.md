# Installed worker interruption and retained continuation

October 10 proof at app source `2caefd6a9a41`, parser build `3aa44ff80155`, on the owned 403-migration candidate. These are native CLI and database observations, separate from the mocked regression suite and historical queue proof. The demo is not used.

## Same-attempt recovery and measured feed

A real browser URL submission queues the publisher's TriMet schedule. The continuous installed CLI downloads and confirms 43,392,539 bytes, matching the retained SHA-256. [The interruption record](journey-worker-interrupted.json) observes its actual parser child before signalling only the owned CLI parent. The parser exits and the CLI stops with status 0. Native reads at interruption find one running claim, no published stop rows and confirmed archive custody. The service peaks at 388.8 MiB under a 1 GiB cap, with swap disabled.

A fresh invocation using the retained journal resumes the same claim before lease expiry. [Native completion](journey-worker-resumed-native.json) remains attempt 1 with one claim: 81 routes, 6,027 stops and 67,515 trips produce 1,023 route and 39,272 stop service rows. It does not adopt the version. A separate actual Storage download verifies its size and hash. The one-shot service takes 45.755 seconds and peaks at 354.7 MiB. This measures that feed and configuration; it does not establish largest-agency capacity, simultaneous workers or uninterrupted production service.

The [publisher page](https://developer.trimet.org/GTFS.shtml) identifies the schedule download. Its [terms](https://developer.trimet.org/terms_of_use.shtml) distinguish site content from registered web-service API data. The archive stays private and is not redistributed in repository evidence. This engineering use does not claim agency endorsement, redistribution permission or measured service validity.

## Fresh replacement worker

A separate browser BART request queues version `efd51598-a404-4501-97b2-eeca83622c18`. [The parent interruption](journey-replacement-interrupted.json) again observes the parser and stops only that owned parent. Its archive and original journal remain retained. A fresh private worker directory keeps the same installation and parser identity. Its pre-expiry one-shot pass does not claim the running version. Continuous polling also respects the lease; [the final pre-expiry native read](journey-replacement-before-expiry.json) still records one attempt and claim. No timestamp or lease is edited.

[The replacement record](journey-replacement-native.json) shows attempt 2 claimed at `02:15:20.637938Z`, after the prior lease ends at `02:15:17.650029Z`. It completes 95 route and 717 stop service rows from the unchanged 892,312-byte archive. It leaves the existing adopted version unchanged. The fresh worker stops cleanly after completion. The original journal's subsequent one-shot pass observes the terminal result in 784 ms, peaks at 93.4 MiB and leaves two native claims, without a third attempt. Both worker roots are retained for the coordinated restore drill.

## Restore input and remaining boundaries

[The new queued ZIP](journey-restore-queued-native.json) is submitted through browser File/DataTransfer, with its bytes/hash verified before admission. Native reads record zero claims and the exact private source file. It is held for the coordinated restore drill. Native file selection remains untested.

These cases do not establish planner cancellation during active processing, uncertain admission cancellation, full restore, geographic service findings, current main integration, GitHub CI, release or practitioner acceptance. All candidate migrations remain unreleased and managed routes remain opt-in.

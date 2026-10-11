# Retained archive HTTP interruption, October 11

[Three added native HTTP tests](../../../openplan/src/test/gtfs-retained-archive-transport.test.ts)
exercise installed `@supabase/storage-js` 2.110.7 and native fetch against an
owned ephemeral loopback server. Cancellation closes a headers-stalled connection,
closes a partial body and refuses its archive. The archive deadline independently
closes a headers-stalled connection. Every case observes one request. The
headers-cancellation case also verifies the full selected private-object path.

The initial and restored suites each pass 14 tests across two files. A harmless
runtime comment passes all three new cases. Four targeted broken behaviors fail
at their intended assertions:

| Broken behavior | Intended failure |
|---|---|
| Omit the download transport signal | The server-side connection does not close. |
| Publish bytes after cancellation | The result wrongly reports success. |
| Mark the deadline without interrupting | The pending read does not settle. |
| Omit transport and body disposal | The partial body's connection does not close. |

[Recorded controls](retained-transport-controls.json) retain actual child exits,
source/test hashes and the private runner hash. The original runtime bytes are
saved before mutation and restored in finally. The runtime SHA-256 remains
`92e712dce8aea3e0332cd06945e67a181d370fd2689c43a442049ce2b680a04e`.
No app or SDK implementation changes are needed. Test lint and scoped TypeScript
pass with actual exit zero. Services each use 1 GiB, no swap and one CPU; the
control service's final journal records 197.2M, lint 260.5M and types 270.3M.

Run the test files from the actual nested package:

```bash
npm test -- src/test/gtfs-retained-archive-transport.test.ts src/test/gtfs-retained-archive.test.ts --maxWorkers=1 --no-file-parallelism
```

The six-byte synthetic archive tests custody and interruption, not parsing.
This uses real local HTTP, not a Storage server, public DNS, TLS, RLS or sustained
capacity. Existing native archive, ownership and recurring late-upload cleanup
proofs remain separate. Frozen 6a build/browser/archive sources stay unchanged.

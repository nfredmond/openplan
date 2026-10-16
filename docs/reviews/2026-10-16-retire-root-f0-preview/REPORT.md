# Retire the completed root-owned f0 preview

October 16, 2026. The old f0 preview's web unit and four helper containers are stopped. Its current unit PID and invocation match the retained startup attestation. Each helper's full ID, name and labels match the original root-owned receipt. Live project-thread inventory shows root and three offline implementation/review children, with no active preview collector. All five stop commands return zero. The web unit is inactive with PID zero, and all four helpers report not running.

The operation targets only `openplan-pr330-memory-f0cbeddff-r2-web.service` and the exact recorded REST, Auth, gateway and Storage container IDs. There is no container removal, database request, file deletion, reset or restart. The demo, protected 215 preview and source anchors are not selected. The old source is `f0cbeddff5ae3fc37e0dd8b91c02601429d977a6`.

The retained build archive still matches its original SHA256 receipt, and pinned runtime sources pass their existing hash checks. This verifies those artifacts, not byte-for-byte preservation of every live log or database contents. The containers, build and database remain in place. Current inactivity does not revise any historical acceptance or failed proof.

Observed available memory rises from 12,051,260 KiB to 12,613,344 KiB across the operation. These are host observations; other processes can change the value. The successor's 10 GiB cap plus 2 GiB reserve remains unchanged. Its actual capacity producer must pass immediately before admission. No successor build is admitted or started here.

Durable intent precedes each stop. Returned command PIDs, exit codes, elapsed time and stream hashes remain under the private root pinned in [evidence.json](evidence.json). Failure would stop later requests; no automatic retry occurs. The source checkout's three inherited staged budget changes remain untouched. No merge, hosted change, release or v1 acceptance follows.

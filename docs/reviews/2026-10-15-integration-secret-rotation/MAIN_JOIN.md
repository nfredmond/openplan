# Current main joins the rotation candidate

October 15, 2026 UTC. PR 328 now includes main
`b259d73e56d22d4935ef2789874cf69901786b33` through merge
`596380a8e88e44ab1d3970da2e4c9c7ccda1f2bb`.

The earlier required-check notice names `cfdce545f`, before the two combined
consumer tests and their independent review. It does not qualify this head.
GitHub reports a conflict after main adds Node process-observation evidence.
The merge preserves both changelog entries, both dated archived evidence entries
and both links in the existing M3 row. M3 remains partial. Historical rollout
statements remain dated evidence; this merge does not rewrite them as current
acceptance.

The integration crypto implementation, two rotation test files and mechanical
documentation tests match exact prior head `9d75524fa`. No conflict changes their
bytes. The separate consumer review remains preserved in
[its report](../2026-10-15-integration-rotation-consumer-independent/STATUS.md).

From the actual nested package, the parent reruns 21 cases in three files:
13 crypto rotation cases, two combined consumer cases and six mechanical
documentation cases. All pass with one worker in a transient 1 GiB scope with
swap disabled. The journal reports a 250.3 MiB memory peak. The product-direction
check passes with the existing review reminders. Staged whitespace checks pass.
No test or guard changes in this merge, so the earlier targeted-fault and
harmless-survivor evidence remains bound to unchanged test and consumer bytes.

These checks do not establish full CI, hosted secret rotation, actual queue
recovery or independent-host restore. The integrated head needs fresh GitHub
checks. Main's production delivery hold remains separate from branch conflict
resolution. No hosted key or setting changes, schema application, release tag
or main merge occurs for PR 328 here.

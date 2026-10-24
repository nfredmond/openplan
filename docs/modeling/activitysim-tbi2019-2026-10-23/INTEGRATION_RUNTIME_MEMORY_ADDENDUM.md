# Runtime memory addendum, 2026-10-23

Both initial model arms exceed the 6 GiB cap during household/person
initialization. Neither produces completed tours. Their logs, started receipts,
scope failures and output directories remain separately retained.

The next preparation attempt uses ActivitySim 1.5.1's installed
`MemMapSkimFactory` through an explicit `network_los.yaml` overlay. It reads the
same 826 matrices, ordered zones and values from disk on demand. Both arms retain
the same 638-zone population, coefficients, random seed, float precision, model
sequence, adaptive chunk settings and 6 GiB/zero-swap scope. No installed package
or repository default changes. The cache belongs to each new output directory.

The native parity record checks all real matrix values through both installed
factories, using their existing float32 runtime representation. Reverse traversal
is the harmless control. Corrupting one cache value must fail; restoring it must
restore the complete cache hash. This establishes skim-value parity only, not
behavioral equivalence, completed model execution or scientific validity.

The original input archive and its custody remain retained. Any updated runtime
archive receives a new hash and inventory. The frozen opening remains closed.

## Allocator reclamation attempt, recorded before execution

Both memory-mapped attempts pass initialization and university location choice,
then exceed the same cap while computing high-school location logsums for
2,315,528 sampled rows. Both failure directories and receipts remain retained.

A candidate grouped batching wrapper fails native exact parity on one work
logsum, differing by one floating-point unit. Its passing unit controls do not
admit it. The candidate and failed native logs remain retained; neither model
arm uses it. No numerical comparison tolerance changes.

The next attempt runs Python garbage collection and glibc `malloc_trim(0)` before
each unchanged location-logsum function call. It preserves call arguments,
object identity, random-number calls, coefficients and return values. The runner
pins ActivitySim 1.5.1 and the installed location-choice source hash. It changes
no installed file. Both arms use this same process-local wrapper, the same
memory-mapped skims, all retained households, and the same 6 GiB/zero-swap cap.
Three wrapper tests pass. Five mutation controls include one harmless survivor
and four intended assertion failures with exact source restoration. These
controls establish call preservation, not numerical accuracy or completion.

# Check the existing private reader byte ceilings

Continue M3 above the verified private reader in PR #260. Preserve the existing
32 MiB original and 193 MiB response ceilings. Measure their actual local
behavior before any capacity claim or default activation.

Use a streamed, owned local HTTP fixture. Valid JSON whitespace brings an
otherwise valid original request to its exact byte ceiling. Escaped tabs exercise
response expansion. Additional outer JSON whitespace brings a valid receipt to
the response ceiling. Both preserve the original contract and canonical job
scope. Verify the exact original length and hash through capture, private save,
load and a relocated runtime. Recovery has no private-query or source adapter.

Check one-byte overflows independently, including declared and undeclared HTTP
lengths. Cancellation after a held first body chunk must join the child and
leave no local original. Keep response refusal, original refusal and downstream
defenses distinct. Use harmless comments and selected faults, restore sources
in finally and retain failed trials.

Run each owned proof serially under one GiB, one CPU and no extra swap. Record
memory, OOM events, actual elapsed time and source bindings. This fixture does
not establish a hosted gateway or database ceiling, native engine capacity,
full installation recovery, maximum concurrency, power-loss durability,
browser acceptance, practitioner usefulness or scientific validity.

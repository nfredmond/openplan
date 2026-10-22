# Reproduce aerial-worker admission loss before processing

M3 requires recoverable accepted work. The current aerial worker keeps its job
registry and NodeODM task identity in memory. Reproduce the admission boundary
before changing implementation or making a recovery claim.

Start unchanged `main.main()` with owned loopback intake/callback listeners,
explicit fixture tokens, a private persistent root, one queued task, disabled
proxies and a NodeODM URL pointing only to the owned refusal fixture. The wrapper
selects an ephemeral loopback server through the existing builder. Do not import
worker test modules, replace the pipeline or start a reconstruction engine.

Hold the first imagery request before response headers/body. Submit a second
request and retain its actual 202 admission. Replay it before interruption and
observe the original receipt. Record the response to changed metadata under that
same request ID without treating it as permission to change custody.

Interrupt only the owned worker. Capture its full stopped root with the existing
snapshot CLI and independently verify ordinary files/directories/modes. Start a
fresh runtime copy. Submit the exact original queued-request bytes. Determine
whether it recovers the original admission or creates a new job/reference.
Keep imagery responses held until both workers stop, so no image bytes or engine
requests are consumed. Record source and engine counters rather than infer them.

The proof oracle must reject observations that conceal this defect. Run baseline,
harmless and restored controls plus targeted broken observations. Stop all owned
children/listeners in finally and retain original source, immutable package,
receipts, executed hashes and failures. This is an admission counterexample,
not photogrammetry, artifact quality, successful recovery or public acceptance.
Do not change deployment/worker contracts or lift the relaunch owner's hold.

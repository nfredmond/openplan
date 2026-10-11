# Distinct transit and equity panel identity

October 10 candidate correction. Browser verification at `3132cdddb9f8` found a defect that the prior component checks missed. The transit and Title VI components were siblings with the same account/workspace React key. The browser console reported duplicate keys. Repeated server refreshes left 11 managed transit sections in the DOM instead of one. The app was stopped before source changes.

The two keys now include distinct `transit` and `equity` prefixes. Each still binds the actual workspace and session actor. A server reread retains the transit controller and unfinished policy edits within that scope. Switching accounts or workspaces resets those components. A new source guard checks that the sibling keys differ. Its targeted mutation gives equity the transit key and must fail at that assertion.

This source guard checks the actual page mount and catches the reproduced key collision. It does not render the complete server page or establish browser reconciliation. The corrected build still needs an identified-build T3 journey, including one-panel cardinality after progress reads and adoption.

During the same failed journey, the isolated PostgREST container exited at its 128 MiB memory limit. Docker reported an exit code of 137 without its OOM flag; the kernel log identifies the memory cgroup kill. Only that owned container was restarted, and its cap was raised to 256 MiB with swap disabled. Data Hub then reached the application error boundary and recovered through Try again. This adjustment is proof-topology evidence, not production capacity acceptance. The demo and other agent services were not targets.

The prior checkpoint and its green tests remain dated evidence. They do not establish acceptance of either defect. No migration, worker parsing, adoption policy, service classification or scientific claim changes here.

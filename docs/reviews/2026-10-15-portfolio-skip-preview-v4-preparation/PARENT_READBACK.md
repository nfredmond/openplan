# V4 execution remains on hold

The parent reads the preparation report, ordered recipe, manifest, all five
runtime diffs, assembled helper, application controller, runner, attestor and
control drivers. A fresh independent Sol-high packet review is running. The
preparation commit is joined as `30b2a83ba`; this join does not approve execution.

The parent checks 256 bindings, including all 25 sealed inputs, five matching
public/private templates, 216 protected files and modes, the original retained
dump, absent candidate and runtime/upgrade receipts, and empty execution
directory. The saved control results contain 74 observations, with 20 survivors
and 54 refusals. The parent reads those results without rerunning the campaign.
These checks do not establish live database state or a new runtime.

## A cleared environment blocks the new preservation check

The new helper's `unchanged_inputs()` calls `preserve()`, which calls
`protected_web()`. That function uses `subprocess.run` to call
`systemctl --user` with the inherited environment. The helper's direct entry
point supplies `XDG_RUNTIME_DIR`, but the application controller and attestor
clear their environment without supplying it. Their imported helper does not
run the helper's entry point.

A read-only query of the existing owned web unit reproduces the boundary. With
the cleared application environment, it exits 1 and reports:

```text
Failed to connect to user scope bus via local transport: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined (consider using --machine=<user>@.host --user to connect to bus of other user)
```

The same query with the fixed `/run/user/<current uid>` runtime directory exits
0 and reads the original active unit invocation
`34615ba06b554482b0f79c90fe999a61`. The parent sends this finding to the running
reviewer for independent assessment. No sealed packet is edited and no operating
stage runs. The correction still needs a new sealed version and review before
execution; the exact correction remains subject to the completed review.

Private readback:
`portfolio-skip-preview-v4-parent-readback-20261015/readback.json`, SHA-256
`35f24effc1527ce9211c09ffafe9d060af2892f10ad499f5565b78cfbc18c3f4`.
The existing preview, retained databases, original failures and canonical
unrelated files remain outside this write scope. No corrected browser import,
new build, hosted migration, main merge or release is claimed.

## Completed review requires three corrections

The parent reads the complete independent review
`b037efc892359dcbd5350eb64438604610713ca5`, its control driver, 23 observations
and execution records. It joins as `172695e47` with changes required. The parent
accepts all three P2 findings: the imported user-bus environment, the absent
post-journey preservation/result path, and the initial constraint comparator
that accepts an unconditional expression retaining the required phrase.

The three public/private review files match, and all 36 recorded immediate V4
files remain hash-identical. The 16 surviving observations include deliberate
hazard specimens. They are findings, not a clean acceptance score. No independent
campaign is rerun by the parent.

The parent also tests the unresolved observer context with read-only commands.
With the fixed current-uid runtime path, both the host and exact outer wrapper
read the original active web invocation. The host sees listener PID 4104299 and
can read its environment. The wrapper sees the listening socket without a PID,
and the environment read fails with `PermissionError`, errno 13. Their user
namespaces differ. Fixing the runtime path alone therefore cannot resolve the
imported observer's complete call chain.

The context record is `observer-context.json`, SHA-256
`51d4f36c34966d36839d2f9d14d73b7acab7748408cbcc4c7b0d2a601ac30fea`.
The review readback is `round1-readback.json`, SHA-256
`8577d398dffb851103ccb8d0fede251357eb62619735e2db42abc48bf2253c1a`.
Both sit beside the original private readback.

The original preparation agent owns a new V5 correction packet only. Its scope
requires a fixed host observer while retaining strict process checks and the
outer read-only confinement, an explicit final preservation receipt, and complete
independently bound CHECK definitions before the first upgrade receipt. V4 stays
unchanged. Fresh independent review precedes operating execution.

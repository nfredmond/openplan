# Keep the upload fault deadline out of normal recovery

Claude reports a shuffled failure with seed 745488 in run 38332043709. The actual
failed job 115083745720 places the unconfirmed-archive error at line 229, the second
retry. The fixture keeps its 15 ms fault deadline for that normal retry. Its normal
mock also performs real file reads. The failure traceback gives no per-request timing, so the
particular delayed operation remains unknown.

Adding 50 ms of controlled normal-recovery latency reproduces the same unconfirmed
error with the preceding deadline choice. The fixture now restores its original
normal deadline before that recovery phase. The first ignored upload keeps its
15 ms deadline. A new observation checks that its external signal aborts before
archive reconciliation, rather than passing merely because final cleanup aborts.
The retry still must reuse saved bytes and fetch the original URL only once.
Production intake, deadlines, cancellation, custody and flags remain unchanged.

The [controller](verify_controls.py) passes seven checks. Five baseline, harmless,
restored and full-suite controls survive. Keeping the short fault deadline on
normal recovery fails with the unconfirmed-archive error. Giving the upload only
the ownership signal fails the named before-reconciliation cancellation assertion.
Both mutations restore exactly. The 18 classifier controls reject zero exits,
wrong test/count/error type, reasons appearing only in source and extra unhandled
errors. All 38 intake cases pass.

The [follow-up](evidence/followup-results.json) passes 58 intake/documentation cases
in shuffled order with seed 745488, scoped TypeScript, changed-file lint and
product direction. Both owned 1 GiB units stop. Their peaks are206,012,416 and
394,194,944 bytes, with zero max/OOM events and no extra swap. See the actual
[control resources](evidence/control-resources.json) and
[follow-up resources](evidence/followup-resources.json).

These are mocked Storage transports with real private local file I/O. They prove
the selected cancellation/recovery fixture boundaries, not public TLS, actual
Storage service behavior, live RLS, operational capacity or browser acceptance.
This is not a repeat of the already established late-upload reconciliation work.
No hosted write, migration, worker activation or release is introduced. The full
current-head CI and combined integration remain separate before landing through
PR #263. Existing M3 and the complete v1 contract remain open.

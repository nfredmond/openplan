# Governed decision handoff browser proof - 2026-08-28

- Local guard passed for local governed decision handoff smoke: app=http://localhost:3200, supabase=http://127.0.0.1:54321.
- Project: California small-agency handoff 040042 (4a420a97-7171-4158-88d6-39652428917c)
- outcomeReached: "yes"
- Desktop and 390px paths passed through Projects, Evidence, My Work, return, replacement, approval, bundle download, and receipt download.
- The approver began with a different active workspace. My Work found the caller-assigned package through RLS, showed the waiting-work notice, and the direct switch opened the exact review.
- The visible approved bundle SHA-256 matched the downloaded ZIP bytes, and the visible receipt SHA-256 matched the exact downloaded receipt bytes.
- The approved downloaded ZIP passed sha256sum, jq, and ogrinfo. The receipt named that exact bundle hash and retained false publication, adoption, and model-validation flags.
- Browser console and uncaught page errors: none.

## Artifacts

- docs/ops/2026-08-28-test-output/2026-08-28-governed-handoff-01-frozen-desktop.png
- docs/ops/2026-08-28-test-output/2026-08-28-governed-handoff-02-submitted-desktop.png
- docs/ops/2026-08-28-test-output/2026-08-28-governed-handoff-02a-cross-workspace-notice-desktop.png
- docs/ops/2026-08-28-test-output/2026-08-28-governed-handoff-03-returned-desktop.png
- docs/ops/2026-08-28-test-output/2026-08-28-governed-handoff-04-approved-desktop.png
- docs/ops/2026-08-28-test-output/2026-08-28-governed-handoff-05-approved-390px.png
- docs/ops/2026-08-28-test-output/2026-08-28-governed-handoff-print.pdf
- docs/ops/2026-08-28-test-output/2026-08-28-governed-approved-bundle.zip
- docs/ops/2026-08-28-test-output/2026-08-28-governed-approval-receipt.json

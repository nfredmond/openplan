# OpenPlan Production QA Cleanup — 2026-03-17

- Started: 2026-03-17T20:15:04.176Z
- Created-after filter: 2026-03-17
- QA match rule: /qa|proof|trace|canary|debug/i

## Executive summary
A deliberate cleanup pass removed the full set of obvious QA/debug/proof/trace/canary production records created on 2026-03-17, deleted the corresponding auth users, and expired the associated open Stripe Checkout sessions.

Result:
- targeted QA workspaces removed,
- targeted QA auth users removed,
- targeted open checkout sessions expired,
- no matching QA workspaces or QA auth users remained after verification.

## Scope
- Targeted QA/debug/proof/trace/canary production records created on or after 2026-03-17.
- Targeted workspaces: 41
- Targeted projects: 22
- Targeted reports: 4
- Targeted engagement campaigns: 10
- Targeted auth users: 19

## Stripe cleanup
All 20 targeted live Checkout sessions were expired after the app-row cleanup pass:
- cs_live_a1KfVA9Q4Kxm4f5hfmmjPRmn2ICVgeKwdN0hz3GXWenzTOaR8I80avEyO8
- cs_live_a1HZ9DWXk8WEkDLBxEX5i7FIg3VSo2mK77MWy8M9qS7LGvKJbngppAE3h3
- cs_live_a1TxNZCl2eC0ct8RrTNhzGf3N7qVq6ry5GEnvEvWprAPfuVJXJJ94ahveC
- cs_live_a1NEGyjSMwUPwCFEo76NSh89bmkhf8AUyx1b4jNum1GIY7WBGTXZ0ToG7w
- cs_live_a18GKjRBlU30SVIx5EoujwqzLCvzU1ItWYmodvH4dg3b5d6BIx5CYFy5ZE
- cs_live_a1ocM6c8vFbFohRTxyouPEKO348ME7i7ETz6yP1233eMxX0jxVo5RI72GH
- cs_live_a13F2duh9y71yDF3xSAWo4nsDJ03Xk36MaXRSijfBNbqJImMg0uhwe59jK
- cs_live_a14V61Flb8wtcCFbcfPjPdDkAQMXmzLo68D9ZqXlPhSQYLCRj8nzxNSctn
- cs_live_a1jtzwb2mXij5G2HYlQxkO9Gs0R1R8l9QRjfuBd5TQzqPoaz2dQRVf1C4X
- cs_live_a1kazlsAMoFnjXGqHNBCEetQ3ODCeqWRmuimGdy5teDDVAQoTVGf8yIIpq
- cs_live_a1RUMI9m97mMcYRIvvPA0NmKT0xC5l1t1VCD84NLXJ3cOHvaMHf19EZchM
- cs_live_a1pultmScjOQs3CDElEfpoXVdUmRhjIFyFegwrWfD2fzDVKSUvrUy5lvJs
- cs_live_a15mrHuL0ZdANWUnKsBPfVy81DpZdK4ogj3r2kiJNFvAMNXce8jgPUbjdk
- cs_live_a1nn4SCijqDOYYh3Hr50a2QLyI0aem2vA31D08Tk03y117iW1FGaSty3CD
- cs_live_a14AjeFR69vAcz3pY6vcMRTerNLMDn77BK33Jv10qrfBnzhN3DG1QCeB7T
- cs_live_a1QPPgkxjB04RYwzVRz6l5kkuALlPAwnJLCVj8yEqyd906CGqb962T5SpC
- cs_live_a1r0hSU38AJ561PYDeWKL1m8w4p6lrARIm9UCyPaHniaSyE5EZz2X1tW1z
- cs_live_a1Qw9qwN0eFPKOW8YKeq6bL0bE3HF2pjK8XSHCAl5clJzAqjy4GsN0pYmU
- cs_live_a1MI9tmvXOp0LQg2uK1frxVswjr0Fh0TFEM9lluftpGfJF6MsJ5LZo7edF
- cs_live_a1ovUzYUKS9Gx0BJJgIBp9OM81EtZgFLHOiha4X28LdpxitxPzW6Gq9Dw5

## Delete results
- `report_artifacts`: deleted 1
- `report_sections`: deleted 16
- `engagement_items`: deleted 9
- `engagement_categories`: deleted 10
- `plans`: deleted 1
- `models`: deleted 1
- `programs`: deleted 1
- `billing_events`: deleted 20
- `engagement_campaigns`: deleted 10
- `reports`: deleted 4
- `projects`: deleted 22
- `workspace_members`: deleted 41
- `workspaces`: deleted 41

## Auth deletes
- Deleted 19 matching auth users.

## Verification
- Remaining matching workspaces: 0
- Remaining matching auth users: 0

## Notes
- This cleanup intentionally targeted obvious test-only records and QA identities, not user-authored production workspaces.
- Historical evidence remains in repo-side docs/screenshots even after production row cleanup.
- Canonical machine-readable summary: `docs/ops/2026-03-17-test-output/2026-03-17-qa-cleanup-summary.json`.

# v0.58.1 publication

Published September 13, 2026 at 20:05:51 UTC:
https://github.com/nfredmond/openplan/releases/tag/v0.58.1

The annotated tag dereferences locally and remotely to
`b330bcc8785dfbe54b6a591c7aafdf7ab321b8da`. GitHub reports the release published,
neither draft nor prerelease. All jobs in each required workflow passed on that
exact commit before tagging:

- [CI, including full QA, shuffled tests, workers, modeling and operations](https://github.com/nfredmond/openplan/actions/runs/34778941590)
- [RLS isolation](https://github.com/nfredmond/openplan/actions/runs/34778941592)
- [Populated upgrade from v0.58.0](https://github.com/nfredmond/openplan/actions/runs/34778947466)

VERIFICATION.md retains production browser identity, actual signup/invitation
navigation at desktop and narrow widths, adverse controls, local checks and
console limits. Application and worker source is unchanged between browser
candidate 1eef5f49 and the release commit. No migration is added. The fix landed
directly on main, with no PR or human review gate. The original checkout and demo
were left untouched.

The larger translation workflow remains unfinished and separately pushed at
`5995b05f` on `work/translation-command-workflow`. Its new recovery checkpoint
preserves an in-flight request when browser storage is deleted, corrupted or
replaced; desktop and phone browser evidence covers native deletion, download,
exact retries and retained originals. Its PENDING_STORAGE_DELETION.md records
remaining machine-acceptance, durable generation, publication, accounting,
producer-conversion and release checks. None of that unfinished branch was
merged as part of this patch. The full V1 goal remains active.

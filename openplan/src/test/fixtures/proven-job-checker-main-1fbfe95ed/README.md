# Main's proven job checker at 1fbfe95ed, frozen

`openplan/scripts/ops/capability-evidence.mjs` and the two files under
`schemas/` are byte copies from commit `1fbfe95ed`, before lane 39 moved the
first job's own rules into its definition entry. The checker finds its schemas
at `../../../schemas` from its own folder, so the folders mirror the
repository. The two files under `openplan/scripts/lib/` re-export the live
matcher and Poppler reader, which are shared and not under comparison.

`src/test/proven-job-checker-equivalence.test.ts` runs the first job's cases
through this copy and the current checker, and pins these files' hashes. Do not
edit them; to compare against a later checker, add a new frozen copy.

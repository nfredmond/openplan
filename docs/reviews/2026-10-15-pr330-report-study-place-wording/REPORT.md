# PR330 report study-place wording correction

The report figure now separates a searched study place from project jurisdiction.
Its boundary and county filter remain recoverable from the searched place.
Project jurisdiction requires a separate human declaration and assessment.
Geography does not resolve adopting authority or legal applicability.

## Ownership and source identity

- Assigned checkout: `/home/nathaniel/.t3/worktrees/openplan/t3-e444198e`.
- Branch: `t3/pr330-study-place-jurisdiction-wording`.
- Clean starting commit: `05dd3e8da4a4572437f06e771b0a2477873e681f`.
- Local fast-forward only base: `f00465a86ee546e6b261a663f4611cde7b56cb6e`.
- Base application tree: `a13c491da3ad3ba5b237ca5fa8802b236c4ef27b`.
- Owned application files: `openplan/src/lib/reports/geography-figure.ts` and
  `openplan/src/test/packet-geography-figure.test.ts`.
- Other owned files: this review directory, including controls and evidence.

The production diff changes one string in `describeStudyArea`. The test diff
strengthens one existing resolved-place test. Existing drawn and uploaded caveat
tests remain unchanged. The patch adds no place literals, geography logic,
registry rules, or legal determinations. Source comparison in
`evidence/scope.json` establishes that replacing the corrected sentence with the
original recreates the entire base helper exactly. Geometry code remains identical.

## Scoped checks and controls

Root's post-journey process initially held the shared compiler-repair lock.
Checks began after it released that lock. Each validation attempt acquired
the same lock with a bounded wait. All test runs used the actual nested
`openplan/` working directory and its unchanged `vitest.config.ts`.

Dependencies were absent in this checkout. The authorized local `node_modules`
symlink points to `/home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan/node_modules`.
No dependency installation or donor write was performed. Each case uses its own
cache below a private task directory in `/home/nathaniel/.local/state/openplan`.
The recorded Vitest configuration confirms one fork worker and the assigned
config path. `NODE_OPTIONS=--max-old-space-size=1024` applies to each test process.

Reproduction command, run from the assigned nested `openplan/` directory:

```bash
/usr/bin/flock -w 45 /home/nathaniel/.local/state/openplan/compiler-repair-checks-20261015.lock python3 -B ../docs/reviews/2026-10-15-pr330-report-study-place-wording/check_controls.py
```

Final outcomes appear in `evidence/controls.json` and the corresponding logs
and Vitest JSON reports:

- Direction check: exit 0. Existing reminders concern the jurisdiction registry,
  capability matrix and registry review dates, the reviewed package version,
  and intervening changes. No authority records were changed.
- Baseline: 20 passed, zero failed in `packet-geography-figure.test.ts`.
- Harmless comment mutation: survived, 20 passed and zero failed.
- Old inference sentence: detected, 19 passed and exactly one failed. The
  resolved-place test fails at the assertion requiring a separate human
  jurisdiction declaration and assessment. Both drawn/uploaded tests still pass.
- Restored source: 20 passed, zero failed. The source SHA-256 returns to
  `8218090f7ab3c6c39610691883021228c428c52706a80b2c506bd0251c9968aa`.
- Source restoration occurs in `finally` for every case and the overall run.

Two control setup failures remain visible. The initial runner config loader
rejects the existing `__dirname` reference before collecting tests. The standard
bundled loader evaluates this package's CommonJS config in memory and resolves
that startup issue without source changes. A subsequent control-script summary
assertion fails because Vitest abbreviates JSON failure messages. The actual
test already fails for the intended reason. The corrected control checks the
full expected text in stderr. The `initial-*` evidence files preserve both
failures. Final controls then pass through source restoration and the final run.

## Evidence limits and handoff

The strengthened assertion protects the helper's emitted resolved-place legend
copy. It cannot establish HTML/PDF placement, route integration, live data,
human jurisdiction declarations, adopting authority, or legal applicability.
The direction check examines repository authority records, not runtime behavior.
The existing geometry tests cover their fixtures; they do not prove every
possible geometry. The production diff itself establishes unchanged geometry code.

No suite, build, full TypeScript check, native export, database, service, or
browser check ran. No frozen candidate, parent source, browser evidence, archive,
or seal changed. The actual frozen f0 report/browser evidence still contains the
old sentence. This local source correction does not amend that artifact or
establish new browser acceptance. Root owns independent review and later
integration after the existing f0 browser evidence. Delivery is a local commit
only, without push, pull-request update, merge, tag, or release.

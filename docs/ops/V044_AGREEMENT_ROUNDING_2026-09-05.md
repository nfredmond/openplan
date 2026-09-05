# Agreement-map rounding correction

The complete first-week run `2026-09-05T06-37-00-799Z` was stopped during
job 05 on identified checkout `916e47bf085db80634095b6c6bfa590b4c45aa4f`.
Its ActivitySim run succeeded, but the method-sensitivity map returned HTTP 422.
The owned runner received Ctrl-C and exited 130. Raw findings are preserved;
this is an interrupted, non-passing release gate, not a completed run.

## Exact failure

- Model run: `24cb3ac6-7d3c-4fbe-8e3f-8882a46382c5`.
- GeoJSON artifact: `824542cb-d24d-4efd-9200-8061972f2afe`.
- Registered and independently computed SHA-256:
  `953bc70b7a6a17e02912fd466111110f2fa77c977e95dcaf32e105275f3581e3`.
- The artifact contains 4,513 roadway links, 1,928 with meaningful traffic.
- The central GEH values are 5.17 and 5.183. Their binary floating-point mean is
  slightly below decimal 5.1765. Python publishes 5.176; the browser verifier's
  scaled `Math.round` produced 5.177 and rejected the summary.
- All other recomputed summary fields matched. The artifact bytes were intact.

The existing shared Python-rounding helper now rounds the exact binary ratio,
including ties to even. The agreement verifier uses that helper. This follows
[Python's documented round behavior](https://docs.python.org/3/library/functions.html#round).
The helper already serves report arithmetic; those tests are included because
its former scaled-double approximation could also differ at a rounding boundary.
Only last-digit arithmetic changes. The repair does not change model assignment,
acceptance thresholds, artifact schemas, matching, custody, or stored evidence.

## Verification so far

The synthetic three-link regression uses the same two central GEH values as
the observed failure. The existing Python producer independently computed its
5.176 median. This is a labeled test fixture, not planning evidence.

- Before the fix, the integrated agreement regression failed at `invalid`
  versus `verified`. Rounding-helper cases also exposed binary-boundary and
  overflow differences.
- A comment-only mutation survived, 51 tests passed.
- Restoring the old agreement rounding failed the integrated regression.
- Changing exact ties to round away from zero failed five helper/report checks.
- Widening the summary tolerance failed the assertion that an altered 5.177
  summary must still be refused. The original tolerance is restored.
- The restored five-suite run passed 94 tests.
- A deterministic 40,000-case comparison against local CPython matched. It
  covers signed values at and beside decimal boundaries for zero to four digits.
- The corrected verifier accepts the unchanged actual artifact above, preserving
  all separate method values and its 5.176 median.

Local logs are under `/tmp/openplan-v044-rounding-*`. The oracle and durable
continuation notes are in
`/home/nathaniel/.local/state/openplan/release-checks/v044-2026-09-05/`.
These arithmetic checks cannot establish UI reachability, tenant isolation,
model accuracy, or completeness of the twelve planner outcomes. Rebuilt browser
proof, full QA, and remote CI remain required.

## Other evidence from the interrupted run

Four jobs completed with an explicit yes, exit zero, and no console errors:
first-day setup, neutral-geography setup, project handoff, and engagement.
Neutral geography exercised Benton County, Oregon, and Ponce, Puerto Rico.
Unsupported legal review stayed disclosed; no jurisdiction substitution appeared.

The project board packet was downloaded and all nine rendered pages inspected.
It preserves USD 4,200,000, an unknown cost price year, and its CSV source.
PDF SHA-256:
`ad2571a03a1c0a67219d6ee66800775ee1fc26f816564721e4b24372f08e70d9`.
The actual project ZIP has SHA-256
`25154e48d316f997ad1f8305c906c50a3a2568d0fc4d2fdd9c268b77792a13f6`.
All nine checksummed members matched and all ten GeoPackage layers opened.
The standalone and bundled jurisdiction-readiness objects matched in full;
their serialization bytes differ. A no-op archive control survived and altered
project bytes failed their checksum. This does not independently validate every
source claim inside the archive.

Engagement saved and moderated an actual exercise comment. Its resident receipt
was inspected at 390px and the approved item at desktop. The public comment
remained visible when signed out. The geography-status wording defect remains.

Safety completed with a **partial** outcome, exit zero, and no console errors.
Two fresh acquisitions each retain their own 4,123 crash and 5,729 person rows.
The downloaded extract has 1,408 unique crashes, including 63 fatal and 298
serious-injury crashes. Requested years, exclusions, and acquisition identity
remain explicit. CSV SHA-256:
`5d2a5ff15c1ed1ce2cc48629ad4c7bef2e7fabd56f92ef9a856cd58f0d3fc9da`.
GeoJSON SHA-256:
`6ffc3a938ea8a2cf26caf411a25bb26ccfdb19166cd174e0ee6e01be080832a8`.
All twelve Safety packet pages were inspected. PDF SHA-256:
`72c418c79bf5fe3142e25b80bfce44a8dc3d346b2be11ec50f848d80c1a6c781`.
The tester withheld yes because reviewed site treatments, costs, and casualty
reductions were not established. No such source inputs were supplied by this
exercise. A product-scope question is pending; neither its rubric nor its
partial result has been changed. Do not invent treatment or benefit evidence.

Both packets retain awkward page breaks and mostly empty final pages. Their
content checks do not establish flawless print layout. These remain issue 032.
Jobs 06 through 11 did not start before the agreement-map interruption.

## Release boundary

Remote CI `33949904959` and RLS `33949905024` succeeded for 916e47bf.
Its local QA passed 12,881 app tests, 135 live RLS checks, production dependency
audit, and build. Those results precede this rounding correction.
Upgrade run `33949211278` passed with the same current migration bytes.

The refreshed full dependency audit is **not clean**: ten development-package
advisories, two high, six moderate, two low. The production-only audit reports
zero. High findings are in Browserslist and fast-uri through development tools.
They require separate dependency maintenance; the production audit is not proof
that development dependencies are clean.

The distributed-loading candidate stays retired and inconclusive. No defaults,
frozen v0.39 through v0.43 studies, holdouts, or scientific acceptance rules
were changed. No v0.44 tag may be inferred from this checkpoint.

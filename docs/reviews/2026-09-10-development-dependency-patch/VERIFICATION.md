# Development dependency patch, v0.52.1

v0.52.0 was published before this increment. Its production audit passed; the
complete audit reported 14 affected development packages at publication, including
three rated high. The patched lockfile audit initially cleared all but an esbuild
advisory. Updating tsx within its existing major allowed the patched esbuild and
cleared that last finding. No forced major upgrade or dependency removal was used.

The qs override advances from 6.15.3 to 6.16.0. Vitest stays on 4.1 and advances to
4.1.11. The existing connector, application routes and migrations are unchanged.
Browserslist's required caniuse-lite data is shared with the production dependency
tree, so this record does not claim that every changed lockfile entry is dev-only.
The build and narrow browser layout will be checked before release.

QA now runs the complete npm audit at low severity. The old production-only audit
could not see these development dependencies. Audit counts describe the registry
response at the recorded time, not proof that undisclosed vulnerabilities cannot
exist. Native runtime isolation, scientific accuracy and agency usefulness remain
separate evidence categories.

## Sources and checks

The npm registry supplied compatible versions. Relevant upstream advisories include
[Vitest redirect-file access](https://github.com/advisories/GHSA-82fw-gwwq-j7x9),
[qs object parsing](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g), and
[js-yaml merge limits](https://github.com/advisories/GHSA-2883-xcg3-v3hh).
Original audit JSON and lockfiles are retained in the private dependency-patch
evidence directory. Mutation, QA, browser and final CI results follow below.

## Local acceptance at 63bb31e42b93

A fresh `npm ci` completed and the complete audit reported zero vulnerabilities.
Full QA passed lint, unused-code checks, 13,748 tests with 357 named skips,
31 connector tests with two named native-only skips, the audit and production
build. Shuffled seed 9100521 passed the same 13,748 tests. The 379 live RLS tests
passed on the explicitly named disposable openplan-restore-target-2026091050
stack. This fresh checkout does not have the optional Python runtime environments;
its seven additional named main-suite skips match the CI environment. Worker
source is unchanged from v0.52.0, which retains its separate worker/native evidence.
[Local receipt](local-checks.json) records hashes of the original private logs.

The [audit controls](audit-controls.json) passed with a harmless package description,
failed on the actual v0.52.0 manifest and lockfile with 14 findings, and demonstrated
that the old production-only audit incorrectly stayed green for that same fixture.
The [release guard](release-controls.json) survived a harmless comment, failed for
a wrong migration count and passed again after restoration. The final manifest
still has 314 migrations and this patch adds none.

Chrome 152 entered through home, sign-in, Dashboard and Projects at desktop and
390px, including keyboard navigation. The first launch omitted the commit stamp;
the identity guard refused it. A short eight-character stamp was also refused.
Both owned attempts were stopped. The final launch used the full source SHA,
matched the build checkout and listening process, and only then collected browser
evidence. No source changed during the build or browser collection.

Both journeys preserved the original native answer, showed private-history counts
without exposing content, and issued no deletion or provider request. The narrow
refusal fitted its own container and remained readable in inspected screenshots.
A harmless attribute preserved the layout; deliberately removing wrapping failed
the geometry check, and restoration passed. The injected unavailable preflight
showed a visible refusal and no deletion dialog/request. Normal console output was
clean; the only captured error was the injected 503. The owned server was stopped
before this evidence was added. These journeys check the rebuilt shared layout;
they do not re-establish all product workflows or add a native backend.

## Published release

[v0.52.1](https://github.com/nfredmond/openplan/releases/tag/v0.52.1) was published
at 2026-09-10 16:24:55 UTC from `5d7ccdb067bb4db639132889f8efd5db160dfc6b`.
All seven exact-commit checks passed before tagging. Full QA and shuffled seed
406370 each passed 13,748 tests with 357 named skips; connector checks passed 31
with two separately exercised native skips. The complete dependency audit reported
zero vulnerabilities. RLS passed 379 tests in 46 files. All Python CI jobs passed.
The populated upgrade from v0.52.0 preserved custody hashes and row counts
`2:2:1:1:1:1:1` before and after. The remote annotated tag resolves to the same
commit. [Publication receipt](release-ci.json) retains check links and log hashes.

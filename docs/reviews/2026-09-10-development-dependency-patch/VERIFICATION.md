# Development dependency patch candidate

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

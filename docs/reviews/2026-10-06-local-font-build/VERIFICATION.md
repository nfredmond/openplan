# Remove the font-download build dependency

PR #117 at `408e6e9f` passes 18,387 tests in the GitHub QA job, with 1,525 skips.
The final production build fails in Next.js 16.3.8's Google Fonts loader at
`google/loader.js:122`. The loader calls a file-extension regular expression and
reads capture group 1 without checking for a match. The CI log reports a null
match; it does not retain the offending URL. The shuffled test job passes.
This is a failed QA gate, not a passing release.

A fresh live CSS probe for both configured families returns URLs with supported
extensions. That probe does not reproduce the original response or explain its
origin. Local production builds of `408e6e9f` and `103a67fd` also pass. A retry
might pass, but it would retain the remote input dependency.

## Repair

The repair uses `next/font/local` with pinned, unmodified fonts from the Google
Fonts repository. Each original SIL Open Font License notice stays beside its
font. The families and upstream versions match the downloaded files in the
successful `103a67fd` build. Existing CSS variables, requested weights and swap
behavior remain in use. No new dependency or service is required.

FontTools inspection compares the existing downloaded subsets with the full
font files. Space Grotesk retains all 634 code points in the old subset union;
its full font contains 735. JetBrains Mono retains all 663 prior code points;
its full font contains 976. Default glyph advance widths agree for every shared
code point. These are file-level checks, not a rendered typography assessment.

## Verification boundaries

The updated source-wiring test passes. A harmless comment survives. Returning to
the remote import, duplicating the display declaration, and separating the body
font variable each fail the stated source assertions. Source restoration is
verified. Changed-source ESLint and the restored baseline test pass. The Git
attributes retain upstream license bytes, including original line endings and
spaces; generated log copies have trailing whitespace removed for review. These checks cannot establish font loading or browser layout.

An actual production-build control blocks `fonts.googleapis.com` and
`fonts.gstatic.com` in Node's HTTP request API. It first uses the original
committed layout, then restores the local-font layout. The original build fails with eight blocked font requests. The local-font build
passes with zero blocked requests. Both emitted TTF assets match their pinned
source SHA-256 values. Results and logs are retained in [evidence](evidence/). This control changes only the
owned verification checkout and does not weaken production network behavior.

Browser screenshots remain unavailable through the current T3 preview session.
No visual, keyboard or accessibility acceptance is claimed for this repair.
The prior font-download failure remains in the record. Exact-head GitHub checks
and an identified clean-checkout production build remain required before landing.

# Grant catalog search candidate

October 18, 2026. Base: `239a152a1195ca86dc50fc89aa284556974d43fc`.
Scope: M13e/B4 catalog search in the existing [delivery plan](../2026-10-12-two-month-review/PLAN.md#b4-grants-that-reach-submission-v072).

Search matches every query word against displayed program names, agencies,
project types, summaries, applicant/match/cycle/benefit-cost text, level and
registry-derived jurisdiction badges. Blank searches retain the complete catalog.
Counts, Clear search and an empty-result message accompany the labeled input.
Coverage disclosures remain outside results. Matches do not establish eligibility
or an open call. Program records, links and tracking requests remain unchanged.

Checks: 23 focused tests across the existing catalog/coverage component suites
and new search suite; scoped ESLint and TypeScript. One worker, private caches,
768 MiB Node heap and the nonblocking shared compiler lock constrain checks.
The harmless comment mutation survives five tests; bypassing the filter fails
three intended assertions. Exact helper bytes are restored before the final run.
Private logs, including initial harness corrections and lock contention, remain
at `/tmp/openplan-catalog-search-20261018-7ekpijqz`.

These checks establish pure and jsdom behavior. Root still owns identified-build
navigation, desktop/390px, keyboard and browser console acceptance. No database,
build, full suite, worker or model operation runs in this implementation task.

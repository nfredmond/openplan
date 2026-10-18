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

## Root integration

Root reviews the search implementation and joins the current-area Safety
message correction plus the launcher/CI follow-up. All 62 focused checks pass
across six search, registry, coverage and Safety files. The join preserves both
dated ops notes. Product direction passes with existing review reminders.
Desktop, phone and keyboard browser acceptance remain pending. Available memory
is below the earlier preview reserve, so no new server or failed-run retry starts.

## Identified browser check and mobile correction

Build `4229c9cbb567` passes normal Dashboard-to-Grants navigation, search,
keyboard clearing, empty-state and restore checks at desktop and 390 pixels.
The catalog starts with 35 programs; HSIP narrows it to one; clearing restores
35. The jurisdiction warning remains unchanged. Expanding the existing details
shows the official program link. No opportunity is created or funding data edited.

Root inspects the desktop, phone and focused-card images. A mobile correction
gives program text the full row and places its action below. The real text
column measures 274 of 274 available pixels. A harmless DOM annotation survives;
removing the responsive class fails the named layout assertion, then restores.
All 39 focused catalog and copy checks across six files pass, with scoped lint.

No page error, console error, failed HTTP response or horizontal overflow is
observed. One background aerial-catalog request is canceled during navigation,
so the saved whole-journey classifier remains false. Earlier failed browser and
OOM records remain unchanged; their hidden-link locator is corrected by checking
visible program rows and opening details explicitly. The isolated 3 GiB preview
stops normally after capture. Raw images, logs and resource observations remain
private. New-head CI, hosted delivery, live grant discovery, deadline alerts and
SS4A seeding remain separate requirements. No milestone or scientific claim closes.

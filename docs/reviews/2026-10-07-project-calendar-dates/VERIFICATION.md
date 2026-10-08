# Project calendar dates

The prior identified T3 award journey displays a December 15 milestone as
December 14 at 4 PM Pacific in Project Delivery. My Work displays December 15.
The project helper parses date-only strings as midnight UTC and then formats
them as local timestamps, inventing a time and shifting the recorded day.

The project helper now recognizes exact YYYY-MM-DD input, verifies the calendar
round trip and uses the existing date-only work-deadline formatter. Invalid
calendar dates remain the original visible value. Inputs with a time retain the
existing local timestamp behavior. This changes presentation only, not stored
records, deadline comparison, due-time policy or funding compliance.

Ten targeted tests run separately under UTC, America/Los_Angeles and
Pacific/Kiritimati. All pass. They include year transition, leap day, daylight
saving transition, invalid calendar dates, absent values and an actual timestamp.
The original implementation fails six tests in Pacific time. The existing project
page and controls suites pass all 69 tests. Targeted ESLint and diff checks pass.
A harmless comment passes. Restoring local calendar conversion, accepting
normalized invalid dates or stripping timestamp time each fails a targeted check.
All mutations are restored. Logs are in the local state directory
project-calendar-dates-20261007-proof.

Production build, identified desktop/390px T3 verification, console review and
GitHub checks remain pending. The earlier observation establishes the defect,
not rendered acceptance of this correction. Other date formatters and deadline
comparison semantics are outside this helper change and require their own audit.

## Identified browser acceptance

Implementation d7d116ed passes the production webpack build, TypeScript and
137 static pages. Build ID is `I8KmVdgX_jAlbc_zGXfJ6`. The owned port 3508
server reports this commit and its PID cwd matches the isolated checkout.

T3 navigation from the existing synthetic project to Delivery shows December 15
in the next-milestone summary, deadline queue and milestone target card, without
inventing a time. The same persisted record previously displayed December 14
at 4 PM Pacific. No stored record changes during this check. Desktop 1440 by
900 and mobile 390 by 844 screenshots are inspected. Mobile document width is
390, and the displayed date and record controls fit. The page contains no prior
December 14 label after navigation settles. Timestamp behavior remains covered
by the three-time-zone test; no separate timestamp browser case is claimed.

All retained console entries are inspected through the same tab's health page;
none is new during this corrected-build journey. Older network entries remain
truncated. Private screenshots, runtime identity and diagnostics reside in
project-calendar-dates-20261007-proof/acceptance.json under local state.
GitHub checks and main integration remain pending. This synthetic visual check
does not establish a platform-wide date audit or practitioner acceptance.

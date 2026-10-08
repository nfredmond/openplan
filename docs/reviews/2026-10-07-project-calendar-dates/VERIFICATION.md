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

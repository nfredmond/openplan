# v0.46 release landing, September 8

[PR #106](https://github.com/nfredmond/openplan/pull/106) merged as
03a7efeb834d855f091910554cd885087ab4eba1. Its tree is identical to the accepted
PR head 21f64907; application-code acceptance is bound to 67345968, followed
only by evidence updates. This landing checkpoint changes documentation only.
The [v0.46.0 release](https://github.com/nfredmond/openplan/releases/tag/v0.46.0)
records publication; release tagging follows successful main checks.

## GitHub evidence

All seven checks passed on the final PR head: [QA, shuffled order and scripts](https://github.com/nfredmond/openplan/actions/runs/34203094731),
[187 isolated live database checks](https://github.com/nfredmond/openplan/actions/runs/34203094762),
and [restore drill](https://github.com/nfredmond/openplan/actions/runs/34203094843).
The merged commit also passed the [populated previous-release upgrade](https://github.com/nfredmond/openplan/actions/runs/34204719459).
Main checks are separately visible in the [merge CI run](https://github.com/nfredmond/openplan/actions/runs/34204719441)
and [main workflow history](https://github.com/nfredmond/openplan/actions?query=branch%3Amain).
These links retain job results; a push alone is not a passing check.

## Installed demo and retained predecessor

The supported safe updater built and installed 03a7efeb  / 0.46.0 at
http://localhost:3000. The web and Documents export services are active.
The production identity checker matched the merged checkout and separate demo
clone. Read-only browser navigation passed from existing test-account sign-in
through receivables, Projects, Planning contracts and the workspace engagement
register at desktop and 390px. There was no horizontal document overflow or
page error. No business fixtures were written to the demo database. Full
mutation/export acceptance remains in the isolated synthetic workspace.

The updater's receipt is locally retained at
/home/nathaniel/apps/.openplan-updates/latest.json. Its ready transaction keeps
v0.45.0  / a0aed946, including Git identity, changed source/configuration, build and
node_modules, at
/home/nathaniel/apps/.openplan-updates/6461b6b6beae4f3cb219f4fc6053e0bf/previous.
The retained Git commit, package version and runtime directories were checked.
Use the supported updater's --recover operation for this retained transaction;
do not reset the database to switch application builds.

## Runtime database upgrade

The configured local database is supabase_db_openplan, port 54322. Supabase CLI
applied all eight additive migrations. Inventory is 279, last 20260911000008.
Fingerprints of original columns in eight legacy ledger tables remained
unchanged; five tables were populated. v0.45 still signed in and opened its
receivables register against the upgraded database before application promotion.

Private fingerprints and the prior logical database dump remain under
/home/nathaniel/.local/state/openplan/backups/pre-v046-20260908. The dump SHA256
is 2c68d4916a75e1237ae9b86b7a4d681c56dcd5d3d1a7d77b8d82234d6e2cf70f.
This logical dump is not a complete database-plus-storage restore point.
The published isolated restore drill and retained demo runtime test different
boundaries. No reset, destructive migration or paid infrastructure was used.

See evidence/demo-refresh.json and evidence/demo-browser.json for sanitized
receipts, VERIFICATION.md for detailed acceptance and INDEPENDENT_REVIEW.md
for the final bounded review. M11, practitioner usefulness, scheduling, funder
forms, accounting replacement and closeout remain open.

# Exact approval recovery and interface candidate

September 27, 2026. This candidate connects exact staff synthesis approval to the retained review inspector. It is not released. Approval concerns an exact private staff draft; it does not publish findings, establish representative support or grant agency authority.

The authenticated API binds the route, current staff account and workspace to the command, verifies origin, caps streamed input at 16,384 bytes, rejects invalid UTF-8 and assistant markers, and returns private, uncached exact event packets. Reasons are excluded from audit metadata. Read failures preserve access, missing-record, conflict and unavailable distinctions through the existing server.

Browser recovery keeps an account/source/review-scoped reason and frozen command. Writes compare earlier storage bytes and confirm the new bytes. Unreadable or quota-failed state must be preserved before continuing. A confirmed receipt names its original revision even after a correction. Parent-owned memory retains quota-failed text through inspector revalidation. Account/access loss clears private interface state. Corrections do not inherit approval; staff can explicitly withdraw the original and approve the current saved revision.

## Focused evidence

- Recovery: 37 tests; 42 proof cases, including baseline, harmless control and 40 targeted faults.
- API route: 14 tests; 30 proof cases, including baseline, harmless control and 28 targeted faults.
- Connected components: 32 tests across approval, review and source panels; 22 proof cases, including baseline, harmless control and 20 targeted faults.
- Proof manifests record expected outcomes, source restoration and hashes. Mock storage and transport do not establish native permissions, actual browser focus, layout or concurrent committed writers.

The original panel test baseline exposed ambiguous saved-review heading selectors. They now select the saved-review h4 explicitly. The first type check found unsupported Testing Library role options; removing those options preserves exact string name matching. A further test reproduced an in-flight approval timing defect: selecting a corrected revision invalidated the earlier write response and left the panel busy. Only leaving the keyed account/review scope now invalidates writes. The test observes the original receipt and then enables approval of the still-unapproved correction. Restoring the old invalidation fails that assertion. An initial effect-cleanup lint warning is resolved by the separate unmount invalidation effect.

The preceding server commit e4c2456f passed GitHub CI 36350628124, including full QA and shuffled tests, and RLS Isolation 36350628092. These checks do not cover this new API/UI candidate. Full local installed RLS passed 657 tests in 66 files earlier September 27 against the named isolated stack. No database reset or candidate migration is needed; migration 28 is installed.

## Required before release

Run final lint/types and applicable broad checks. Build and identify this candidate, then run browser-approvals.cjs at desktop and 390px through real navigation and inspect screenshots/console. Run browser-approval-concurrency.cjs against a completed browser journey for identical/competing requests, both explicit commit orders and an actual simultaneous approval/correction pair. Those scripts are prepared but have not run at this checkpoint. Do not infer browser acceptance from these component tests.

Complete final QA, shuffle, isolated database, applicable worker and upgrade evidence; inspect final release CI before tagging. Keep the complete M9b and V1 requirements. Response/decision connections, reviewed exports and optional complete resumable generation remain following work. No new human software-release approval is required.

## First broad run

Shuffled seed 619147 completed with 15,620 passing tests, 628 skips and one failure. The plain-language counter found the new sentence beginning "Approval records staff review". Its noun-oriented counter also counts this verb use. The sentence now reads "Staff approval applies to this exact saved version." All claim limits remain. No baseline or guard was weakened. The panel mutation manifest covers the preceding code; this subsequent wording change does not change its behavior. Repeat the focused component/copy tests and broad suite on the final wording. The first production build passed, but browser acceptance will use a rebuilt candidate.

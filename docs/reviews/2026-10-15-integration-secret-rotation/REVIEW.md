# Read-only source review

The separate reviewer inspected the changed source and operating instructions.
It ran no tests, services or browser. The following reports are retained as
returned. They do not establish deployment, queue or restore acceptance.

## Initial report

No concrete crypto-code defect found. Primary-only writes, authenticated fallback, retained ciphertext, and existing payer/refusal behavior remain intact.

- **P2, `SELF_HOSTING.md:114`:** Step2 can overwrite an already needed previous secret during a later rotation. Require an inventory and retirement check before replacing an occupied second slot. Two slots cannot preserve three required secrets.
- **P3, `verify_controls.py:63`:** The prepared rolling-compatibility test has no targeted broken run; filtered mutations execute other tests. Add a fault targeting that test and its own diagnostic.

I ran no tests or services. Hosted rotation, queue recovery, and restore acceptance remain unproved.

## Follow-up report

Both findings are closed. The instructions protect an occupied second slot, and the rolling-compatibility test now has a targeted fault and named assertion. The new provider revision test also checks retained identity and destination refusal.

No additional concrete defect found in the changed lines. Read-only review; I ran no tests. Hosted rotation and queue/restore acceptance remain unproved.

## GitHub review and recovery instructions

The review of `1f004f0894` identified a P2 omission in the canonical backup and
hosted recovery documents. Both named only the primary integration secret.
The correction now names the second secret when retained records depend on it,
requires protected capture and restoration to every credential reader, and
preserves keys needed by retained recovery points. The runtime source and its
tested bindings remain unchanged. The four selected test files pass 27 cases,
and both recovery links resolve. These are instruction and regression checks,
not a performed installation restore.

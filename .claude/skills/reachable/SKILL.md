---
name: reachable
description: Check that a planner can actually get to a finished capability, starting from the front door. Use before calling any user-facing work done, and when a feature is built and tested but nobody has opened it.
disable-model-invocation: true
---

# Reachable

Answer one question about a capability: **can a planner get to this, starting
from where they actually enter?**

This is OpenPlan's most recurrent defect — a complete, tested, access-gated
capability that no person can reach. Eleven or more instances. Every one of them
had passing tests, because a green suite proves the code runs, not that anyone
can run it.

## What the existing guard does and does not catch

`src/test/every-api-route-has-a-caller.test.ts` fails when a route under
`src/app/api` is referenced by nothing outside `src/app/api` and `src/test`, with
a shrink-only allowlist. It catches the crudest shape: no caller at all.

**It structurally cannot see:**

- a caller that exists but no planner can reach — behind a tab never rendered, a
  link never shown, a condition never true
- a wrong permission gate, so the capability is reachable in principle and
  refused in practice
- a missing column in a `.select()` projection, so the surface renders with the
  data silently absent

Those need a test that renders the real surface, or a person looking at it.

## Walk it

Start at the front door and navigate the way a planner does. No deep links, no
seeded fixtures standing in for the product's own data.

At each step: is the entry point actually rendered, is it enabled, and does the
permission gate let the intended role through? Then confirm the data arrives —
not that the request succeeds, but that the field being displayed is in the
projection that was requested.

The database clients here are deliberately untyped and there is no type
generation step, so a `.select()` string is not type-checked and a column typo
surfaces at runtime as an absence rather than an error. Assert on the projection
string itself; a mocked client cannot catch a missing column.

Where the check is visual or spatial, call the Skill tool with "openplan-browser"
for how to launch it, and look.

## Extract what two surfaces share

**A shared capability living inside one of its two callers will be reimplemented
wrongly by the other.** That is the structural cause behind the sharpest instance
of this defect: an operator-text renderer was a private helper inside the full
public page, so the embed surface could not reach it, open-coded the raw fields,
and published an unlabelled English header over a Spanish consultation.

When you find one, extract it so the divergence becomes impossible rather than
merely unlikely.

## Done when

- The path from the front door to the capability has been walked, and each step
  named.
- The permission gate has been checked for the role that is supposed to have
  access, not only for an admin.
- Every field the surface displays has been confirmed present in the projection
  actually requested.
- Anything visual has been looked at, not inferred.
- Any capability shared by two surfaces lives outside both of them.

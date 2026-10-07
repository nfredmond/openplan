# Repeated contribution inspection

T3 preview on production build 359ab99204b2 reproduced a focus defect on October
7, 2026. In the synthetic campaign's saved staff review, the first activation
of Inspect comment 1 focused Selected contribution evidence. Activating the
same button again left focus on the button. The retained evidence remained
available, but the inspection action no longer returned keyboard focus to it.
The browser readout is retained in before.json. No source or review was changed.

The correction explicitly focuses the already-selected contribution. Selecting
a different contribution continues to use the existing post-render focus effect.
The regression test reproduces the original failure at its second focus assertion;
the other 16 tests pass. With the correction, all 17 tests pass. A harmless source
comment passes the new regression. Removing only the repeated-focus operation
fails the focus assertion. The source is restored after each control.

These tests cover DOM focus and retained contribution text, and assert that
inspection sends no write requests. They do not prove screen-reader speech,
mobile layout, meaningful thematic interpretation or human acceptance. The
identified production build and T3 desktop/390px checks of the correction remain
pending. The broader nonempty theme/citation and response-to-decision journey
remains open.

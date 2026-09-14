# Outline hover contrast, September 13, 2026

This continues 9d6e14fb in the owned translation checkout. The shared outline
Button hovered background now mixes its palette color with var(--background)
instead of literal white. No geometry, text, keyboard handler or database
permission changes are included.

## Demonstrated defect and fix

The prior narrow translation recovery screenshot showed pale green text on a
pale hovered Download retained request button. The shared outline variant uses
pine-deep for hovered text. That token is dark in light themes and light in dark
themes, but its background had always mixed against white.

A real Chrome journey from sign-in through Engagement and the campaign Setup tab
measured the same shared variant on the Translation history control. Before the
fix, all ten dark hover cases across five palettes and two widths failed the
4.5:1 text floor. Ratios ranged from 1.185 to 1.495. The other 50 idle, hover and
keyboard cases passed. Black/white and same-color calculation controls measured
21 and 1 respectively, and the probe requires opaque rendered colors and an
enabled outline button before accepting a measurement.

Mixing with the active background token follows both the mode and palette.
The first complete corrected run measured at least 7.561:1 across all 60 cases.
It also exercised Tab to the reason textarea, Shift+Tab back to the visible
history control, and Enter to open and close history. Further final-source
control results are recorded below when the run finishes.

## Probe correction

Several early attempts lost hover or found the focused button outside the
viewport. These were invalid measurements, not contrast failures. The probe
refused them and captured screenshots and focus/scroll traces. An attempted
source-fault run likewise refused to classify its navigation failure as a killed
contrast defect because no complete measurement report existed.

The trace showed focus disappearing to the body and the page scroller resetting
after measurements had begun. The probe had clicked Setup without awaiting the
resulting URL navigation. Its existing content could remain visible while the
later route render was pending. The probe now awaits the campaign URL with
?tab=setup before measuring, and independently checks hover, focus and viewport
state. No application scrolling code was changed to make the check pass.

The browser script retains failure-only diagnostic traces. The source-fault
wrapper restores the original literal-white hover expression, requires all ten
dark hover contrast failures in a complete 60-measurement report, and restores
the corrected file in finally. A harmless outline-offset control must still
pass. Source hashes must remain unchanged within each browser run.

## Scope and continuation

This checks the shared outline variant on an actual Engagement control in five
palettes, light and dark, at 1440px and 390px. It does not prove every consumer's
custom overrides, numeric focus-ring contrast or whole-product accessibility.
The focus ring is required to render and remain visible; screenshots are also
inspected. No model, generation queue or publication browser journey is claimed.
The 29 existing theme/history UI tests and focused Button lint check passed.

The large translation workflow remains unreleased. Continue the staff generation
queue/catalog/editor producer join described in PENDING_PUBLICATION_PROGRESS.md.
Preserve retained generation output and old source/saved versions through retries;
replace the old staff suggestion and publication producers before command
activation. Public producer privacy and allowance remain separate boundaries.
Full V1, direct main landing after applicable verification, final CI before tags,
free local operation and no human-review release gate remain the task.

## Final evidence

After the Setup navigation wait, the harmless and final corrected browser runs
each passed all 60 measurements, including viewport, hover, keyboard focus and
Enter activation. Minimum text contrast was 7.561:1. Restoring literal white
failed exactly the ten dark-hover measurements in a complete 60-case run. The
wrapper restored the corrected source and its SHA-256 matches final evidence.

The first completed fault run did fail the intended contrast assertion, but its
wrapper expected a custom message that Playwright omitted from formatted output.
It refused to classify the run. The wrapper now verifies the exact assertion
source location together with the complete structured measurement report; the
subsequent fault run passed those checks. No failure was counted from a missing
report, unexpected page exception, lost hover or offscreen focus.

The existing 29 theme/history tests and focused Button lint check passed. No
source changed during each browser capture. Final console review recorded no
page exception or console error. The final corrected and harmless runs also recorded no console warnings. No database write, temporary grant or provider call was made.
All verification processes are terminal. Main remained ef16f166 with successful
CI and RLS when checked during this increment; no new release is claimed.

outline-hover-evidence.json records source and browser-script hashes, result
paths, screenshot paths, contrast minima and the targeted fault. Inspected narrow
hover and keyboard captures show readable mint text on the dark background and
a visible keyboard ring. The contrast finding in the previous pending-publication
checkpoint is closed for the shared outline variant. Resume the generation
editor integration next.

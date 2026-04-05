# OpenPlan production UX review

Reviewed against `https://openplan-zeta.vercel.app` using the seeded QA workspace/project/campaign/invoice set created for the 2026-03-22 production UX pass.

## 1) Engagement campaign detail page — share controls

- **High — The UI makes the share token feel primary and the live public URL feel secondary.**
  - The raw token gets the clearer field treatment, while the actual public link is truncated and visually de-emphasized.
  - **Fix:** make the public URL the primary object. Put it first, show more of it, and pair it with `Copy` + `Open portal`. Move the raw token under an `Advanced link settings` disclosure.

- **High — Portal state is implicit instead of explicit.**
  - Right now the operator has to infer state from the token, the description field, and the submissions checkbox.
  - **Fix:** add a visible state badge at the top of the card: `Private`, `Public link active`, or `Public + accepting submissions`.

- **Medium — `Remove` is too vague for a destructive share control.**
  - It is not clear whether it removes the token, disables the portal, or revokes all public access.
  - **Fix:** rename to `Disable public link` or `Revoke public access` and add a confirmation message that explains the effect.

- **Medium — Save/share/export actions are grouped at the same level even though they do different jobs.**
  - `Save share settings`, `Export CSV`, and `Export JSON` compete for attention.
  - **Fix:** keep sharing actions together and move exports into a lower `Data export` row or secondary section.

- **Medium — The description field lacks a live preview cue.**
  - The user can write the text, but there is no strong indication of how it appears on the public page.
  - **Fix:** add helper copy like `Shown under the portal title on the public page` and a one-line preview beneath the field.

- **Medium — No unsaved-change feedback.**
  - Editing the token/description/checkbox feels fragile because the user gets no visible dirty state.
  - **Fix:** add dirty-state feedback on the card and disable exports until saved state is current.

## 2) Project detail page — controls / records composer

- **High — Above-the-fold density is too high.**
  - The project summary, control-room card, full record composer, and stage-gate cockpit all compete immediately.
  - **Fix:** keep summary + one governance snapshot above the fold, then collapse the full composer behind `Add record` or open it in a drawer/modal.

- **High — The record-type selector is overloaded.**
  - Seven record types in one thin horizontal row reads like a cramped toolbar, not a clean choice architecture.
  - **Fix:** replace with a 2-column selector grid, grouped chips, or a compact left-rail stepper.

- **High — The governance column is too dense to scan as a dashboard.**
  - The stage-gate area becomes an evidence wall of chips and stacked cards instead of a fast-read operator surface.
  - **Fix:** reduce it to: `current gate`, `blocking condition`, `next gate`, then collapsible evidence details.

- **Medium — The composer and governance surfaces are not context-linked strongly enough.**
  - Creating a milestone does not visibly reframe the right rail around milestone-related dependencies.
  - **Fix:** filter/highlight the governance content based on the active record type so the right rail responds to the job the user is doing.

- **Medium — The page has a severe balance problem once the composer opens.**
  - The left column drops into long white vertical space while the right rail stays visually dense and heavy.
  - **Fix:** shorten the default form, progressively disclose advanced fields, and cap right-rail content height with collapsible sections.

- **Medium — The page gets too long too quickly.**
  - After the first project control zone, the user still has to keep scrolling through additional control surfaces with little navigation support.
  - **Fix:** add sticky in-page navigation or section anchors for `Summary`, `Add record`, `Governance`, `Records`, and `Recent activity`.

## 3) Copilot button placement in the app shell

- **Medium — Placement is right, but emphasis is slightly too weak.**
  - Top-right utility placement is correct, but the button currently reads like a peer utility next to notifications rather than a primary assistant entry point.
  - **Fix:** keep the location, but strengthen hover/focus/active states and add a slightly stronger accent treatment.

- **Medium — The button is visually squeezed between the search bar and the account pill.**
  - Search and the account chip dominate the header width, so Copilot feels pinched.
  - **Fix:** tighten the account pill width, remove redundant authenticated text, or reserve a bit more horizontal breathing room around Copilot.

- **Medium — The closed-state label does not communicate page grounding.**
  - Users cannot tell whether Copilot is scoped to the current project, campaign, billing page, or generic app state until after opening it.
  - **Fix:** add a small context cue in the button or drawer entry state: `Copilot • Project`, `Copilot • Campaign`, `Copilot • Billing`.

- **Low — The open drawer header is elegant but cramped.**
  - The title block is carrying too much context in too little height.
  - **Fix:** give the drawer header more vertical breathing room and add clearer separation between header and conversation body.

## 4) Billing page — invoice register scaffolding

- **High — The net request preview is not trustworthy.**
  - The composer shows a gross amount, but the preview card still shows `$0.00`. That immediately damages operator trust.
  - **Fix:** treat preview math as blocking. The preview must update live and correctly before this page is used in production demos or finance workflows.

- **High — Two billing systems are competing on one page.**
  - Subscription checkout and consulting invoice operations are both present, which makes the page feel split-brain.
  - **Fix:** separate into clearer modes or tabs: `Subscription` and `Consulting invoices`. If kept on one page, make consulting invoices the dominant operational surface and compress subscription controls into a compact summary card.

- **Medium — Repeated scaffolding/deferred/v0.1 language makes the page feel apologetic.**
  - The scope caveat appears in multiple places and keeps re-explaining what the page cannot do.
  - **Fix:** consolidate all boundary language into one `Current scope` info block and stop repeating it across multiple cards.

- **Medium — The composer rows are too tight for real billing labels and select values.**
  - Several desktop rows feel cramped or truncated, especially dropdown-heavy fields.
  - **Fix:** reduce columns per row, give long-select fields more width, and let the form breathe before adding more metadata.

- **Medium — The KPI cards are too narrow and text-heavy.**
  - Wrapped explanatory copy makes the metrics feel choppy instead of crisp.
  - **Fix:** convert the register summary to a 2x2 grid or a wider strip with shorter support text.

- **Medium — The register summary and register list feel disconnected.**
  - The page reads like a summary card plus a second invoice register below it rather than one coherent register experience.
  - **Fix:** visually connect the KPI summary to the invoice list beneath it with a shared section header, filters, and tighter vertical spacing.

## Priority order

1. **Billing:** fix the net preview trust bug.
2. **Project detail:** reduce above-the-fold density by collapsing the full composer and simplifying the governance rail.
3. **Engagement:** make portal state + live public URL primary; demote raw token editing.
4. **Billing IA:** separate subscription billing from consulting invoice operations more clearly.
5. **Copilot:** keep placement, but improve discoverability and context signaling in the closed state.

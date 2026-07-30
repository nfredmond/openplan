-- A resident who cannot use the portal can find out how to take part anyway.
--
-- WHY THIS EXISTS
--   The participant portal is a map, a form and a comment feed. Every one of
--   those has people it does not work for: a screen-reader user placing a pin, a
--   resident on a phone with no data allowance, somebody who does not read any
--   of the languages the campaign has been translated into, a person who would
--   rather speak to someone. For a consultation run by a public agency, "could
--   not take part" is not a UX problem — it is the consultation failing to have
--   heard from people whose input it was legally required to seek.
--
--   OpenPlan already tells a resident when text is machine-translated, when it
--   is untranslated, and which language the page is in. It had nothing to tell
--   them about the one thing that resolves all of those at once: a person at the
--   agency they can contact.
--
-- WHOSE STATEMENT THIS IS, WHICH IS THE WHOLE DESIGN
--   OpenPlan cannot make this promise on an agency's behalf, and must not. The
--   duty to provide an alternative way to take part sits with the body running
--   the consultation, the accommodation is arranged by their staff, and the
--   contact is theirs. So these columns hold the AGENCY's words, entered by the
--   agency, rendered as the agency's own — the same posture as
--   `engagement_content_translations.source = 'operator'` (20260729000004).
--   Nothing here is defaulted to an OpenPlan-authored sentence, because a
--   default would put words in a public body's mouth about its own legal duty.
--
-- JURISDICTION-NEUTRAL, DELIBERATELY
--   No column says ADA, Section 508, Title VI, WCAG, or Equality Act. The US is
--   the current scope and worldwide is the target, and every jurisdiction names
--   this differently while asking for the same thing: who to contact, and what
--   else is on offer. `contact_label` is free text so an agency can write "ADA
--   Coordinator", "Community Engagement Team", or "Access Officer" in its own
--   vocabulary rather than picking from a list OpenPlan invented. A registry of
--   accessibility regimes would be the wrong shape — this is one contact, not a
--   compliance framework.
--
-- POSTURE
--   * COLUMNS ON `engagement_campaigns`, NOT A NEW TABLE. One campaign has one
--     accommodation contact; a 1:1 fact belongs on the row. It is per-CAMPAIGN
--     rather than per-workspace because a county agency may run a corridor study
--     whose contact is the project manager, not the front desk.
--   * EVERYTHING NULLABLE. A campaign with no contact recorded is the state
--     every existing campaign is in, and the portal renders nothing rather than
--     an empty heading. It is surfaced to the OPERATOR as an unmet readiness
--     item, which is where an omission can still be fixed.
--   * NO NEW POLICIES. These are columns on a table whose RLS already decides
--     who may read and write a campaign, and whose share-token path already
--     governs the public read. Adding policies here would be a second answer to
--     a question already answered.
--
-- WHAT THIS IS NOT
--   Not a conformance claim. Nothing in this migration asserts that the portal
--   meets any standard, and no code reads it as though it does. It records a way
--   to reach a human, which is true whatever the portal's conformance turns out
--   to be.

alter table public.engagement_campaigns
  -- Who to contact, in the agency's own vocabulary.
  add column if not exists accessibility_contact_label text,
  add column if not exists accessibility_contact_email text,
  add column if not exists accessibility_contact_phone text,
  -- What else is on offer: paper copies, a phone line, an interpreter, a
  -- meeting. Free text because the list is different at every agency.
  add column if not exists accessibility_alternate_formats text;

-- Trimmed-empty is not a contact. Without this a whitespace-only value would
-- render as a heading with nothing under it, which reads to a resident as an
-- offer the agency did not make.
alter table public.engagement_campaigns
  drop constraint if exists engagement_campaigns_accessibility_contact_nonblank;

alter table public.engagement_campaigns
  add constraint engagement_campaigns_accessibility_contact_nonblank check (
    (accessibility_contact_label is null or btrim(accessibility_contact_label) <> '')
    and (accessibility_contact_email is null or btrim(accessibility_contact_email) <> '')
    and (accessibility_contact_phone is null or btrim(accessibility_contact_phone) <> '')
    and (accessibility_alternate_formats is null or btrim(accessibility_alternate_formats) <> '')
  );

comment on column public.engagement_campaigns.accessibility_contact_label is
  'Who a resident contacts to take part another way, in the agency''s own words. Agency-authored; never defaulted by OpenPlan.';
comment on column public.engagement_campaigns.accessibility_contact_email is
  'Email for accommodation requests. Rendered to the public portal verbatim.';
comment on column public.engagement_campaigns.accessibility_contact_phone is
  'Phone for accommodation requests. Rendered to the public portal verbatim.';
comment on column public.engagement_campaigns.accessibility_alternate_formats is
  'Other ways to take part — paper, phone, interpreter, in person. Agency-authored free text.';

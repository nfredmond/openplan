-- Narrow creation-time service grants on retained award history and its views.
-- Row UPDATE/DELETE guards do not protect TRUNCATE. Keep definitions and client grants exact.
REVOKE ALL PRIVILEGES ON TABLE
 public.funding_award_handoff_revisions,
 public.funding_award_handoff_sources,
 public.funding_award_handoff_occurrences,
 public.funding_award_closure_receipts
FROM service_role;
GRANT SELECT, INSERT ON TABLE
 public.funding_award_handoff_revisions,
 public.funding_award_handoff_sources,
 public.funding_award_handoff_occurrences,
 public.funding_award_closure_receipts
TO service_role;

REVOKE ALL PRIVILEGES ON TABLE
 public.current_award_handoff_records,
 public.active_project_submittals,
 public.active_project_milestones,
 public.legacy_calendar_funding_awards,
 public.funding_award_handoff_fulfillment,
 public.funding_opportunity_issuance
FROM service_role;
GRANT SELECT ON TABLE
 public.current_award_handoff_records,
 public.active_project_submittals,
 public.active_project_milestones,
 public.legacy_calendar_funding_awards,
 public.funding_award_handoff_fulfillment,
 public.funding_opportunity_issuance
TO service_role;

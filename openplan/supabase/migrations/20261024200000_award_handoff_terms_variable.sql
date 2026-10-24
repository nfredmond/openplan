-- Keep occurrence loop values distinct from SQL aliases during terms validation.
CREATE OR REPLACE FUNCTION public.handoff_validate_terms(t jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_occurrence jsonb; field text; c numeric;
BEGIN
 IF coalesce(t->'issuanceDisposition'->>'state','') NOT IN ('issued','rescinded','corrected') OR coalesce(length(trim(t->'issuanceDisposition'->>'evidence')),0)=0 THEN RAISE EXCEPTION 'Current funder disposition requires actual notice evidence' USING ERRCODE='22023'; END IF;
 IF t->>'issued' IS DISTINCT FROM 'true' OR jsonb_array_length(t->'sources')<1 OR t->>'effective' NOT IN ('true','false') THEN RAISE EXCEPTION 'Actual notice and effective-source choice required' USING ERRCODE='22023'; END IF;
 FOREACH field IN ARRAY ARRAY['ceiling','match'] LOOP
  IF coalesce(t->>field,'') !~ '^\d+(\.\d{1,2})?$' THEN RAISE EXCEPTION 'Exact actual money required' USING ERRCODE='22023'; END IF;
  c:=(t->>field)::numeric; IF c>999999999999.99 THEN RAISE EXCEPTION 'Award NUMERIC(14,2) limit exceeded' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF t->'currency'->>'code' IN ('BHD','IQD','JOD','KWD','LYD','OMR','TND','CLF','UYW','JPY','KRW','VND','CLP','PYG','RWF','UGX','VUV','XAF','XOF','XPF','BIF','DJF','GNF','KMF') THEN RAISE EXCEPTION 'Currency precision is not supported by the cent store' USING ERRCODE='22023'; END IF;
 IF coalesce(t->'currency'->>'code','') !~ '^[A-Z]{3}$' OR t->'currency'->>'minorUnits' IS DISTINCT FROM '2' OR coalesce(length(trim(t->'currency'->>'source')),0)=0 THEN RAISE EXCEPTION 'Explicit source-confirmed cent currency required; unsupported precision refuses' USING ERRCODE='22023'; END IF;
 FOREACH field IN ARRAY ARRAY['recipient','funder','scope','differences','commitments','applicability','submissionReceipt','scheduleCoverage','effectiveEvidence','acceptanceEvidence'] LOOP
  IF coalesce(length(trim(t->>field)),0)=0 THEN RAISE EXCEPTION 'Complete actual terms or explicit unresolved qualification required: %',field USING ERRCODE='22023'; END IF;
 END LOOP;
 IF t->>'acceptance' NOT IN ('not_recorded','pending','accepted','declined') OR t->'authorization'->>'state' NOT IN ('not_recorded','not_authorized','authorized') THEN RAISE EXCEPTION 'Independent acceptance and authorization states required' USING ERRCODE='22023'; END IF;
 IF t->'authorization'->>'amount' IS NOT NULL AND coalesce(t->'authorization'->>'amountCurrencyCode','') !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Authorization amount requires its independently recorded currency' USING ERRCODE='22023'; END IF;
 IF t->'authorization'->>'amount' IS NOT NULL AND (coalesce(t->'authorization'->>'amount','') !~ '^\d+(\.\d{1,2})?$' OR (t->'authorization'->>'amount')::numeric>999999999999.99) THEN RAISE EXCEPTION 'Invalid independently sourced authorization amount' USING ERRCODE='22023'; END IF;
 FOREACH field IN ARRAY ARRAY['unknownReason','authority','scope','period','evidence'] LOOP
  IF coalesce(length(trim(t->'authorization'->>field)),0)=0 THEN RAISE EXCEPTION 'State authorization evidence or its unresolved qualification' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF t->>'acceptance' IN ('accepted','declined') AND (coalesce(t->>'acceptanceEvidence','') ~* 'not recorded|unresolved|unknown' OR NOT EXISTS(SELECT FROM jsonb_array_elements(t->'sources') s WHERE s->>'id'=t->>'acceptanceSourceId')) THEN RAISE EXCEPTION 'Acceptance/decline requires actual retained evidence' USING ERRCODE='22023'; END IF;
 IF t->'authorization'->>'state'<>'not_recorded' OR t->'authorization'->>'amount' IS NOT NULL THEN
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(t->'sources') s WHERE s->>'id'=t->'authorization'->>'sourceId') OR concat_ws(' ',t->'authorization'->>'authority',t->'authorization'->>'scope',t->'authorization'->>'period',t->'authorization'->>'evidence') ~* 'not recorded|unresolved|unknown' THEN RAISE EXCEPTION 'Authorization facts require actual retained authority/scope/period evidence' USING ERRCODE='22023'; END IF;
 END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(t->'sources') s WHERE s->>'id'=t->>'noticeSourceId' AND s->>'family'='kb_pdf') THEN RAISE EXCEPTION 'Actual notice PDF required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(t->'sources') s GROUP BY s->>'family',s->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Select each retained PDF once' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(t->'occurrences') x GROUP BY x->>'conditionKey',x->>'occurrenceKey' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate occurrence identity' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(t->'occurrences') x GROUP BY x->>'requirement',x->'clock' HAVING count(*)>1 AND count(DISTINCT x->>'distinctSourceIdentity')<>count(*)) THEN RAISE EXCEPTION 'Duplicate dates/requirements need explicit distinct source identities' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(t->'occurrences') x WHERE x->>'kind'='obligation' AND x->>'disposition'<>'withdraw')>1 THEN RAISE EXCEPTION 'One obligation milestone per award; retain further clocks unresolved' USING ERRCODE='22023'; END IF;
 FOR v_occurrence IN SELECT value FROM jsonb_array_elements(t->'occurrences') LOOP
  IF coalesce(v_occurrence->>'conditionKey','') !~ '^[a-zA-Z0-9._-]{1,100}$' OR coalesce(v_occurrence->>'occurrenceKey','') !~ '^[a-zA-Z0-9._-]{1,100}$' OR v_occurrence->>'kind' NOT IN ('report','obligation','expenditure') OR v_occurrence->>'disposition' NOT IN ('new','carry','reschedule','replace','reopen','withdraw','adopt_legacy') THEN RAISE EXCEPTION 'Invalid occurrence identity or disposition' USING ERRCODE='22023'; END IF;
  FOREACH field IN ARRAY ARRAY['requirement','responsibleParty','citation','reason','distinctSourceIdentity'] LOOP
   IF coalesce(length(trim(v_occurrence->>field)),0)=0 THEN RAISE EXCEPTION 'Complete occurrence and source identity required' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF v_occurrence->'clock'->>'kind'='date_only' THEN
   IF (v_occurrence->'clock'->>'date')::date::text IS DISTINCT FROM v_occurrence->'clock'->>'date' THEN RAISE EXCEPTION 'Invalid date-only clock' USING ERRCODE='22023'; END IF;
  ELSIF v_occurrence->'clock'->>'kind'='instant' THEN
   IF v_occurrence->'clock'->>'value' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' OR coalesce(length(v_occurrence->'clock'->>'sourceZone'),0)=0 OR coalesce(length(v_occurrence->'clock'->>'calendarDateBasis'),0)=0 THEN RAISE EXCEPTION 'Original offset/source zone and source calendar projection required' USING ERRCODE='22023'; END IF;
   PERFORM (v_occurrence->'clock'->>'value')::timestamptz; PERFORM (v_occurrence->'clock'->>'calendarDate')::date;
  ELSIF v_occurrence->'clock'->>'kind'<>'unresolved_trigger' OR coalesce(length(v_occurrence->'clock'->>'trigger'),0)=0 THEN RAISE EXCEPTION 'Typed clock required' USING ERRCODE='22023'; END IF;
 END LOOP;
END $$;

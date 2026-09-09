-- Staff can read their own imported hours without payroll values, finance notes or source files.
-- Only their own unreviewed submissions remain editable; existing write guards still enforce this.
CREATE OR REPLACE FUNCTION public.read_contract_management_v046(p_engagement_id uuid,p_actor_id uuid,p_cutoff timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; actor_role text; result jsonb;
BEGIN
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 actor_role:=public.contract_actor_role(e.id,p_actor_id);
 IF e.id IS NULL OR actor_role IS NULL OR actor_role NOT IN ('owner','admin','member','pm','finance','consultant') THEN RAISE EXCEPTION 'Contract access denied' USING ERRCODE='42501'; END IF;
 result:=jsonb_build_object('engagement',to_jsonb(e),'role',actor_role,
 'staff',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'active',s.active,'user_id',s.user_id) ORDER BY s.name) FROM public.invoicing_staff s WHERE s.workspace_id=e.workspace_id AND (actor_role IN ('owner','admin','finance') OR (actor_role='pm' AND (public.contract_staff_available(s.id,e.workspace_id) OR EXISTS(SELECT 1 FROM public.contract_task_assignments a WHERE a.engagement_id=e.id AND a.staff_id=s.id) OR EXISTS(SELECT 1 FROM public.contract_actual_versions a WHERE a.engagement_id=e.id AND a.command->>'staffId'=s.id::text))) OR s.user_id=p_actor_id)),'[]'),
 'deliverables',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'title',d.title)) FROM public.project_deliverables d WHERE d.project_id=e.project_id),'[]'),
 'documents',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'checksum',d.checksum)) FROM public.kb_documents d WHERE d.workspace_id=e.workspace_id AND d.checksum IS NOT NULL AND d.work_program_report_id IS NULL),'[]'),
 'baselines',coalesce((SELECT jsonb_agg(to_jsonb(b)||CASE WHEN b.approved_at>p_cutoff THEN jsonb_build_object('state','proposed','approved_at',NULL,'approval_evidence','') ELSE '{}'::jsonb END ORDER BY b.version) FROM public.contract_baselines b WHERE b.engagement_id=e.id AND b.created_at<=p_cutoff),'[]'),
 'actuals',coalesce((SELECT jsonb_agg(to_jsonb(v)||jsonb_build_object('amount',v.amount::text,'hours',v.hours::text,'shared_source_stale',public.contract_shared_source_stale(v,p_cutoff)) ORDER BY v.created_at,v.version) FROM public.contract_actual_versions v WHERE v.engagement_id=e.id AND v.created_at<=p_cutoff),'[]'),
 'owpSources',CASE WHEN actor_role IN ('owner','admin','pm','finance') THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'category',v.kind,'timeEntryId',v.time_entry_id,'spendEntryId',v.spend_entry_id,'staffId',v.staff_id,'hours',v.hours::text,'amount',v.amount::text,'entryDate',v.entry_date,'status',v.status,'sourceKey',v.source_key,'sourceReference',coalesce(v.detail->>'sourceReference',''),'description',coalesce(v.detail->>'description',''),'billable',coalesce((v.detail->>'billable')::boolean,false)) ORDER BY v.entry_date,v.id) FROM public.work_program_actual_versions v WHERE v.workspace_id=e.workspace_id AND v.created_at<=p_cutoff AND v.kind IN ('labor','expense') AND NOT EXISTS(SELECT 1 FROM public.work_program_actual_versions n WHERE n.entry_id=v.entry_id AND n.version>v.version AND n.created_at<=p_cutoff) AND (EXISTS(SELECT 1 FROM public.invoicing_time_entries t WHERE t.id=v.time_entry_id AND t.engagement_id=e.id) OR EXISTS(SELECT 1 FROM public.project_spend_entries s WHERE s.id=v.spend_entry_id AND s.project_id=e.project_id))),'[]') ELSE '[]'::jsonb END,
 'rates',coalesce((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('hourly_rate',r.hourly_rate::text)) FROM public.contract_rates r WHERE r.engagement_id=e.id AND r.created_at<=p_cutoff),'[]'),
 'estimates',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at) FROM public.contract_estimates x WHERE x.engagement_id=e.id AND x.created_at<=p_cutoff),'[]'),
 'billingSources',coalesce((SELECT jsonb_agg(to_jsonb(bs)) FROM public.contract_billing_sources bs WHERE bs.engagement_id=e.id AND bs.created_at<=p_cutoff),'[]'),
 'invoices',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'status',i.status,'subtotal_amount',i.subtotal_amount::text,'retention_amount',i.retention_amount::text,'currency_code',i.currency_code,'invoice_date',i.invoice_date,'sent_date',i.sent_date,'updated_at',i.updated_at)) FROM public.client_invoices i WHERE i.engagement_id=e.id AND i.created_at<=p_cutoff),'[]'),
 'unmappedTime',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'hours',t.hours::text,'entry_date',t.entry_date,'staff_id',t.staff_id,'notes',t.notes,'billable',t.billable)) FROM public.invoicing_time_entries t WHERE t.engagement_id=e.id AND t.created_at<=p_cutoff AND NOT EXISTS(SELECT 1 FROM public.contract_actual_versions v WHERE v.time_entry_id=t.id AND v.created_at<=p_cutoff)),'[]'),
 'unmappedSpend',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'amount',s.amount::text,'entry_date',s.entry_date,'description',s.description)) FROM public.project_spend_entries s WHERE s.project_id=e.project_id AND s.created_at<=p_cutoff AND NOT EXISTS(SELECT 1 FROM public.contract_actual_versions v WHERE v.spend_entry_id=s.id AND v.created_at<=p_cutoff)),'[]'),
 'cutoffConflicts',EXISTS(SELECT 1 FROM public.client_invoices i WHERE i.engagement_id=e.id AND i.created_at<=p_cutoff AND i.updated_at>p_cutoff) OR
 EXISTS(SELECT 1 FROM public.invoicing_time_entries t WHERE t.engagement_id=e.id AND t.created_at<=p_cutoff AND t.updated_at>p_cutoff AND NOT EXISTS(SELECT 1 FROM public.contract_actual_versions v WHERE v.time_entry_id=t.id AND v.created_at<=p_cutoff)) OR
 EXISTS(SELECT 1 FROM public.project_spend_entries x WHERE x.project_id=e.project_id AND x.created_at<=p_cutoff AND x.updated_at>p_cutoff AND NOT EXISTS(SELECT 1 FROM public.contract_actual_versions v WHERE v.spend_entry_id=x.id AND v.created_at<=p_cutoff)) OR
 EXISTS(SELECT 1 FROM public.contract_source_deletions d WHERE d.workspace_id=e.workspace_id AND (d.engagement_id=e.id OR d.project_id=e.project_id) AND d.source_created_at<=p_cutoff AND d.deleted_at>p_cutoff),
 'imports',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'filename',i.filename,'source_hash',i.source_hash,'created_at',i.created_at) ORDER BY i.created_at) FROM public.contract_imports i WHERE i.engagement_id=e.id AND i.created_at<=p_cutoff),'[]'),
 'snapshots',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'created_at',s.created_at,'snapshot_hash',s.snapshot_hash) ORDER BY s.created_at DESC) FROM public.contract_snapshots s WHERE s.engagement_id=e.id),'[]'));
 IF actor_role IN ('member','consultant') THEN
  -- Own input stays readable; finance-entered time uses an explicit public field list.
  result:=result||jsonb_build_object('cutoffConflicts',false,'imports','[]'::jsonb,'rates','[]'::jsonb,'estimates','[]'::jsonb,'invoices','[]'::jsonb,'billingSources','[]'::jsonb,'unmappedSpend','[]'::jsonb,'snapshots','[]'::jsonb,'documents','[]'::jsonb,
   'baselines',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'version',b.version,'state',b.state,'content',jsonb_build_object('title',b.content->'title','scope',b.content->'scope','currency',b.content->'currency','tasks',(SELECT jsonb_agg(t-'cost'-'fee'-'hours'-'staff') FROM jsonb_array_elements(b.content->'tasks') t))) ORDER BY b.version) FROM public.contract_baselines b WHERE b.engagement_id=e.id AND b.state='approved' AND b.created_at<=p_cutoff),'[]'),
   'actuals',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',v.id,'entry_id',v.entry_id,'version',v.version,'created_at',v.created_at,
    'hours',v.hours::text,'time_entry_id',v.time_entry_id,'spend_entry_id',NULL,
    'member_can_correct',v.created_by=p_actor_id AND v.command->>'status'='draft',
    'command',coalesce(own.command-'amount'-'rateId'-'valuationBasis',jsonb_build_object(
     'kind','actual','entryId',v.entry_id,'sourceKey',v.source_key,
     'sourceReference','Recorded for you by finance. Ask finance to review a discrepancy.',
     'description','Time recorded for you by finance','staffId',s.id,'category','labor',
     'billable',v.command->'billable','correctionNote','','reconciliationNote','','openingBasis',''))
     ||jsonb_build_object('amount',NULL,'rateId',NULL,'valuationBasis','unvalued',
      'status',v.command->>'status','hours',v.hours::text,'entryDate',v.command->>'entryDate',
      'allocations',coalesce((SELECT jsonb_agg(jsonb_build_object('taskId',a->'taskId','deliverableId',a->'deliverableId','share',a->'share')) FROM jsonb_array_elements(v.allocations) a),'[]')),
    'amount',NULL,'allocations','[]'::jsonb) ORDER BY v.created_at,v.entry_id,v.version)
    FROM public.contract_actual_versions v
    JOIN public.invoicing_staff s ON s.id=(v.command->>'staffId')::uuid AND s.workspace_id=e.workspace_id
    LEFT JOIN LATERAL (SELECT original.command FROM public.contract_actual_versions original WHERE original.entry_id=v.entry_id AND original.created_by=p_actor_id AND original.version<=v.version AND original.created_at<=p_cutoff ORDER BY original.version DESC LIMIT 1) own ON true
    WHERE v.engagement_id=e.id AND s.user_id=p_actor_id AND v.command->>'category'='labor' AND v.created_at<=p_cutoff),'[]'),
   'unmappedTime',coalesce((SELECT jsonb_agg(t) FROM jsonb_array_elements(result->'unmappedTime') t WHERE EXISTS(SELECT 1 FROM public.invoicing_staff s WHERE s.id=(t->>'staff_id')::uuid AND s.user_id=p_actor_id)),'[]'));
 END IF;
 IF actor_role='pm' THEN
  result:=result||jsonb_build_object('rates','[]'::jsonb,'imports','[]'::jsonb,'snapshots','[]'::jsonb,'documents',coalesce((SELECT jsonb_agg(d) FROM jsonb_array_elements(result->'documents') d WHERE EXISTS(SELECT 1 FROM public.contract_baselines b CROSS JOIN LATERAL jsonb_array_elements(b.content->'sourceDocuments') src WHERE b.engagement_id=e.id AND src#>>'{}'=d->>'id') OR EXISTS(SELECT 1 FROM public.kb_documents owned WHERE owned.id=(d->>'id')::uuid AND owned.workspace_id=e.workspace_id AND owned.uploaded_by=p_actor_id)),'[]'));
 END IF;
 IF actor_role='consultant' THEN
  result:=result||jsonb_build_object('engagement',jsonb_build_object('id',e.id,'workspace_id',e.workspace_id,'project_id',e.project_id,'title',e.title,'parent_engagement_id',NULL,'engagement_kind',e.engagement_kind),'staff','[]'::jsonb,'actuals','[]'::jsonb,'unmappedTime','[]'::jsonb);
 END IF;
 RETURN result;
END $$;

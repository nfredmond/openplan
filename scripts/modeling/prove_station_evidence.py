"""Run temporary-copy mutations and retain assertion-level outcomes."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[2]
MODULE='scripts/modeling/station_evidence.py'
AUDIT='scripts/modeling/audit_station_evidence.py'
FILES=[MODULE,AUDIT,'scripts/modeling/validation_instrument.py',
       'workers/aequilibrae_worker/count_observation_uncertainty.py',
       'scripts/modeling/tests/test_station_evidence.py',
       'scripts/modeling/tests/test_station_evidence_audit.py']
# Each mutation has one anchor and a targeted test that must fail by assertion.
MUTATIONS=[
 ('custody',MODULE,"if sha256(payload) != receipt['sha256'] or len(payload) != receipt['bytes']:","if False:",'test_station_evidence.CustodyTests.test_fetch_and_verify'),
 ('access',MODULE,"if access != 'public_no_registration' or not url.startswith('https://'):","if False:",'test_station_evidence.CustodyTests.test_registration_refused_before_network'),
 ('redirect',MODULE,'if final_url != url:','if False:','test_station_evidence.CustodyTests.test_redirect_refused'),
 ('workbook_year',MODULE,"s.get('name') == f'{year} AADT DATA'","s.get('name') == '2023 AADT DATA'",'test_station_evidence.AdapterTests.test_workbook_wrong_year'),
 ('workbook_formula',MODULE,"if cell.find('m:f', ns) is not None:",'if False:','test_station_evidence.AdapterTests.test_workbook_formula'),
 ('workbook_county',MODULE,"if row.get('CNTY') in counties:",'if True:','test_station_evidence.AdapterTests.test_workbook_edition_and_fields'),
 ('caltrans_year',MODULE,"record.update(year=a['year'],","record.update(year=a['year'] + 1,",'test_station_evidence.AdapterTests.test_caltrans_preserves_unknown_process_and_sections'),
 ('caltrans_prefix',MODULE,"text(row.get('PM_PFX')),","'',",'test_station_evidence.AdapterTests.test_caltrans_duplicate_annual_and_prefix_mismatch'),
 ('caltrans_duplicate',MODULE,'if len(annual) == 1:','if len(annual) >= 1:','test_station_evidence.AdapterTests.test_caltrans_duplicate_annual_and_prefix_mismatch'),
 ('cdot_year',MODULE,"count_year=number(attrs['COUNTYEAR'])","count_year=number(attrs['AADTYR'])",'test_station_evidence.AdapterTests.test_cdot_type_years_dates_not_duration'),
 ('cdot_type',MODULE,"'continuous' if row['continuous'] else 'short_duration'","'continuous'",'test_station_evidence.AdapterTests.test_cdot_type_years_dates_not_duration'),
 ('cdot_continuous',MODULE,"'continuous' if row['continuous'] else 'short_duration'","'short_duration'",'test_station_evidence.AdapterTests.test_cdot_continuous_dates_are_not_complete_days'),
 ('cdot_duplicate',MODULE,"if len(record['aadts']) == 1:","if len(record['aadts']) >= 1:",'test_station_evidence.AdapterTests.test_cdot_refuses_duplicate_aadt_and_ramp'),
 ('cdot_ramp',MODULE,"{'0': 'mainline', '1': 'ramp'}","{'0': 'mainline', '1': 'mainline'}",'test_station_evidence.AdapterTests.test_cdot_refuses_duplicate_aadt_and_ramp'),
 ('incomplete_date',MODULE,'incomplete.append(date)','pass','test_station_evidence.AdapterTests.test_incomplete_source_date_retained_and_flagged'),
 ('tmas_county',MODULE,'if geography not in counties:','if False:','test_station_evidence.AdapterTests.test_tmas_fields_county_filter_and_method'),
 ('tmas_year',MODULE,"if int(row['year_record']) not in {year, year % 100}:",'if False:','test_station_evidence.AdapterTests.test_tmas_fields_county_filter_and_method'),
 ('tmas_method',MODULE,"'continuous' if row['method_volume'] == '3' else None","'continuous'",'test_station_evidence.AdapterTests.test_tmas_fields_county_filter_and_method'),
 ('tmas_longitude',MODULE,'-abs(lon) / 1e6','abs(lon) / 1e6','test_station_evidence.AdapterTests.test_tmas_fields_county_filter_and_method'),
 ('hpms_year',MODULE,"'year': number(row['year_record'])","'year': 2023",'test_station_evidence.AdapterTests.test_hpms_section_scope_and_group_duration_refusal'),
 ('join_namespace',MODULE,"if record['source'] != reference['source']:",'if False:','test_station_evidence.JoinTests.test_identity_rule'),
 ('join_station_id',MODULE,"if record.get('station_id') != reference['station_id']:",'if False:','test_station_evidence.JoinTests.test_identity_rule'),
 ('join_route_section',MODULE,"if record.get('route') != reference['route'] or record.get('postmile') is None or abs(record['postmile'] - reference['postmile']) > 0.00051:",'if False:','test_station_evidence.JoinTests.test_identity_rule'),
 ('join_facility',MODULE,"if reference['facility'] != 'mainline' or record.get('facility') != 'mainline':",'if False:','test_station_evidence.JoinTests.test_location_refusals'),
 ('join_distance',MODULE,"distance > max_distance_m or reference['description']", "distance > 1000000 or reference['description']",'test_station_evidence.JoinTests.test_location_refusals'),
 ('join_description',MODULE,"or reference['description'] != record.get('description')",'', 'test_station_evidence.JoinTests.test_location_refusals'),
 ('join_ambiguity',MODULE,'if len(candidates) != 1:','if not candidates:','test_station_evidence.JoinTests.test_ambiguous_and_empty'),
 ('year_transfer',MODULE,"if record.get('year') != observation['time_basis']['year']:",'if False:','test_station_evidence.JoinTests.test_year_and_value_mismatch_no_transfer'),
 ('value_transfer',MODULE,"if not values or max(values) != number(retained_row['observed_volume']):",'if False:','test_station_evidence.JoinTests.test_year_and_value_mismatch_no_transfer'),
 ('preserve_observation',MODULE,'result = copy.deepcopy(observation)','result = observation','test_station_evidence.JoinTests.test_enrichment_preserves_grade_center_and_input'),
 ('section_scope',MODULE,'if len(set(values)) > 1 else','if False else','test_station_evidence.JoinTests.test_unmatched_keeps_input_and_section_ambiguity'),
 ('external_route',MODULE,'if not same_route:','if False:','test_station_evidence_audit.ExternalTests.test_route_scope_distance_refusals'),
 ('external_scope',MODULE,"if record.get('facility') != 'mainline' or reference['facility'] != 'mainline' or record['direction'] != reference['direction']:",'if False:','test_station_evidence_audit.ExternalTests.test_route_scope_distance_refusals'),
 ('external_distance',MODULE,'if distance is None or distance > max_distance_m:','if distance is None:','test_station_evidence_audit.ExternalTests.test_route_scope_distance_refusals'),
 ('crosswalk',MODULE,"'publisher_crosswalk_required' if len(candidates) == 1","'verified_station' if len(candidates) == 1",'test_station_evidence_audit.ExternalTests.test_section_location_is_candidate_not_station'),
 ('registry_custody',AUDIT,"if se.sha256(raw) != config['input_registry_sha256']:",'if False:','test_station_evidence_audit.AuditTests.test_registry_hash_refusal'),
 ('baseline_custody',AUDIT,"if se.sha256(baseline_raw) != config['baseline_sha256']:",'if False:','test_station_evidence_audit.AuditTests.test_baseline_and_archive_hash_refusal'),
 ('archive_custody',AUDIT,"if hashlib.file_digest(handle, 'sha256').hexdigest() != registry['archive']['sha256']:",'if False:','test_station_evidence_audit.AuditTests.test_baseline_and_archive_hash_refusal'),
 ('bundle_custody',AUDIT,"if bundle['config_sha256'] != digest(config) or set(bundle['records']) != set(selected):",'if False:','test_station_evidence_audit.AuditTests.test_bundle_config_and_exclusive_output'),
 ('gis_duplicate',MODULE,'if key in duplicates:','if False:','test_station_evidence.AdapterTests.test_caltrans_exact_gis_duplicates_keep_all_locators'),
 ('gis_geometry',MODULE,"'geometry': feature.get('geometry')","'geometry': None",'test_station_evidence.AdapterTests.test_caltrans_exact_gis_duplicates_keep_all_locators'),
 ('member_custody',AUDIT,"if se.sha256(raw) != member['sha256'] or len(raw) != member['bytes']:",'if False:','test_station_evidence_audit.AuditTests.test_member_hash_refusal'),
 ('object_name',MODULE,"if not re.fullmatch(r'[0-9a-f]{64}', name):",'if False:','test_station_evidence.CustodyTests.test_bad_object_name'),
 ('arcgis_truncated',MODULE,"if 'error' in document or document.get('exceededTransferLimit'):","if 'error' in document:",'test_station_evidence.AdapterTests.test_caltrans_schema_county_and_truncation'),
 ('cdot_bool',MODULE,"if type(row['continuous']) is not bool:",'if False:','test_station_evidence.AdapterTests.test_cdot_refuses_string_boolean_dates_and_schema'),
 ('join_confidence',MODULE,"'confidence': 'high_identity_only'","'confidence': 'none'",'test_station_evidence.JoinTests.test_location_rule_survives_irrelevant_field'),
 ('location_limit',MODULE,'if not math.isfinite(max_distance_m) or not 0 < max_distance_m <= 100:','if False:','test_station_evidence.JoinTests.test_distance_tolerance_and_identity_decode'),
 ('historical_transfer',MODULE,"if record['source'] != 'caltrans':",'if False:','test_station_evidence.JoinTests.test_cdot_station_type_not_historical_observation'),
 ('external_ambiguity',MODULE,"'ambiguous_section_candidates' if candidates else","'publisher_crosswalk_required' if candidates else",'test_station_evidence_audit.ExternalTests.test_ambiguous_sections_never_choose_nearest'),
 ('tmas_scope',MODULE,"if record.get('facility') != 'mainline' or reference['facility'] != 'mainline' or record['direction'] != reference['direction']:",'if False:','test_station_evidence_audit.ExternalTests.test_tmas_direction_and_facility_unproved'),
 ('missing_geometry',MODULE,"if kind not in {'LineString', 'MultiLineString'}:\n        return None","if kind not in {'LineString', 'MultiLineString'}:\n        return 0",'test_station_evidence_audit.ExternalTests.test_geometry_missing_and_multi'),
 ('assignment_access',AUDIT,'raw = bundle.read(name)',"raw = bundle.read('99001/assignment-output.csv')",'test_station_evidence_audit.AuditTests.test_only_count_member_opens_and_recomputes'),
 ('partition',AUDIT,"if registry['partition'] != config['partition'] or config['partition'] != 'original five development counties only':",'if False:','test_station_evidence_audit.AuditTests.test_partition_geography_and_row_refusals'),
 ('exclusive_output',AUDIT,"with path.open('x') as handle:","with path.open('w') as handle:",'test_station_evidence_audit.AuditTests.test_bundle_config_and_exclusive_output'),
]


def run(output: Path):
    pins={f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in FILES}
    record={'schema':'openplan.station-evidence-mutation-proof.v1','interpreter':sys.version,
            'source_pins':pins,'controls':[],'skips':0,
            'blind_categories':['publisher truth','empirical interval coverage','historical process transfer','live service completeness','scientific acceptance']}
    try:
        with tempfile.TemporaryDirectory(prefix='station-proof-') as temp:
            root=Path(temp)
            for file in FILES:
                (root/file).parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/file,root/file)
            def execute(name, selector, expected):
                command=[sys.executable,'-B','-m','unittest']
                if selector is None: command+=['discover','-s','scripts/modeling/tests','-p','test_station_evidence*.py']
                else: command+=[selector]
                import os
                env={**os.environ,'PYTHONPATH':str(root/'scripts/modeling/tests')}
                p=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True,timeout=60)
                text=p.stdout+p.stderr
                passed=(p.returncode==0) if expected=='survive' else (p.returncode!=0 and 'FAIL:' in text and 'ERROR:' not in text and 'AssertionError' in text)
                record['controls'].append({'name':name,'selector':selector,'expected':expected,'exit_code':p.returncode,'valid':passed,'output':text})
                if not passed: raise RuntimeError('control did not meet expected assertion outcome: '+name)
            execute('baseline',None,'survive')
            for file in (MODULE,AUDIT):
                original=(root/file).read_bytes();(root/file).write_bytes(original+b'\n# Harmless source-custody comment.\n')
                execute('harmless_'+Path(file).stem,None,'survive');(root/file).write_bytes(original)
            for name,file,before,after,test in MUTATIONS:
                original=(root/file).read_text()
                if original.count(before)!=1:raise RuntimeError('mutation anchor not unique: '+name)
                (root/file).write_text(original.replace(before,after))
                try:execute(name,test,'assertion_failure')
                finally:(root/file).write_text(original)
            record['complete']=True
    except Exception as error:
        record['complete']=False;record['failure']=str(error)
        raise
    finally:
        record['originals_unchanged']=all(hashlib.sha256((ROOT/f).read_bytes()).hexdigest()==h for f,h in pins.items())
        with output.open('x') as handle:json.dump(record,handle,indent=2,sort_keys=True);handle.write('\n')
    print(json.dumps({'controls':len(record['controls']),'broken':len(MUTATIONS),'harmless':2,'skips':0}))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('output',type=Path);run(p.parse_args().output)

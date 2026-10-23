"""Run synthetic controls and restore exact source bytes after every mutation."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path.cwd();OUT=Path(__file__).resolve().parent
bulk=ROOT/'scripts/modeling/census_bulk_inputs.py';transit=ROOT/'scripts/modeling/activitysim_transit_skims.py'
cases=[
 ('bulk-comment',bulk,None,None,True),
 ('bulk-position',bulk,'starts[key] + int(line) - 2','starts[key] + int(line) - 1',False),
 ('bulk-duplicate-household',bulk,'if serial in households:', 'if False:',False),
 ('bulk-duplicate-person',bulk,'if identity in seen or (', 'if False and (',False),
 ('bulk-puma-coverage',bulk,'if represented != wanted:', 'if False:',False),
 ('bulk-person-count',bulk,"if counts.get(serial, 0) != int(household['NP']):",'if False:',False),
 ('bulk-group-quarters',bulk,"if r.get('RELSHIPP', r.get('RELP', '')) in {'16', '17', '37', '38'}:",'if True:',False),
 ('bulk-vintage',bulk,"if any(p['vintage'] != vintage for p in pumas):",'if False:',False),
 ('bulk-geography-duplicate',bulk,"if row[4] in result or geoid in result.values():",'if False:',False),
 ('bulk-geography-coverage',bulk,'if set(result.values()) != geoids:', 'if False:',False),
 ('bulk-sequence-identity',bulk,"or row[4].zfill(4) != sequence.zfill(4)","or False",False),
 ('bulk-sequence-duplicate',bulk,'if row[5] in seen:','if False:',False),
 ('bulk-missing-definition',bulk,'if set(positions) != wanted:','if False:',False),
 ('bulk-start-position',bulk,"raise ValueError('Sequence cell lacks table start position')", 'return {}' ,False),
 ('bulk-duplicate-definition',bulk,'if name in positions:', 'if False:',False),
 ('bulk-sequence-member',bulk,"raise ValueError('Expected one estimate or margin sequence member')", 'return {}' ,False),
 ('bulk-sequence-coverage',bulk,'if seen != set(logrecs):','if False:',False),
 ('bulk-puma-vintages',bulk,"raise ValueError('Bulk adapter requires one PUMA vintage')",'return [], {}' ,False),
 ('bulk-pums-member',bulk,"raise ValueError('Expected one PUMS CSV member')",'return',False),
 ('bulk-row-width',bulk,"raise ValueError('Sequence identity or row width differs')",'return {}' ,False),
 ('bulk-no-residents' ,bulk,'if not rows:','if False:',False),
 ('bulk-puma-join',bulk,"or (r['ST'].zfill(2), r[field].zfill(5)) != household_places[serial]",'or False',False),
 ('transit-comment',transit,None,None,True),
 ('fare-single-boarding',transit,'if len(boardings) != 1:','if not boardings:',False),
 ('fare-unknown-route',transit,'if schedule is None:\n                return None','if schedule is None:\n                return 0.0',False),
 ('fare-overlap',transit,'if len(matching) != 1:','if not matching:',False),
 ('fare-boundary',transit,'<= when < seconds(r["end"])','<= when <= seconds(r["end"])',False),
 ('fare-amount',transit,'return number(matching[0]["usd"], "route fare usd")','return 0.0',False),
 ('fare-source',transit,'if not policy.get("source"):\n                raise','if False:\n                raise',False),
 ('fare-date',transit,'if policy["service_date"] != config["service_date"]:','if False:',False),
 ('fare-validity',transit,'if not policy["effective_from"] <= config["service_date"] <= policy["verified_through"]:','if False:',False),
 ('fare-custody',transit,'if sha256(policy["source_path"]) != policy["source_sha256"]:','if False:',False),
 ('coverage-source',transit,'if not exclusions.get("source"):','if False:',False),
 ('coverage-membership',transit,'if not excluded <= set(record["zone_ids"]):','if False:',False),
 ('coverage-mask',transit,'if zone_id in excluded:','if False:',False),
]
originals={p:p.read_bytes() for p in [bulk,transit]};report=[]
try:
 for name,path,old,new,survive in cases:
  source=originals[path].decode()
  if old is None:changed=source+'\n# Harmless input preparation control.\n'
  else:
   if source.count(old)!=1:raise RuntimeError('Mutation anchor count: '+name)
   changed=source.replace(old,new)
  path.write_text(changed)
  pattern='test_census_bulk_inputs.py' if path==bulk else 'test_activitysim_integration_inputs.py'
  run=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','scripts/modeling/tests','-p',pattern,'-v'],capture_output=True,text=True)
  log=run.stdout+run.stderr;(OUT/(name+'.log')).write_text(log)
  path.write_bytes(originals[path])
  observed=run.returncode==0 if survive else run.returncode!=0 and 'FAIL:' in log and 'FAILED (failures=' in log and 'ERROR:' not in log
  report.append({'name':name,'expected':'survive' if survive else 'assertion failure','exit_code':run.returncode,'expected_observed':observed,'restored_sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
  print(name,observed,flush=True)
  if not observed:break
finally:
 for path,data in originals.items():path.write_bytes(data)
 (OUT/'mutations.json').write_text(json.dumps(report,indent=2)+'\n')
if not all(r['expected_observed'] for r in report) or len(report)!=len(cases):sys.exit(1)

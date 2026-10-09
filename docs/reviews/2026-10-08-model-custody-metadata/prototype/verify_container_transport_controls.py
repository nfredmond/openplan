"""Serial Docker transport faults against real local HTTP socket fixtures."""
import hashlib,json,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
path=ROOT/'workers/activitysim_worker/container_transport.py'
original=path.read_bytes();source=original.decode()
cases=[('harmless',[],None),
 ('reopen-handshake',[('if self.connected_once:','if False:')],'test_connection_close_during_handshake_is_not_reopened'),
 ('reconnect-after-drop',[('if self.connected_once:','if False:'),('if self.closed or self.owner !=','if self.owner !=')],'test_dropped_create_reply_never_reconnects_or_repeats_create'),
 ('substitute-inspected-id',[('if observed.get("Id") != container_id:','if False:')],'test_inspection_cannot_substitute_another_container_id'),
 ('ignore-endpoint',[('intent.get("endpoint_sha256") != self.endpoint_sha256','False')],'test_other_endpoint_refuses_before_create_reservation'),
 ('reserve-after-send',[('        creation.begin_create()\n',''),('        container_id = response.get("Id")','        creation.begin_create()\n        container_id = response.get("Id")')],'test_create_retains_intent_response_and_verified_identity'),
 ('send-swap-allowance',[('"MemorySwap": plan.memory_bytes','"MemorySwap": plan.memory_bytes * 2')],'test_create_retains_intent_response_and_verified_identity'),
 ('ignore-peer-user',[('if uid not in (0, os.getuid()):','if False:')],'test_other_user_peer_is_refused'),
 ('ignore-api-range',[('if not parts(version.get("MinAPIVersion")) <= parts(API_VERSION) <= parts(version.get("ApiVersion")):','if False:')],'test_unsupported_api_is_refused'),
 ('ignore-http-status',[('response.status != status','False')],'test_unexpected_http_status_is_refused'),
 ('ignore-response-size',[('len(content) > MAX_RESPONSE_BYTES','False')],'test_valid_json_over_response_limit_is_refused'),
 ('ignore-create-warning',[('if response.get("Warnings") not in (None, []):','if False:')],'test_creation_warning_remains_unverified'),
 ('ignore-recovery-daemon', [('plan.daemon_id != self.daemon_id:', 'False:')], 'test_recovery_refuses_changed_daemon_before_listing'),
 ('grant-retry', [('"retry_authorized": False', '"retry_authorized": True')], 'test_absence_and_ambiguity_do_not_authorize_retry'),
 ('ignore-recovery-identity', [('if observed.get("Id") != container_id:\n            raise DockerTransportError("Creation observation returned another container")', 'if False:\n            raise DockerTransportError("Creation observation returned another container")')], 'test_recovery_rechecks_full_inspection_and_exact_id'),
 ('ignore-recovery-policy', [('identity = verify_created_container(plan, self.daemon_id, observed)', 'identity = {}')], 'test_recovery_rechecks_full_inspection_and_exact_id'),
 ('omit-stopped-containers', [('"all": "1"', '"all": "0"')], 'test_lost_reply_can_be_observed_without_repeating_creation'),
 ('ignore-recovery-ambiguity', [('if len(candidates) != 1:', 'if False:')], 'test_absence_and_ambiguity_do_not_authorize_retry'),
 ('omit-bootstrap-policy', [('if bootstrap:', 'if False:')], 'test_bootstrap_creation_sends_required_privilege_policy'),
 ('ignore-empty-body', [('if content:', 'if False:')], 'test_empty_response_contract_refuses_json_body'),
 ('allow-nonboolean-bootstrap', [('if type(bootstrap) is not bool:', 'if False:')], 'test_bootstrap_policy_requires_boolean'),
 ('restored',[],None)]
records=[]
try:
 for name,changes,expected in cases:
  text=source
  for before,after in changes:
   assert before in text
   text=text.replace(before,after)
  if name=='harmless':text+='\n# Harmless local transport control.\n'
  path.write_text(text)
  result=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','workers/activitysim_worker/tests','-p','test_container_transport.py','-v'],cwd=ROOT,capture_output=True,text=True,timeout=30)
  output=result.stdout+result.stderr
  if expected:assert result.returncode!=0 and (f'FAIL: {expected} (' in output or f'ERROR: {expected} (' in output),output
  else:assert result.returncode==0,output
  records.append({'case':name,'verified':True,'returncode':result.returncode,'expected_failure':expected})
finally:path.write_bytes(original)
print(json.dumps({'cases':records,'source_sha256':hashlib.sha256(original).hexdigest(),
 'limits':['Actual Unix HTTP socket with synthetic Docker messages and response loss','Separate live Docker proof covers creation and identity','No independent controller, startup or owner-loss cleanup']},indent=2))

from pathlib import Path
import json, subprocess
root=Path('/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10/openplan')
p=root/'src/lib/assistant/provider-api-transport.ts'; original=p.read_text()
e=Path('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12')
cases=[
 ('harmless-comment','// Resolve once and retain only those addresses','// Resolve once and retain only the checked addresses',None),
 ('URL-credentials','url.username || url.password || ','','unsafe endpoint https://user:'),
 ('URL-query','url.search || ','','unsafe endpoint https://example.com/v1?'),
 ('URL-fragment','url.hash || ','','unsafe endpoint https://example.com/v1#'),
 ('URL-port-zero',' || url.port === "0"','','unsafe endpoint https://example.com:0'),
 ('host-policy','if (policy.allowedHosts && !hostIsAllowlisted(base.hostname, policy.allowedHosts))','if (false)','narrowing operator host'),
 ('HTTPS-default','if (base.protocol !== "https:" && !local)','if (false)','unsafe endpoint http://example.com'),
 ('all-DNS-answers','addresses.some(row =>','addresses.slice(0, 1).some(row =>','ambiguous local DNS answers [{"address":"127.0.0.1","family":4},{"address":"93.'),
 ('public-address-classification','classifyAddress(row.address).kind !== "public"','false','private answers for an ordinary HTTPS'),
 ('local-loopback-boundary','!["127.0.0.1", "::1"].includes(row.address)','false','ambiguous local DNS answers [{"address":"127.0.0.1","family":4},{"address":"93.'),
 ('DNS-family-binding','isIP(row.address) !== row.family','false','ambiguous local DNS answers [{"address":"127.0.0.1","family":6}]'),
 ('DNS-pin','lookup: pinnedLookup','lookup: undefined','single checked address'),
 ('IPv4-fallback','autoSelectFamily: true','autoSelectFamily: false','approved IPv4 answer'),
 ('local-policy-copy','localEndpoints: [...selectedPolicy.localEndpoints]','localEndpoints: selectedPolicy.localEndpoints','caller\'s connection'),
 ('host-policy-copy','[...selectedPolicy.allowedHosts]','selectedPolicy.allowedHosts','caller\'s connection'),
 ('endpoint-snapshot','resolveEndpoint(endpoint, policy, lookup, signal)','resolveEndpoint(args.endpoint, policy, lookup, signal)','caller\'s connection'),
 ('model-snapshot','checkedRequestBody(init.body, model)','checkedRequestBody(init.body, args.model)','caller\'s connection'),
 ('private-agent','method: "POST", agent, lookup:','method: "POST", agent: undefined, lookup:','ambient credentials or proxy'),
 ('TLS-verification','new HttpsAgent({ keepAlive: false })','new HttpsAgent({ keepAlive: false, rejectUnauthorized: false })','certificate verification: untrusted'),
 ('request-identity','if (called) fail("api_request_repeated");','if (false) fail("api_request_repeated");','single checked address'),
 ('request-target','String(input) !== new URL("chat/completions", base).href','false','changed destination'),
 ('request-method','init?.method !== "POST"','false','changed method'),
 ('request-model','parsed.model !== model || ','','changed model'),
 ('request-byte-limit','Buffer.byteLength(body) > 256_000','body.length > 256_000','changed unicode-body-limit'),
 ('request-tools','parsed.tools !== undefined || ','','changed tools'),
 ('request-functions','parsed.functions !== undefined || ','','changed functions'),
 ('request-tool-choice','parsed.tool_choice !== undefined ||','','changed tool-choice'),
 ('request-stream','parsed.stream === true ||','','changed stream'),
 ('output-token-upper-limit','(parsed.max_tokens as number) > 4000','false','changed tokens'),
 ('output-token-integer','!Number.isInteger(parsed.max_tokens)','false','changed fractional-tokens'),
 ('output-token-minimum','(parsed.max_tokens as number) < 1','false','changed zero-tokens'),
 ('one-output','(parsed.n !== undefined && parsed.n !== 1)','false','changed multiple-answers'),
 ('output-schema','parsed.response_format.type !== "json_schema"','false','changed schema'),
 ('header-allowlist','if (!["content-type", "authorization", "user-agent"].includes(key))','if (false)','changed cookie'),
 ('credential-binding','headers.get("authorization") !==\n      (apiKey === null ? null : `Bearer ${apiKey}`)','false','changed authorization'),
 ('response-model','|| parsed.model !== model) fail("api_response_identity_invalid")',') fail("api_response_identity_invalid")','missing-model'),
 ('response-id-length','parsed.id.length > 200','false','long-id'),
 ('one-response','parsed.choices.length !== 1','false','multiple-choices'),
 ('response-completion','choice.finish_reason !== "stop" || ','','incomplete without'),
 ('response-tool-calls','(choice.message.tool_calls != null && (!Array.isArray(choice.message.tool_calls) || choice.message.tool_calls.length > 0))','false','tool-call without'),
 ('response-function-call','choice.message.function_call != null','false','function-call without'),
 ('response-byte-count','bytes += chunk.length','bytes += chunk.toString("utf8").length','unicode-body-limit without'),
 ('response-header-limit','maxHeaderSize: 16_384','maxHeaderSize: 128_000','header-limit without'),
 ('response-compression','![undefined, "identity"].includes(response.headers["content-encoding"])','false','encoding without'),
 ('UTF8-fatal','new TextDecoder("utf-8", { fatal: true })','new TextDecoder("utf-8", { fatal: false })','invalid-utf8 without'),
 ('response-header-projection','new Response(text, { headers: { "content-type": "application/json" } })','new Response(text, { headers: response.headers as Record<string, string> })','strips response cookies'),
]
cases.extend([
 ('attempt-cancellation','AbortSignal.any([attemptSignal,','AbortSignal.any([','pre-cancelled requests'),
 ('SDK-cancellation','...(init?.signal ? [init.signal] : []),','', 'cancellation from the SDK'),
 ('pending-DNS-cancellation','await untilAborted(lookup(hostname), signal)','await lookup(hostname)', 'cancellation while DNS'),
 ('socket-cancellation','autoSelectFamily: true, signal, maxHeaderSize:','autoSelectFamily: true, signal: undefined, maxHeaderSize:', 'in-flight response'),
 ('deadline','AbortSignal.timeout(timeoutMs)','AbortSignal.timeout(30_000)', 'bounds an unresponsive'),
])
records=[]
try:
 for index,(name,before,after,target) in enumerate(cases):
  assert original.count(before)==1,(name,original.count(before))
  p.write_text(original.replace(before,after))
  report=e/f'transport-mutation-{name}.json'
  cmd=['bwrap','--die-with-parent','--unshare-net','--bind','/','/','--','npm','exec','--','vitest','run','src/test/provider-api-transport.test.ts','--reporter=json','--outputFile',str(report)]
  run=subprocess.run(cmd,cwd=root,text=True,capture_output=True,timeout=45)
  (e/f'transport-mutation-{name}.log').write_text(run.stdout+run.stderr)
  data=json.loads(report.read_text())
  failures=[a['fullName'] for suite in data['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
  if target is None:
   assert run.returncode==0 and data['numPassedTests']==73,(name,data)
  else:
   assert run.returncode!=0 and failures and any(target in f for f in failures),(name,failures,run.stdout+run.stderr)
  records.append({'mutation':name,'outcome':'survived' if target is None else 'failed','exitCode':run.returncode,'target':target,'failedTests':failures})
  (e/'transport-mutations-progress.json').write_text(json.dumps(records,indent=2)+'\n')
  if index%5==0: print(f'{index+1}/{len(cases)} {name}: {records[-1]["outcome"]}',flush=True)
finally:p.write_text(original)
(e/'transport-mutations.json').write_text(json.dumps({'network':'Every run used an isolated network namespace; only owned loopback fixtures were reachable.','mutations':records,'blindCategories':['No real external provider or account was tested.','The transport does not establish user, workspace or connection-revision authority; those callers are not implemented yet.','Cancellation closes the local request but cannot undo a remote model request already accepted.','DNS resolution can finish after cancellation; no socket opens from that late result.']},indent=2)+'\n')
print(f'Completed {len(records)} checked mutations.',flush=True)

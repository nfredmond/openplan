"""Exercise the acceptance server preload without allowing real network traffic."""
from pathlib import Path
import hashlib, json, subprocess
review = Path(__file__).resolve().parent
source = review / 'translation-browser-server-network-guard.mjs'
original = source.read_text()
test = r'''
import assert from 'node:assert/strict';
const calls=[];
globalThis.fetch=async function(input,init){calls.push({input,init});return new Response('local-control');};
await import('data:text/javascript;base64,'+Buffer.from(process.argv[1]).toString('base64'));
for(const input of ['https://api.anthropic.com/v1/messages',new URL('https://api.anthropic.com/v1/messages'),new Request('https://api.anthropic.com/v1/messages')]) {
 await assert.rejects(fetch(input),/SYNTHETIC browser server cannot call Anthropic/,'Provider traffic must be blocked before reaching the original fetch');
}
assert.equal(calls.length,0,'Blocked provider never reaches original fetch');
const input=new Request('http://127.0.0.1:29821/rest/v1/synthetic');const init={headers:{'x-synthetic':'control'}};
assert.equal(await(await fetch(input,init)).text(),'local-control');
assert.equal(calls.length,1,'Local application fetch forwarded once');assert.equal(calls[0].input,input);assert.equal(calls[0].init,init);
console.log('NETWORK_GUARD_PASSED');
'''
broken = original.replace("if (url.hostname === 'api.anthropic.com')", 'if (false)')
assert broken != original
results=[]
for name, body, expected in [('baseline',original,None),('harmless',original+'\n// Harmless network control.\n',None),('allow-provider',broken,'Provider traffic must be blocked')]:
    run=subprocess.run(['node','--input-type=module','-e',test,body],capture_output=True,text=True,timeout=10)
    correct=run.returncode==0 and 'NETWORK_GUARD_PASSED' in run.stdout if expected is None else run.returncode!=0 and expected in run.stderr
    results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'expectedOutcome':correct})
    assert correct,(name,run.stderr)
    print(name,results[-1]['outcome'])
(review/'generation-server-network-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'results':results,'limits':'Node fetch preload with a recording fake transport. Proves Anthropic blocking and local Request forwarding in this acceptance harness, not an operating-system egress firewall or arbitrary SDK network implementations.'},indent=2)+'\n')

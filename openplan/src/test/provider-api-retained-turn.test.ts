// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkedProviderTurn, retainedProviderTurnSchema, PROVIDER_TURN_COLUMNS } from "@/lib/assistant/provider-server";

const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
function fixture() {
  const workspace=randomUUID(),project=randomUUID();
  const packet={version:1,workspaceId:workspace,capturedAt:'2026-09-12T00:00:00Z',project:{id:project,name:'Synthetic retained project',summary:null,
    status:'active',planType:'other',deliveryPhase:'planning',updatedAt:'2026-09-12T00:00:00Z'},source:{id:`project:${project}`,label:'Synthetic retained project',href:`/projects/${project}`}};
  const configuration={label:'Synthetic retained API',protocol:'openai_chat_completions',endpoint:'https://model.fixture.invalid/v1/',modelIds:['synthetic-model'],structuredOutput:true,authMode:'api_key',timeoutSeconds:120};
  const canonical=JSON.stringify(packet),configCanonical=JSON.stringify(configuration);
  return {id:randomUUID(),request_id:randomUUID(),user_id:randomUUID(),workspace_id:workspace,project_id:project,connection_id:null,
    provider:'api_connection',model_id:'synthetic-model',auth_mode:'connection_api_key',question:'Synthetic question',packet_canonical:canonical,packet_hash:hash(canonical),
    state:'running',attempt_id:randomUUID(),lease_expires_at:'2099-01-01T00:00:00Z',result:null,provider_receipt:null,failure_code:null,
    created_at:'2026-09-12T00:00:00Z',started_at:'2026-09-12T00:00:00Z',finished_at:null,
    api_connection_id:randomUUID(),api_revision_id:randomUUID(),api_configuration_canonical:configCanonical,api_configuration_hash:hash(configCanonical),api_charge_ack:true};
}

describe('retained saved API turn decoding',()=>{
  it('retains the exact saved configuration and owner in the authenticated metadata projection',()=>{
    const row=fixture(),{turn,packet}=checkedProviderTurn(row);
    expect(turn).toEqual(row);expect(packet).toEqual(JSON.parse(row.packet_canonical));
    expect(PROVIDER_TURN_COLUMNS.split(',')).toEqual(expect.arrayContaining(['user_id','api_connection_id','api_revision_id','api_configuration_canonical','api_configuration_hash','api_charge_ack']));
    expect(PROVIDER_TURN_COLUMNS).not.toContain('credential');
  });
  it('retains keyless mode without interpreting it as an environment credential',()=>{
    const row=fixture(),configuration=JSON.parse(row.api_configuration_canonical);
    configuration.authMode='none';row.api_configuration_canonical=JSON.stringify(configuration);row.api_configuration_hash=hash(row.api_configuration_canonical);row.auth_mode='connection_no_key';
    expect(checkedProviderTurn(row).turn.auth_mode).toBe('connection_no_key');
    expect(retainedProviderTurnSchema.safeParse({...row,auth_mode:'deployment_api_key'}).success).toBe(false);
    expect(()=>checkedProviderTurn({...row,auth_mode:'deployment_api_key'})).toThrow();
  });
  for(const field of ['user_id','api_connection_id','api_revision_id','api_configuration_canonical','api_configuration_hash','api_charge_ack']) {
    it(`refuses missing API ${field}`,()=>{
      const raw=Object.fromEntries(Object.entries(fixture()).filter(([key])=>key!==field));
      expect(retainedProviderTurnSchema.safeParse(raw).success).toBe(false);
      expect(()=>checkedProviderTurn(raw)).toThrow();
    });
  }
  it('refuses a native connection token reference or false charge acknowledgement on an API turn',()=>{
    expect(retainedProviderTurnSchema.safeParse({...fixture(),connection_id:randomUUID()}).success).toBe(false);
    expect(()=>checkedProviderTurn({...fixture(),connection_id:randomUUID()})).toThrow();
    expect(retainedProviderTurnSchema.safeParse({...fixture(),api_charge_ack:false}).success).toBe(false);
    expect(()=>checkedProviderTurn({...fixture(),api_charge_ack:false})).toThrow();
  });
  for(const change of ['hash','model','mode','protocol','json']) {
    it(`refuses invalid retained API ${change}`,()=>{
      const row=fixture();
      if(change==='hash')row.api_configuration_hash='a'.repeat(64);
      if(change==='model')row.model_id='other-model';
      if(change==='mode')row.auth_mode='connection_no_key';
      if(change==='protocol'){
        const configuration=JSON.parse(row.api_configuration_canonical);configuration.protocol='unsupported';
        row.api_configuration_canonical=JSON.stringify(configuration);row.api_configuration_hash=hash(row.api_configuration_canonical);
      }
      if(change==='json'){row.api_configuration_canonical='{';row.api_configuration_hash=hash('{');}
      expect(()=>checkedProviderTurn(row)).toThrow('provider_api_snapshot_invalid');
    });
  }
  for(const provider of ['codex','claude','opencode','anthropic']) {
    it(`preserves legacy ${provider} history with absent or null API fields`,()=>{
      const row=fixture();
      const legacy={...Object.fromEntries(Object.entries(row).filter(([key])=>!key.startsWith('api_')&&key!=='user_id')),
        provider,connection_id:provider==='anthropic'?null:randomUUID(),auth_mode:provider==='anthropic'?'deployment_api_key':provider==='claude'?'claude_subscription':provider==='opencode'?'opencode_api':'chatgpt'};
      expect(checkedProviderTurn(legacy).turn).toEqual(legacy);
      const withNulls={...legacy,api_connection_id:null,api_revision_id:null,api_configuration_canonical:null,api_configuration_hash:null,api_charge_ack:null};
      expect(checkedProviderTurn(withNulls).turn).toEqual(withNulls);
      for (const [field, value] of Object.entries(row).filter(([key])=>key.startsWith('api_'))) {
        expect(()=>checkedProviderTurn({...legacy,[field]:value})).toThrow();
      }
    });
  }
  it('still rejects a foreign or tampered project packet for an API turn',()=>{
    const row=fixture();
    expect(()=>checkedProviderTurn({...row,workspace_id:randomUUID()})).toThrow('provider_packet_mismatch');
    expect(()=>checkedProviderTurn({...row,project_id:randomUUID()})).toThrow('provider_packet_mismatch');
    expect(()=>checkedProviderTurn({...row,packet_hash:'b'.repeat(64)})).toThrow('provider_packet_mismatch');
  });
});

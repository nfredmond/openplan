const path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createClient}=require(path.resolve(__dirname,'../../../../openplan/node_modules/@supabase/supabase-js'));
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:29971','Refuse any other stack');
const options={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const member=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
const must=async(p,label)=>{const r=await p;if(r.error)throw Error(label+': '+r.error.message);return r.data;};
(async()=>{
 const suffix=randomUUID(),password=randomUUID()+'!Aa9',email='finance-review-'+suffix+'@example.test';
 const user=await must(service.auth.admin.createUser({email,password,email_confirm:true}),'synthetic account');
 const w1=randomUUID(),w2=randomUUID(),fa=randomUUID(),fb=randomUUID(),fc=randomUUID(),pa=randomUUID(),pc=randomUUID();
 await must(service.from('workspaces').insert([{id:w1,name:'Synthetic review A',slug:'fin-a-'+suffix},{id:w2,name:'Synthetic review B',slug:'fin-b-'+suffix}]),'workspaces');
 await must(service.from('workspace_members').insert({workspace_id:w1,user_id:user.user.id,role:'owner'}),'membership');
 for(const [fund,workspace] of [[fa,w1],[fb,w1],[fc,w2]]){const program=randomUUID();await must(service.from('programs').insert({id:program,workspace_id:workspace,title:'Synthetic review fund',program_type:'local_measure',cycle_name:'FY26'}),'program');await must(service.from('measure_funds').insert({id:fund,workspace_id:workspace,program_id:program,receipt_cadence:'quarterly',currency_code:'USD'}),'fund');}
 for(const [period,fund,workspace] of [[pa,fa,w1],[pc,fc,w2]])await must(service.from('measure_fund_periods').insert({id:period,workspace_id:workspace,measure_fund_id:fund,period_label:'Q1',fiscal_year_label:'FY26',period_start:'2026-01-01',period_end:'2026-03-31',received_amount:1000}),'period');
 await must(member.auth.signInWithPassword({email,password}),'sign in');
 const row=(fund,period,workspace,category,amount=100)=>({workspace_id:workspace,measure_fund_id:fund,period_id:period,category_id:category,amount,computation_basis:'manual',rationale:'Synthetic native integrity review',stated_by:user.user.id,stated_on:'2026-10-01'});
 const replace=async(fund,period,rows)=>member.rpc('replace_measure_period_allocation',{p_measure_fund_id:fund,p_period_id:period,p_allocations:rows,p_off_the_top:[],p_reserves:[]});
 const control=await replace(fa,pa,[row(fa,pa,w1,'control')]);assert.equal(control.error,null);
 const harmless=await replace(fa,pa,[{...row(fa,pa,w1,'control'),rationale:'Equivalent synthetic note'}]);assert.equal(harmless.error,null);
 const negative=await replace(fa,pa,[row(fa,pa,w1,'negative',-.01)]);assert.equal(negative.error?.code,'23514');
 const kept=await must(member.from('measure_allocations').select('category_id,amount').eq('period_id',pa),'retained');assert.deepEqual(kept,[{category_id:'control',amount:100}]);
 const foreign=await replace(fa,pc,[row(fa,pc,w1,'foreign')]);assert(foreign.error,'Foreign-workspace period must fail');
 const mismatched=await replace(fb,pa,[row(fb,pa,w1,'mismatched')]);assert.equal(mismatched.error,null,'Observed same-workspace mismatch accepted');
 const rows=await must(member.from('measure_allocations').select('measure_fund_id,period_id,category_id,amount').eq('period_id',pa),'rows');assert.equal(rows.length,2);assert(rows.some(r=>r.measure_fund_id===fb));
 console.log(JSON.stringify({baseline:'891a0d89a848133d44b9e4f314a76a922cd71ace',matchedControlAccepted:!control.error,harmlessNoteAccepted:!harmless.error,negativeRejected:negative.error.code,priorAllocationPreserved:kept,foreignWorkspacePeriodRejected:foreign.error.code,sameWorkspaceWrongFundAccepted:!mismatched.error,periodAllocationCount:rows.length,fixtureWorkspaceIds:[w1,w2]},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});

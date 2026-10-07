import assert from 'node:assert/strict';
import {allocateMeasureReceipt,parseMeasureAllocationRule} from '../../../..//openplan/src/lib/measures/allocation';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const rule=parseMeasureAllocationRule({version:1,categories:[{id:'roads',label:'Roads',percentOfAllocable:100,distribution:{kind:'return_to_source',basisId:'population'}}],basisDefinitions:[{id:'population',label:'Population',statedSourceNote:'Synthetic review fixture',vintageRuleNote:'Synthetic 2026'}]});
function run(receipt:string,values:number[]){
 const out=allocateMeasureReceipt({rule,receiptAmount:receipt,recipients:ids.map(id=>({id,is_active:true})),basisValues:ids.map((id,i)=>({recipient_id:id,basis_id:'population',vintage_label:'2026',basis_value:values[i]})),basisVintageLabel:'2026'});
 assert(out.ok);const d=out.allocation.categories[0].distribution;assert(d.kind==='return_to_source');return d.shares.map(s=>s.amount);
}
const control=run('4.00',[1,1,1,1]); assert.deepEqual(control,[1,1,1,1]);
const boundary=run('0.02',[1,1,1,1]);assert.deepEqual(boundary,[.01,.01,.01,-.01]);
const larger=run('1000000.01',[1,1,1,0]);assert.deepEqual(larger,[333333.34,333333.34,333333.34,-.01]);
console.log(JSON.stringify({control,boundary,larger},null,2));

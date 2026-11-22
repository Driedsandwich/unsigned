import test from 'node:test';
import assert from 'node:assert/strict';
import { InferenceMode as modes } from 'firebase/ai';
import { createInference, rawInput, approvedInput, adminInput, sourceLabel } from '../src/inference.js';
import { residualRisks, participantRewrites } from '../src/domain.js';
import { Respondent } from '../src/respondent.js';
import { createDemoParticipation } from '../src/participation.js';

const raw = 'Honestly Maya changes the release plan every Tuesday standup and as the only QA person I find out last.';
const risks = [{text:'Maya',category:'name'},{text:'Tuesday standup',category:'weekday'},{text:'only QA person',category:'uncommon role'}];
const retained = 'Release changes should be shared sooner, especially for those involved in quality assurance.';
const result = (value, source = 'on_device') => ({response:{text:()=>value,inferenceSource:source}});
const tick = () => new Promise(resolve => setImmediate(resolve));
function respondent(infer) { return new Respondent({infer,send:async()=>{},question_id:'q',responseId:'r',delay:1000}); }
function pipeline({draft=retained, review=[]}={}) {
  const calls=[];
  const infer = createInference({modes,modelFactory:mode=>({generateContent:async prompt=>{
    calls.push({mode,prompt});
    return result(calls.length===1?JSON.stringify(risks):calls.length===2?draft:JSON.stringify(review));
  }})});
  return {infer,calls};
}
async function ready(m) {m.setRaw(raw);await m.rewrite();}

test('Source risks run first, rewrite receives terms/categories, then semantic draft review runs only on device',async()=>{
  const {infer,calls}=pipeline();const m=respondent(infer);await ready(m);
  assert.equal(calls.length,3);assert.ok(calls.every(c=>c.mode===modes.ONLY_ON_DEVICE));
  assert.match(calls[0].prompt,/Identify names/);assert.match(calls[1].prompt,/Rewrite team feedback/);
  for(const {text,category} of risks){assert.ok(calls[1].prompt.includes(text));assert.ok(calls[1].prompt.includes(category));}
  assert.match(calls[2].prompt,/semantic paraphrases/);assert.ok(calls[2].prompt.includes(retained));
  assert.ok(m.draftRisks.some(r=>r.text==='quality assurance'));assert.equal(m.canApprove(),false);
  m.approve(true);assert.equal(m.approved,false);assert.equal(await m.submit(),null);
});
test('Deterministic review catches exact terms, case variants, weekdays and QA role aliases without AI help',()=>{
  const draft='MAYA told testers at the Tuesday standup. Quality Assurance and QA agree.';
  const marked=residualRisks(draft,risks).map(r=>r.text);
  for(const term of ['MAYA','testers','Tuesday','Tuesday standup','Quality Assurance','QA'])assert.ok(marked.includes(term),term);
  assert.deepEqual(residualRisks('The Mayan calendar and equality matter.',risks),[]);
});
test('Semantic review blocks an unfamiliar paraphrase beyond the finite alias table',async()=>{
  const draft='Those who validate the product learn last.';
  assert.deepEqual(residualRisks(draft,risks),[]);
  const m=respondent(pipeline({draft,review:[{text:'Those who validate the product',category:'uncommon role'}]}).infer);
  await ready(m);assert.equal(m.canApprove(),false);assert.equal(m.draftRisks[0].text,'Those who validate the product');
});
test('Explicit retention unlocks approval for this version only; editing requires fresh review',async()=>{
  const m=respondent(pipeline().infer);await ready(m);m.acceptRisks(true);assert.equal(m.canApprove(),true);
  m.approve(true);assert.equal(m.approved,true);m.beginEdit();m.editDraft('Share release changes sooner with the team.');
  assert.equal(m.keepRisks,false);assert.equal(m.canApprove(),false);assert.equal(m.approved,false);
  await m.reviewDraft();assert.equal(m.canApprove(),true);assert.deepEqual(m.draftRisks,[]);
});
test('Source edits and regeneration clear explicit retention',async()=>{
  const m=respondent(pipeline().infer);await ready(m);m.acceptRisks(true);m.setRaw(raw+' Please help.');m.invalidate();
  assert.equal(m.keepRisks,false);assert.equal(m.canApprove(),false);
  const next=respondent(pipeline().infer);await ready(next);next.acceptRisks(true);await next.rewrite();assert.equal(next.keepRisks,false);
});
test('Approval and retention stay locked until the semantic check completes',async()=>{
  let resolve;let n=0;
  const m=respondent(async()=>++n===1?{value:risks}:n===2?{value:retained}:new Promise(r=>resolve=r));
  m.setRaw(raw);const pending=m.rewrite();await tick();assert.equal(m.phase,'checking');
  m.acceptRisks(true);m.approve(true);assert.equal(m.keepRisks,false);assert.equal(m.approved,false);
  resolve({value:[],source:'on_device'});await pending;assert.equal(m.canApprove(),false);
});
test('A stale semantic check cannot unlock an edited or newer draft',async()=>{
  const m=respondent(pipeline({draft:'Share updates sooner.'}).infer);await ready(m);m.beginEdit();
  let resolve;m.infer=()=>new Promise(r=>resolve=r);m.editDraft('First edit.');const pending=m.reviewDraft();
  m.editDraft('Second edit with Maya.');m.invalidate();resolve({value:[],source:'on_device'});await pending;
  assert.equal(m.draft,'Second edit with Maya.');assert.equal(m.canApprove(),false);
});
test('Malformed semantic review fails closed without sending any text',async()=>{
  let n=0;const infer=createInference({modes,modelFactory:()=>({generateContent:async()=>result(++n===1?JSON.stringify(risks):n===2?retained:'not JSON')})});
  const m=respondent(infer);await ready(m);assert.equal(m.device,'failed');assert.equal(m.raw,'');assert.equal(m.canApprove(),false);
});
test('Semantic risk claims that cannot be marked in the draft fail closed instead of silently disappearing',async()=>{
  const m=respondent(pipeline({review:[{text:'invented paraphrase absent from draft',category:'uncommon role'}]}).infer);
  await ready(m);assert.equal(m.device,'failed');assert.equal(m.canApprove(),false);assert.equal(m.raw,'');
});
test('Private review tokens cannot enter either cloud-capable feature',async()=>{
  const infer=createInference({modes,modelFactory:()=>assert.fail('No model allowed')});
  for(const feature of ['groupThemes','draftQuestion'])await assert.rejects(infer(feature,rawInput(retained,{risks,review:true})),/boundary/);
});
test('Demo question uses real PREFER_ON_DEVICE and SDK source with the administrator request',async()=>{
  const calls=[];const infer=createInference({modes,demo:true,availability:async()=>'available',modelFactory:mode=>({generateContent:async prompt=>{
    calls.push({mode,prompt});return result('How could release changes reach testers sooner?');
  }})});
  const r=await infer('draftQuestion',adminInput('Ask how release changes could reach testers sooner'));
  assert.equal(calls[0].mode,modes.PREFER_ON_DEVICE);assert.match(calls[0].prompt,/Ask how release changes could reach testers sooner/);
  assert.equal(r.simulated,false);assert.equal(sourceLabel(r),'Ran on device');assert.match(r.value,/testers sooner/);
});
for(const availability of ['unavailable','downloadable','downloading'])test(`Demo question simulates only unavailable local inference (${availability}) and reflects the request`,async()=>{
  const infer=createInference({modes,demo:true,availability:async()=>availability,modelFactory:()=>assert.fail('No cloud model')});
  const r=await infer('draftQuestion',adminInput('Ask how release changes could reach testers sooner'));
  assert.equal(sourceLabel(r),'Cloud fallback (simulated in demo)');assert.equal(r.source,null);
  assert.equal(r.value,'How release changes could reach testers sooner?');
  const different=await infer('draftQuestion',adminInput('Ask what would protect focus time'));
  assert.match(different.value,/focus time/);assert.notEqual(r.value,different.value);
});
test('Demo rejects unexpected cloud source and does not disguise device errors as unavailable',async()=>{
  for(const output of [result('Cloud output','in_cloud'),null]){
    const infer=createInference({modes,demo:true,availability:async()=>'available',modelFactory:()=>({generateContent:async()=>{if(!output)throw Error('local failure');return output;}})});
    await assert.rejects(infer('draftQuestion',adminInput('Ask a question')));
  }
});
test('Queued Demo availability is checked inside the device queue and stale drafts do not run',async()=>{
  let release,checks=0,current=true;
  const infer=createInference({modes,demo:true,availability:async()=>{checks++;return 'available';},modelFactory:()=>({generateContent:()=>new Promise(r=>release=r)})});
  const first=infer('rewrite',rawInput(raw));await tick();const second=infer('draftQuestion',adminInput('Ask'),{current:()=>current});
  await tick();assert.equal(checks,0);current=false;release(result('Neutral.'));await first;assert.equal(await second,null);assert.equal(checks,0);
});
function evidence(count) {
  const rows=Array.from({length:count},(_,i)=>({id:`r${i}`,approved_rewrite:`Shared concern ${i}.`}));
  return {rows,participants:rows.map((r,i)=>({id:`uid${i}`,response_id:r.id}))};
}
test('Three responses without three matching participants never pass the grouping boundary',()=>{
  const {rows,participants}=evidence(3);
  for(const markers of [undefined,[],participants.slice(0,2),participants.map(p=>({...p,response_id:'missing-'+p.id}))])assert.throws(()=>approvedInput(rows,markers));
});
test('Duplicate participant IDs or reused response references are rejected',()=>{
  const {rows,participants}=evidence(3);
  assert.throws(()=>approvedInput(rows,[participants[0],participants[0],participants[2]]),/Duplicate/);
  assert.throws(()=>approvedInput(rows,participants.map(p=>({...p,response_id:'r0'}))),/Duplicate/);
  assert.throws(()=>approvedInput([...rows,rows[0]],participants),/Duplicate/);
});
test('Cloud prompt contains only matched rewrites; orphan records and participant IDs do not affect bands',async()=>{
  const {rows,participants}=evidence(9);let prompt;
  const infer=createInference({modes,modelFactory:()=>({generateContent:async p=>{prompt=p;return result(JSON.stringify([{title:'Shared',summary:'Context helps.',members:[0,1,2,3,4,5,6,7,8]}]),'in_cloud');}})});
  const r=await infer('groupThemes',approvedInput(rows,participants.slice(0,3)));
  assert.equal(r.value[0].band,'3–5');assert.doesNotMatch(prompt,/uid0|response_id|Shared concern 3/);
  assert.equal(participantRewrites(rows,participants).length,9);
});
test('Demo enforces one atomic participation per sign-in per question, including retries',()=>{
  const store=createDemoParticipation({seed:false});const payload={question_id:'q1',approved_rewrite:'Shared concern.'};
  store.submit('u1','r1',payload);
  assert.throws(()=>store.submit('u1','r2',payload));assert.throws(()=>store.submit('u1','r1',payload));
  assert.throws(()=>store.submit('u2','r1',payload));assert.equal(store.approved('q1').participants.length,1);
  store.submit('u1','r2',{...payload,question_id:'q2'});assert.equal(store.approved('q2').participants.length,1);
  store.submit('u2','r3',payload);assert.throws(()=>approvedInput(...Object.values(store.approved('q1'))));
  store.submit('u3','r4',payload);const {rows,participants}=store.approved('q1');assert.equal(participantRewrites(rows,participants).length,3);
  assert.throws(()=>store.submit('u4','r5',{...payload,uid:'forbidden'}));assert.equal(store.approved('q1').participants.length,3);
});
test('Demo fixtures have one marker per response and simulated bands use only matched participants',async()=>{
  const {rows,participants}=createDemoParticipation().approved('check-in-001');assert.equal(rows.length,10);assert.equal(participants.length,10);
  const infer=createInference({modes,demo:true,modelFactory:()=>assert.fail('No cloud inference')});
  const r=await infer('groupThemes',approvedInput(rows,participants.slice(0,3)));assert.equal(r.value.length,1);assert.equal(r.value[0].band,'3–5');
});

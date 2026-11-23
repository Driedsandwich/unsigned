import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { POLICY, assertPolicy } from '../src/policy.js';
import { createInference, rawInput, approvedInput, adminInput, sourceLabel } from '../src/inference.js';
import { submission, validatePayload, thresholdThemes, publicThemes, riskSpans, respondentPath } from '../src/domain.js';
import { resolveConfig } from '../src/config.js';
import { Respondent } from '../src/respondent.js';
import { createTools } from '../mcp/tools.js';
import { InferenceMode } from 'firebase/ai';
const modes = InferenceMode;
const raw = 'Maya changed the plan on Tuesday. I am the only release lead.';
const rows = ['One neutral suggestion.','Another neutral suggestion.','A third neutral suggestion.'].map((approved_rewrite,i)=>({id:`response-${i}`,approved_rewrite}));
const participants = rows.map((r,i)=>({id:`person-${i}`,response_id:r.id}));
const result = (value, source = 'on_device') => ({ response: { text:()=>value, inferenceSource:source } });
function harness(response = result('Neutral words.')) {
  const calls=[];
  const infer=createInference({modes,modelFactory: mode => ({generateContent:async prompt=>{calls.push({mode,prompt});return response;}})});
  return {infer,calls};
}
function model(infer = async feature => ({value:feature==='rewrite'?'A shared checklist could help.':[],source:'on_device'}), send = async()=>{}) {
  return new Respondent({infer, send, question_id:'check-in-001',responseId:'random-response',delay:1000});
}
async function ready(m) {m.setRaw(raw); await m.rewrite();}
const tick = () => new Promise(resolve=>setImmediate(resolve));

test('Policy contains the four exact required feature routes', () => {
  assert.deepEqual(POLICY, {rewrite:{input:'raw',mode:'ONLY_ON_DEVICE'},identifyRisks:{input:'raw',mode:'ONLY_ON_DEVICE'},groupThemes:{input:'approved_batch',mode:'ONLY_IN_CLOUD'},draftQuestion:{input:'admin_request',mode:'PREFER_ON_DEVICE'}});
  assertPolicy(); assert.ok(Object.isFrozen(POLICY.rewrite));
});
for(const feature of ['rewrite','identifyRisks']) for(const mode of ['ONLY_IN_CLOUD','PREFER_ON_DEVICE','PREFER_IN_CLOUD']) test(`${feature} rejects unsafe policy ${mode} before SDK use`,()=>{
  assert.throws(()=>createInference({modes,policy:{...POLICY,[feature]:{input:'raw',mode}},modelFactory:()=>assert.fail('must not construct a model')}),/Raw input/);
});
test('Raw input tokens cannot enter cloud grouping or question drafting',async()=>{
  const h=harness(); const token=rawInput(raw);
  await assert.rejects(h.infer('groupThemes',token),/boundary/);
  await assert.rejects(h.infer('draftQuestion',token),/boundary/);
  assert.deepEqual(h.calls,[]); assert.doesNotMatch(JSON.stringify(token),/Maya/);
});
test('Forged input objects and unknown features are rejected',async()=>{
  const h=harness(); await assert.rejects(h.infer('rewrite',{kind:'raw',value:raw})); await assert.rejects(h.infer('unknown',rawInput(raw))); assert.equal(h.calls.length,0);
});
test('Both raw-reading features use SDK ONLY_ON_DEVICE',async()=>{
  const h=harness(result('[]'));
  await h.infer('rewrite',rawInput(raw)); await h.infer('identifyRisks',rawInput(raw));
  assert.deepEqual(h.calls.map(c=>c.mode),[modes.ONLY_ON_DEVICE,modes.ONLY_ON_DEVICE]);
});
test('SDK trailing empty lines are trimmed, actual inferenceSource retained',async()=>{
  const h=harness(result('  Neutral words.\n\n'));
  assert.deepEqual(await h.infer('rewrite',rawInput(raw)),{value:'Neutral words.',source:'on_device',simulated:false});
});
test('Unexpected or absent SDK inferenceSource fails closed',async()=>{
  for(const source of ['in_cloud','unknown',null]) await assert.rejects(harness(result('Neutral',source)).infer('rewrite',rawInput(raw)));
});
test('Cloud grouping only receives approved rewrites and always uses ONLY_IN_CLOUD',async()=>{
  const h=harness(result('[{"title":"Clarity","summary":"Shared context helps.","members":[0,1,2]}]','in_cloud'));
  const r=await h.infer('groupThemes',approvedInput(rows.map(r=>({...r,raw,uid:'private-id'})), participants));
  assert.equal(h.calls[0].mode,modes.ONLY_IN_CLOUD); assert.doesNotMatch(h.calls[0].prompt,/Maya|private-id|uid/); assert.equal(r.value[0].band,'3–5');
});
test('Grouping with fewer than three approved responses is rejected before inference',()=>{
  for(const count of [0,1,2]) assert.throws(()=>approvedInput(rows.slice(0,count), participants),/three/);
});
test('Administrator drafting uses SDK PREFER_ON_DEVICE and reports cloud fallback accurately',async()=>{
  const h=harness(result('What would help next week?','in_cloud'));
  const r=await h.infer('draftQuestion',adminInput('Ask about clarity.'));
  assert.equal(h.calls[0].mode,modes.PREFER_ON_DEVICE); assert.equal(sourceLabel(r),'Ran in cloud');
});
test('All potential device calls are serialized across features, including question drafting',async()=>{
  let active=0,max=0; const releases=[];
  const infer=createInference({modes,modelFactory:()=>({generateContent:async()=>{
    active++;max=Math.max(max,active);await new Promise(r=>releases.push(r));active--;return result('[]');
  }})});
  const a=infer('rewrite',rawInput(raw)); const b=infer('identifyRisks',rawInput(raw)); const c=infer('draftQuestion',adminInput('Ask one question.'));
  await tick();assert.equal(releases.length,1);releases.shift()();await a;await tick();assert.equal(releases.length,1);releases.shift()();await b;await tick();releases.shift()();await c;assert.equal(max,1);
});
test('Failed device call releases queue without cloud fallback',async()=>{
  const calls=[];let attempt=0;
  const infer=createInference({modes,modelFactory:mode=>({generateContent:async()=>{calls.push(mode);if(!attempt++)throw Error('unavailable');return result('Neutral.');}})});
  await assert.rejects(infer('rewrite',rawInput(raw))); await infer('rewrite',rawInput(raw)); assert.deepEqual(calls,[modes.ONLY_ON_DEVICE,modes.ONLY_ON_DEVICE]);
});
test('Superseded queued jobs never create a model',async()=>{
  const h=harness();assert.equal(await h.infer('rewrite',rawInput(raw),{current:()=>false}),null);assert.equal(h.calls.length,0);
});
test('Demo keeps real raw-text AI and simulates grouping plus unavailable-device question fallback',async()=>{
  const calls=[];const infer=createInference({modes,demo:true,availability:async()=>'unavailable',modelFactory:mode=>({generateContent:async()=>{calls.push(mode);return result('[]');}})});
  await infer('rewrite',rawInput(raw));await infer('identifyRisks',rawInput(raw));
  for(const [feature,input] of [['groupThemes',approvedInput(rows, participants)],['draftQuestion',adminInput('Ask about next week.')]]){
    const r=await infer(feature,input);assert.equal(r.simulated,true);assert.equal(r.source,null);assert.equal(sourceLabel(r),feature==='draftQuestion'?'Cloud fallback (simulated in demo)':'Simulated · no AI inference');
  }
  assert.deepEqual(calls,[modes.ONLY_ON_DEVICE,modes.ONLY_ON_DEVICE]);
});
test('Submission projects exactly question ID and the currently approved trimmed draft',()=>{
  const payload=submission({question_id:'check-in-001',draft:'  Approved words.\n',approved:true,version:4,draftVersion:4,raw,uid:'x'});
  assert.deepEqual(payload,{question_id:'check-in-001',approved_rewrite:'Approved words.'});
  assert.throws(()=>validatePayload({...payload,raw}));assert.throws(()=>validatePayload({...payload,uid:'x'}));
});
test('Stale, unapproved, empty and overlong submissions are rejected',()=>{
  const base={question_id:'check-in-001',draft:'Approved.',approved:true,version:2,draftVersion:2};
  for(const patch of [{approved:false},{draftVersion:1},{draft:'  '},{draft:'a'.repeat(1201)},{question_id:'bad/path'}])assert.throws(()=>submission({...base,...patch}));
});
test('Theme threshold uses distinct valid evidence indexes, never claimed model counts',()=>{
  const candidates=[{title:'Hidden',summary:'Never exposed.',members:[0,0,1,999,-1,'2'],count:100},{title:'Visible',summary:'Shared pattern.',members:[0,1,2,2]}];
  assert.deepEqual(thresholdThemes(candidates,3),[{title:'Visible',summary:'Shared pattern.',band:'3–5'}]);
});
test('Theme bands advance only at six and nine valid supporting responses',()=>{
  for(const [count,band] of [[2,null],[3,'3–5'],[5,'3–5'],[6,'6–8'],[8,'6–8'],[9,'9+']]){
    const themes=thresholdThemes([{title:'Theme',summary:'Summary.',members:Array.from({length:count},(_,i)=>i)}],count);assert.equal(themes[0]?.band??null,band);
  }
});
test('Public theme projection suppresses low counts and strips evidence and individual fields',()=>{
  const list=publicThemes([{title:'Hidden',summary:'No.',band:'3–5',count:2},{title:'Visible',summary:'Yes.',band:'6–8',members:[0,1,2],raw,approved_rewrite:'secret',uid:'person'},{title:'Hidden2',summary:'No.',band:'1–2'}]);
  assert.deepEqual(list,[{title:'Visible',summary:'Yes.',band:'6–8'}]);
});
test('Risk markers only quote exact substrings actually present on the device',()=>{
  assert.deepEqual(riskSpans(raw,[{text:'Maya',category:'name'},{text:'Tuesday',category:'weekday'},{text:'Invented',category:'name'}]),[{text:'Maya',category:'name'},{text:'Tuesday',category:'weekday'}]);
});
test('No model, preparing model and failed model all offer the structured path',()=>{
  for(const state of ['unavailable','preparing','failed'])assert.equal(respondentPath(state),'structured');assert.equal(respondentPath('ready'),'private');
});
test('Missing configuration enables Demo; invalid present configuration never silently enables it',()=>{
  assert.equal(resolveConfig(undefined).demo,true);assert.equal(resolveConfig(null).demo,true);assert.throws(()=>resolveConfig({}));
  assert.throws(()=>resolveConfig({firebase:{apiKey:'REPLACE',appId:'x',projectId:'x',authDomain:'x'},appCheckSiteKey:'x',cloudModel:'x'}));
});
test('Complete local configuration selects real Firebase mode',()=>{
  const value={firebase:{apiKey:'test',appId:'test-app',projectId:'test-project',authDomain:'test.invalid'},appCheckSiteKey:'test-site',cloudModel:'test-model'};
  assert.equal(resolveConfig(value).demo,false);
});
test('Preparing state offers a structured answer and rejects a late local result',async()=>{
  let release;const m=model(()=>new Promise(r=>release=r));m.setRaw(raw);const pending=m.rewrite();assert.equal(m.phase,'preparing');assert.equal(m.path(),'structured');
  m.structured('preparing');m.setTemplate('focus','0');m.approve(true);release({value:'Stale result',source:'on_device'});await pending;
  assert.equal(m.raw,'');assert.equal(m.draft,'Focus time: Protected focus time could help.');assert.equal(m.approved,true);
});
test('Unavailable AI clears raw text and permits only chosen templates',async()=>{
  const m=model(async()=>{throw Error('unavailable');});await ready(m);assert.equal(m.device,'failed');assert.equal(m.raw,'');m.setRaw(raw);assert.equal(m.raw,'');
  m.setTemplate('handoffs');assert.equal(m.canApprove(),false);m.setTemplate('handoffs','0');assert.equal(m.canApprove(),true);
});
test('Late old rewrite cannot replace a newer input or enable approval',async()=>{
  let release;const m=model(()=>new Promise(r=>release=r));m.setRaw(raw);const pending=m.rewrite();m.setRaw('A newer concern.');m.invalidate();release({value:'Old draft',source:'on_device'});await pending;
  assert.equal(m.draft,'');assert.equal(m.canApprove(),false);
});
test('Risk detection failure also fails closed to structured choices',async()=>{
  const m=model(async f=>{if(f==='identifyRisks')throw Error('bad JSON');return {value:'Neutral.',source:'on_device'};});await ready(m);assert.equal(m.phase,'structured');assert.equal(m.draft,'');assert.equal(m.raw,'');
});
test('Approval clears for both source edits and draft edits; protected edits require regenerate',async()=>{
  const m=model();await ready(m);m.approve(true);assert.equal(m.approved,true);m.beginEdit();m.editDraft('My neutral edit.');assert.equal(m.approved,false);
  m.approve(true);m.setRaw('Updated source');m.invalidate();assert.equal(m.approved,false);assert.equal(m.phase,'stale');assert.equal(m.draft,'My neutral edit.');assert.equal(m.canApprove(),false);
  await m.rewrite();assert.equal(m.canApprove(),true);
});
test('Sending locks the draft, prevents double clicks, and clears raw and risk data',async()=>{
  const calls=[];let release;const m=model(undefined,async(id,p)=>{calls.push({id,p});await new Promise(r=>release=r);});await ready(m);m.approve(true);const pending=m.submit();assert.equal(m.sending,true);assert.equal(await m.submit(),null);m.setRaw('Changed');assert.equal(m.raw,raw);release();await pending;
  assert.equal(calls.length,1);assert.deepEqual(Object.keys(calls[0].p),['question_id','approved_rewrite']);assert.equal(m.raw,'');assert.deepEqual(m.risks,[]);assert.equal(m.draft,'');assert.equal(await m.submit(),null);
});
test('Failed delivery retries the same random response ID and keeps approval reviewable',async()=>{
  let attempt=0;const ids=[];const m=model(undefined,async(id)=>{ids.push(id);if(!attempt++)throw Error('offline');});await ready(m);m.approve(true);assert.equal(await m.submit(),null);assert.equal(m.sent,null);assert.equal(m.sending,false);await m.submit();assert.deepEqual(ids,['random-response','random-response']);
});
test('Changing fallback topic or template clears approval',()=>{
  const m=model();m.structured();m.setTemplate('focus','0');m.approve(true);m.setTemplate('focus','1');assert.equal(m.approved,false);m.approve(true);m.setTemplate('decisions');assert.equal(m.canApprove(),false);
});
test('MCP emits only safe aggregate projections and filters below-three themes',async()=>{
  const tools=createTools({demo:false,loadThemes:async()=>[{title:'Hidden',summary:'Do not show.',band:'3–5',count:2},{title:'Visible',summary:'General.',band:'3–5',raw,uid:'person',members:[0,1,2]}]});
  assert.deepEqual(await tools.get_themes(),{themes:[{title:'Visible',summary:'General.',band:'3–5'}]});
});
test('MCP Demo returns fictional themes without reading a live file',async()=>{
  const tools=createTools({loadThemes:()=>assert.fail('must not read')});const result=await tools.get_themes();assert.equal(result.themes.length,2);assert.ok(result.themes.every(t=>['3–5','6–8','9+'].includes(t.band)));
});
test('MCP draft and schedule tools never infer or schedule and require human confirmation',async()=>{
  const saved=[];const tools=createTools({saveDraft:async d=>saved.push(d)});
  const draft=await tools.draft_check_in_question({request:'What would help next week?'});assert.equal(draft.inference,'none');assert.equal(draft.status,'draft');
  const scheduled=await tools.schedule_check_in({question:draft.question,proposed_date:'2026-12-01'});assert.equal(scheduled.scheduled,false);assert.equal(saved[0].human_confirmation_required,true);assert.equal(saved[0].status,'draft');
  await assert.rejects(tools.schedule_check_in({question:'Question?',proposed_date:'2026-02-31'}));assert.equal(saved.length,1);
});
test('Production HTML wiring has unique IDs and every direct DOM lookup exists',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8') + await readFile(new URL('../src/admin.html',import.meta.url),'utf8');
  const ui=await readFile(new URL('../src/main.js',import.meta.url),'utf8') + await readFile(new URL('../src/admin.js',import.meta.url),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
  for(const [,id] of ui.matchAll(/(?<!\$)\$\('([^']+)'\)/g))if(id!=='panel-')assert.ok(ids.includes(id),id);
  for(const [,refs] of html.matchAll(/\b(?:for|aria-controls|aria-labelledby|aria-describedby)="([^"]+)"/g))for(const id of refs.split(' '))assert.ok(ids.includes(id),id);
  assert.doesNotMatch(html,/lang="ja"|Simulated AI|AI is simulated/);assert.match(html,/Preparing|fallback-title/);
});
test('Only Firebase adapter imports inference SDK; no direct model API or telemetry transport',async()=>{
  const files=await readdir(new URL('../src',import.meta.url));
  for(const file of files.filter(f=>f.endsWith('.js'))){const s=await readFile(new URL('../src/'+file,import.meta.url),'utf8');
    if(file!=='firebase.js')assert.doesNotMatch(s,/from ['"]firebase\/ai/);
    if(file!=='config.js')assert.doesNotMatch(s,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|console\.(?:log|error)/);
    if (file !== 'i18n.js') assert.doesNotMatch(s,/LanguageModel\.(?:create|prompt)|localStorage|sessionStorage/);
  }
});
test('Firestore rules restrict response fields, creation, admin reading, and theme bands',async()=>{
  const rules=await readFile(new URL('../firestore.rules',import.meta.url),'utf8');
  const responses=rules.split('match /responses/')[1].split('match /themes/')[0];
  assert.match(responses,/hasOnly\(\['question_id', 'approved_rewrite', 'created_at'\]\)/);assert.match(responses,/allow read: if admin\(\)/);assert.match(responses,/allow update, delete: if false/);assert.match(responses,/created_at == request.time/);assert.match(rules,/unsigned_admin == true/);assert.match(rules,/band in \['3–5', '6–8', '9\+'\]/);
});
test('Ignore rules exclude real config and local agent data; Firebase is pinned',async()=>{
  const ignore=await readFile(new URL('../.gitignore',import.meta.url),'utf8');assert.match(ignore,/public\/firebase-config\.js/);assert.match(ignore,/mcp\/private\//);assert.match(ignore,/\.env/);
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));assert.equal(pkg.dependencies.firebase,'13.4.0');
});
test('Streaming rewrite grows only from on-device chunks and returns trimmed final text',async()=>{
  const chunks=[]; const infer=createInference({modes,modelFactory:mode=>({generateContentStream:async()=>{
    assert.equal(mode,modes.ONLY_ON_DEVICE);
    return {stream:(async function*(){yield result('Neutral ').response;yield result('words.\n\n').response;})(),response:Promise.resolve(result('Neutral words.\n\n').response)};
  }})});
  const r=await infer('rewrite',rawInput(raw),{onPartial:(s,source)=>chunks.push({s,source})});
  assert.deepEqual(chunks,[{s:'Neutral',source:'on_device'},{s:'Neutral words.',source:'on_device'}]);assert.equal(r.value,'Neutral words.');
});
test('Partial rewrite cannot be approved and stale streamed text is ignored',async()=>{
  let release,partial;const m=model(async(feature,token,options)=>{if(feature==='identifyRisks')return {value:[],source:'on_device'};partial=options.onPartial;partial('Growing draft','on_device');await new Promise(r=>release=r);return {value:'Completed draft',source:'on_device'};});
  m.setRaw(raw);const pending=m.rewrite();await tick();assert.equal(m.draft,'Growing draft');assert.equal(m.canApprove(),false);m.setRaw('A newer source');m.invalidate();partial('Stale partial','on_device');assert.notEqual(m.draft,'Stale partial');release();await pending;assert.equal(m.canApprove(),false);
});

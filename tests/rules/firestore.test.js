import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp, setLogLevel } from 'firebase/firestore';

// Never silently fall back to a real project or silently skip the rule suite.
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) throw new Error('Run npm run test:rules with the localhost Firestore emulator');
let env;
const anonymous = uid => env.authenticatedContext(uid, {firebase:{sign_in_provider:'anonymous'}}).firestore();
const admin = () => env.authenticatedContext('admin', {unsigned_admin:true,firebase:{sign_in_provider:'google.com'}}).firestore();
const response = (question_id='q1') => ({question_id,approved_rewrite:'Share changes sooner.',created_at:serverTimestamp()});
function pair(db, {uid='u1', id='r1', q='q1', data=response(q), marker={response_id:id,created_at:serverTimestamp()}}={}) {
  const batch=writeBatch(db);
  batch.set(doc(db,'responses',id),data);
  batch.set(doc(db,'checkins',q,'participants',uid),marker);
  return batch.commit();
}
before(async()=>{
  setLogLevel('silent');
  const [hostname,port]=host.split(':');
  env=await initializeTestEnvironment({projectId:'demo-unsigned',firestore:{host:hostname,port:Number(port),rules:await readFile(new URL('../../firestore.rules',import.meta.url),'utf8')}});
});
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    for(const [id,status] of [['q1','open'],['q2','open'],['closed','closed']])await setDoc(doc(db,'checkins',id),{question:'What would help?',status,created_at:Timestamp.now()});
    await setDoc(doc(db,'themes','q1','items','t1'),{title:'Shared context',summary:'Share changes sooner.',band:'3–5'});
  });
});
after(async()=>{await env?.cleanup();});

test('Valid response and matching participant are created together, with no identity field in response',async()=>{
  await assertSucceeds(pair(anonymous('u1')));
  const data=(await getDoc(doc(admin(),'responses','r1'))).data();
  assert.deepEqual(Object.keys(data).sort(),['approved_rewrite','created_at','question_id']);
});
for(const field of ['uid','respondent_id','author','email','raw','risks','inferenceSource'])test(`Response rejects extra field ${field}`,async()=>{
  await assertFails(pair(anonymous('u1'),{data:{...response(),[field]:'forbidden'}}));
  assert.equal((await getDoc(doc(admin(),'checkins','q1','participants','u1'))).exists(),false);
});
for(const field of ['question_id','approved_rewrite','created_at'])test(`Response requires field ${field}`,async()=>{
  const data=response();delete data[field];await assertFails(pair(anonymous('u1'),{data}));
});
test('Response without a participant in the same atomic write is denied',async()=>{
  await assertFails(setDoc(doc(anonymous('u1'),'responses','r1'),response()));
});
test('Participant without its response is denied',async()=>{
  await assertFails(setDoc(doc(anonymous('u1'),'checkins','q1','participants','u1'),{response_id:'r1',created_at:serverTimestamp()}));
});
test('Participant cannot be added later to a preexisting orphan response',async()=>{
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'responses','legacy'),{...response(),created_at:Timestamp.now()}));
  await assertFails(setDoc(doc(anonymous('u1'),'checkins','q1','participants','u1'),{response_id:'legacy',created_at:serverTimestamp()}));
});
test('Existing participant cannot authorize a later response',async()=>{
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'checkins','q1','participants','u1'),{response_id:'r1',created_at:Timestamp.now()}));
  await assertFails(setDoc(doc(anonymous('u1'),'responses','r1'),response()));
});
test('Second participation for the same UID and question is denied atomically',async()=>{
  const db=anonymous('u1');await assertSucceeds(pair(db));
  await assertFails(pair(db,{id:'r2'}));
  assert.equal((await getDoc(doc(admin(),'responses','r2'))).exists(),false);
});
test('Three different anonymous UIDs can participate once each',async()=>{
  for(let i=1;i<=3;i++)await assertSucceeds(pair(anonymous(`u${i}`),{uid:`u${i}`,id:`r${i}`}));
  assert.equal((await getDocs(collection(admin(),'checkins','q1','participants'))).size,3);
});
test('Same anonymous UID may participate once in another question',async()=>{
  const db=anonymous('u1');await assertSucceeds(pair(db));await assertSucceeds(pair(db,{q:'q2',id:'r2'}));
});
test('A caller cannot create a participant under another UID',async()=>{
  await assertFails(pair(anonymous('u1'),{uid:'u2'}));
});
test('One participant cannot authorize two responses in one batch',async()=>{
  const db=anonymous('u1'),batch=writeBatch(db);
  for(const id of ['r1','r2'])batch.set(doc(db,'responses',id),response());
  batch.set(doc(db,'checkins','q1','participants','u1'),{response_id:'r1',created_at:serverTimestamp()});
  await assertFails(batch.commit());assert.equal((await getDocs(collection(admin(),'responses'))).size,0);
});
test('Mismatched response reference or question is denied',async()=>{
  await assertFails(pair(anonymous('u1'),{marker:{response_id:'wrong',created_at:serverTimestamp()}}));
  await assertFails(pair(anonymous('u1'),{data:response('q2')}));
});
test('Participant rejects extra fields and client timestamps',async()=>{
  await assertFails(pair(anonymous('u1'),{marker:{response_id:'r1',created_at:serverTimestamp(),raw:'private'}}));
  await assertFails(pair(anonymous('u1'),{marker:{response_id:'r1',created_at:Timestamp.fromMillis(0)}}));
  await assertFails(pair(anonymous('u1'),{data:{...response(),created_at:Timestamp.fromMillis(0)}}));
});
test('Closed and missing questions reject response pairs',async()=>{
  for(const q of ['closed','missing'])await assertFails(pair(anonymous('u1'),{q}));
});
test('Empty, oversized and invalid response values are denied',async()=>{
  for(const approved_rewrite of ['', '   ', 'a'.repeat(1201),42])await assertFails(pair(anonymous('u1'),{data:{...response(),approved_rewrite}}));
});
test('Response and participant updates and deletes are denied, including to administrators',async()=>{
  await pair(anonymous('u1'));
  for(const db of [anonymous('u1'),admin()])for(const path of [['responses','r1'],['checkins','q1','participants','u1']]){
    await assertFails(updateDoc(doc(db,...path),{created_at:serverTimestamp()}));await assertFails(deleteDoc(doc(db,...path)));
  }
});
test('Anonymous users, unclaimed Google users and anonymous admin claims cannot read responses, themes or markers',async()=>{
  await pair(anonymous('u1'));
  const clients=[anonymous('u1'),env.unauthenticatedContext().firestore(),env.authenticatedContext('google',{firebase:{sign_in_provider:'google.com'}}).firestore(),env.authenticatedContext('fake-admin',{unsigned_admin:true,firebase:{sign_in_provider:'anonymous'}}).firestore()];
  for(const db of clients){
    for(const path of [['responses','r1'],['themes','q1','items','t1'],['checkins','q1','participants','u1']])await assertFails(getDoc(doc(db,...path)));
    for(const path of [['responses'],['themes','q1','items'],['checkins','q1','participants']])await assertFails(getDocs(collection(db,...path)));
  }
});
test('Only Google users with the admin claim can read responses, themes and participants',async()=>{
  await pair(anonymous('u1'));const db=admin();
  for(const path of [['responses','r1'],['themes','q1','items','t1'],['checkins','q1','participants','u1']])await assertSucceeds(getDoc(doc(db,...path)));
  for(const path of [['responses'],['themes','q1','items'],['checkins','q1','participants']])await assertSucceeds(getDocs(collection(db,...path)));
});
test('Non-anonymous identities cannot submit even when they have an admin claim',async()=>{
  await assertFails(pair(admin(),{uid:'admin'}));await assertFails(pair(env.unauthenticatedContext().firestore()));
});
test('Themes enforce admin writes, allowed bands and exact schema',async()=>{
  const data={title:'Context',summary:'Share context.',band:'3–5'};
  await assertFails(setDoc(doc(anonymous('u1'),'themes','q1','items','new'),data));
  await assertSucceeds(setDoc(doc(admin(),'themes','q1','items','new'),data));
  await assertFails(setDoc(doc(admin(),'themes','q1','items','new'),{...data,band:'1–2'}));
  await assertFails(setDoc(doc(admin(),'themes','q1','items','new'),{...data,raw:'private'}));
});

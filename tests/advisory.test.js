import test from 'node:test';
import assert from 'node:assert/strict';
import { InferenceMode as modes } from 'firebase/ai';
import { createInference, rawInput } from '../src/inference.js';
import { literalSpans, semanticNotes } from '../src/domain.js';
import { Respondent } from '../src/respondent.js';
import { privateCall, PRIVATE_CALL_TIMEOUT_MS } from '../src/private-check.js';

const raw = 'Honestly Maya changes the release plan every Tuesday standup and as the only QA person I find out last.';
const draft = "There's a concern about adjustments to the release schedule. It's felt that updates aren't always communicated effectively to the team. A suggestion is to improve communication regarding changes to the plan. Better coordination could help ensure everyone is aware of updates.";
const risks = [{ text: 'Maya', category: 'name' }, { text: 'Tuesday standup', category: 'weekday' }, { text: 'only QA person', category: 'uncommon role' }];
const sentences = ["It's felt that updates aren't always communicated effectively to the team.", 'Better coordination could help ensure everyone is aware of updates.'];
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = value => ({ response: { text: () => typeof value === 'string' ? value : JSON.stringify(value), inferenceSource: 'on_device' } });
function setup({ output = draft, review = [], failAt, failure = Error('sensitive input must not be logged: ' + raw) } = {}) {
  const sent = [], calls = [];
  const infer = createInference({ modes, modelFactory: mode => ({ generateContent: async prompt => {
    calls.push({ mode, prompt });
    if (calls.length === failAt) throw failure;
    return response(calls.length === 1 ? risks : calls.length === 2 ? output : review);
  } }) });
  return { m: new Respondent({ infer, send: async (_id, payload) => sent.push(payload), question_id: 'q', responseId: 'r' }), sent, calls };
}
async function ready(m) { m.setRaw(raw); await m.rewrite(); }

test('Reported Chrome 158 draft remains approvable despite linked sentence claims, with no sentence highlights', async () => {
  const { m, sent, calls } = setup({ review: sentences.map(text => ({ text, sourceRiskIndex: 2 })) });
  await ready(m);
  assert.deepEqual(m.draftRisks, []); assert.equal(m.keepRisks, false); assert.equal(m.canApprove(), false);
  assert.equal(m.aiNotes.length, 2);
  for (const note of m.aiNotes) { assert.equal(note.sourceRiskIndex, 2); assert.equal(note.text, ''); assert.deepEqual(note.spans, []); }
  assert.match(calls[2].prompt, /1 to 4 words/);
  assert.ok(calls.every(call => call.mode === modes.ONLY_ON_DEVICE));
  m.acceptAdvisory(true); m.approve(true); await m.submit();
  assert.deepEqual(sent, [{ question_id: 'q', approved_rewrite: draft }]);
  assert.deepEqual(m.aiNotes, []);
});
for (const term of ['quality assurance', 'testers', 'tester', 'Maya', 'Tuesday']) {
  test(`Adding ${term} to the reported draft requires explicit retention and marks only the matching phrase`, async () => {
    const { m } = setup(); await ready(m); m.approve(true); m.beginEdit();
    m.editDraft(`${draft} ${term}`);
    assert.equal(m.approved, false); assert.equal(m.canApprove(), false);
    assert.deepEqual(m.draftRisks.map(r => r.text), [term]);
    await m.reviewDraft(); assert.equal(m.canApprove(), false);
    m.acceptRisks(true); m.approve(true); assert.equal(m.approved, true);
    m.editDraft(draft); assert.equal(m.keepRisks, false); assert.equal(m.approved, false); assert.equal(m.canApprove(), true);
    await m.reviewDraft();
  });
}
test('Only literal phrases of 1–4 words get advisory spans; sentences and absent phrases remain notes only', () => {
  const value = 'Experts validate the product. They share changes promptly today.';
  for (const phrase of ['Experts', 'the product', 'validate the product', 'They share changes promptly']) {
    const [note] = semanticNotes(value, [{ text: phrase, sourceRiskIndex: 2 }], risks);
    assert.equal(note.text, phrase); assert.equal(note.spans.length, 1);
    assert.equal(value.slice(note.spans[0].start, note.spans[0].end), phrase);
  }
  for (const phrase of ['Experts validate the product.', 'Experts validate the product', 'Experts validate the product. They', 'missing words', 'experts', '', 'product. They']) {
    const [note] = semanticNotes(value, [{ text: phrase, sourceRiskIndex: 2 }], risks);
    assert.equal(note.text, ''); assert.deepEqual(note.spans, []);
  }
});
test('Term highlights do not spread into longer words when the same term also occurs independently', () => {
  assert.deepEqual(literalSpans('Maya Mayan Maya', 'Maya'), [{ start: 0, end: 4 }, { start: 11, end: 15 }]);
  assert.deepEqual(semanticNotes('testers tester', [{ text: 'tester', sourceRiskIndex: 2 }], risks)[0].spans, [{ start: 8, end: 14 }]);
});
for (const output of [draft, draft + ' quality assurance']) for (const kind of ['error', 'timeout']) {
  test(`Semantic ${kind} keeps the private draft and ${output === draft ? 'allows approval' : 'requires deterministic retention'}`, async t => {
    const warn = t.mock.method(console, 'warn', () => {});
    const failure = kind === 'timeout' ? new DOMException(raw, 'TimeoutError') : Error(raw);
    const { m, sent } = setup({ output, failAt: 3, failure }); await ready(m);
    assert.equal(m.device, 'ready'); assert.equal(m.phase, 'ready'); assert.equal(m.path(), 'private');
    assert.equal(m.raw, raw); assert.equal(m.draft, output); assert.equal(m.canApprove(), output === draft);
    assert.match(m.reviewWarning, new RegExp(`AI check unavailable — review the draft yourself \\(Semantic draft check: ${kind}\\)`));
    assert.deepEqual(warn.mock.calls.map(c => c.arguments), [[`[Unsigned] Semantic draft check: ${kind}`]]);
    assert.deepEqual(sent, []);
    if (m.draftRisks.length) m.acceptRisks(true);
    m.approve(true); await m.submit(); assert.deepEqual(sent, [{ question_id: 'q', approved_rewrite: output }]);
  });
}
for (const failAt of [1, 2]) for (const kind of ['error', 'timeout']) {
  const stage = failAt === 1 ? 'Source risk check' : 'Rewrite';
  test(`${stage} ${kind} falls back to structured choices with a sanitized stage diagnostic`, async t => {
    const warn = t.mock.method(console, 'warn', () => {});
    const { m, sent } = setup({ failAt, failure: kind === 'timeout' ? new DOMException(raw, 'TimeoutError') : Error(raw) });
    await ready(m); assert.equal(m.phase, 'structured'); assert.equal(m.raw, ''); assert.equal(m.draft, ''); assert.equal(m.canApprove(), false);
    assert.ok(m.error.startsWith(`${stage}: ${kind}.`)); assert.ok(!m.error.includes(raw));
    assert.deepEqual(warn.mock.calls.map(c => c.arguments), [[`[Unsigned] ${stage}: ${kind}`]]);
    assert.deepEqual(sent, []); m.setTemplate('focus', '0'); assert.equal(m.canApprove(), true);
  });
}
test('Malformed semantic JSON is unavailable, never a structured fallback for the reported neutral draft', async t => {
  t.mock.method(console, 'warn', () => {});
  const { m } = setup({ review: 'not JSON' }); await ready(m);
  assert.equal(m.phase, 'ready'); assert.equal(m.canApprove(), true); assert.match(m.reviewWarning, /Semantic draft check: error/);
});
test('Approval is possible before semantic completion and late review cannot modify a sent response', async () => {
  const { m, sent } = setup(); await ready(m); m.beginEdit();
  let release;
  m.infer = () => new Promise(resolve => { release = resolve; });
  m.editDraft(draft); const pending = m.reviewDraft();
  assert.equal(m.reviewPending, true); assert.equal(m.canApprove(), true);
  m.approve(true); await m.submit();
  release({ value: [{ text: 'concern', sourceRiskIndex: 0 }], source: 'on_device' }); await pending;
  assert.deepEqual(sent, [{ question_id: 'q', approved_rewrite: draft }]);
  assert.equal(m.draft, ''); assert.deepEqual(m.aiNotes, []); assert.equal(m.reviewPending, false);
});
test('First-call preparation of 11 seconds plus generation fits the explicit 60-second per-call limit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(PRIVATE_CALL_TIMEOUT_MS, 60_000);
  let calls = 0;
  const m = new Respondent({ question_id: 'q', responseId: 'r', send: async () => {}, infer: () => {
    const n = ++calls;
    return new Promise(resolve => setTimeout(() => resolve({ value: n === 1 ? risks : n === 2 ? draft : [], source: 'on_device' }), n === 1 ? 11_000 + 5_000 : 5_000));
  } });
  m.setRaw(raw); const pending = m.rewrite();
  t.mock.timers.tick(11_000); await tick(); assert.equal(m.phase, 'preparing');
  t.mock.timers.tick(5_000); await tick(); assert.equal(m.phase, 'rewriting');
  t.mock.timers.tick(5_000); await tick(); assert.equal(m.phase, 'ready'); assert.equal(m.canApprove(), true);
  t.mock.timers.tick(5_000); await pending; assert.equal(m.reviewWarning, '');
});
for (const stuckAt of [1, 2, 3]) test(`Actual deadline at stage ${stuckAt} ignores late results and streaming chunks`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const warn = t.mock.method(console, 'warn', () => {});
  let calls = 0, release, partial;
  const m = new Respondent({ question_id: 'q', responseId: 'r', send: async () => {}, infer: (_feature, _token, options) => {
    const n = ++calls;
    if (n === stuckAt) { partial = options.onPartial; return new Promise(resolve => { release = resolve; }); }
    return Promise.resolve({ value: n === 1 ? risks : n === 2 ? draft : [], source: 'on_device' });
  } });
  m.setRaw(raw); const pending = m.rewrite(); await tick();
  t.mock.timers.tick(PRIVATE_CALL_TIMEOUT_MS); await pending;
  assert.equal(m.phase, stuckAt === 3 ? 'ready' : 'structured'); assert.equal(m.canApprove(), stuckAt === 3);
  assert.equal(warn.mock.calls.length, 1); assert.match(warn.mock.calls[0].arguments[0], /: timeout$/);
  const snapshot = JSON.stringify({ draft: m.draft, notes: m.aiNotes, warning: m.reviewWarning, error: m.error });
  partial?.('Late identifying output', 'on_device'); release({ value: stuckAt === 2 ? 'Late draft' : [], source: 'on_device' }); await tick();
  assert.equal(JSON.stringify({ draft: m.draft, notes: m.aiNotes, warning: m.reviewWarning, error: m.error }), snapshot);
});

test('Timed-out Firebase operation retains its queue slot, and expired queued work never starts a model', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0, release;
  const infer = createInference({ modes, modelFactory: () => ({ generateContent: async () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { release = resolve; });
    return response('[]');
  } }) });
  const first = privateCall(infer, 'identifyRisks', rawInput(raw), { current: () => true });
  const rejectedFirst = assert.rejects(first, { name: 'TimeoutError' }); await tick();
  t.mock.timers.tick(PRIVATE_CALL_TIMEOUT_MS); await rejectedFirst;
  const queued = privateCall(infer, 'identifyRisks', rawInput(raw), { current: () => true });
  const rejectedQueued = assert.rejects(queued, { name: 'TimeoutError' }); await tick();
  assert.equal(calls, 1);
  t.mock.timers.tick(PRIVATE_CALL_TIMEOUT_MS); await rejectedQueued;
  release(response('[]')); await tick(); assert.equal(calls, 1);
  await infer('identifyRisks', rawInput(raw)); assert.equal(calls, 2);
});

test('Streaming final-response timeouts retain their stage classification without leaking the SDK error', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const infer = createInference({ modes, modelFactory: () => ({
    generateContent: async () => response(risks),
    generateContentStream: async () => ({
      stream: (async function* () { yield response('Partial private draft').response; })(),
      response: Promise.reject(new DOMException(raw, 'TimeoutError'))
    })
  }) });
  const m = new Respondent({ infer, send: async () => assert.fail('Must not send'), question_id: 'q', responseId: 'r' });
  await ready(m); assert.equal(m.phase, 'structured'); assert.equal(m.draft, '');
  assert.match(m.error, /^Rewrite: timeout/);
  assert.deepEqual(warn.mock.calls.map(c => c.arguments), [['[Unsigned] Rewrite: timeout']]);
});

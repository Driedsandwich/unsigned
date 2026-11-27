import test from 'node:test';
import assert from 'node:assert/strict';
import { InferenceMode as modes } from 'firebase/ai';
import { createInference } from '../src/inference.js';
import { semanticNotes, draftAdvisoryNotes, hasSpecificWord } from '../src/domain.js';
import { Respondent } from '../src/respondent.js';

// 11/27 Chrome 158 sandbox run: the sample insertion and the draft that wrongly got marks and a Maya note.
const raw = 'As the only release lead, I chased Maya on Tuesday for the notes. A shared checklist would help.';
const sourceRisks = [
  { text: 'only release lead', category: 'uncommon role' },
  { text: 'Maya', category: 'name' },
  { text: 'Tuesday', category: 'weekday' }
];
const draft = 'It was challenging to obtain necessary information. A standardized checklist could improve communication and information flow.';
const ordinaryReview = [
  { text: 'standardized checklist', sourceRiskIndex: 1 },
  { text: 'improve communication', sourceRiskIndex: 1 },
  { text: 'information flow', sourceRiskIndex: 1 }
];
const response = value => ({ response: { text: () => typeof value === 'string' ? value : JSON.stringify(value), inferenceSource: 'on_device' } });
function setup({ rewrite = draft, review = ordinaryReview } = {}) {
  let n = 0;
  const infer = createInference({ modes, modelFactory: () => ({ generateContent: async () => response(++n === 1 ? sourceRisks : n === 2 ? rewrite : review) }) });
  return new Respondent({ infer, send: async () => {}, question_id: 'q', responseId: 'r' });
}
const ready = async m => { m.setRaw(raw); await m.rewrite(); };

test('Ordinary draft phrases get no AI marks and the draft side has 0 marks for the sample', async () => {
  const m = setup(); await ready(m);
  assert.deepEqual(m.draftRisks, []);
  assert.deepEqual(m.aiNotes, []);
  assert.equal(m.aiNotes.flatMap(n => n.spans).length + m.draftRisks.length, 0);
  assert.equal(m.needsAdvisoryConfirm(), false); assert.equal(m.canApprove(), true);
});
test('The draft-side filter uses the same ordinary-word list as the source side', () => {
  for (const phrase of ['standardized checklist', 'improve communication', 'information flow']) assert.equal(hasSpecificWord(phrase), false, phrase);
  for (const phrase of ['Maya', 'Tuesday', 'release lead', 'validate the product']) assert.equal(hasSpecificWord(phrase), true, phrase);
  const [note] = semanticNotes(draft, [{ text: 'standardized checklist', sourceRiskIndex: 1 }], sourceRisks);
  assert.equal(note.text, ''); assert.deepEqual(note.spans, []);
  const [kept] = semanticNotes('Maya joined.', [{ text: 'Maya', sourceRiskIndex: 1 }], sourceRisks);
  assert.equal(kept.text, 'Maya'); assert.equal(kept.spans.length, 1);
});
test('No “may still point to Maya” note when neither Maya nor a fixed alias is in the draft', () => {
  assert.deepEqual(draftAdvisoryNotes(draft, semanticNotes(draft, ordinaryReview, sourceRisks), sourceRisks), []);
  assert.deepEqual(draftAdvisoryNotes(draft, [{ sourceRiskIndex: 1, category: 'name', text: '', spans: [] }, { sourceRiskIndex: 9, text: '', spans: [] }], sourceRisks), []);
});
for (const [term, index] of [['Maya', 1], ['Tuesday', 2], ['Tue', 2], ['release manager', 0]]) {
  test(`Adding ${term} to the draft still gates approval and still shows the AI note`, async () => {
    const m = setup({ rewrite: `${draft} ${term}`, review: [{ text: term, sourceRiskIndex: index }] }); await ready(m);
    assert.ok(m.draftRisks.some(r => r.text.toLowerCase() === term.toLowerCase()), term);
    assert.equal(m.canApprove(), false);
    assert.equal(m.aiNotes.length, 1); assert.equal(m.aiNotes[0].sourceRiskIndex, index);
    m.acceptRisks(true); m.acceptAdvisory(true); assert.equal(m.canApprove(), true);
  });
}
test('A paraphrase note with a specific word stays even when the flag is absent; ordinary-word and phrase-less notes do not', () => {
  const d = 'Those who validate the product learn last.';
  const risk = [{ text: 'only QA person', category: 'uncommon role' }];
  const kept = draftAdvisoryNotes(d, semanticNotes(d, [{ text: 'validate the product', sourceRiskIndex: 0 }], risk), risk);
  assert.equal(kept.length, 1); assert.equal(kept[0].text, 'validate the product');
  assert.equal(draftAdvisoryNotes(d, semanticNotes(d, [{ text: 'learn last', sourceRiskIndex: 0 }], risk), risk).length, 1);
  assert.equal(draftAdvisoryNotes(d, semanticNotes(d, [{ text: '', sourceRiskIndex: 0 }], risk), risk).length, 0);
  assert.equal(draftAdvisoryNotes(draft, semanticNotes(draft, [{ text: 'information flow', sourceRiskIndex: 0 }], risk), risk).length, 0);
});
test('A sole-role leftover (alone + role) still gates approval and keeps its AI note', async () => {
  const text = 'I was the only release person on the team. A shared checklist would help.';
  const m = setup({ rewrite: text, review: [{ text: 'only release person', sourceRiskIndex: 0 }] }); await ready(m);
  assert.ok(m.draftRisks.length > 0); assert.equal(m.canApprove(), false);
  assert.equal(m.aiNotes.length, 1);
});

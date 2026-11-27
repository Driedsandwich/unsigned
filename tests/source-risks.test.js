import test from 'node:test';
import assert from 'node:assert/strict';
import { InferenceMode as modes } from 'firebase/ai';
import { riskSpans, ruleBasedSourceRisks } from '../src/domain.js';
import { createInference } from '../src/inference.js';
import { Respondent } from '../src/respondent.js';

function respondent(candidates, rewrite) {
  const outputs = [candidates, rewrite, []];
  const infer = createInference({ modes, modelFactory: mode => {
    assert.equal(mode, modes.ONLY_ON_DEVICE);
    return { generateContent: async () => {
      const value = outputs.shift() ?? [];
      return { response: {
        inferenceSource: 'on_device',
        text: () => typeof value === 'string' ? value : JSON.stringify(value)
      } };
    } };
  } });
  return new Respondent({ infer, question_id: 'q', responseId: 'r', send: () => assert.fail('No submission expected') });
}

test('Ordinary English words reported on November 24 produce no highlights or retention checkbox', async () => {
  const original = 'Our handoffs could use three bullet points. “Right now, we rely on memory each week.”';
  const candidates = ['Our', 'handoffs', 'three', 'bullet points', 'memory', 'Right', 'week']
    .map(text => ({ text, category: 'name' }));
  assert.deepEqual(ruleBasedSourceRisks(original), []);
  const model = respondent(candidates, original);
  model.setRaw(original);
  await model.rewrite();
  assert.deepEqual(model.risks, []);
  assert.deepEqual(model.draftRisks, []);
  assert.equal(model.needsAdvisoryConfirm(), false);
  assert.equal(model.canApprove(), true);
});

test('Model source candidates require exact text and identifying evidence', () => {
  const original = 'Élan may help. “Élan can wait.” I met ÉLise in November with １２ notes and a release coordinator on Tue.';
  const expected = [
    { text: 'ÉLise', category: 'other identifying detail' },
    { text: 'November', category: 'other identifying detail' },
    { text: '１２ notes', category: 'other identifying detail' },
    { text: 'release coordinator', category: 'uncommon role' },
    { text: 'Tue', category: 'other identifying detail' }
  ];
  const candidates = [
    ...expected,
    { text: 'élise', category: 'name' },
    { text: 'Élan', category: 'other identifying detail' },
    { text: 'may', category: 'date' },
    { text: 'met', category: 'other identifying detail' },
    { text: '.', category: 'weekday' }
  ];
  assert.deepEqual(riskSpans(original, candidates), expected);
});

for (const { language, original, neutral, details } of [
  {
    language: 'English',
    original: 'Maya shares notes on Tuesday with the only QA person',
    neutral: 'Share notes earlier.',
    details: [
      ['Maya', 'Share notes with MAYA.', 'MAYA'],
      ['Tuesday', 'Share notes on Tue.', 'Tue'],
      ['only QA person', 'Share notes with quality assurance.', 'quality assurance']
    ]
  },
  {
    language: 'Japanese',
    original: 'マヤさんに火曜の引き継ぎについて聞いた。自分は唯一のリリース担当です。',
    neutral: '引き継ぎのメモを早めに共有してほしい。',
    details: [
      ['マヤさん', 'マヤさんに共有してほしい。', 'マヤさん'],
      ['火曜', '火曜日に情報を共有してほしい。', '火曜'],
      ['唯一のリリース担当', 'リリースは担当者が一人で進めています。', '一人で']
    ]
  }
]) {
  test(`${language} rules flag identifying details with an empty AI result and gate approval on residuals`, async () => {
    const model = respondent([], neutral);
    model.setRaw(original);
    await model.rewrite();
    assert.equal(model.canApprove(), true);
    for (const [source, draft, residual] of details) {
      assert.ok(model.risks.some(r => r.text === source), source);
      model.beginEdit();
      model.editDraft(draft);
      await model.reviewDraft();
      assert.ok(model.draftRisks.some(r => r.text === residual), residual);
      model.approve(true);
      assert.equal(model.approved, false);
      model.acceptRisks(true);
      assert.equal(model.canApprove(), true);
    }
  });
}

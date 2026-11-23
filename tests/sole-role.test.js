import test from 'node:test';
import assert from 'node:assert/strict';
import { InferenceMode as modes } from 'firebase/ai';
import { createInference } from '../src/inference.js';
import { residualRisks, ruleBasedSourceRisks, thresholdThemes } from '../src/domain.js';
import { EXAMPLES_JA, TEMPLATES_JA, demoThemesFromRewrites, classifyDemoRewrite } from '../src/fixtures.js';
import { Respondent } from '../src/respondent.js';
import { approvedInput } from '../src/inference.js';

const jaRisks = [
  { text: 'マヤさん', category: 'name' },
  { text: '火曜', category: 'weekday' },
  { text: '唯一のリリース担当', category: 'uncommon role' }
];
const neutralJa = '会議が多くて集中できない。静かな時間がほしい。';
const extraSoleDraft = 'リリースは担当者が一人で担当しています。';

const soleDrafts = [
  'リリース作業を担当するメンバーが一人で担当しているため、引き継ぎメモの共有が難しい。チェックリストがあると助かる。',
  'リリース作業は、担当者が一人で進めているようです。引き継ぎの仕組みを整えたい。'
];

test('Rule-based source scan flags Japanese handoffs sample when AI returns none', () => {
  const found = ruleBasedSourceRisks(EXAMPLES_JA.handoffs);
  assert.equal(found.length, 3);
  assert.ok(found.some(r => r.text === 'マヤさん' && r.category === 'name'));
  assert.ok(found.some(r => r.text === '火曜' && r.category === 'weekday'));
  assert.ok(found.some(r => r.text === '唯一のリリース担当' && r.category === 'uncommon role'));
  assert.deepEqual(ruleBasedSourceRisks(neutralJa), []);
});

test('Merged identifyRisks uses rule-based flags when the model returns []', async () => {
  const jaDraft = '引き継ぎメモを共有できる仕組みがあると助かる。';
  let n = 0;
  const infer = createInference({
    modes,
    modelFactory: () => ({
      generateContent: async () => {
        n++;
        return {
          response: { text: () => (n === 1 ? '[]' : n === 2 ? jaDraft : '[]'), inferenceSource: 'on_device' }
        };
      }
    })
  });
  const m = new Respondent({ infer, send: async () => {}, question_id: 'q', responseId: 'r', delay: 0 });
  m.setRaw(EXAMPLES_JA.handoffs);
  await m.rewrite();
  assert.equal(m.risks.length, 3);
  for (const text of ['マヤさん', '火曜', '唯一のリリース担当']) assert.ok(m.risks.some(r => r.text === text));
});

test('Residual markers block Maya, Tuesday and sole-role paraphrases in Japanese drafts', () => {
  assert.ok(residualRisks(extraSoleDraft, jaRisks).some(r => r.sourceRiskIndex === 2));
  assert.ok(residualRisks('火曜のスタンドアップについて共有してほしい。', jaRisks).some(r => r.sourceRiskIndex === 1));
  assert.ok(residualRisks('マヤさんに先週話した内容とズレている。', jaRisks).some(r => r.sourceRiskIndex === 0));
  assert.deepEqual(residualRisks(neutralJa, jaRisks), []);
});

for (const draft of soleDrafts) {
  test(`Sole-role paraphrase blocks approval: ${draft.slice(0, 24)}…`, () => {
    const marked = residualRisks(draft, jaRisks);
    assert.ok(marked.length > 0);
    assert.ok(marked.some(r => r.sourceRiskIndex === 2));
  });
}

test('Sole-role paraphrase requires explicit retention then accepts', async () => {
  const draft = soleDrafts[0];
  let n = 0;
  const infer = async () => ({ value: ++n === 1 ? jaRisks : n === 2 ? draft : [], source: 'on_device' });
  const m = new Respondent({ infer, send: async () => {}, question_id: 'q', responseId: 'r', delay: 0 });
  m.setRaw(EXAMPLES_JA.handoffs);
  await m.rewrite();
  assert.equal(m.canApprove(), false);
  m.approve(true);
  assert.equal(m.approved, false);
  m.acceptRisks(true);
  assert.equal(m.canApprove(), true);
});

test('Demo grouping surfaces handoffs after three live Japanese rewrites only', () => {
  const jaReply = `${TEMPLATES_JA.handoffs.title}: ${TEMPLATES_JA.handoffs.options[0]}`;
  assert.equal(classifyDemoRewrite(jaReply), 'handoffs');
  const two = demoThemesFromRewrites([jaReply, jaReply], 'ja');
  assert.equal(two.length, 0);
  const three = thresholdThemes(demoThemesFromRewrites([jaReply, jaReply, jaReply], 'ja'), 3);
  assert.equal(three.length, 1);
  assert.equal(three[0].title, '引き継ぎを明確に');
  assert.equal(three[0].band, '3–5');
});

test('Demo infer grouping counts only submitted rewrites passed into approved batch', async () => {
  const handoff = 'Clearer handoffs: A shared checklist could help.';
  const rows = Array.from({ length: 3 }, (_, i) => ({ id: `live-${i}`, approved_rewrite: handoff }));
  const participants = rows.map((r, i) => ({ id: `person-${i}`, response_id: r.id }));
  const infer = createInference({ modes, demo: true, modelFactory: () => assert.fail('no cloud') });
  const r = await infer('groupThemes', approvedInput(rows, participants));
  assert.equal(r.value.length, 1);
  assert.equal(r.value[0].title, 'Clearer handoffs');
});
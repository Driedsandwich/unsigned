import test from 'node:test';
import assert from 'node:assert/strict';
import { InferenceMode as modes } from 'firebase/ai';
import { createInference } from '../src/inference.js';
import { residualRisks, thresholdThemes } from '../src/domain.js';
import { EXAMPLES_JA, TEMPLATES_JA, demoThemesFromRewrites, classifyDemoRewrite } from '../src/fixtures.js';
import { Respondent } from '../src/respondent.js';
import { approvedInput } from '../src/inference.js';

const jaRisks = [
  { text: 'マヤさん', category: 'name' },
  { text: '火曜', category: 'weekday' },
  { text: '唯一のリリース担当', category: 'uncommon role' }
];

const soleDrafts = [
  'リリース作業を担当するメンバーが一人で担当しているため、引き継ぎメモの共有が難しい。チェックリストがあると助かる。',
  'リリース作業は、担当者が一人で進めているようです。引き継ぎの仕組みを整えたい。'
];

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
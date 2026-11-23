import test from 'node:test';
import assert from 'node:assert/strict';
import { dictForTests, resolveLocale, setLocale, t, getLocale } from '../src/i18n.js';
import { residualRisks } from '../src/domain.js';
import { EXAMPLES, EXAMPLES_JA } from '../src/fixtures.js';
import { inputLanguage } from '../src/inference.js';
import { InferenceMode as modes } from 'firebase/ai';
import { createInference, rawInput, adminInput } from '../src/inference.js';
import { Respondent } from '../src/respondent.js';

test('English and Japanese dictionaries contain the same keys', async () => {
  const tables = await dictForTests();
  assert.deepEqual(Object.keys(tables.en).sort(), Object.keys(tables.ja).sort());
});

test('resolveLocale prefers URL, then storage fallback, defaulting to English', () => {
  assert.equal(resolveLocale('?lang=ja'), 'ja');
  assert.equal(resolveLocale('?lang=en'), 'en');
  assert.equal(resolveLocale('?lang=fr'), 'en');
  assert.equal(resolveLocale(''), 'en');
});

test('Japanese fiction examples include names, weekdays and sole roles', () => {
  for (const text of Object.values(EXAMPLES_JA)) {
    assert.match(text, /さん|曜/);
    assert.match(text, /唯一|リリース|デザイナー|アナリスト/);
  }
});

test('Japanese prompts are selected from input language without changing policy modes', async () => {
  const calls = [];
  const jaRaw = EXAMPLES_JA.handoffs;
  const infer = createInference({ modes, modelFactory: mode => ({ generateContent: async prompt => {
    calls.push({ mode, prompt });
    return { response: { text: () => (calls.length === 1 ? '[]' : jaRaw), inferenceSource: 'on_device' } };
  } }) });
  assert.equal(inputLanguage(jaRaw), 'ja');
  const m = new Respondent({ infer, send: async () => {}, question_id: 'q', responseId: 'r', delay: 0 });
  m.setRaw(jaRaw);
  await m.rewrite();
  assert.ok(calls.every(c => c.mode === modes.ONLY_ON_DEVICE));
  assert.match(calls[0].prompt, /名前・日付・曜日/);
  assert.match(calls[1].prompt, /平易な日本語/);
});

test('Japanese weekday and QA role aliases gate approval deterministically', () => {
  const risks = [{ text: '火曜のスタンドアップ', category: 'weekday' }, { text: '唯一のQA担当', category: 'uncommon role' }];
  const draft = '火曜のスタンドアップで品質保証とテスターが知った。';
  const marked = residualRisks(draft, risks).map(r => r.text);
  for (const term of ['火曜のスタンドアップ', '品質保証', 'テスター']) assert.ok(marked.includes(term), term);
  assert.equal(residualRisks('金曜日の定例で品質保証が共有された。', [{ text: '金曜日', category: 'weekday' }]).some(r => r.text === '金曜日'), true);
});

test('Japanese draft without retained aliases can approve', async () => {
  const jaRaw = EXAMPLES_JA.handoffs;
  const jaDraft = '引き継ぎメモを共有できる仕組みがあると助かる。';
  const risks = [{ text: 'マヤさん', category: 'name' }, { text: '火曜', category: 'weekday' }, { text: '唯一のリリース担当', category: 'uncommon role' }];
  let n = 0;
  const infer = async () => {
    n++;
    return { value: n === 1 ? risks : n === 2 ? jaDraft : [], source: 'on_device' };
  };
  const m = new Respondent({ infer, send: async () => {}, question_id: 'q', responseId: 'r', delay: 0 });
  m.setRaw(jaRaw);
  await m.rewrite();
  assert.equal(m.canApprove(), true);
  assert.deepEqual(m.draftRisks, []);
});

test('Japanese administrator drafting keeps request text in the prompt payload', async () => {
  const calls = [];
  const request = '来週の引き継ぎ改善について尋ねて';
  const infer = createInference({ modes, demo: true, availability: async () => 'available', modelFactory: () => ({ generateContent: async prompt => {
    calls.push(prompt);
    return { response: { text: () => '来週の引き継ぎをどう改善できますか？', inferenceSource: 'on_device' } };
  } }) });
  await infer('draftQuestion', adminInput(request));
  assert.match(calls[0], /来週の引き継ぎ改善について尋ねて/);
  assert.match(calls[0], /日本語/);
});

test('setLocale switches UI strings', async () => {
  await setLocale('ja');
  assert.match(t('approveLabel'), /承認/);
  await setLocale('en');
  assert.match(t('approveLabel'), /approve/i);
  assert.equal(getLocale(), 'en');
});
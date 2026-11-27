import test from 'node:test';
import assert from 'node:assert/strict';
import { createServices, SANDBOX_CLOUD_GROUP_LIMIT, SANDBOX_LIMIT_CODE } from '../src/services.js';
import { introFor, dictForTests } from '../src/i18n.js';
import { resolveConfig } from '../src/config.js';

const live = { demo: false, sandbox: false };
const demo = resolveConfig(undefined);
const sandbox = { demo: false, sandbox: true };

test('The prototype intro (nothing is sent) appears only in Demo mode and only in Japanese', () => {
  assert.deepEqual(introFor(demo, 'ja'), { key: 'jaIntroHtml', hidden: false });
  assert.deepEqual(introFor(demo, 'en'), { key: 'jaIntroHtml', hidden: true });
  assert.notEqual(introFor(live, 'ja').key, 'jaIntroHtml');
  assert.notEqual(introFor(live, 'en').key, 'jaIntroHtml');
  assert.notEqual(introFor(sandbox, 'ja').key, 'jaIntroHtml');
  assert.notEqual(introFor(sandbox, 'en').key, 'jaIntroHtml');
  assert.equal(introFor(null, 'ja').hidden, true);
});

test('Live and sandbox intros exist in both languages, say what really happens, and never claim nothing is sent', async () => {
  const tables = await dictForTests();
  for (const loc of ['ja', 'en']) {
    for (const cfg of [live, sandbox]) {
      const { key, hidden } = introFor(cfg, loc);
      assert.equal(hidden, false);
      const text = tables[loc][key];
      assert.ok(text, `${loc}/${key}`);
      assert.doesNotMatch(text, /外へは送らず|何も外へ送られません|本番なら|nothing is sent|Nothing is sent/);
    }
  }
  assert.match(tables.ja.introSandboxHtml, /このタブだけ/); assert.match(tables.ja.introSandboxHtml, /端末と雲/);
  assert.match(tables.en.introSandboxHtml, /this tab only/); assert.match(tables.en.introSandboxHtml, /device and in the cloud/);
  assert.match(tables.ja.introLiveHtml, /送られて保存される/); assert.match(tables.en.introLiveHtml, /sent and stored/);
  assert.match(tables.ja.tellSandboxCloudLimit, /この砂場で雲の束ねを試せるのは 3 回までです/);
  assert.match(tables.en.tellSandboxCloudLimit, /up to 3 times/);
});

function counted(config) {
  let loads = 0, calls = 0;
  const services = createServices(config, {
    loadAI: async () => { loads++; return { createAI: () => async () => { calls++; return { value: [], source: 'in_cloud' }; } }; },
    loadStore: async () => ({ createStore: () => ({}) })
  });
  return { services, calls: () => calls, loads: () => loads };
}

test('Sandbox allows three cloud groupings per tab and the fourth never reaches the SDK', async () => {
  const { services, calls, loads } = counted(sandbox);
  for (let i = 0; i < SANDBOX_CLOUD_GROUP_LIMIT; i++) await services.infer('groupThemes', {});
  assert.equal(calls(), 3);
  await assert.rejects(services.infer('groupThemes', {}), error => error.code === SANDBOX_LIMIT_CODE);
  await assert.rejects(services.infer('groupThemes', {}), error => error.code === SANDBOX_LIMIT_CODE);
  assert.equal(calls(), 3);
  assert.equal(loads(), 1);
  await services.infer('rewrite', {});
  assert.equal(calls(), 4);
});

test('The first rejected sandbox call does not even load the SDK adapter', async () => {
  const { services, loads } = counted(sandbox);
  for (let i = 0; i < 3; i++) await services.infer('draftQuestion', {});
  assert.equal(loads(), 1);
  const fresh = counted(sandbox);
  for (let i = 0; i < 3; i++) await fresh.services.infer('groupThemes', {});
  await assert.rejects(fresh.services.infer('groupThemes', {}), { code: SANDBOX_LIMIT_CODE });
});

test('Live administrator and Demo grouping are not capped', async () => {
  for (const cfg of [live, demo]) {
    const { services, calls } = counted(cfg);
    for (let i = 0; i < 6; i++) await services.infer('groupThemes', {});
    assert.equal(calls(), 6);
  }
});

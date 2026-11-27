import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { resolveConfig, sandboxMode } from '../src/config.js';
import { DEMO_CHECKIN, DEMO_RESPONSES } from '../src/fixtures.js';
import { approvedInput, rawInput } from '../src/inference.js';

const value = {
  firebase: { apiKey: 'test-key', projectId: 'unsigned-unit', appId: 'test-app', authDomain: 'unsigned-unit.invalid' },
  appCheckSiteKey: 'test-site-key',
  cloudModel: 'test-cloud-model'
};
const firebaseApp = new URL('../src/firebase-app.js', import.meta.url).href;
const calls = [];
const mockAppCheck = 'data:text/javascript,' + encodeURIComponent(`
  import { Component } from ${JSON.stringify(import.meta.resolve('@firebase/component'))};
  export const initialized = [];
  export class ReCaptchaEnterpriseProvider {
    constructor(siteKey) { this.siteKey = siteKey; }
  }
  export function initializeAppCheck(app, options) {
    initialized.push(options);
    app.container.addComponent(new Component('app-check-internal', () => ({
      getToken: async () => ({ token: 'unit-test-app-check-token' })
    }), 'PRIVATE'));
  }
`);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^(?:@?firebase)\/(?:auth|firestore)|live-services\.js$/.test(specifier)) {
      calls.push(specifier);
      throw new Error('Sandbox must not load Authentication or Firestore');
    }
    if (specifier === 'firebase/app-check') return { url: mockAppCheck, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== firebaseApp) return result;
    return { ...result, source: 'import.meta.env = { DEV: false };\n' + result.source };
  }
});
const { createServices } = await import('../src/services.js');
const { initialized } = await import(mockAppCheck);
test.after(() => {
  hooks.deregister();
  assert.deepEqual(calls, []);
});

function servicesForSandbox() {
  const config = resolveConfig(value);
  return createServices({ ...config, sandbox: sandboxMode(config, '?sandbox=1').active });
}

test('The judge entry requires Firebase configuration and the direct URL selects the same sandbox', () => {
  const demo = resolveConfig(undefined);
  const live = resolveConfig(value);
  assert.deepEqual(sandboxMode(demo, '?sandbox=1'), { available: false, active: false });
  assert.deepEqual(sandboxMode(live, ''), { available: true, active: false });
  assert.deepEqual(sandboxMode(live, '?lang=ja&sandbox=1'), { available: true, active: true });
  assert.deepEqual(sandboxMode(live, '?sandbox=0'), { available: true, active: false });
});

test('Sandbox opens a draft and accepts one approved response per question entirely in memory', async () => {
  const services = servicesForSandbox();
  const initial = await services.approved(DEMO_CHECKIN.id);
  assert.equal(initial.rows.length, 10);
  assert.equal(new Set(initial.participants.map(marker => marker.id)).size, 10);
  assert.deepEqual(await services.themes(DEMO_CHECKIN.id), []);

  const { id, question } = await services.saveDraft('What could improve focus time?');
  const payload = { question_id: id, approved_rewrite: 'Protect blocks of focus time.' };
  await assert.rejects(services.checkin(id), /not open/);
  await assert.rejects(services.submit(services.responseId(), payload), /not open/);
  await services.openDraft(id);
  assert.deepEqual(await services.checkin(id), { id, question, status: 'open' });
  assert.equal((await services.approved(id)).rows.length, 10);
  await assert.rejects(services.submit(services.responseId(), { ...payload, raw: 'Private' }), /Unexpected response fields/);
  await services.submit(services.responseId(), payload);
  await assert.rejects(services.submit(services.responseId(), payload), /Already participated/);
  await services.openDraft(id);
  const { rows, participants } = await services.approved(id);
  assert.equal(rows.length, 11);
  assert.equal(new Set(participants.map(marker => marker.id)).size, 11);
  assert.deepEqual(await services.approved(DEMO_CHECKIN.id), initial);
  assert.deepEqual(await services.themes(id), []);
  await assert.rejects(servicesForSandbox().checkin(id), /not open/);
});

test('Sandbox grouping uses the actual Firebase SDK cloud transport with App Check and only matched approved strings', async t => {
  const services = servicesForSandbox();
  const { id } = await services.saveDraft('What could improve focus time?');
  await services.openDraft(id);
  const rewrite = 'Protect blocks of focus time.';
  await services.submit(services.responseId(), { question_id: id, approved_rewrite: rewrite });
  const { rows, participants } = await services.approved(id);
  const requests = [];
  const themes = [
    { title: 'Focus time', summary: 'Set aside time for focused work.', members: [0, 1, 2, 3, 10] },
    { title: 'Too few', summary: 'Below the support threshold.', members: [0, 1] }
  ];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(themes) }] }, finishReason: 'STOP' }] });
  });
  await assert.rejects(services.infer('groupThemes', rawInput('Private source')), /Input rejected/);
  assert.equal(requests.length, 0);
  const result = await services.infer('groupThemes', approvedInput(
    [...rows, { id: 'orphan-id', approved_rewrite: 'Unmatched response' }], participants
  ));
  assert.equal(requests.length, 1);
  const { url, options } = requests[0];
  assert.equal(new URL(url).hostname, 'firebasevertexai.googleapis.com');
  assert.match(new URL(url).pathname, /\/projects\/unsigned-unit\/models\/test-cloud-model:generateContent$/);
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.get('X-Firebase-AppCheck'), 'unit-test-app-check-token');
  assert.equal(options.headers.get('Authorization'), null);
  const { text: prompt } = JSON.parse(options.body).contents[0].parts[0];
  assert.deepEqual(JSON.parse(prompt.split('\n').at(-1)), [...DEMO_RESPONSES, rewrite]);
  assert.equal(initialized.length, 1);
  assert.equal(initialized[0].provider.siteKey, value.appCheckSiteKey);
  assert.equal(initialized[0].isTokenAutoRefreshEnabled, true);
  assert.deepEqual(result, {
    value: [{ title: 'Focus time', summary: 'Set aside time for focused work.', band: '3–5' }],
    source: 'in_cloud',
    simulated: false
  });
  await services.saveThemes(id, result.value);
  assert.deepEqual(await services.themes(id), result.value);
  assert.deepEqual(await servicesForSandbox().themes(DEMO_CHECKIN.id), []);
});

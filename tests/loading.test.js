import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServices } from '../src/services.js';
import { createInference, rawInput, adminInput, approvedInput } from '../src/inference.js';
import { Respondent } from '../src/respondent.js';
import { InferenceMode as modes } from 'firebase/ai';
import { build } from 'vite';

const tick = () => new Promise(resolve => setImmediate(resolve));
const response = value => ({ response: { text: () => value, inferenceSource: 'on_device' } });

test('Lazy Demo store keeps submission, participant, themes and draft behavior without loading AI', async () => {
  const services = createServices({ demo: true }, { loadAI: () => assert.fail('No AI needed') });
  await services.respondent();
  const checkin = await services.checkin('check-in-001');
  const payload = { question_id: checkin.id, approved_rewrite: 'Share updates sooner.' };
  await assert.rejects(services.themes(checkin.id), /Open Admin/);
  await services.submit(services.responseId(), payload);
  await assert.rejects(services.submit(services.responseId(), payload), /Already participated/);
  await services.nextDemoRespondent(); await services.submit(services.responseId(), payload);
  await services.loginAdmin();
  const { rows, participants } = await services.approved(checkin.id);
  assert.equal(rows.length, 12); assert.equal(participants.length, 12);
  const themes = await services.themes(checkin.id); assert.equal(themes.length, 2);
  assert.deepEqual(await services.saveThemes(checkin.id, themes), themes);
  const draft = await services.saveDraft('What would help?');
  assert.equal(await services.openDraft(draft.id), draft.id);
  await services.logoutAdmin(); await assert.rejects(services.approved(checkin.id), /Open Admin/);
});

test('Concurrent first AI calls share one lazy dispatcher and the same device queue', async () => {
  let loads = 0, factories = 0, active = 0, maximum = 0;
  const releases = [];
  const services = createServices({ demo: true }, { loadAI: async () => {
    loads++; await tick();
    return { createAI: () => {
      factories++;
      return createInference({ modes, demo: true, availability: async () => 'available', modelFactory: () => ({ generateContent: async () => {
        active++; maximum = Math.max(maximum, active);
        await new Promise(resolve => releases.push(resolve)); active--; return response('[]');
      } }) });
    } };
  } });
  assert.equal(loads, 0);
  const first = services.infer('identifyRisks', rawInput('Private words.'));
  const second = services.infer('draftQuestion', adminInput('Ask about handoffs'));
  while (!releases.length) await tick();
  assert.equal(loads, 1); assert.equal(factories, 1); releases.shift()(); await first;
  await tick(); assert.equal(releases.length, 1); releases.shift()(); await second;
  assert.equal(maximum, 1);
});

test('Lazy Demo inference preserves private streaming, review, approval and simulated cloud steps', async () => {
  let loads = 0; const routes = [], partials = [];
  const services = createServices({ demo: true }, { loadAI: async () => {
    loads++;
    return { createAI: () => createInference({ modes, demo: true, availability: async () => 'unavailable', modelFactory: mode => {
      routes.push(mode);
      return {
        generateContent: async () => response('[]'),
        generateContentStream: async () => ({
          stream: (async function* () { yield response('Share updates ').response; yield response('sooner.').response; })(),
          response: Promise.resolve(response('Share updates sooner.').response)
        })
      };
    } }) };
  } });
  await services.respondent(); assert.equal(loads, 0);
  const m = new Respondent({ infer: services.infer, send: services.submit, question_id: 'check-in-001', responseId: services.responseId(), onChange: m => { if (m.phase === 'rewriting' && m.draft) partials.push(m.draft); } });
  m.setRaw('We learn about changes last.'); await m.rewrite();
  assert.deepEqual(partials, ['Share updates', 'Share updates sooner.']);
  assert.equal(m.canApprove(), true); m.approve(true);
  assert.deepEqual(await m.submit(), { question_id: 'check-in-001', approved_rewrite: 'Share updates sooner.' });
  await services.loginAdmin(); const { rows, participants } = await services.approved('check-in-001');
  assert.equal((await services.infer('groupThemes', approvedInput(rows, participants))).simulated, true);
  assert.equal((await services.infer('draftQuestion', adminInput('Ask about handoffs'))).cloudFallback, true);
  assert.equal(loads, 1); assert.deepEqual(routes, Array(3).fill(modes.ONLY_ON_DEVICE));
});

test('Failed lazy AI load offers structured answers and can retry without loading a cloud store', async () => {
  let attempts = 0;
  const services = createServices({ demo: true }, {
    loadAI: async () => { if (!attempts++) throw Error('chunk unavailable'); return { createAI: () => async () => ({ value: [], source: 'on_device' }) }; },
    loadStore: () => assert.fail('No store needed for private review')
  });
  const m = new Respondent({ infer: services.infer, send: services.submit, question_id: 'q', responseId: 'r' });
  m.setRaw('Private words.'); await m.rewrite();
  assert.equal(m.phase, 'structured'); assert.equal(m.raw, ''); assert.equal(m.canApprove(), false);
  m.setTemplate('focus', '0'); assert.equal(m.canApprove(), true);
  assert.deepEqual((await services.infer('identifyRisks', rawInput('Retry.'))).value, []);
  assert.equal(attempts, 2);
});

test('Production chunks stay below 500 kB and entry/Demo/AI graphs exclude deferred features', async () => {
  const warnings = [];
  const { output } = await build({ logLevel: 'silent', build: { write: false, rollupOptions: { onwarn: warning => warnings.push(warning) } } });
  const chunks = output.filter(item => item.type === 'chunk');
  for (const chunk of chunks) assert.ok(Buffer.byteLength(chunk.code) <= 500_000, chunk.fileName);
  assert.deepEqual(warnings, []);
  const closure = chunk => {
    const seen = new Set();
    function visit(item) { if (seen.has(item)) return; seen.add(item); for (const name of item.imports) visit(chunks.find(c => c.fileName === name)); }
    visit(chunk); return [...seen];
  };
  const entry = chunks.find(c => c.isEntry);
  const modules = list => list.flatMap(c => Object.keys(c.modules)).join('\n');
  assert.doesNotMatch(modules(closure(entry)), /firebase|admin\.(?:js|html)|mcp\//);
  assert.ok(closure(entry).reduce((sum, c) => sum + Buffer.byteLength(c.code), 0) < 50_000);
  for (const path of ['/src/demo-services.js', '/src/sandbox-services.js', '/src/firebase.js']) {
    const chunk = chunks.find(c => c.facadeModuleId?.endsWith(path)); assert.ok(chunk, path);
    assert.doesNotMatch(modules(closure(chunk)), /@firebase\/(?:firestore|auth)|live-services|admin\.html|mcp\//);
  }
  const admin = chunks.find(c => c.facadeModuleId?.endsWith('/src/admin.js'));
  assert.match(modules(closure(admin)), /admin\.html/);
  const html = String(output.find(item => item.fileName === 'index.html').source);
  assert.doesNotMatch(html, /For AI agents|schedule_check_in|Theme landscape/);
  assert.match(admin.code, /For AI agents/);

  const bundledPackages = new Set();
  for (const chunk of chunks) {
    for (const [id, { renderedLength }] of Object.entries(chunk.modules)) {
      if (!renderedLength || !id.includes('/node_modules/')) continue;
      const path = id.split('/node_modules/').at(-1).split('/');
      bundledPackages.add(path.slice(0, path[0].startsWith('@') ? 2 : 1).join('/'));
    }
  }
  const notices = String(output.find(item => item.fileName === 'THIRD_PARTY_NOTICES.txt').source);
  const listed = [...notices.matchAll(/^Package: (.+)@[^\s]+\nLicense: [^\n]+/gm)].map(([, name]) => name);
  assert.deepEqual(listed.sort(), [...bundledPackages].sort());
  assert.equal(html.match(/href="\/THIRD_PARTY_NOTICES\.txt"/g)?.length, 1);
  for (const path of ['../LICENSE', '../node_modules/idb/LICENSE', '../node_modules/re2js/LICENSE', '../node_modules/tslib/LICENSE.txt']) {
    assert.ok(notices.includes(readFileSync(new URL(path, import.meta.url), 'utf8').trimEnd()), path);
  }
  assert.match(notices, /Copyright The Closure Library Authors/);
});

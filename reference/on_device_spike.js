import { initializeApp } from 'firebase/app';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'firebase/ai';

const log = (k, v) => { const el = document.getElementById('log'); el.textContent += k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)) + '\n'; console.log('[X209SPIKE]', k, v); };
const netCalls = [];
const origFetch = window.fetch.bind(window);
window.fetch = (...a) => { netCalls.push(String(a[0]).slice(0, 120)); return origFetch(...a); };

async function run() {
  log('userAgent', navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] || '?');
  log('LanguageModel in window', typeof window.LanguageModel);
  try { log('LanguageModel.availability()', await window.LanguageModel?.availability?.()); } catch (e) { log('availability error', String(e)); }
  // The spike called initializeApp() with a placeholder Firebase web config whose values were made up
  // (no real project existed). On-device inference still ran because ONLY_ON_DEVICE never calls the backend.
  const app = initializeApp(window.PLACEHOLDER_FIREBASE_CONFIG);
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const model = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE });
  const t0 = performance.now();
  try {
    const r = await model.generateContent('Rewrite this team feedback neutrally in one sentence. Remove names and weekdays: "Maya keeps changing the plan every Tuesday and nobody tells me."');
    log('ONLY_ON_DEVICE text', r.response.text());
    log('inferenceSource', r.response.inferenceSource ?? '(none)');
    log('ms', Math.round(performance.now() - t0));
  } catch (e) { log('ONLY_ON_DEVICE error', String(e)); }
  const m2 = getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE });
  try {
    const r2 = await m2.generateContent('Say "ok" in one word.');
    log('PREFER_ON_DEVICE text', r2.response.text());
    log('PREFER inferenceSource', r2.response.inferenceSource ?? '(none)');
  } catch (e) { log('PREFER_ON_DEVICE error', String(e)); }
  log('network fetch calls', netCalls);
  document.title = 'DONE';
}
run();

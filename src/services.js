// Cache promises as well as instances: concurrent callers share one store and AI queue.
// Failed imports can be retried; a failed inference never falls back to cloud here.
export function deferred(factory) {
  let pending;
  return () => pending ??= Promise.resolve().then(factory).catch(error => { pending = null; throw error; });
}
// Public sandbox only: a signed-out visitor could otherwise call the cloud grouping without end.
// The cap is per tab and in memory only (browser storage is banned in src/, and a reload also resets the sandbox).
export const SANDBOX_CLOUD_GROUP_LIMIT = 3;
export const SANDBOX_LIMIT_CODE = 'sandbox_cloud_limit';
function createCloudGroupMeter() {
  let used = 0;
  return () => {
    if (used >= SANDBOX_CLOUD_GROUP_LIMIT) throw Object.assign(new Error('Sandbox cloud grouping limit reached'), { code: SANDBOX_LIMIT_CODE });
    used += 1;
  };
}
export function createServices(config, {
  loadAI = () => import('./firebase.js'),
  loadStore = () => {
    if (config.demo) return import('./demo-services.js');
    if (config.sandbox) return import('./sandbox-services.js');
    return import('./live-services.js');
  }
} = {}) {
  const ai = deferred(async () => (await loadAI()).createAI(config));
  const store = deferred(async () => (await loadStore()).createStore(config));
  const countCloudGroup = config.sandbox && !config.demo ? createCloudGroupMeter() : null;
  const services = {
    infer: async (feature, ...args) => {
      if (countCloudGroup && feature === 'groupThemes') countCloudGroup();
      return (await ai())(feature, ...args);
    },
    responseId: () => crypto.randomUUID()
  };
  for (const method of ['respondent', 'restoreAdmin', 'loginAdmin', 'logoutAdmin', 'checkin', 'nextDemoRespondent', 'submit', 'approved', 'themes', 'saveThemes', 'saveDraft', 'openDraft']) {
    services[method] = async (...args) => (await store())[method](...args);
  }
  return services;
}

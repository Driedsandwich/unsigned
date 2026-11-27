// Cache promises as well as instances: concurrent callers share one store and AI queue.
// Failed imports can be retried; a failed inference never falls back to cloud here.
export function deferred(factory) {
  let pending;
  return () => pending ??= Promise.resolve().then(factory).catch(error => { pending = null; throw error; });
}
export function createServices(config, {
  loadAI = () => import('./firebase.js'),
  loadStore = () => config.demo ? import('./demo-services.js') : import('./live-services.js')
} = {}) {
  const ai = deferred(async () => (await loadAI()).createAI(config));
  const store = deferred(async () => (await loadStore()).createStore(config));
  const services = {
    infer: async (...args) => (await ai())(...args),
    responseId: () => crypto.randomUUID()
  };
  for (const method of ['respondent', 'restoreAdmin', 'loginAdmin', 'logoutAdmin', 'checkin', 'nextDemoRespondent', 'submit', 'approved', 'themes', 'saveThemes', 'saveDraft', 'openDraft']) {
    services[method] = async (...args) => (await store())[method](...args);
  }
  return services;
}

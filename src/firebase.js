import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'firebase/ai';
import { createInference, DEVICE_OPTIONS } from './inference.js';
import { createApp } from './firebase-app.js';

export function createAI(config) {
  const app = createApp(config);
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const models = new Map();
  const infer = createInference({ demo: config.demo, modes: InferenceMode, modelFactory(mode) {
    if (!models.has(mode)) models.set(mode, getGenerativeModel(ai, {
      mode, onDeviceParams: { createOptions: structuredClone(DEVICE_OPTIONS) },
      ...(!config.demo && mode !== InferenceMode.ONLY_ON_DEVICE ? { inCloudParams: { model: config.cloudModel } } : {})
      // Public SDK request option: a race in availability must never reach a real cloud in Demo.
    }, config.demo ? { baseUrl: 'http://127.0.0.1:9', timeout: 1000 } : undefined));
    return models.get(mode);
  } });
  return infer;
}

export const PLACEHOLDER = Object.freeze({ apiKey: 'demo', projectId: 'unsigned-demo-placeholder', appId: '1:000000000000:web:unsigned-demo', authDomain: 'unsigned-demo-placeholder.invalid' });
export function resolveConfig(value) {
  if (value === undefined || value === null) return { demo: true, firebase: PLACEHOLDER };
  const firebase = value.firebase;
  if (!firebase || ['apiKey', 'projectId', 'appId', 'authDomain'].some(k => typeof firebase[k] !== 'string' || !firebase[k].trim() || /REPLACE|YOUR_|example/i.test(firebase[k])) || typeof value.appCheckSiteKey !== 'string' || !value.appCheckSiteKey.trim() || /REPLACE|YOUR_/i.test(value.appCheckSiteKey) || typeof value.cloudModel !== 'string' || !value.cloudModel.trim() || /REPLACE|YOUR_/i.test(value.cloudModel)) throw new Error('Configuration is incomplete. Use real local settings or remove the file for Demo mode.');
  return { demo: false, firebase, appCheckSiteKey: value.appCheckSiteKey, cloudModel: value.cloudModel };
}
export async function loadConfig() {
  // Vite SPA fallback returns HTML for a missing public file. Do not evaluate it.
  const response = await fetch('/firebase-config.js', { cache: 'no-store' });
  if (response.status === 404) return resolveConfig(undefined);
  if (!response.ok) throw new Error('Could not read configuration');
  const body = await response.text();
  if (/^\s*<!doctype html|^\s*<html/i.test(body)) return resolveConfig(undefined);
  // Load as a classic script: Vite's dev server refuses module imports of /public files.
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/firebase-config.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not read configuration'));
    document.head.appendChild(script);
  });
  if (!globalThis.UNSIGNED_CONFIG) throw new Error('Missing UNSIGNED_CONFIG in configuration file');
  return resolveConfig(globalThis.UNSIGNED_CONFIG);
}

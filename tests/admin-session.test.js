import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createServices } from '../src/services.js';

const liveStore = new URL('../src/live-services.js', import.meta.url).href;
const moduleURL = source => `data:text/javascript,${encodeURIComponent(source)}`;
const mocks = {
  './firebase-app.js': moduleURL(`export const createApp = (_config, name = '[DEFAULT]') => ({ name });`),
  'firebase/firestore': moduleURL(`
    export const getFirestore = app => app;
    export const collection = null, doc = null, getDoc = null, getDocs = null,
      setDoc = null, query = null, where = null, serverTimestamp = null,
      writeBatch = null, updateDoc = null;
  `),
  'firebase/auth': moduleURL(`
    export const sessions = new Map(), calls = [];
    export const browserSessionPersistence = 'SESSION';
    export const GoogleAuthProvider = class {};
    export function getAuth({ name }) {
      return {
        name,
        currentUser: null,
        async authStateReady() {
          await Promise.resolve();
          this.currentUser = sessions.get(name) ?? null;
        }
      };
    }
    export async function setPersistence(auth, type) { calls.push(['persistence', auth.name, type]); }
    export async function signInAnonymously(auth) {
      calls.push(['anonymous', auth.name]);
      sessions.set(auth.name, auth.currentUser = { isAnonymous: true });
    }
    export async function signInWithPopup(auth) {
      calls.push(['popup', auth.name]);
      sessions.set(auth.name, auth.currentUser = { claims: { unsigned_admin: true }, signInProvider: 'google.com' });
    }
    export async function getIdTokenResult(user, forceRefresh) { calls.push(['token', forceRefresh]); return user; }
    export async function signOut(auth) { sessions.delete(auth.name); auth.currentUser = null; }
  `)
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const url = context.parentURL === liveStore && mocks[specifier];
    return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
  }
});
const store = await import(liveStore).finally(() => hooks.deregister());
const { sessions, calls } = await import(mocks['firebase/auth']);
const liveServices = () => createServices({ demo: false }, { loadStore: async () => store });

test('Live startup restores a Google admin without another popup and keeps anonymous auth separate', async () => {
  sessions.clear();
  calls.length = 0;
  const first = liveServices();
  await first.respondent();
  assert.equal(await first.restoreAdmin(), false);
  await first.loginAdmin();
  const respondent = sessions.get('[DEFAULT]');

  const reloaded = liveServices();
  await reloaded.respondent();
  assert.equal(await reloaded.restoreAdmin(), true);
  assert.deepEqual(calls, [
    ['persistence', '[DEFAULT]', 'SESSION'], ['anonymous', '[DEFAULT]'],
    ['persistence', 'unsigned-admin', 'SESSION'], ['popup', 'unsigned-admin'], ['token', true],
    ['persistence', '[DEFAULT]', 'SESSION'], ['token', true]
  ]);
  await reloaded.logoutAdmin();
  assert.equal(await liveServices().restoreAdmin(), false);
  assert.equal(sessions.get('[DEFAULT]'), respondent);
});

test('Live startup rejects a restored user without both the Google provider and admin claim', async () => {
  sessions.clear();
  calls.length = 0;
  for (const [signInProvider, unsigned_admin] of [['google.com', false], ['password', true]]) {
    sessions.set('unsigned-admin', { signInProvider, claims: { unsigned_admin } });
    assert.equal(await liveServices().restoreAdmin(), false);
  }
  assert.deepEqual(calls, [['token', true], ['token', true]]);
});

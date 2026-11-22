import { initializeApp } from 'firebase/app';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'firebase/ai';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth, signInAnonymously, signInWithPopup, GoogleAuthProvider, getIdTokenResult, signOut, setPersistence, browserSessionPersistence } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, query, where, serverTimestamp, writeBatch, updateDoc } from 'firebase/firestore';
import { createInference, DEVICE_OPTIONS } from './inference.js';
import { createDemoParticipation } from './participation.js';
import { validatePayload, publicThemes, questionId, text } from './domain.js';
import { DEMO_CHECKIN, DEMO_THEMES } from './fixtures.js';

export function createServices(config) {
  const app = initializeApp(config.firebase);
  // In development only: supply a local environment value. It is never logged here.
  if (import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
  function appCheck(instance) {
    if (!config.demo) initializeAppCheck(instance, { provider: new ReCaptchaV3Provider(config.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  }
  appCheck(app);
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
  let auth, db, adminAuth, adminDb;
  let admin = false;
  const participation = config.demo ? createDemoParticipation() : null;
  let demoUid = crypto.randomUUID();
  const memory = { themes: new Map([[DEMO_CHECKIN.id, publicThemes(DEMO_THEMES)]]), drafts: new Map() };
  if (!config.demo) {
    auth = getAuth(app); db = getFirestore(app);
    // Separate auth contexts keep respondent writes anonymous while an admin is signed in.
    const adminApp = initializeApp(config.firebase, 'unsigned-admin'); appCheck(adminApp);
    adminAuth = getAuth(adminApp); adminDb = getFirestore(adminApp);
  }
  async function requireAdmin() {
    if (config.demo) { if (!admin) throw new Error('Open Admin first'); return; }
    const user = adminAuth.currentUser;
    if (!user) throw new Error('Sign in as an administrator');
    const token = await getIdTokenResult(user, true);
    if (token.claims.unsigned_admin !== true || token.signInProvider !== 'google.com') throw new Error('This Google account is not an administrator');
  }
  return {
    infer,
    async respondent() {
      if (config.demo) return;
      await setPersistence(auth, browserSessionPersistence);
      await auth.authStateReady();
      if (!auth.currentUser?.isAnonymous) await signInAnonymously(auth);
    },
    async loginAdmin() {
      if (!config.demo) {
        await setPersistence(adminAuth, browserSessionPersistence);
        await signInWithPopup(adminAuth, new GoogleAuthProvider());
        await requireAdmin();
      }
      admin = true;
    },
    async logoutAdmin() { admin = false; if (!config.demo) await signOut(adminAuth); },
    async checkin(id) {
      questionId(id);
      if (config.demo) return { ...DEMO_CHECKIN, id };
      const snap = await getDoc(doc(db, 'checkins', id));
      if (!snap.exists() || snap.data().status !== 'open') throw new Error('This check-in is not open');
      return { id: snap.id, question: text(snap.data().question, 240), status: 'open' };
    },
    responseId() { return crypto.randomUUID(); },
    nextDemoRespondent() { if (!config.demo) throw new Error('Demo only'); demoUid = crypto.randomUUID(); },
    async submit(id, payload) {
      const clean = validatePayload(payload);
      if (config.demo) { participation.submit(demoUid, id, clean); return; }
      // Reuse this random document ID on retry; no author field is ever stored.
      const ref = doc(db, 'responses', id);
      if (!auth.currentUser?.isAnonymous) throw new Error('Anonymous sign-in required');
      const marker = doc(db, 'checkins', clean.question_id, 'participants', auth.currentUser.uid);
      const batch = writeBatch(db);
      batch.set(ref, { ...clean, created_at: serverTimestamp() });
      batch.set(marker, { response_id: id, created_at: serverTimestamp() });
      await batch.commit();
    },
    async approved(id) {
      await requireAdmin(); questionId(id);
      if (config.demo) return participation.approved(id);
      const snap = await getDocs(query(collection(adminDb, 'responses'), where('question_id', '==', id)));
      const markers = await getDocs(collection(adminDb, 'checkins', id, 'participants'));
      return { rows: snap.docs.map(d => ({ id: d.id, approved_rewrite: text(d.data().approved_rewrite) })),
        participants: markers.docs.map(d => ({ id: d.id, response_id: d.data().response_id })) };
    },
    async themes(id) {
      await requireAdmin(); questionId(id);
      if (config.demo) return publicThemes(memory.themes.get(id));
      const participants = await getDocs(collection(adminDb, 'checkins', id, 'participants'));
      if (participants.size < 3) return [];
      const snap = await getDocs(collection(adminDb, 'themes', id, 'items'));
      return publicThemes(snap.docs.map(d => d.data()));
    },
    async saveThemes(id, themes) {
      await requireAdmin(); questionId(id);
      const safe = publicThemes(themes);
      if (safe.length > 30) throw new Error('Too many themes');
      if (config.demo) { memory.themes.set(id, safe); return safe; }
      const target = collection(adminDb, 'themes', id, 'items');
      const old = await getDocs(target);
      if (old.size > 400) throw new Error('Theme store requires administrator maintenance');
      const batch = writeBatch(adminDb);
      old.docs.forEach(d => batch.delete(d.ref));
      safe.forEach(t => batch.set(doc(target), t));
      await batch.commit();
      return safe;
    },
    async saveDraft(question) {
      await requireAdmin(); const value = text(question, 240);
      const id = crypto.randomUUID();
      if (config.demo) memory.drafts.set(id, value);
      else await setDoc(doc(adminDb, 'checkins', id), { question: value, status: 'draft', created_at: serverTimestamp() });
      return { id, question: value };
    },
    async openDraft(id) {
      await requireAdmin(); questionId(id);
      if (!config.demo) await updateDoc(doc(adminDb, 'checkins', id), { status: 'open' });
      return id;
    }
  };
}

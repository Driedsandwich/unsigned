import { getAuth, signInAnonymously, signInWithPopup, GoogleAuthProvider, getIdTokenResult, signOut, setPersistence, browserSessionPersistence } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, query, where, serverTimestamp, writeBatch, updateDoc } from 'firebase/firestore';
import { validatePayload, publicThemes, questionId, text } from './domain.js';
import { createApp } from './firebase-app.js';

export function createStore(config) {
  const app = createApp(config);
  const auth = getAuth(app), db = getFirestore(app);
  let adminAuth, adminDb;
  async function requireAdmin() {
    const user = adminAuth?.currentUser;
    if (!user) throw new Error('Sign in as an administrator');
    const token = await getIdTokenResult(user, true);
    if (token.claims.unsigned_admin !== true || token.signInProvider !== 'google.com') throw new Error('This Google account is not an administrator');
  }
  return {
    async respondent() {
      await setPersistence(auth, browserSessionPersistence);
      await auth.authStateReady();
      if (!auth.currentUser?.isAnonymous) await signInAnonymously(auth);
    },
    async loginAdmin() {
      if (!adminAuth) {
        // Separate auth contexts keep respondent writes anonymous while an admin is signed in.
        const adminApp = createApp(config, 'unsigned-admin');
        adminAuth = getAuth(adminApp); adminDb = getFirestore(adminApp);
      }
      await setPersistence(adminAuth, browserSessionPersistence);
      await signInWithPopup(adminAuth, new GoogleAuthProvider());
      await requireAdmin();
    },
    async logoutAdmin() { if (adminAuth) await signOut(adminAuth); },
    async checkin(id) {
      questionId(id);
      const snap = await getDoc(doc(db, 'checkins', id));
      if (!snap.exists() || snap.data().status !== 'open') throw new Error('This check-in is not open');
      return { id: snap.id, question: text(snap.data().question, 240), status: 'open' };
    },
    async submit(id, payload) {
      const clean = validatePayload(payload);
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
      const snap = await getDocs(query(collection(adminDb, 'responses'), where('question_id', '==', id)));
      const markers = await getDocs(collection(adminDb, 'checkins', id, 'participants'));
      return { rows: snap.docs.map(d => ({ id: d.id, approved_rewrite: text(d.data().approved_rewrite) })),
        participants: markers.docs.map(d => ({ id: d.id, response_id: d.data().response_id })) };
    },
    async themes(id) {
      await requireAdmin(); questionId(id);
      const participants = await getDocs(collection(adminDb, 'checkins', id, 'participants'));
      if (participants.size < 3) return [];
      const snap = await getDocs(collection(adminDb, 'themes', id, 'items'));
      return publicThemes(snap.docs.map(d => d.data()));
    },
    async saveThemes(id, themes) {
      await requireAdmin(); questionId(id);
      const safe = publicThemes(themes);
      if (safe.length > 30) throw new Error('Too many themes');
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
      await setDoc(doc(adminDb, 'checkins', id), { question: value, status: 'draft', created_at: serverTimestamp() });
      return { id, question: value };
    },
    async openDraft(id) {
      await requireAdmin(); questionId(id);
      await updateDoc(doc(adminDb, 'checkins', id), { status: 'open' });
      return id;
    }
  };
}

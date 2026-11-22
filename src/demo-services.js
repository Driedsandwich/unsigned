import { createDemoParticipation } from './participation.js';
import { validatePayload, publicThemes, questionId, text } from './domain.js';
import { DEMO_CHECKIN, DEMO_THEMES } from './fixtures.js';

export function createStore() {
  const participation = createDemoParticipation();
  const memory = { themes: new Map([[DEMO_CHECKIN.id, publicThemes(DEMO_THEMES)]]), drafts: new Map() };
  let admin = false, demoUid = crypto.randomUUID();
  function requireAdmin() { if (!admin) throw new Error('Open Admin first'); }
  return {
    async respondent() {},
    async loginAdmin() { admin = true; },
    async logoutAdmin() { admin = false; },
    async checkin(id) { questionId(id); return { ...DEMO_CHECKIN, id }; },
    nextDemoRespondent() { demoUid = crypto.randomUUID(); },
    async submit(id, payload) { participation.submit(demoUid, id, validatePayload(payload)); },
    async approved(id) { requireAdmin(); questionId(id); return participation.approved(id); },
    async themes(id) { requireAdmin(); questionId(id); return publicThemes(memory.themes.get(id)); },
    async saveThemes(id, themes) {
      requireAdmin(); questionId(id); const safe = publicThemes(themes);
      if (safe.length > 30) throw new Error('Too many themes');
      memory.themes.set(id, safe); return safe;
    },
    async saveDraft(question) {
      requireAdmin(); const value = text(question, 240), id = crypto.randomUUID();
      memory.drafts.set(id, value); return { id, question: value };
    },
    async openDraft(id) { requireAdmin(); questionId(id); return id; }
  };
}

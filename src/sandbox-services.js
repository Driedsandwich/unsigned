import { createDemoParticipation } from './participation.js';
import { validatePayload, publicThemes, questionId, text } from './domain.js';
import { DEMO_CHECKIN } from './fixtures.js';

export function createStore() {
  const participation = createDemoParticipation();
  const checkins = new Map([[DEMO_CHECKIN.id, DEMO_CHECKIN]]);
  const themes = new Map();
  const respondentId = crypto.randomUUID();

  function openCheckin(id) {
    const checkin = checkins.get(questionId(id));
    if (checkin?.status !== 'open') throw new Error('This check-in is not open');
    return checkin;
  }

  return {
    async checkin(id) { return { ...openCheckin(id) }; },
    async submit(id, payload) {
      const clean = validatePayload(payload);
      openCheckin(clean.question_id);
      participation.submit(respondentId, id, clean);
    },
    async approved(id) {
      openCheckin(id);
      return participation.approved(id);
    },
    async themes(id) {
      openCheckin(id);
      return publicThemes(themes.get(id));
    },
    async saveThemes(id, result) {
      openCheckin(id);
      const safe = publicThemes(result);
      if (safe.length > 30) throw new Error('Too many themes');
      themes.set(id, safe);
      return publicThemes(safe);
    },
    async saveDraft(question) {
      const id = crypto.randomUUID(), value = text(question, 240);
      checkins.set(id, { id, question: value, status: 'draft' });
      return { id, question: value };
    },
    async openDraft(id) {
      const checkin = checkins.get(questionId(id));
      if (!checkin) throw new Error('Check-in not found');
      if (checkin.status === 'draft') {
        participation.seedFictionalResponses(id);
        checkins.set(id, { ...checkin, status: 'open' });
      }
      return id;
    }
  };
}

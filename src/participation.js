import { validatePayload } from './domain.js';
import { DEMO_CHECKIN, DEMO_RESPONSES } from './fixtures.js';

// Fictional modes mirror the atomic response + one-marker-per-participant rule in memory.
export function createDemoParticipation({ seed = true } = {}) {
  const responses = new Map(), participants = new Map();
  function submit(uid, id, payload) {
    const clean = validatePayload(payload);
    const key = `${clean.question_id}/${uid}`;
    if (!uid || !id || participants.has(key) || responses.has(id)) throw new Error('Already participated');
    responses.set(id, clean);
    participants.set(key, { question_id: clean.question_id, id: uid, response_id: id });
  }
  function seedFictionalResponses(question_id) {
    DEMO_RESPONSES.forEach((approved_rewrite, i) => submit(`fixture-person-${i}`, `fixture-response-${question_id}-${i}`, { question_id, approved_rewrite }));
  }
  if (seed) seedFictionalResponses(DEMO_CHECKIN.id);
  return {
    submit,
    seedFictionalResponses,
    approved(question_id) {
      return {
        rows: [...responses].filter(([,r]) => r.question_id === question_id).map(([id,r]) => ({ id, approved_rewrite: r.approved_rewrite })),
        participants: [...participants.values()].filter(p => p.question_id === question_id).map(({id,response_id}) => ({id,response_id}))
      };
    }
  };
}

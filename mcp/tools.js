import { publicThemes, text } from '../src/domain.js';
import { DEMO_THEMES } from '../src/fixtures.js';
export function createTools({ demo = true, loadThemes = async () => [], saveDraft = async () => {} } = {}) {
  return {
    async get_themes() { return { themes: publicThemes(demo ? DEMO_THEMES : await loadThemes()) }; },
    async draft_check_in_question({ request }) {
      return { question: text(request, 240), status: 'draft', human_confirmation_required: true, inference: 'none' };
    },
    async schedule_check_in({ question, proposed_date }) {
      const draft = { question: text(question, 240), proposed_date: text(proposed_date, 10), status: 'draft', human_confirmation_required: true };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.proposed_date) || Number.isNaN(Date.parse(draft.proposed_date)) || new Date(draft.proposed_date).toISOString().slice(0,10) !== draft.proposed_date) throw new Error('Invalid proposed date');
      await saveDraft(draft);
      return { ...draft, scheduled: false };
    }
  };
}

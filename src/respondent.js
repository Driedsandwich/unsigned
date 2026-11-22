import { rawInput } from './inference.js';
import { submission, respondentPath } from './domain.js';
import { TEMPLATES } from './fixtures.js';
export class Respondent {
  constructor({ infer, send, question_id, responseId, onChange = () => {}, delay = 1000 }) {
    Object.assign(this, { infer, send, question_id, responseId, onChange, delay });
    this.version = 0; this.run = 0; this.timer = null; this.raw = ''; this.draft = '';
    this.draftVersion = -1; this.approved = false; this.edited = false; this.editing = false;
    this.device = 'ready'; this.phase = 'empty'; this.risks = []; this.rewriteResult = null; this.riskResult = null;
    this.sent = null; this.sentSource = null; this.sending = false; this.error = ''; this.topic = ''; this.template = ''; this.prepared = false;
  }
  emit() { this.onChange(this); }
  invalidate() { clearTimeout(this.timer); this.run++; this.approved = false; }
  structured(status = 'unavailable') {
    if (this.sending || this.sent) return;
    this.invalidate(); this.version++; this.device = status; this.raw = ''; this.draft = '';
    this.draftVersion = -1; this.risks = []; this.riskResult = null; this.rewriteResult = null;
    this.phase = 'structured'; this.edited = false; this.editing = false; this.emit();
  }
  setRaw(value) {
    if (this.device !== 'ready' || this.sent || this.sending) return;
    this.invalidate(); this.raw = String(value).slice(0,1200); this.version++; this.risks = []; this.riskResult = null;
    this.error = '';
    if (!this.raw.trim()) { this.draft = ''; this.phase = 'empty'; this.draftVersion = -1; }
    else if (this.edited) this.phase = 'stale';
    else { this.phase = 'waiting'; this.timer = setTimeout(() => this.rewrite(), this.delay); }
    this.emit();
  }
  async rewrite() {
    if (this.device !== 'ready' || !this.raw.trim() || this.sent || this.sending) return;
    this.invalidate(); const run = this.run, version = this.version;
    const current = () => run === this.run && version === this.version && this.device === 'ready';
    const token = rawInput(this.raw);
    this.edited = false; this.editing = false; this.draft = ''; this.draftVersion = -1;
    this.phase = this.prepared ? 'rewriting' : 'preparing'; this.emit();
    try {
      const result = await this.infer('rewrite', token, { current, onPartial: (value, source) => { if (current()) { this.draft = value; this.rewriteResult = { source }; this.phase = 'rewriting'; this.emit(); } } });
      if (!current() || !result) return;
      this.prepared = true; this.draft = result.value; this.rewriteResult = result; this.phase = 'checking'; this.emit();
      const risks = await this.infer('identifyRisks', token, { current });
      if (!current() || !risks) return;
      this.risks = risks.value; this.riskResult = risks; this.draftVersion = version; this.phase = 'ready'; this.emit();
    } catch {
      if (!current()) return;
      this.structured('failed'); this.error = 'Private rewriting is unavailable. Choose a structured answer. Your original text was not sent to cloud AI.'; this.emit();
    }
  }
  beginEdit() { if (this.phase !== 'ready') return; this.edited = true; this.editing = true; this.approved = false; this.emit(); }
  editDraft(value) {
    if (!this.editing || this.sending || this.sent) return;
    this.draft = String(value).slice(0,1200); this.approved = false; this.emit();
  }
  setTemplate(topic, index = '') {
    if (this.device === 'ready' || this.sent || this.sending) return;
    this.invalidate(); this.version++; this.topic = topic; this.template = index;
    const option = TEMPLATES[topic]?.options[index];
    this.draft = option ? `${TEMPLATES[topic].title}: ${option}` : '';
    this.draftVersion = this.draft ? this.version : -1; this.emit();
  }
  path() { return respondentPath(this.phase === 'preparing' ? 'preparing' : this.device); }
  canApprove() { return !this.sent && !this.sending && !!this.draft.trim() && this.draftVersion === this.version && ['ready', 'structured'].includes(this.phase); }
  approve(value) { this.approved = value === true && this.canApprove(); this.emit(); }
  async submit() {
    if (!this.canApprove() || !this.approved) return null;
    const payload = submission({ question_id: this.question_id, draft: this.draft, approved: this.approved, version: this.version, draftVersion: this.draftVersion });
    this.sending = true; this.error = ''; this.emit();
    try {
      await this.send(this.responseId, payload); this.sent = payload; this.sentSource = this.rewriteResult ? { source: this.rewriteResult.source } : null;
      this.invalidate(); this.raw = ''; this.draft = ''; this.risks = []; this.rewriteResult = null; this.riskResult = null; this.editing = false;
      return payload;
    } catch {
      this.error = 'Could not confirm delivery. Retry uses the same response ID. If the first write succeeded, another write is blocked; ask your administrator before starting another response.';
      return null;
    } finally { this.sending = false; this.emit(); }
  }
}

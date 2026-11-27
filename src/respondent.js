import { rawInput } from './inference.js';
import { submission, respondentPath, residualRisks, draftAdvisoryNotes } from './domain.js';
import { privateCall, privateFailure, PRIVATE_CALL_TIMEOUT_MS } from './private-check.js';
import { TEMPLATES, TEMPLATES_JA } from './fixtures.js';
export class Respondent {
  constructor({ infer, send, question_id, responseId, onChange = () => {}, delay = 1000, timeoutMs = PRIVATE_CALL_TIMEOUT_MS }) {
    Object.assign(this, { infer, send, question_id, responseId, onChange, delay, timeoutMs });
    this.version = 0; this.run = 0; this.timer = null; this.raw = ''; this.draft = '';
    this.draftVersion = -1; this.approved = false; this.edited = false; this.editing = false;
    this.device = 'ready'; this.phase = 'empty'; this.risks = []; this.rewriteResult = null; this.riskResult = null;
    this.draftRisks = []; this.reviewResult = null; this.keepRisks = false;
    this.aiNotes = []; this.reviewPending = false; this.reviewWarning = ''; this.reviewRun = 0;
    this.confirmAdvisory = false;
    this.sent = null; this.sentSource = null; this.sending = false; this.error = ''; this.topic = ''; this.template = ''; this.prepared = false;
  }
  emit() { this.onChange(this); }
  clearReview() { this.reviewRun++; this.aiNotes = []; this.reviewPending = false; this.reviewWarning = ''; this.reviewResult = null; this.confirmAdvisory = false; }
  call(feature, token, options) { return privateCall(this.infer, feature, token, options, this.timeoutMs); }
  invalidate() { clearTimeout(this.timer); this.run++; this.approved = false; this.keepRisks = false; this.confirmAdvisory = false; }
  structured(status = 'unavailable') {
    if (this.sending || this.sent) return;
    this.invalidate(); this.clearReview(); this.version++; this.device = status; this.raw = ''; this.draft = '';
    this.draftVersion = -1; this.risks = []; this.riskResult = null; this.rewriteResult = null;
    this.draftRisks = []; this.reviewResult = null;
    this.phase = 'structured'; this.edited = false; this.editing = false; this.emit();
  }
  setRaw(value) {
    if (this.device !== 'ready' || this.sent || this.sending) return;
    this.invalidate(); this.clearReview(); this.raw = String(value).slice(0,1200); this.version++; this.risks = []; this.riskResult = null;
    this.draftRisks = []; this.reviewResult = null;
    this.error = '';
    if (!this.raw.trim()) { this.draft = ''; this.phase = 'empty'; this.draftVersion = -1; }
    else if (this.edited) this.phase = 'stale';
    else { this.phase = 'waiting'; this.timer = setTimeout(() => this.rewrite(), this.delay); }
    this.emit();
  }
  async rewrite() {
    if (this.device !== 'ready' || !this.raw.trim() || this.sent || this.sending) return;
    this.invalidate(); this.clearReview(); this.error = ''; const run = this.run, version = this.version;
    const current = () => run === this.run && version === this.version && this.device === 'ready';
    const token = rawInput(this.raw);
    this.edited = false; this.editing = false; this.draft = ''; this.draftVersion = -1;
    this.draftRisks = []; this.reviewResult = null;
    this.phase = this.prepared ? 'rewriting' : 'preparing'; this.emit();
    let stage = 'Source risk check';
    try {
      const risks = await this.call('identifyRisks', token, { current });
      if (!current() || !risks) return;
      this.risks = risks.value; this.riskResult = risks; this.prepared = true; this.phase = 'rewriting'; this.emit();
      stage = 'Rewrite';
      const result = await this.call('rewrite', rawInput(this.raw, { risks: this.risks }), { current, onPartial: (value, source) => { if (current()) { this.draft = value; this.rewriteResult = { source }; this.phase = 'rewriting'; this.emit(); } } });
      if (!current() || !result) return;
      this.draft = result.value; this.rewriteResult = result;
      await this.reviewDraft();
    } catch (error) {
      if (!current()) return;
      const detail = privateFailure(stage, error);
      this.structured('failed'); this.error = `${detail}. Choose a structured answer. Your original text was not sent to cloud AI.`; this.emit();
    }
  }
  beginEdit() { if (this.phase !== 'ready') return; this.edited = true; this.editing = true; this.approved = false; this.emit(); }
  editDraft(value) {
    if (!this.editing || this.sending || this.sent || this.phase === 'stale') return;
    this.invalidate(); this.clearReview(); this.draft = String(value).slice(0,1200); this.draftVersion = this.version;
    this.draftRisks = residualRisks(this.draft, this.risks); this.phase = 'ready'; this.reviewPending = !!this.draft.trim();
    this.timer = setTimeout(() => this.reviewDraft(), this.delay); this.emit();
  }
  async reviewDraft() {
    clearTimeout(this.timer);
    if (this.device !== 'ready' || this.sent || this.sending) return;
    this.clearReview();
    const reviewRun = this.reviewRun, run = this.run, version = this.version, draft = this.draft;
    const current = () => reviewRun === this.reviewRun && run === this.run && version === this.version && draft === this.draft && this.device === 'ready';
    this.phase = 'ready'; this.draftVersion = version;
    this.draftRisks = residualRisks(draft, this.risks); this.reviewPending = !!draft.trim(); this.emit();
    if (!draft.trim()) return;
    try {
      const result = await this.call('identifyRisks', rawInput(draft, { risks: this.risks, review: true }), { current });
      if (!current() || !result) return;
      this.aiNotes = draftAdvisoryNotes(draft, result.value, this.risks); this.reviewResult = result; this.reviewPending = false; this.emit();
    } catch (error) {
      if (!current()) return;
      const detail = privateFailure('Semantic draft check', error);
      this.reviewPending = false; this.reviewWarning = `AI check unavailable — review the draft yourself (${detail})`; this.emit();
    }
  }
  acceptRisks(value) {
    this.keepRisks = value === true && this.phase === 'ready' && this.draftRisks.length > 0;
    this.approved = false; this.emit();
  }
  advisoryIndexes() {
    return [...new Set(this.aiNotes.map(note => note.sourceRiskIndex).filter(index => Number.isInteger(index) && index >= 0 && index < this.risks.length))];
  }
  needsAdvisoryConfirm() { return this.advisoryIndexes().length > 0; }
  acceptAdvisory(value) {
    this.confirmAdvisory = value === true && this.phase === 'ready' && this.needsAdvisoryConfirm();
    this.approved = false; this.emit();
  }
  setTemplate(topic, index = '') {
    if (this.device === 'ready' || this.sent || this.sending) return;
    this.invalidate(); this.version++; this.topic = topic; this.template = index;
    const catalog = (typeof globalThis.document !== 'undefined' && globalThis.document.documentElement?.lang === 'ja') ? TEMPLATES_JA : TEMPLATES;
    const option = catalog[topic]?.options[index];
    this.draft = option ? `${catalog[topic].title}: ${option}` : '';
    this.draftVersion = this.draft ? this.version : -1; this.emit();
  }
  path() { return respondentPath(this.phase === 'preparing' ? 'preparing' : this.device); }
  canApprove() {
    return !this.sent && !this.sending && !!this.draft.trim() && this.draftVersion === this.version && ['ready', 'structured'].includes(this.phase)
      && (!this.draftRisks.length || this.keepRisks) && (!this.needsAdvisoryConfirm() || this.confirmAdvisory);
  }
  approve(value) { this.approved = value === true && this.canApprove(); this.emit(); }
  async submit() {
    if (!this.canApprove() || !this.approved) return null;
    const payload = submission({ question_id: this.question_id, draft: this.draft, approved: this.approved, version: this.version, draftVersion: this.draftVersion });
    this.sending = true; this.error = ''; this.emit();
    try {
      await this.send(this.responseId, payload); this.sent = payload; this.sentSource = this.rewriteResult ? { source: this.rewriteResult.source } : null;
      this.invalidate(); this.clearReview(); this.raw = ''; this.draft = ''; this.risks = []; this.rewriteResult = null; this.riskResult = null; this.editing = false;
      this.draftRisks = []; this.reviewResult = null;
      return payload;
    } catch {
      this.error = 'Could not confirm delivery. Retry uses the same response ID. If the first write succeeded, another write is blocked; ask your administrator before starting another response.';
      return null;
    } finally { this.sending = false; this.emit(); }
  }
}

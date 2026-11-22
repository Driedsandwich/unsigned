export const MAX_TEXT = 1200;
export function text(value, max = MAX_TEXT) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error('Invalid text');
  return value.trim();
}
export function questionId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error('Invalid question ID');
  return value;
}
export function submission({ question_id, draft, approved, version, draftVersion }) {
  if (approved !== true || version !== draftVersion) throw new Error('Approve the current complete draft');
  return Object.freeze({ question_id: questionId(question_id), approved_rewrite: text(draft) });
}
export function validatePayload(payload) {
  if (!payload || Object.keys(payload).sort().join(',') !== 'approved_rewrite,question_id') throw new Error('Unexpected response fields');
  return { question_id: questionId(payload.question_id), approved_rewrite: text(payload.approved_rewrite) };
}
export const BANDS = Object.freeze(['3–5', '6–8', '9+']);
export function bandFor(n) { return n >= 9 ? '9+' : n >= 6 ? '6–8' : n >= 3 ? '3–5' : null; }
export function parseJSON(value) {
  return JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
}
// Evidence uses response indexes, never model-reported counts. Duplicate or invalid indexes do not count.
export function thresholdThemes(candidate, responseCount) {
  if (!Array.isArray(candidate) || candidate.length > 30) throw new Error('Invalid theme output');
  return candidate.flatMap(t => {
    if (!t || !Array.isArray(t.members)) return [];
    const members = new Set(t.members.filter(i => Number.isInteger(i) && i >= 0 && i < responseCount));
    const band = bandFor(members.size);
    if (!band) return [];
    try { return [{ title: text(t.title, 100), summary: text(t.summary, 400), band }]; } catch { return []; }
  });
}
// Re-project stored data at every read/export/MCP boundary. No extra fields survive.
export function publicThemes(themes) {
  if (!Array.isArray(themes)) return [];
  return themes.flatMap(t => {
    if (!t || !BANDS.includes(t.band) || ('count' in t && (!Number.isInteger(t.count) || t.count < 3))) return [];
    try { return [{ title: text(t.title, 100), summary: text(t.summary, 400), band: t.band }]; } catch { return []; }
  });
}
export function riskSpans(raw, candidate) {
  if (!Array.isArray(candidate)) throw new Error('Invalid risk output');
  const allowed = new Set(['name', 'date', 'weekday', 'uncommon role', 'other identifying detail']);
  return candidate.slice(0, 30).flatMap(r => {
    if (typeof r?.text !== 'string' || !r.text || !raw.includes(r.text)) return [];
    return [{ text: r.text, category: allowed.has(r.category) ? r.category : 'other identifying detail' }];
  });
}
export function respondentPath(status) { return status === 'ready' ? 'private' : 'structured'; }

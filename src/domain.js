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
// Each index refers to one distinct matched participant, never a model-reported count.
export function thresholdThemes(candidate, participantCount) {
  if (!Array.isArray(candidate) || candidate.length > 30) throw new Error('Invalid theme output');
  return candidate.flatMap(t => {
    if (!t || !Array.isArray(t.members)) return [];
    const members = new Set(t.members.filter(i => Number.isInteger(i) && i >= 0 && i < participantCount));
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
export function riskSpans(raw, candidate, { strict = false } = {}) {
  if (!Array.isArray(candidate)) throw new Error('Invalid risk output');
  if (strict && (candidate.length > 30 || candidate.some(r => typeof r?.text !== 'string' || !r.text || !raw.includes(r.text)))) throw new Error('Unanchored draft risk output');
  const allowed = new Set(['name', 'date', 'weekday', 'uncommon role', 'other identifying detail']);
  return candidate.slice(0, 30).flatMap(r => {
    if (typeof r?.text !== 'string' || !r.text || !raw.includes(r.text)) return [];
    return [{ text: r.text, category: allowed.has(r.category) ? r.category : 'other identifying detail' }];
  });
}
// Finite, conservative local aliases supplement (never replace) the semantic AI review.
const ROLE_ALIASES = [
  ['qa', 'quality assurance', 'quality analyst', 'tester', 'testers', 'testing', 'test engineer'],
  ['release lead', 'release manager', 'release coordinator'],
  ['designer', 'designers', 'design specialist'],
  ['analyst', 'analysts', 'analysis specialist']
];
export function residualRisks(draft, risks) {
  const found = [];
  for (const risk of risks) {
    const terms = new Set([risk.text]);
    if (risk.category === 'uncommon role') {
      const role = risk.text.replace(/\b(?:as|the|a|an|only|sole|single|person|people|in|our|team)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      if (role) terms.add(role);
      for (const aliases of ROLE_ALIASES) {
        if (aliases.some(term => new RegExp(`\\b${term}\\b`, 'i').test(risk.text))) aliases.forEach(term => terms.add(term));
      }
    }
    if (risk.category === 'weekday' || risk.category === 'date') {
      for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
        if (risk.text.toLowerCase().includes(day.toLowerCase())) { terms.add(day); terms.add(day.slice(0,3)); }
      }
    }
    for (const term of terms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
      for (const match of draft.matchAll(pattern)) found.push({ text: match[0], category: risk.category });
    }
  }
  return mergeRisks(found);
}
export function mergeRisks(...lists) {
  return [...new Map(lists.flat().map(r => [r.text, r])).values()];
}
// Join only locally. A marker is one anonymous sign-in per question, linked to one response.
export function participantRewrites(rows, participants) {
  if (!Array.isArray(rows) || !Array.isArray(participants)) throw new Error('Participation evidence required');
  const responses = new Map();
  for (const row of rows) {
    if (!row.id || responses.has(row.id)) throw new Error('Duplicate response evidence');
    responses.set(row.id, row);
  }
  const people = new Set(), usedResponses = new Set(), rewrites = [];
  for (const participant of participants) {
    if (!participant.id || people.has(participant.id) || usedResponses.has(participant.response_id)) throw new Error('Duplicate participation evidence');
    people.add(participant.id); usedResponses.add(participant.response_id);
    const row = responses.get(participant.response_id);
    if (row) rewrites.push(text(row.approved_rewrite));
  }
  if (rewrites.length < 3) throw new Error('At least three distinct participants with approved responses required');
  return rewrites;
}
export function respondentPath(status) { return status === 'ready' ? 'private' : 'structured'; }

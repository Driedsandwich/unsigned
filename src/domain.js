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
export function riskSpans(raw, candidate) {
  if (!Array.isArray(candidate)) throw new Error('Invalid risk output');
  const allowed = new Set(['name', 'date', 'weekday', 'uncommon role', 'other identifying detail']);
  return candidate.slice(0, 30).flatMap(r => {
    if (typeof r?.text !== 'string' || !r.text || !raw.includes(r.text)) return [];
    return [{ text: r.text, category: allowed.has(r.category) ? r.category : 'other identifying detail' }];
  });
}
// Semantic claims are advisory only. Invalid/long spans can explain a note but
// never become sentence highlights or deterministic approval requirements.
export function semanticNotes(draft, candidate, originalRisks) {
  if (!Array.isArray(candidate) || candidate.length > 30) throw new Error('Invalid semantic review');
  return candidate.flatMap(r => {
    if (!Number.isInteger(r?.sourceRiskIndex) || r.sourceRiskIndex < 0 || r.sourceRiskIndex >= originalRisks.length) return [];
    const phrase = typeof r.text === 'string' ? r.text.trim() : '';
    if (/^(?:(?:the|our|a|some|all)\s+)?(?:team|people|updates)$/i.test(phrase) && phrase.toLowerCase() !== originalRisks[r.sourceRiskIndex].text.toLowerCase()) return [];
    const words = phrase.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? [];
    const short = words.length >= 1 && words.length <= 4 && !/[.!?\n\r]/u.test(phrase);
    const spans = short ? literalSpans(draft, phrase).filter(({ start, end }) => {
      // Even a short sentence is not an advisory term highlight.
      const before = draft.slice(0, start).trimEnd(), after = draft.slice(end).trimStart();
      return !((!before || /[.!?]$/.test(before)) && (!after || /^[.!?]/.test(after)));
    }) : [];
    return [{ sourceRiskIndex: r.sourceRiskIndex, category: originalRisks[r.sourceRiskIndex].category, text: spans.length ? phrase : '', spans }];
  });
}
export function literalSpans(value, term) {
  if (!term) return [];
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu');
  return [...value.matchAll(pattern)].map(match => ({ start: match.index, end: match.index + match[0].length }));
}
// Only literal originals and this finite local alias table can gate approval.
const ROLE_ALIASES = [
  ['qa', 'quality assurance', 'quality analyst', 'tester', 'testers', 'testing', 'test engineer', '品質保証', 'テスター', '検証担当', '品質管理'],
  ['release lead', 'release manager', 'release coordinator', 'リリース担当', 'リリースリード'],
  ['designer', 'designers', 'design specialist', 'デザイナー'],
  ['analyst', 'analysts', 'analysis specialist', 'アナリスト', '分析担当']
];
const WEEKDAYS = [
  ['Monday', 'Mon'], ['Tuesday', 'Tue'], ['Wednesday', 'Wed'], ['Thursday', 'Thu'], ['Friday', 'Fri'], ['Saturday', 'Sat'], ['Sunday', 'Sun'],
  ['月曜日', '月曜'], ['火曜日', '火曜'], ['水曜日', '水曜'], ['木曜日', '木曜'], ['金曜日', '金曜'], ['土曜日', '土曜'], ['日曜日', '日曜']
];
const SOLE_MARKERS_JA = Object.freeze(['一人で', '一人だけ', '唯一', 'ただ一人', '単独で', '自分だけ']);
const SOLE_MARKERS_EN = Object.freeze([
  ['\\bonly\\b', 'only'], ['\\bsole\\b', 'sole'], ['\\bsingle\\b', 'single'],
  ['\\bthe one who\\b', 'the one who'], ['\\bby myself\\b', 'by myself'], ['\\bon my own\\b', 'on my own']
]);
const SOLE_ROLE_WORDS = Object.freeze([
  '担当', 'リード', 'リリース', 'テスター', '検証', '品質', 'デザイナー', 'アナリスト',
  'release', 'lead', 'tester', 'qa', 'designer', 'analyst', 'testing', 'manager', 'coordinator'
]);

function soleMarkerIn(text) {
  for (const marker of SOLE_MARKERS_JA) if (text.includes(marker)) return marker;
  for (const [pattern] of SOLE_MARKERS_EN) if (new RegExp(pattern, 'i').test(text)) return true;
  return null;
}

function roleTermsForSoleRisk(risk) {
  const terms = new Set();
  for (const word of SOLE_ROLE_WORDS) {
    if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(word) ? risk.text.includes(word) : new RegExp(`\\b${word}\\b`, 'i').test(risk.text)) terms.add(word);
  }
  if (risk.category === 'uncommon role') {
    for (const aliases of ROLE_ALIASES) {
      if (aliases.some(term => (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(term) ? risk.text.includes(term) : new RegExp(`\\b${term}\\b`, 'i').test(risk.text)))) aliases.forEach(term => terms.add(term));
    }
  }
  return [...terms];
}

function termInDraft(draft, term) {
  if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(term)) return draft.includes(term);
  return new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(draft);
}

const SOLE_IN_DRAFT = new RegExp([...SOLE_MARKERS_JA.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), ...SOLE_MARKERS_EN.map(([p]) => p)].join('|'), 'giu');

function soleRoleResiduals(draft, risks) {
  const found = [];
  for (const [sourceRiskIndex, risk] of risks.entries()) {
    if (risk.category !== 'uncommon role' || !soleMarkerIn(risk.text)) continue;
    const soleMatches = [...draft.matchAll(SOLE_IN_DRAFT)];
    if (!soleMatches.length) continue;
    const roles = roleTermsForSoleRisk(risk);
    if (!roles.some(term => termInDraft(draft, term))) continue;
    for (const match of soleMatches) found.push({ text: match[0], category: 'uncommon role', sourceRiskIndex });
    for (const term of roles) {
      if (!termInDraft(draft, term)) continue;
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = /[\u3040-\u30FF\u4E00-\u9FFF]/.test(term)
        ? new RegExp(escaped, 'giu')
        : new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
      for (const match of draft.matchAll(pattern)) found.push({ text: match[0], category: 'uncommon role', sourceRiskIndex });
    }
  }
  return found;
}

export function residualRisks(draft, risks) {
  const found = [];
  for (const [sourceRiskIndex, risk] of risks.entries()) {
    const terms = new Set([risk.text]);
    if (risk.category === 'uncommon role') {
      for (const aliases of ROLE_ALIASES) {
        if (aliases.some(term => term.match(/[\u3040-\u30FF\u4E00-\u9FFF]/) ? risk.text.includes(term) : new RegExp(`\\b${term}\\b`, 'i').test(risk.text))) aliases.forEach(term => terms.add(term));
      }
    }
    if (risk.category === 'weekday' || risk.category === 'date') {
      for (const [day, short] of WEEKDAYS) {
        if (risk.text.toLowerCase().includes(day.toLowerCase()) || risk.text.includes(day)) {
          terms.add(day);
          if (short) terms.add(short);
        }
      }
    }
    for (const term of terms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = /[\u3040-\u30FF\u4E00-\u9FFF]/.test(term)
        ? new RegExp(escaped, 'giu')
        : new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
      for (const match of draft.matchAll(pattern)) found.push({ text: match[0], category: risk.category, sourceRiskIndex });
    }
  }
  return mergeRisks(found, soleRoleResiduals(draft, risks));
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

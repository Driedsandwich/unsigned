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
const COMMON_ENGLISH_WORDS = new Set(`
  a about above across after again against all am an and any are around as at
  be because been before being below between both but by can could did do does doing
  down during each either else enough even every few for from further had has have
  having he her here hers herself him himself his honestly how i if in into is it
  its itself just like many may me might more most much must my myself near neither no
  nor not now of off on once only onto or other our ours ourselves out over own
  per please same she should since so some still such than that the their theirs them
  themselves then there these they this those though through to together too under
  until up us very via was we were what whatever when where whether which while who
  whom whose why will with within without would yes you your yours yourself yourselves
  one two three four five six seven eight nine ten
  action answer answers better brief bullet bullets change changes clear comment comments
  communication current daily day days detail details document documents easier easy end
  example examples feedback first general good group handoff handoffs help helpful idea
  ideas important issue issues large last later little long low main meeting meetings
  member members memory message messages morning new next note notes old open ordinary
  part parts people person plan plans point points problem problems project projects
  question questions quick recent regular relevant reminder report reports request requests
  response responses result results review reviews right routine rule rules schedule shared
  short simple small status step steps suggestion suggestions support task tasks team teams
  thing things time today tomorrow update updates usual week weekend weeks weekly work yesterday
  challenging checklist checklists clarity communicate communicated communicating coordination
  effective effectively flow improve improved improvement improvements information necessary
  obtain obtained process processes standard standardized standards
`.trim().split(/\s+/));
const SPECIFIC_RISK_CATEGORIES = new Set(['name', 'date', 'weekday', 'uncommon role']);
const EN_MONTH = /(?<![\p{L}\p{N}])(?:January|February|March|April|May|June|July|August|September|October|November|December)(?![\p{L}\p{N}])/u;

// The one ordinary-word test, shared by the source-side marks (riskSpans) and the draft-side AI marks (semanticNotes).
export function hasSpecificWord(term) {
  return (String(term).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).some(word => !COMMON_ENGLISH_WORDS.has(word));
}

export function riskSpans(raw, candidate, ruleRisks = ruleBasedSourceRisks(raw)) {
  if (!Array.isArray(candidate)) throw new Error('Invalid risk output');
  const ruleTexts = new Set(ruleRisks.map(r => r.text));
  return candidate.slice(0, 30).flatMap(r => {
    if (typeof r?.text !== 'string' || !r.text || !raw.includes(r.text)) return [];
    const term = r.text;
    const specificWord = hasSpecificWord(term);
    const specificCategory = SPECIFIC_RISK_CATEGORIES.has(r.category);
    const nameCandidate = specificWord && /^\p{Lu}\p{L}*$/u.test(term) &&
      literalSpans(raw, term).some(({ start }) => {
        const before = raw.slice(0, start).replace(/[\p{Ps}\p{Pi}"' \t]+$/u, '');
        return before.length > 0 && !/[.!?。！？\r\n]$/u.test(before);
      });
    if (!ruleTexts.has(term) && !/\p{N}/u.test(term) && !EN_MONTH.test(term) && !weekdayHits(term).length &&
        !nameCandidate && !(specificCategory && specificWord)) return [];
    return [{ text: term, category: specificCategory ? r.category : 'other identifying detail' }];
  });
}
const JA_NAME = /(?:[\u30A0-\u30FF]|[\u4E00-\u9FFF]){1,6}(?:さん|くん|ちゃん|様|氏)/gu;
const JA_DATE = /\d{1,2}月\d{1,2}日|\d{1,2}\/\d{1,2}/gu;
const JA_WEEKDAY_PAREN = /\([月火水木金土日]\)/gu;
const JA_SOLE_SOURCE = /(?:唯一の|一人だけの|ただ一人の|たった一人の|自分だけが|唯一|一人だけ|ただ一人|たった一人|自分だけ)(?:[のがとして、,\s]*)(?:[\u30A0-\u30FF\u4E00-\u9FFFA-Za-z]+)*(?:担当|リード|リーダー|QA|テスター|検証|リリース|デザイナー|エンジニア|アナリスト|品質)[\u30A0-\u30FF\u4E00-\u9FFFA-Za-z]*/gu;
const EN_SOLE_SOURCE = /\b(?:only|sole|single)\b(?:\s+[\w.'-]+){0,3}/giu;
const EN_NAME = /(?<![\p{L}\p{N}])([A-Z][a-z]{1,19})(?![\p{L}\p{N}])/gu;
const EN_DATE = /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/gu;

function pushRisk(found, text, category) {
  if (text && text.length <= 120) found.push({ text, category });
}

function weekdayHits(raw) {
  const hits = [];
  const terms = [...new Set(WEEKDAYS.flatMap(([day, short]) => [day, short].filter(Boolean)))];
  terms.sort((a, b) => b.length - a.length);
  const seenStarts = new Set();
  for (const day of terms) {
    let from = 0;
    while ((from = raw.indexOf(day, from)) !== -1) {
      if (!seenStarts.has(from)) {
        seenStarts.add(from);
        hits.push({ text: day, category: 'weekday' });
      }
      from += 1;
    }
  }
  for (const match of raw.matchAll(JA_WEEKDAY_PAREN)) pushRisk(hits, match[0], 'weekday');
  return hits;
}

function englishSoleHits(raw) {
  const hits = [];
  for (const match of raw.matchAll(EN_SOLE_SOURCE)) {
    const chunk = match[0].trim();
    if (SOLE_ROLE_WORDS.some(w => !/[\u3040-\u30FF\u4E00-\u9FFF]/.test(w) && new RegExp(`\\b${w}\\b`, 'i').test(chunk))) pushRisk(hits, chunk, 'uncommon role');
  }
  return hits;
}

function keepLongestNameHits(matches) {
  const longest = matches.filter(hit => !matches.some(other => other !== hit && other.text.includes(hit.text)));
  return mergeRisks(longest);
}

// Supplements on-device AI identifyRisks output; each hit must be an exact substring of raw.
export function ruleBasedSourceRisks(raw) {
  const found = [];
  const names = [...raw.matchAll(JA_NAME)].map(match => ({ text: match[0], category: 'name' }));
  for (const match of raw.matchAll(EN_NAME)) {
    const word = match[1];
    if ((!COMMON_ENGLISH_WORDS.has(word.toLowerCase()) || EN_MONTH.test(word)) &&
        !WEEKDAYS.some(([day]) => day === word)) names.push({ text: word, category: 'name' });
  }
  for (const hit of keepLongestNameHits(names)) pushRisk(found, hit.text, hit.category);
  for (const hit of weekdayHits(raw)) pushRisk(found, hit.text, hit.category);
  for (const match of raw.matchAll(JA_DATE)) pushRisk(found, match[0], 'date');
  for (const match of raw.matchAll(EN_DATE)) pushRisk(found, match[0], 'date');
  for (const match of raw.matchAll(JA_SOLE_SOURCE)) pushRisk(found, match[0], 'uncommon role');
  for (const hit of englishSoleHits(raw)) pushRisk(found, hit.text, hit.category);
  return mergeRisks(found).slice(0, 30);
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
    // Ordinary-word phrases (e.g. "standardized checklist") are never marked on the draft; only literal phrases with a specific word are.
    const short = words.length >= 1 && words.length <= 4 && !/[.!?\n\r]/u.test(phrase) && hasSpecificWord(phrase);
    const spans = short ? literalSpans(draft, phrase).filter(({ start, end }) => {
      // Even a short sentence is not an advisory term highlight.
      const before = draft.slice(0, start).trimEnd(), after = draft.slice(end).trimStart();
      return !((!before || /[.!?]$/.test(before)) && (!after || /^[.!?]/.test(after)));
    }) : [];
    // The AI's own phrase rides along non-enumerably so the note's public shape is unchanged (see draftAdvisoryNotes).
    return [Object.defineProperty({ sourceRiskIndex: r.sourceRiskIndex, category: originalRisks[r.sourceRiskIndex].category, text: spans.length ? phrase : '', spans }, 'phrase', { value: phrase })];
  });
}
// An AI note names an original flag (“may still point to …”). Drop it only when it points at nothing:
// the flag (or a fixed alias from the same deterministic table) is not in the draft, AND the note has no phrase
// with a specific word (a note with no phrase, or one made only of ordinary words, carries no other evidence).
export function draftAdvisoryNotes(draft, notes, originalRisks) {
  return notes.filter(note => {
    const risk = originalRisks[note.sourceRiskIndex];
    if (!risk) return false;
    if (residualRisks(draft, [risk]).length > 0) return true;
    return !!note.phrase && hasSpecificWord(note.phrase);
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
const SOLE_MARKERS_JA = Object.freeze([
  '一人で', '一人だけ', '一人だけの', '唯一', '唯一の', 'ただ一人', 'ただ一人の',
  'たった一人', 'たった一人の', '単独で', '自分だけ', '自分だけが'
]);
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
export function dedupeNestedRisks(risks) {
  return risks.filter(r => !risks.some(o => {
    if (o === r || o.category !== r.category) return false;
    if (r.category === 'uncommon role') return r.text.includes(o.text) && r.text.length > o.text.length;
    return o.text.includes(r.text) && o.text.length > r.text.length;
  }));
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

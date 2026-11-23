export const EXAMPLES = Object.freeze({
  handoffs: 'As the only release lead, I chased Maya on Tuesday for the notes. A shared checklist would help.',
  focus: 'As the only designer, I had five meetings with Alex on Monday. More focus time would help.',
  decisions: 'Jordan changed the plan on Friday. As the only analyst, I could not find the reason for the decision.'
});
export const EXAMPLES_JA = Object.freeze({
  handoffs: '唯一のリリース担当として、火曜にマヤさんに引き継ぎメモを取りに行った。共有チェックリストがあると助かる。',
  focus: '唯一のデザイナーとして、月曜にアレックスさんと五つの会議があった。集中できる時間が欲しい。',
  decisions: '金曜にジョーダンさんが計画を変えた。唯一のアナリストとして、決定の理由がわからなかった。'
});
export const TEMPLATES = Object.freeze({
  handoffs: { title: 'Clearer handoffs', options: ['A shared checklist could help.', 'A central place for handoff notes could help.', 'A consistent handoff format could help.'] },
  focus: { title: 'Focus time', options: ['Protected focus time could help.', 'Fewer recurring meetings could help.', 'More asynchronous updates could help.'] },
  decisions: { title: 'Decision context', options: ['Recording the reasons for decisions could help.', 'A shared decision log could help.', 'Clearer context before decisions could help.'] }
});
export const TEMPLATES_JA = Object.freeze({
  handoffs: { title: '引き継ぎを明確に', options: ['共有チェックリストがあると助かる。', '引き継ぎメモの一元化があると助かる。', '引き継ぎフォーマットの統一があると助かる。'] },
  focus: { title: '集中時間', options: ['保護された集中時間があると助かる。', '定例ミーティングを減らせると助かる。', '非同期の更新を増やせると助かる。'] },
  decisions: { title: '決定の背景', options: ['決定の理由を記録できると助かる。', '共有の決定ログがあると助かる。', '決定前にもっと背景がわかると助かる。'] }
});
export const DEMO_CHECKIN = Object.freeze({ id: 'check-in-001', question: 'What would make handoffs easier?', status: 'open' });
export const DEMO_THEMES = Object.freeze([
  Object.freeze({ title: 'Focus time', summary: 'More uninterrupted time would help deep work.', band: '3–5' }),
  Object.freeze({ title: 'Decision context', summary: 'Capture the reasons behind key decisions.', band: '6–8' })
]);
export const DEMO_THEMES_JA = Object.freeze([
  Object.freeze({ title: '集中時間', summary: '中断の少ない時間があると深い作業がしやすくなります。', band: '3–5' }),
  Object.freeze({ title: '決定の背景', summary: '重要な決定の理由を残すと助かります。', band: '6–8' })
]);
const DEMO_TOPIC_DEFS = Object.freeze({
  handoffs: Object.freeze({
    en: { title: 'Clearer handoffs', summary: 'Shared checklists and handoff notes could help.' },
    ja: { title: '引き継ぎを明確に', summary: '共有のチェックリストや引き継ぎメモがあると助かります。' },
    patterns: [/handoff/i, /checklist/i, /引き継ぎ/, /チェックリスト/, /Clearer handoffs/, /引き継ぎを明確に/]
  }),
  focus: Object.freeze({
    en: { title: 'Focus time', summary: 'More uninterrupted time would help deep work.' },
    ja: { title: '集中時間', summary: '中断の少ない時間があると深い作業がしやすくなります。' },
    patterns: [/focus time/i, /uninterrupted/i, /recurring meeting/i, /quiet work/i, /集中/, /ミーティング/, /Focus time/, /集中時間/, /Protected focus/]
  }),
  decisions: Object.freeze({
    en: { title: 'Decision context', summary: 'Capture the reasons behind key decisions.' },
    ja: { title: '決定の背景', summary: '重要な決定の理由を残すと助かります。' },
    patterns: [/decision/i, /reasons? for/i, /decision log/i, /plans? changed/i, /決定/, /理由/, /Decision context/, /決定の背景/]
  })
});
const THEME_TITLE_PAIRS = Object.freeze(DEMO_THEMES.map((en, i) => ({ en: en.title, ja: DEMO_THEMES_JA[i].title, summaryEn: en.summary, summaryJa: DEMO_THEMES_JA[i].summary })));

export function demoThemesForLocale(locale = 'en') {
  return (locale === 'ja' ? DEMO_THEMES_JA : DEMO_THEMES).map(t => ({ ...t }));
}

export function localizeStoredTheme(theme, locale = 'en') {
  if (locale !== 'ja') return theme;
  const pair = THEME_TITLE_PAIRS.find(p => p.en === theme.title);
  if (pair) return { ...theme, title: pair.ja, summary: pair.summaryJa ?? theme.summary };
  for (const def of Object.values(DEMO_TOPIC_DEFS)) {
    if (def.en.title === theme.title) return { ...theme, title: def.ja.title, summary: def.ja.summary };
  }
  return theme;
}

export function classifyDemoRewrite(text) {
  for (const [topic, def] of Object.entries(DEMO_TOPIC_DEFS)) {
    if (def.patterns.some(pattern => pattern.test(text))) return topic;
  }
  return null;
}

export function demoThemesFromRewrites(rewrites, locale = 'en') {
  const buckets = Object.fromEntries(Object.keys(DEMO_TOPIC_DEFS).map(k => [k, []]));
  rewrites.forEach((row, index) => {
    const topic = classifyDemoRewrite(row);
    if (topic) buckets[topic].push(index);
  });
  const lang = locale === 'ja' ? 'ja' : 'en';
  return Object.entries(buckets).flatMap(([topic, members]) => {
    if (members.length < 3) return [];
    const copy = DEMO_TOPIC_DEFS[topic][lang];
    return [{ title: copy.title, summary: copy.summary, members }];
  });
}
export const DEMO_RESPONSES = Object.freeze([
  'Protected focus time would help.', 'Fewer recurring meetings would help.', 'More uninterrupted work time would help.', 'A quiet work block would help.',
  'A decision log would help.', 'Capture reasons for decisions.', 'Keep decision context accessible.', 'Write down why plans changed.', 'Share decision summaries.', 'Make decision context easier to find.'
]);
export const DEMO_THEME_EVIDENCE = Object.freeze(DEMO_THEMES.map((theme, index) => ({
  title: theme.title, summary: theme.summary, members: index === 0 ? [0,1,2,3] : [4,5,6,7,8,9]
})));

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
export const DEMO_RESPONSES = Object.freeze([
  'Protected focus time would help.', 'Fewer recurring meetings would help.', 'More uninterrupted work time would help.', 'A quiet work block would help.',
  'A decision log would help.', 'Capture reasons for decisions.', 'Keep decision context accessible.', 'Write down why plans changed.', 'Share decision summaries.', 'Make decision context easier to find.'
]);
export const DEMO_THEME_EVIDENCE = Object.freeze(DEMO_THEMES.map((theme, index) => ({
  title: theme.title, summary: theme.summary, members: index === 0 ? [0,1,2,3] : [4,5,6,7,8,9]
})));

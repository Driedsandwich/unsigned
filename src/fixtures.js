export const EXAMPLES = Object.freeze({
  handoffs: 'As the only release lead, I chased Maya on Tuesday for the notes. A shared checklist would help.',
  focus: 'As the only designer, I had five meetings with Alex on Monday. More focus time would help.',
  decisions: 'Jordan changed the plan on Friday. As the only analyst, I could not find the reason for the decision.'
});
export const TEMPLATES = Object.freeze({
  handoffs: { title: 'Clearer handoffs', options: ['A shared checklist could help.', 'A central place for handoff notes could help.', 'A consistent handoff format could help.'] },
  focus: { title: 'Focus time', options: ['Protected focus time could help.', 'Fewer recurring meetings could help.', 'More asynchronous updates could help.'] },
  decisions: { title: 'Decision context', options: ['Recording the reasons for decisions could help.', 'A shared decision log could help.', 'Clearer context before decisions could help.'] }
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

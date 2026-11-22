/* Run: node verify.cjs. Built-in Node modules only; no browser or network. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const script = id => html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>'))[1];
const core = script('prototype-core');
const ui = script('prototype-ui');
const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const plain = value => JSON.parse(JSON.stringify(value));

class Clock {
  constructor() { this.now = 0; this.serial = 0; this.jobs = new Map(); }
  set = (fn, delay) => { const id = ++this.serial; this.jobs.set(id, { at: this.now + delay, fn }); return id; };
  clear = id => this.jobs.delete(id);
  advance(ms) {
    const end = this.now + ms;
    for (;;) {
      const next = [...this.jobs.entries()].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.now = next[1].at; this.jobs.delete(next[0]); next[1].fn();
    }
    this.now = end;
  }
}
function setup() {
  const clock = new Clock();
  const context = vm.createContext({ setTimeout: clock.set, clearTimeout: clock.clear });
  vm.runInContext(core + '\nglobalThis.api = {PrototypeModel, EXAMPLES, runQuestionDraftMock, rewriteOnDeviceMock};', context);
  return { clock, api: context.api, model: new context.api.PrototypeModel() };
}
function ready(s, topic = 'handoffs') { s.model.setRaw(s.api.EXAMPLES[topic]); s.clock.advance(2500); }
function submit(s, topic = 'handoffs') { ready(s, topic); s.model.approve(true); return s.model.submit(); }

test('JavaScript parses; HTML has unique IDs and all direct UI ID references exist', () => {
  new vm.Script(core); new vm.Script(ui);
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const [, id] of ui.matchAll(/(?<!\$)\$\('([^']+)'\)/g)) assert.ok(ids.includes(id), id);
  for (const [, values] of markup.matchAll(/\b(?:for|aria-controls|aria-labelledby|aria-describedby)="([^"]+)"/g)) {
    for (const id of values.split(' ')) assert.ok(ids.includes(id), id);
  }
});
test('Self-contained page blocks connections and has no network or persistence APIs', () => {
  assert.match(markup, /connect-src 'none'/);
  assert.doesNotMatch(html, /<(?:script|img|iframe)\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(html, /<link\b|@import|https?:\/\//i);
  assert.doesNotMatch(core + ui, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB)\b/);
  assert.match(markup, /lang="ja"/);
});
test('Blank initial response cannot be approved or submitted', () => {
  const { model } = setup();
  assert.equal(model.approved, false); assert.equal(model.canApprove(), false);
  model.approve(true); assert.equal(model.submit(), null);
});
test('One-second debounce waits 999ms, then starts progressive rewrite', () => {
  const s = setup(); s.model.setRaw(s.api.EXAMPLES.handoffs);
  s.clock.advance(999); assert.equal(s.model.phase, 'waiting'); assert.equal(s.model.draft, '');
  s.clock.advance(1); assert.equal(s.model.phase, 'rewriting');
  s.clock.advance(450); assert.ok(s.model.draft.length > 0); assert.equal(s.model.canApprove(), false);
  s.clock.advance(1000); assert.equal(s.model.phase, 'ready'); assert.equal(s.model.draftVersion, 1);
});
test('Every input raises the version and resets the debounce', () => {
  const s = setup(); s.model.setRaw('First'); s.clock.advance(900);
  s.model.setRaw('Second'); assert.equal(s.model.rawVersion, 2);
  s.clock.advance(999); assert.equal(s.model.phase, 'waiting');
  s.clock.advance(1001); assert.equal(s.model.draftVersion, 2);
});
test('A stale timer callback is rejected even if invoked after cancellation', () => {
  const s = setup(); s.model.setRaw(s.api.EXAMPLES.handoffs);
  const staleStart = [...s.clock.jobs.values()][0].fn;
  s.model.setRaw(s.api.EXAMPLES.focus); staleStart();
  assert.equal(s.model.phase, 'waiting');
  s.clock.advance(2500); const latest = s.model.draft;
  staleStart(); assert.equal(s.model.draft, latest); assert.match(latest, /focus time/);
});
test('An in-flight old growth result cannot overwrite a newer source', () => {
  const s = setup(); s.model.setRaw(s.api.EXAMPLES.handoffs); s.clock.advance(1000);
  const staleGrowth = [...s.clock.jobs.values()][0].fn;
  s.model.setRaw(s.api.EXAMPLES.decisions); staleGrowth();
  assert.equal(s.model.phase, 'waiting'); s.clock.advance(2500);
  assert.match(s.model.draft, /decisions/); assert.equal(s.model.draftVersion, 2);
});
test('Source edits clear approval immediately', () => {
  const s = setup(); ready(s); s.model.approve(true); assert.equal(s.model.approved, true);
  s.model.setRaw('Changed source'); assert.equal(s.model.approved, false); assert.equal(s.model.submit(), null);
});
test('Manual draft edits clear approval and preserve the edited text', () => {
  const s = setup(); ready(s); s.model.approve(true); s.model.beginEdit();
  s.model.editDraft('A consistent handoff checklist would help.');
  assert.equal(s.model.approved, false); s.clock.advance(10000);
  assert.equal(s.model.draft, 'A consistent handoff checklist would help.');
  assert.equal(s.model.canApprove(), true);
});
test('Changed source never overwrites a protected draft; explicit regenerate releases it', () => {
  const s = setup(); ready(s); s.model.beginEdit(); s.model.editDraft('Keep my edit.');
  s.model.setRaw(s.api.EXAMPLES.focus); s.clock.advance(10000);
  assert.equal(s.model.draft, 'Keep my edit.'); assert.equal(s.model.phase, 'stale');
  assert.equal(s.model.canApprove(), false);
  s.model.regenerate(); s.clock.advance(1500);
  assert.match(s.model.draft, /focus time/); assert.equal(s.model.canApprove(), true);
  assert.equal(s.model.approved, false);
});
test('Empty source and whitespace-only edited draft cannot be submitted', () => {
  const s = setup(); ready(s); s.model.setRaw('   '); s.clock.advance(2500);
  assert.equal(s.model.canApprove(), false); assert.equal(s.model.draft, '');
  ready(s); s.model.beginEdit(); s.model.editDraft('   '); s.model.approve(true);
  assert.equal(s.model.submit(), null);
});
test('Receipt contains exactly the question ID and the approved edited text', () => {
  const s = setup(); ready(s); s.model.beginEdit();
  s.model.editDraft('A shared handoff checklist would help.'); s.model.approve(true);
  const payload = plain(s.model.submit());
  assert.deepEqual(payload, { question_id: 'check-in-001', approved_rewrite: 'A shared handoff checklist would help.' });
  assert.doesNotMatch(JSON.stringify(payload), /Maya|Tuesday|release lead|history|person/);
  assert.equal(s.model.raw, ''); assert.equal(s.model.draft, '');
});
test('Double submission is blocked and does not add a second person', () => {
  const s = setup(); submit(s); assert.equal(s.model.groups.handoffs.people.size, 3);
  assert.equal(s.model.submit(), null); assert.equal(s.model.groups.handoffs.people.size, 3);
});
test('A theme with two people exposes no title, text, or count', () => {
  const s = setup(); const themes = plain(s.model.publicThemes());
  assert.equal(themes.length, 2); assert.doesNotMatch(JSON.stringify(themes), /handoffs|checklist/);
  for (const theme of themes) assert.deepEqual(Object.keys(theme).sort(), ['band', 'key', 'strength', 'summary', 'title']);
});
test('The third distinct fictional respondent makes the hidden handoff island visible', () => {
  const s = setup(); submit(s);
  const themes = plain(s.model.publicThemes()); assert.equal(themes.length, 3);
  assert.equal(themes.find(t => t.key === 'handoffs').band, '3–5');
});
test('Bands advance at six and nine distinct people; repeated local identity is deduplicated', () => {
  const s = setup();
  for (let n = 0; n < 7; n++) { if (n) s.model.nextRespondent(); submit(s); }
  assert.equal(s.model.publicThemes().find(t => t.key === 'handoffs').band, '9+');
  s.model.aggregateApprovedMock(s.model.sent, 'demo-person-7');
  assert.equal(s.model.groups.handoffs.people.size, 9);
  const t = setup(); for (let n = 0; n < 4; n++) { if (n) t.model.nextRespondent(); submit(t); }
  assert.equal(t.model.publicThemes().find(theme => theme.key === 'handoffs').band, '6–8');
});
test('Next fictional respondent starts blank and unapproved', () => {
  const s = setup(); submit(s); s.model.nextRespondent();
  assert.equal(s.model.person, 2); assert.equal(s.model.raw, ''); assert.equal(s.model.approved, false);
  assert.equal(s.model.sent, null); assert.equal(s.model.publicThemes().length, 3);
});
test('No-AI switch clears pending raw text and rejects late rewrite results', () => {
  const s = setup(); s.model.setRaw(s.api.EXAMPLES.handoffs); s.clock.advance(1000);
  const stale = [...s.clock.jobs.values()][0].fn;
  s.model.setDevice(false); stale(); s.clock.advance(5000);
  assert.equal(s.model.raw, ''); assert.equal(s.model.draft, ''); assert.equal(s.model.phase, 'empty');
  s.model.setRaw('No raw input allowed'); assert.equal(s.model.raw, '');
});
test('No-AI path requires a complete template and submits the same two-field schema', () => {
  const s = setup(); s.model.setDevice(false); s.model.setFallback('handoffs');
  assert.equal(s.model.canApprove(), false); s.model.setFallback('handoffs', '0');
  assert.equal(s.model.canApprove(), true); s.model.approve(true);
  const payload = plain(s.model.submit());
  assert.deepEqual(Object.keys(payload), ['question_id', 'approved_rewrite']);
  assert.equal(payload.approved_rewrite, 'Clearer handoffs: A shared checklist could help.');
  assert.equal(s.model.publicThemes().length, 3);
});
test('Changing fallback topic or template clears approval', () => {
  const s = setup(); s.model.setDevice(false); s.model.setFallback('focus', '0'); s.model.approve(true);
  s.model.setFallback('focus', '1'); assert.equal(s.model.approved, false);
  s.model.approve(true); s.model.setFallback('decisions');
  assert.equal(s.model.approved, false); assert.equal(s.model.canApprove(), false);
});
test('Switching device availability after sending preserves the locked receipt', () => {
  const s = setup(); const payload = submit(s);
  s.model.setDevice(false); assert.equal(s.model.sent, payload); assert.equal(s.model.submit(), null);
});
test('Mock rewrites are fixed examples and never interpolate original identifiers', () => {
  const s = setup();
  for (const raw of ['Maya Tuesday only lead secret-name-12', 'Alex focus Monday', 'Jordan decision Friday', '会議の多さで集中できない']) {
    const output = s.api.rewriteOnDeviceMock(raw);
    assert.doesNotMatch(output, /Maya|Tuesday|Alex|Monday|Jordan|Friday|secret-name-12/);
  }
});
test('Question drafting chooses the actual device-first or cloud-fallback fixture', () => {
  const s = setup(), themes = s.model.publicThemes();
  assert.equal(s.api.runQuestionDraftMock(true, themes).location, 'Ran on device');
  assert.equal(s.api.runQuestionDraftMock(false, themes).location, 'Ran in cloud (fallback)');
  assert.doesNotMatch(s.api.runQuestionDraftMock(true, themes).text, /handoffs/);
  submit(s); assert.match(s.api.runQuestionDraftMock(true, s.model.publicThemes()).text, /handoffs/);
});

// Minimal DOM wiring harness. This exercises handlers, not browser layout or native behavior.
function setupUI() {
  const clock = new Clock(), elements = [], byId = new Map();
  const attrs = text => Object.fromEntries([...text.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m => [m[1], m[2] ?? '']));
  for (const [, tag, text] of markup.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)) {
    const a = attrs(text), listeners = {};
    const el = {
      tag, attributes: a, id: a.id, dataset: Object.fromEntries(Object.entries(a).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5), v])),
      value: a.value ?? '', hidden: Object.hasOwn(a, 'hidden'), disabled: Object.hasOwn(a, 'disabled'), checked: false,
      textContent: '', innerHTML: '', classList: { toggle() {} },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, listener) { listeners[type] = listener; },
      focus() { this.focused = true; },
      querySelector() { return elements.find(e => e.attributes.name === 'fallback-topic'); },
      fire(type) { if (type !== 'click' || !this.disabled) listeners[type]?.({ target: this, preventDefault() {} }); }
    };
    elements.push(el); if (el.id) byId.set(el.id, el);
  }
  function select(selector) {
    if (selector === 'input[name="fallback-topic"]') return elements.filter(e => e.tag === 'input' && e.attributes.name === 'fallback-topic');
    if (selector === '.segmented [data-size]') return elements.filter(e => e.tag === 'button' && Object.hasOwn(e.dataset, 'size'));
    const key = selector.match(/^\[data-([\w-]+)\]$/)?.[1];
    if (key) return elements.filter(e => Object.hasOwn(e.dataset, key));
    throw new Error('Unsupported harness selector: ' + selector);
  }
  const document = { getElementById: id => byId.get(id), querySelectorAll: select };
  const context = vm.createContext({ document, setTimeout: clock.set, clearTimeout: clock.clear });
  vm.runInContext(core, context);
  vm.runInContext(ui + '\nglobalThis.wiring = {model, setView, setTab};', context);
  return { clock, el: id => byId.get(id), select, wiring: context.wiring };
}
test('UI wiring: input → draft → approval → receipt → third island', () => {
  const s = setupUI(); assert.equal(s.el('send-response').disabled, true);
  s.el('raw-response').value = 'Maya needs a handoff checklist on Tuesday.'; s.el('raw-response').fire('input');
  s.clock.advance(2500); assert.equal(s.el('approve').disabled, false);
  s.el('approve').checked = true; s.el('approve').fire('change'); s.el('send-response').fire('click');
  assert.equal(s.el('receipt').hidden, false); assert.equal(s.el('response-form').hidden, true);
  assert.deepEqual(Object.keys(JSON.parse(s.el('sent-json').textContent)), ['question_id', 'approved_rewrite']);
  assert.match(s.el('theme-map').innerHTML, /Clearer handoffs/);
  s.el('receipt-admin').fire('click'); assert.equal(s.el('admin-view').hidden, false);
});
test('UI wiring: No-AI shows structured choice and hides the raw input flow', () => {
  const s = setupUI(); s.select('[data-device]').find(e => e.dataset.device === 'no').fire('click');
  assert.equal(s.el('private-flow').hidden, true); assert.equal(s.el('fallback-flow').hidden, false);
  s.select('input[name="fallback-topic"]').find(e => e.value === 'handoffs').fire('change');
  s.el('fallback-template').value = '0'; s.el('fallback-template').fire('change');
  assert.equal(s.el('approve').disabled, false);
});
test('UI wiring: execution location stays tied to the actual run, then changes on regenerate', () => {
  const s = setupUI(); s.wiring.setView('admin');
  s.select('[data-device]').find(e => e.dataset.device === 'no').fire('click');
  s.clock.advance(700); assert.equal(s.el('execution-location').textContent, 'Ran on device');
  assert.equal(s.el('next-route').textContent, 'Next run: cloud (fallback)');
  s.el('generate-question').fire('click'); s.clock.advance(700);
  assert.equal(s.el('execution-location').textContent, 'Ran in cloud (fallback)');
});
test('UI wiring: Use draft adopts edited question text without changing the live question', () => {
  const s = setupUI(); s.wiring.setView('admin'); s.clock.advance(700);
  s.el('question-draft').value = 'What would make next week easier?'; s.el('question-draft').fire('input');
  s.el('use-question').fire('click');
  assert.equal(s.el('saved-question').hidden, false);
  assert.equal(s.el('saved-question-text').textContent, 'What would make next week easier?');
  assert.match(s.el('saved-question-location').textContent, /Edited by you/);
  assert.equal(s.wiring.model.sent, null);
  s.wiring.setTab('settings'); assert.equal(s.el('panel-settings').hidden, false);
  assert.equal(s.el('panel-themes').hidden, true);
});

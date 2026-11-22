import { loadConfig } from './config.js';
import { createServices, deferred } from './services.js';
import { Respondent } from './respondent.js';
import { sourceLabel } from './inference.js';
import { questionId } from './domain.js';
import { EXAMPLES, TEMPLATES } from './fixtures.js';
const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];
const tell = message => { $('app-message').textContent = message; $('announcer').textContent = message; };
let config, services, respondent, checkin, viewRequest = 0;
const adminWorkspace = deferred(async () => {
  const { createAdmin } = await import('./admin.js');
  return createAdmin({ config, services, checkin, setView, tell });
});
async function openAdmin(signIn = false) {
  const request = ++viewRequest;
  try {
    const workspace = await adminWorkspace();
    if (request === viewRequest) await workspace.open(signIn);
  } catch { tell('Could not load the administrator workspace. Try again.'); }
}
function setView(view) {
  const isAdmin = view === 'admin';
  $('admin-view').hidden = !isAdmin; $('respondent-view').hidden = isAdmin; $('admin-tabs').hidden = !isAdmin;
  $$('[data-view]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.view === view)));
  $('structured-mode').hidden = isAdmin;
}
function markRisks(raw, risks, target) {
  const fragment = document.createDocumentFragment(); let offset = 0;
  const spans = [];
  for (const r of risks) {
    let from = 0, index;
    while ((index = raw.indexOf(r.text, from)) !== -1) { spans.push({ start: index, end: index + r.text.length, category: r.category }); from = index + r.text.length; }
  }
  spans.sort((a,b) => a.start - b.start || b.end - a.end);
  for (const s of spans) {
    if (s.start < offset) continue;
    fragment.append(document.createTextNode(raw.slice(offset, s.start)));
    const mark = document.createElement('mark'); mark.textContent = raw.slice(s.start, s.end); mark.title = s.category; fragment.append(mark); offset = s.end;
  }
  fragment.append(document.createTextNode(raw.slice(offset))); $(target).replaceChildren(fragment);
}
function renderResponse() {
  const m = respondent; if (!m) return;
  const preparing = m.phase === 'preparing';
  $('private-flow').hidden = m.path() === 'structured'; $('fallback-flow').hidden = m.path() !== 'structured';
  $('fallback-title').textContent = preparing ? 'Preparing on-device model' : "This device can't rewrite privately";
  $('response-form').hidden = !!m.sent; $('receipt').hidden = !m.sent;
  if ($('raw-response').value !== m.raw) $('raw-response').value = m.raw;
  if ($('neutral-draft').value !== m.draft) $('neutral-draft').value = m.draft;
  $('raw-count').textContent = `${m.raw.length} / 1200`;
  $('raw-response').disabled = m.sending;
  $('neutral-draft').readOnly = !m.editing || m.sending || m.phase === 'stale';
  $('approve').checked = m.approved; $('approve').disabled = !m.canApprove();
  $('send-response').disabled = !m.canApprove() || !m.approved;
  $('send-response').textContent = m.sending ? 'Sending approved response…' : 'Send approved response';
  $('edit-draft').disabled = m.phase !== 'ready' || m.sending;
  $('regenerate').disabled = !m.raw.trim() || m.sending || ['preparing','rewriting','checking'].includes(m.phase);
  $('structured-mode').disabled = m.sending || !!m.sent;
  const statuses = { empty: 'Waiting for your words', waiting: 'Waiting for a pause', preparing: 'Preparing on-device model', rewriting: 'Rewriting on device', checking: 'Checking identifying details on device', ready: 'Ready to review', stale: 'Source changed · regenerate to review', structured: 'Structured answer · no AI' };
  $('draft-status').textContent = statuses[m.phase];
  $('draft-version').textContent = `Source v${m.version} · ${m.draftVersion < 0 ? 'No complete draft' : 'Draft v' + m.draftVersion}`;
  $('draft-note').textContent = `${sourceLabel(m.rewriteResult)} · ${m.edited ? 'Edited by you. ' : ''}Review for identifying details; AI can miss them.`;
  $('risk-source').textContent = sourceLabel(m.riskResult);
  $('risk-note').textContent = m.riskResult ? (m.risks.length ? 'Marked details may identify the writer. Review the rewrite before approving.' : 'No details flagged. This is not a guarantee of anonymity.') : 'Review names, dates and uncommon roles before approving.';
  markRisks(m.raw, m.risks, 'risk-marks');
  markRisks(m.draft, m.draftRisks, 'draft-risk-marks');
  $('draft-risk-review').hidden = !m.draft;
  $('draft-risk-source').textContent = sourceLabel(m.reviewResult);
  $('draft-risk-note').textContent = !m.reviewResult || m.phase !== 'ready' ? 'This version needs a complete on-device check. Approval is locked.' : m.draftRisks.length ? 'Marked details remain. Edit them out, or explicitly choose to keep them before approving.' : 'No residual details flagged. Review carefully; this is not a guarantee of anonymity.';
  $('keep-risks-label').hidden = !m.draftRisks.length;
  $('keep-risks').checked = m.keepRisks;
  $('keep-risks').disabled = m.phase !== 'ready' || m.sending;
  $('ai-bridge').classList.toggle('processing', ['preparing','rewriting','checking'].includes(m.phase));
  $('header-context').textContent = m.device === 'ready' ? 'AI · On device' : 'Structured answer · No AI';
  const options = TEMPLATES[m.topic]?.options ?? [];
  const select = $('fallback-template');
  if (select.dataset.topic !== m.topic) {
    select.replaceChildren(new Option('Choose a short template', ''), ...options.map((s,i) => new Option(s,String(i)))); select.dataset.topic = m.topic;
  }
  select.value = m.template; select.disabled = !m.topic || m.sending;
  $$('input[name="fallback-topic"]').forEach(el => { el.checked = el.value === m.topic; el.disabled = m.sending; });
  $('structured-answer').textContent = m.device === 'ready' ? 'Choose a topic to use a structured answer while the model prepares.' : m.draft || 'Choose a topic and template to preview your response.';
  $('flow-one-title').textContent = m.device === 'ready' ? 'Typed here' : 'Chosen here';
  $('flow-two-title').textContent = m.device === 'ready' ? 'Rewritten here' : 'Structured answer';
  $('flow-two-note').textContent = m.device === 'ready' ? 'On device' : 'No AI';
  if (m.sent) { $('sent-json').textContent = JSON.stringify(m.sent, null, 2); $('receipt-source').textContent = m.sentSource ? sourceLabel(m.sentSource) + ' · Approved version' : 'Structured answer · No AI'; }
  if (m.error) tell(m.error);
  else if (preparing) tell('Preparing on-device model. The supplied Chrome 158 spike took about 11 seconds on its first call. You can choose a structured answer now.');
  else if (['ready','structured','rewriting','checking'].includes(m.phase)) tell(statuses[m.phase]);
}
async function start() {
  try {
    config = await loadConfig(); services = createServices(config);
    $('mode-banner').textContent = config.demo ? 'Demo mode — cloud steps are simulated' : 'Unsigned · Private weekly check-ins';
    $('footer-mode').textContent = config.demo ? 'Real on-device AI · Fictional cloud fixtures' : 'Firebase AI Logic · Approved rewrites only';
    $('admin-login').textContent = config.demo ? 'Open Demo Admin' : 'Sign in with Google';
    $('next-respondent').hidden = !config.demo; $('examples').hidden = !config.demo;
    const id = questionId(new URLSearchParams(location.search).get('checkin') || 'check-in-001');
    await services.respondent();
    try { checkin = await services.checkin(id); }
    catch { checkin = { id, unavailable: true }; $('current-question').textContent = 'This check-in is unavailable. Ask your administrator for an open check-in link.'; $('response-form').hidden = true; tell('No open check-in found. Administrators can sign in to create a draft.'); }
    function newResponse() {
      if (checkin.unavailable) return;
      respondent?.invalidate();
      respondent = new Respondent({ infer: services.infer, send: services.submit, question_id: checkin.id, responseId: services.responseId(), onChange: renderResponse });
      $('current-question').textContent = checkin.question; renderResponse();
    }
    newResponse();
    $('auth-status').textContent = config.demo ? 'Fictional data · memory only' : 'Anonymous respondent';
    $$('[data-view]').forEach(el => el.addEventListener('click', () => { if (el.dataset.view === 'admin') void openAdmin(); else { viewRequest++; setView('respondent'); } }));
    $('admin-login').addEventListener('click', () => openAdmin(true));
    $('raw-response').addEventListener('input', e => respondent?.setRaw(e.target.value));
    $('load-example').addEventListener('click', () => respondent?.setRaw(EXAMPLES[$('example-select').value]));
    $('edit-draft').addEventListener('click', () => { respondent?.beginEdit(); $('neutral-draft').focus(); });
    $('neutral-draft').addEventListener('input', e => respondent?.editDraft(e.target.value));
    $('regenerate').addEventListener('click', () => respondent?.rewrite());
    $('approve').addEventListener('change', e => respondent?.approve(e.target.checked));
    $('keep-risks').addEventListener('change', e => respondent?.acceptRisks(e.target.checked));
    $('send-response').addEventListener('click', async () => { const payload = await respondent?.submit(); if(payload) { $('receipt-title').focus(); tell(config.demo ? 'Saved in demo memory only. No cloud write occurred.' : 'Approved response accepted.'); } });
    $('structured-mode').addEventListener('click', () => respondent?.structured());
    $$('input[name="fallback-topic"]').forEach(el => el.addEventListener('change', () => { if(respondent?.phase==='preparing') respondent.structured('preparing'); respondent?.setTemplate(el.value); }));
    $('fallback-template').addEventListener('change', e => respondent?.setTemplate(respondent.topic,e.target.value));
    $('next-respondent').addEventListener('click', async () => { await services.nextDemoRespondent(); newResponse(); });
    $('receipt-admin').addEventListener('click', () => openAdmin());
    // Availability probing is not inference. All inference remains inside firebase/ai.
    if (respondent && !globalThis.LanguageModel) respondent.structured('unavailable');
    else if (respondent && typeof globalThis.LanguageModel.availability === 'function') {
      try { if(await globalThis.LanguageModel.availability()==='unavailable') respondent.structured('unavailable'); } catch { respondent.structured('failed'); }
    }
  } catch {
    $('mode-banner').textContent='Unsigned could not start';
    tell('Configuration or initialization failed. Check your local configuration. No response was sent.');
    $('response-form').hidden=true; $('admin-login').disabled=true; $('structured-mode').disabled=true;
  }
}
void start();

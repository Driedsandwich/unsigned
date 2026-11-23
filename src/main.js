import { loadConfig } from './config.js';
import { createServices, deferred } from './services.js';
import { Respondent } from './respondent.js';
import { questionId, literalSpans } from './domain.js';
import { EXAMPLES, EXAMPLES_JA, TEMPLATES, TEMPLATES_JA } from './fixtures.js';
const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];
let config, services, respondent, checkin, viewRequest = 0;
let i18n;
const tell = message => { const text = i18n?.translateRespondentCopy?.(message) ?? message; $('app-message').textContent = text; $('announcer').textContent = text; };
const fixtures = () => i18n.getLocale() === 'ja' ? { examples: EXAMPLES_JA, templates: TEMPLATES_JA } : { examples: EXAMPLES, templates: TEMPLATES };
const adminWorkspace = deferred(async () => {
  const { createAdmin } = await import('./admin.js');
  return createAdmin({ config, services, checkin, setView, tell, refreshAdminI18n: () => i18n.applyStaticI18n($('admin-view')) });
});
async function openAdmin(signIn = false) {
  const request = ++viewRequest;
  try {
    const workspace = await adminWorkspace();
    if (request === viewRequest) await workspace.open(signIn);
  } catch { tell(i18n.t('tellAdminLoadFail')); }
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
    for (const span of r.spans ?? literalSpans(raw, r.text)) spans.push({ ...span, category: i18n.riskCategoryLabel(r.category, r.advisory), advisory: r.advisory });
  }
  spans.sort((a,b) => a.start - b.start || b.end - a.end);
  for (const s of spans) {
    if (s.start < offset) continue;
    fragment.append(document.createTextNode(raw.slice(offset, s.start)));
    const mark = document.createElement('mark'); mark.textContent = raw.slice(s.start, s.end); mark.title = s.category;
    if (s.advisory) mark.setAttribute('aria-label', s.category);
    fragment.append(mark); offset = s.end;
  }
  fragment.append(document.createTextNode(raw.slice(offset))); $(target).replaceChildren(fragment);
}
function phaseStatus(phase) {
  const map = { empty: 'statusEmpty', waiting: 'statusWaiting', preparing: 'statusPreparing', rewriting: 'statusRewriting', checking: 'statusChecking', ready: 'statusReady', stale: 'statusStale', structured: 'statusStructured' };
  return i18n.t(map[phase] ?? 'statusEmpty');
}
function refreshExampleOptions() {
  const select = $('example-select');
  const value = select.value || 'handoffs';
  select.replaceChildren(
    new Option(i18n.t('exampleHandoffs'), 'handoffs'),
    new Option(i18n.t('exampleFocus'), 'focus'),
    new Option(i18n.t('exampleDecisions'), 'decisions')
  );
  select.value = value;
}
function refreshToolbarAuth() {
  $('admin-login').textContent = config.demo ? i18n.t('openDemoAdmin') : i18n.t('signInGoogle');
  if (!respondent) {
    $('auth-status').textContent = config.demo ? i18n.t('authDemo') : i18n.t('authAnonymous');
  }
}
function refreshChrome() {
  if (!config) return;
  $('mode-banner').dataset.i18n = config.demo ? 'modeBannerDemo' : 'modeBannerLive';
  $('mode-banner').textContent = i18n.t($('mode-banner').dataset.i18n);
  $('footer-mode').dataset.i18n = config.demo ? 'footerDemo' : 'footerLive';
  $('footer-mode').textContent = i18n.t($('footer-mode').dataset.i18n);
  refreshToolbarAuth();
  i18n.applyStaticI18n();
  i18n.applyStaticI18n($('admin-view'));
  i18n.syncJaIntro();
  if ($('admin-view').innerHTML.trim()) $('admin-view').dispatchEvent(new Event('admin-i18n'));
}
function renderResponse() {
  const m = respondent; if (!m) return;
  const { templates } = fixtures();
  const preparing = m.phase === 'preparing';
  $('private-flow').hidden = m.path() === 'structured'; $('fallback-flow').hidden = m.path() !== 'structured';
  $('fallback-title').textContent = preparing ? i18n.t('fallbackTitlePreparing') : i18n.t('fallbackTitleUnavailable');
  $('response-form').hidden = !!m.sent; $('receipt').hidden = !m.sent;
  if ($('raw-response').value !== m.raw) $('raw-response').value = m.raw;
  if ($('neutral-draft').value !== m.draft) $('neutral-draft').value = m.draft;
  $('raw-count').textContent = `${m.raw.length} / 1200`;
  $('raw-response').disabled = m.sending;
  $('neutral-draft').readOnly = !m.editing || m.sending || m.phase === 'stale';
  $('approve').checked = m.approved; $('approve').disabled = !m.canApprove();
  $('send-response').disabled = !m.canApprove() || !m.approved;
  $('send-response').textContent = m.sending ? i18n.t('sendingApproved') : i18n.t('sendApproved');
  $('edit-draft').disabled = m.phase !== 'ready' || m.sending;
  $('regenerate').disabled = !m.raw.trim() || m.sending || ['preparing','rewriting','checking'].includes(m.phase);
  $('structured-mode').disabled = m.sending || !!m.sent;
  $('draft-status').textContent = phaseStatus(m.phase);
  $('draft-version').textContent = `${i18n.t('sourceVersion', { version: m.version })} · ${m.draftVersion < 0 ? i18n.t('draftVersionNone') : i18n.t('draftVersion', { version: m.draftVersion })}`;
  $('draft-note').textContent = `${i18n.sourceLabelI18n(m.rewriteResult)} · ${m.edited ? i18n.t('draftNoteEdited') : ''}${i18n.t('draftNoteReview')}`;
  $('risk-source').textContent = i18n.sourceLabelI18n(m.riskResult);
  $('risk-note').textContent = m.riskResult ? (m.risks.length ? i18n.t('riskNoteFlagged') : i18n.t('riskNoteNone')) : i18n.t('riskNoteNotRun');
  markRisks(m.raw, m.risks, 'risk-marks');
  markRisks(m.draft, [...m.draftRisks, ...m.aiNotes.map(r => ({ ...r, advisory: true }))], 'draft-risk-marks');
  $('draft-risk-review').hidden = !m.draft;
  $('draft-risk-source').textContent = m.reviewPending ? i18n.t('reviewChecking') : i18n.sourceLabelI18n(m.reviewResult);
  $('draft-risk-note').textContent = m.phase !== 'ready' ? i18n.t('draftRiskWait') : m.draftRisks.length ? i18n.t('draftRiskRemain') : i18n.t('draftRiskClear');
  const notes = [...new Set(m.aiNotes.map(r => r.sourceRiskIndex))].map(index => {
    const original = m.risks[index].text;
    const snippet = original.length > 80 ? original.slice(0, 77) + '…' : original;
    return i18n.t('aiNoteTemplate', { text: snippet });
  });
  $('draft-ai-notes').textContent = i18n.translateRespondentCopy(m.reviewWarning) || (notes.length ? `${notes.join(' · ')}. ${i18n.t('aiNoteNoRetention')}` : '');
  $('draft-ai-notes').hidden = !m.reviewWarning && !notes.length;
  $('keep-risks-label').hidden = !m.draftRisks.length;
  $('keep-risks').checked = m.keepRisks;
  $('keep-risks').disabled = m.phase !== 'ready' || m.sending;
  $('ai-bridge').classList.toggle('processing', m.reviewPending || ['preparing','rewriting','checking'].includes(m.phase));
  $('header-context-text').textContent = m.device === 'ready' ? i18n.t('headerAiOnDevice') : i18n.t('headerStructured');
  const options = templates[m.topic]?.options ?? [];
  const select = $('fallback-template');
  if (select.dataset.topic !== m.topic || select.dataset.locale !== i18n.getLocale()) {
    select.replaceChildren(new Option(i18n.t('chooseTemplate'), ''), ...options.map((s,i) => new Option(s,String(i))));
    select.dataset.topic = m.topic; select.dataset.locale = i18n.getLocale();
  }
  select.value = m.template; select.disabled = !m.topic || m.sending;
  $$('input[name="fallback-topic"]').forEach(el => { el.checked = el.value === m.topic; el.disabled = m.sending; });
  $('structured-answer').textContent = m.device === 'ready' ? i18n.t('structuredChooseTopic') : (m.draft || i18n.t('structuredChooseBoth'));
  $('flow-one-title').textContent = m.device === 'ready' ? i18n.t('flowTyped') : i18n.t('flowChosen');
  $('flow-two-title').textContent = m.device === 'ready' ? i18n.t('flowRewritten') : i18n.t('flowStructured');
  $('flow-two-note').textContent = m.device === 'ready' ? i18n.t('flowOnDevice') : i18n.t('flowNoAi');
  if (m.sent) {
    $('sent-json').textContent = JSON.stringify(m.sent, null, 2);
    $('receipt-source').textContent = m.sentSource ? `${i18n.sourceLabelI18n(m.sentSource)} · ${i18n.t('approvedVersion')}` : `${i18n.t('headerStructured')} · ${i18n.t('flowNoAi')}`;
  }
  if (m.error) tell(m.error);
  else if (preparing) tell(i18n.t('tellPreparing'));
  else if (['ready','structured','rewriting','checking'].includes(m.phase)) tell(phaseStatus(m.phase));
}
async function start() {
  i18n = await import('./i18n.js');
  await i18n.initI18n();
  i18n.bindLangToggle(() => { refreshChrome(); refreshExampleOptions(); renderResponse(); });
  i18n.onLocaleChange(() => {
    refreshChrome();
    refreshExampleOptions();
    if (checkin && !checkin.unavailable) $('current-question').textContent = checkin.id === 'check-in-001' ? i18n.t('demoCheckinQuestion') : checkin.question;
    renderResponse();
  });
  try {
    config = await loadConfig(); services = createServices(config);
    refreshChrome();
    $('next-respondent').hidden = !config.demo; $('examples').hidden = !config.demo;
    refreshExampleOptions();
    const id = questionId(new URLSearchParams(location.search).get('checkin') || 'check-in-001');
    await services.respondent();
    try { checkin = await services.checkin(id); }
    catch { checkin = { id, unavailable: true }; $('current-question').textContent = i18n.t('questionUnavailable'); $('response-form').hidden = true; tell(i18n.t('tellCheckinUnavailable')); }
    function newResponse() {
      if (checkin.unavailable) return;
      respondent?.invalidate();
      respondent = new Respondent({ infer: services.infer, send: services.submit, question_id: checkin.id, responseId: services.responseId(), onChange: renderResponse });
      $('current-question').textContent = checkin.id === 'check-in-001' ? i18n.t('demoCheckinQuestion') : checkin.question; renderResponse();
    }
    newResponse();
    refreshToolbarAuth();
    $$('[data-view]').forEach(el => el.addEventListener('click', () => { if (el.dataset.view === 'admin') void openAdmin(); else { viewRequest++; setView('respondent'); } }));
    $('admin-login').addEventListener('click', () => openAdmin(true));
    $('raw-response').addEventListener('input', e => respondent?.setRaw(e.target.value));
    $('load-example').addEventListener('click', () => respondent?.setRaw(fixtures().examples[$('example-select').value]));
    $('edit-draft').addEventListener('click', () => { respondent?.beginEdit(); $('neutral-draft').focus(); });
    $('neutral-draft').addEventListener('input', e => respondent?.editDraft(e.target.value));
    $('regenerate').addEventListener('click', () => respondent?.rewrite());
    $('approve').addEventListener('change', e => respondent?.approve(e.target.checked));
    $('keep-risks').addEventListener('change', e => respondent?.acceptRisks(e.target.checked));
    $('send-response').addEventListener('click', async () => { const payload = await respondent?.submit(); if(payload) { $('receipt-title').focus(); tell(config.demo ? i18n.t('tellDemoSaved') : i18n.t('tellApprovedAccepted')); } });
    $('structured-mode').addEventListener('click', () => respondent?.structured());
    $$('input[name="fallback-topic"]').forEach(el => el.addEventListener('change', () => { if(respondent?.phase==='preparing') respondent.structured('preparing'); respondent?.setTemplate(el.value); }));
    $('fallback-template').addEventListener('change', e => respondent?.setTemplate(respondent.topic,e.target.value));
    $('next-respondent').addEventListener('click', async () => { await services.nextDemoRespondent(); newResponse(); });
    $('receipt-admin').addEventListener('click', () => openAdmin());
  } catch {
    $('mode-banner').dataset.i18n = 'modeBannerStartFail';
    $('mode-banner').textContent = i18n.t('modeBannerStartFail');
    tell(i18n.t('tellConfigFail'));
    $('response-form').hidden = true; $('admin-login').disabled = true; $('structured-mode').disabled = true;
  }
  if (respondent && !globalThis.LanguageModel) respondent.structured('unavailable');
  else if (respondent && typeof globalThis.LanguageModel?.availability === 'function') {
    try { if(await globalThis.LanguageModel.availability()==='unavailable') respondent.structured('unavailable'); } catch { respondent.structured('failed'); }
  }
}
void start();
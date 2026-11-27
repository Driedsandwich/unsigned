import { loadConfig, sandboxMode } from './config.js';
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
  return createAdmin({ config, services, getCheckin: () => checkin, openSandboxResponse, setView, tell, refreshAdminI18n: () => i18n.applyStaticI18n($('admin-view')) });
});
async function openAdmin(options = {}) {
  const request = ++viewRequest;
  try {
    const workspace = await adminWorkspace();
    if (request === viewRequest) await workspace.open(options);
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
  i18n.paintText($('admin-login'), config.demo ? 'openDemoAdmin' : 'signInGoogle');
  if (!respondent || config.sandbox) i18n.paintText($('auth-status'), config.sandbox ? 'authSandbox' : config.demo ? 'authDemo' : 'authAnonymous');
}
function refreshChrome() {
  if (!config) return;
  i18n.paintText($('mode-banner'), config.sandbox ? 'modeBannerSandbox' : config.demo ? 'modeBannerDemo' : 'modeBannerLive');
  i18n.paintText($('footer-mode'), config.demo ? 'footerDemo' : 'footerLive');
  refreshToolbarAuth();
  i18n.applyStaticI18n();
  i18n.applyStaticI18n($('admin-view'));
  i18n.syncJaIntro(config);
  if ($('admin-view').innerHTML.trim()) $('admin-view').dispatchEvent(new Event('admin-i18n'));
}
function renderResponse() {
  const m = respondent; if (!m) return;
  const { templates } = fixtures();
  const preparing = m.phase === 'preparing';
  $('private-flow').hidden = m.path() === 'structured'; $('fallback-flow').hidden = m.path() !== 'structured';
  i18n.paintText($('fallback-title'), preparing ? 'fallbackTitlePreparing' : 'fallbackTitleUnavailable');
  $('response-form').hidden = !!m.sent; $('receipt').hidden = !m.sent;
  if ($('raw-response').value !== m.raw) $('raw-response').value = m.raw;
  if ($('neutral-draft').value !== m.draft) $('neutral-draft').value = m.draft;
  $('raw-count').textContent = `${m.raw.length} / 1200`;
  $('raw-response').disabled = m.sending;
  $('neutral-draft').readOnly = !m.editing || m.sending || m.phase === 'stale';
  $('approve').checked = m.approved; $('approve').disabled = !m.canApprove();
  $('send-response').disabled = !m.canApprove() || !m.approved;
  i18n.paintText($('send-response'), m.sending ? 'sendingApproved' : 'sendApproved');
  $('edit-draft').disabled = m.phase !== 'ready' || m.sending;
  $('regenerate').disabled = !m.raw.trim() || m.sending || ['preparing','rewriting','checking'].includes(m.phase);
  $('structured-mode').disabled = m.sending || !!m.sent;
  i18n.paintText($('draft-status'), { empty: 'statusEmpty', waiting: 'statusWaiting', preparing: 'statusPreparing', rewriting: 'statusRewriting', checking: 'statusChecking', ready: 'statusReady', stale: 'statusStale', structured: 'statusStructured' }[m.phase] ?? 'statusEmpty');
  i18n.paintFree($('draft-version'), `${i18n.t('sourceVersion', { version: m.version })} · ${m.draftVersion < 0 ? i18n.t('draftVersionNone') : i18n.t('draftVersion', { version: m.draftVersion })}`);
  i18n.paintFree($('draft-note'), `${i18n.sourceLabelI18n(m.rewriteResult)} · ${m.edited ? i18n.t('draftNoteEdited') : ''}${i18n.t('draftNoteReview')}`);
  i18n.paintSource($('risk-source'), m.riskResult);
  i18n.paintText($('risk-note'), m.riskResult ? (m.risks.length ? 'riskNoteFlagged' : 'riskNoteNone') : 'riskNoteNotRun');
  markRisks(m.raw, m.risks, 'risk-marks');
  markRisks(m.draft, [...m.draftRisks, ...m.aiNotes.map(r => ({ ...r, advisory: true }))], 'draft-risk-marks');
  $('draft-risk-review').hidden = !m.draft;
  if (m.reviewPending) i18n.paintText($('draft-risk-source'), 'reviewChecking');
  else i18n.paintSource($('draft-risk-source'), m.reviewResult);
  i18n.paintText($('draft-risk-note'), m.phase !== 'ready' ? 'draftRiskWait' : m.draftRisks.length ? 'draftRiskRemain' : 'draftRiskClear');
  const notes = [...new Set(m.aiNotes.map(r => r.sourceRiskIndex))].map(index => {
    const original = m.risks[index].text;
    const snippet = original.length > 80 ? original.slice(0, 77) + '…' : original;
    return i18n.t('aiNoteTemplate', { text: snippet });
  });
  const advisoryText = i18n.translateRespondentCopy(m.reviewWarning) || (notes.length ? `${notes.join(' · ')}. ${i18n.t('aiNoteNoRetention')}` : '');
  i18n.paintFree($('draft-ai-notes'), advisoryText);
  $('draft-ai-notes').hidden = !advisoryText;
  $('draft-ai-notes').classList.toggle('ai-advisory-notes', !!notes.length || !!m.reviewWarning);
  $('confirm-advisory-label').hidden = !m.needsAdvisoryConfirm();
  $('confirm-advisory').checked = m.confirmAdvisory;
  $('confirm-advisory').disabled = m.phase !== 'ready' || m.sending || !m.needsAdvisoryConfirm();
  $('keep-risks-label').hidden = !m.draftRisks.length;
  $('keep-risks').checked = m.keepRisks;
  $('keep-risks').disabled = m.phase !== 'ready' || m.sending;
  $('ai-bridge').classList.toggle('processing', m.reviewPending || ['preparing','rewriting','checking'].includes(m.phase));
  i18n.paintText($('header-context-text'), m.device === 'ready' ? 'headerAiOnDevice' : 'headerStructured');
  const options = templates[m.topic]?.options ?? [];
  const select = $('fallback-template');
  if (select.dataset.topic !== m.topic || select.dataset.locale !== i18n.getLocale()) {
    select.replaceChildren(new Option(i18n.t('chooseTemplate'), ''), ...options.map((s,i) => new Option(s,String(i))));
    select.dataset.topic = m.topic; select.dataset.locale = i18n.getLocale();
  }
  select.value = m.template; select.disabled = !m.topic || m.sending;
  $$('input[name="fallback-topic"]').forEach(el => { el.checked = el.value === m.topic; el.disabled = m.sending; });
  if (m.device === 'ready') i18n.paintText($('structured-answer'), 'structuredChooseTopic');
  else if (m.draft) i18n.paintFree($('structured-answer'), m.draft);
  else i18n.paintText($('structured-answer'), 'structuredChooseBoth');
  i18n.paintText($('flow-one-title'), m.device === 'ready' ? 'flowTyped' : 'flowChosen');
  i18n.paintText($('flow-two-title'), m.device === 'ready' ? 'flowRewritten' : 'flowStructured');
  i18n.paintText($('flow-two-note'), m.device === 'ready' ? 'flowOnDevice' : 'flowNoAi');
  if (m.sent) {
    $('sent-json').textContent = JSON.stringify(m.sent, null, 2);
    $('receipt-source').textContent = m.sentSource ? `${i18n.sourceLabelI18n(m.sentSource)} · ${i18n.t('approvedVersion')}` : `${i18n.t('headerStructured')} · ${i18n.t('flowNoAi')}`;
  }
  if (m.error) tell(m.error);
  else if (preparing) tell(i18n.t('tellPreparing'));
  else if (['ready','structured','rewriting','checking'].includes(m.phase)) tell(phaseStatus(m.phase));
}
function showQuestion() {
  if (checkin.id === 'check-in-001') i18n.paintText($('current-question'), 'demoCheckinQuestion');
  else i18n.paintFree($('current-question'), checkin.question);
}
function newResponse() {
  if (checkin.unavailable) return;
  respondent?.invalidate();
  const next = new Respondent({
    infer: services.infer, send: services.submit, question_id: checkin.id,
    responseId: services.responseId(), onChange: model => { if (model === respondent) renderResponse(); }
  });
  respondent = next;
  $('sent-json').textContent = '';
  showQuestion();
  renderResponse();
  if (!globalThis.LanguageModel) next.structured('unavailable');
  else if (typeof globalThis.LanguageModel.availability === 'function') {
    void (async () => {
      try {
        if (await globalThis.LanguageModel.availability() === 'unavailable' && next === respondent && next.phase === 'empty') next.structured('unavailable');
      } catch {
        if (next === respondent && next.phase === 'empty') next.structured('failed');
      }
    })();
  }
}
async function openSandboxResponse(id) {
  checkin = await services.checkin(id);
  newResponse();
  viewRequest++;
  setView('respondent');
  $('app-main').focus();
}
function navigateSandbox(active) {
  const url = new URL(location.href);
  if (active) url.searchParams.set('sandbox', '1');
  else url.searchParams.delete('sandbox');
  url.hash = active ? '' : 'respondent-view';
  location.replace(url.href);
}
async function start() {
  i18n = await import('./i18n.js');
  await i18n.initI18n();
  i18n.bindLangToggle(() => { refreshChrome(); refreshExampleOptions(); renderResponse(); });
  i18n.onLocaleChange(() => {
    refreshChrome();
    refreshExampleOptions();
    if (checkin && !checkin.unavailable) showQuestion();
    renderResponse();
  });
  try {
    const loadedConfig = await loadConfig();
    const sandbox = sandboxMode(loadedConfig, location.search);
    config = { ...loadedConfig, sandbox: sandbox.active };
    services = createServices(config);
    refreshChrome();
    $('sandbox-controls').hidden = !sandbox.available;
    $('enter-sandbox').hidden = !sandbox.available || sandbox.active;
    $('exit-sandbox').hidden = !sandbox.active;
    const setIntroOpen = open => { $('top-bar').classList.toggle('intro-open', open); $('intro-toggle').setAttribute('aria-expanded', String(open)); };
    setIntroOpen(!sandbox.active);
    $('intro-toggle').addEventListener('click', () => setIntroOpen(!$('top-bar').classList.contains('intro-open')));
    $('enter-sandbox').addEventListener('click', () => navigateSandbox(true));
    $('exit-sandbox').addEventListener('click', () => navigateSandbox(false));
    $('admin-login').hidden = sandbox.active;
    $('tab-settings').hidden = sandbox.active;
    $('next-respondent').hidden = !config.demo;
    $('examples').hidden = !config.demo && !sandbox.active;
    if (sandbox.active) {
      i18n.paintText($('what-was-sent'), 'sandboxReceiptHeading');
      i18n.paintText($('receipt-note'), 'sandboxReceiptNote');
    }
    refreshExampleOptions();
    const id = questionId((!sandbox.active && new URLSearchParams(location.search).get('checkin')) || 'check-in-001');
    if (!sandbox.active) await services.respondent();
    try { checkin = await services.checkin(id); }
    catch { checkin = { id, unavailable: true }; i18n.paintText($('current-question'), 'questionUnavailable'); $('response-form').hidden = true; tell(i18n.t('tellCheckinUnavailable')); }
    newResponse();
    refreshToolbarAuth();
    if (sandbox.active) await openAdmin();
    else if (!config.demo) {
      try {
        if (await services.restoreAdmin()) await openAdmin({ restored: true, respondentView: location.hash === '#respondent-view' });
      } catch { tell(i18n.t('tellAdminSignInFail')); }
    }
    $$('[data-view]').forEach(el => el.addEventListener('click', () => { if (el.dataset.view === 'admin') void openAdmin(); else { viewRequest++; setView('respondent'); } }));
    $('admin-login').addEventListener('click', () => openAdmin({ signIn: true }));
    $('raw-response').addEventListener('input', e => respondent?.setRaw(e.target.value));
    $('load-example').addEventListener('click', () => respondent?.setRaw(fixtures().examples[$('example-select').value]));
    $('edit-draft').addEventListener('click', () => { respondent?.beginEdit(); $('neutral-draft').focus(); });
    $('neutral-draft').addEventListener('input', e => respondent?.editDraft(e.target.value));
    $('regenerate').addEventListener('click', () => respondent?.rewrite());
    $('approve').addEventListener('change', e => respondent?.approve(e.target.checked));
    $('keep-risks').addEventListener('change', e => respondent?.acceptRisks(e.target.checked));
    $('confirm-advisory').addEventListener('change', e => respondent?.acceptAdvisory(e.target.checked));
    $('send-response').addEventListener('click', async () => {
      const active = respondent;
      const payload = await active?.submit();
      if (payload && active === respondent) {
        $('receipt-title').focus();
        tell(i18n.t(config.sandbox ? 'tellSandboxSaved' : config.demo ? 'tellDemoSaved' : 'tellApprovedAccepted'));
      }
    });
    $('structured-mode').addEventListener('click', () => respondent?.structured());
    $$('input[name="fallback-topic"]').forEach(el => el.addEventListener('change', () => { if(respondent?.phase==='preparing') respondent.structured('preparing'); respondent?.setTemplate(el.value); }));
    $('fallback-template').addEventListener('change', e => respondent?.setTemplate(respondent.topic,e.target.value));
    $('next-respondent').addEventListener('click', async () => { await services.nextDemoRespondent(); newResponse(); });
    $('receipt-admin').addEventListener('click', () => openAdmin());
  } catch {
    i18n.paintText($('mode-banner'), 'modeBannerStartFail');
    tell(i18n.t('tellConfigFail'));
    $('response-form').hidden = true; $('admin-login').disabled = true; $('structured-mode').disabled = true;
  }
}
void start();

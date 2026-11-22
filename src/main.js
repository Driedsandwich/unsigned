import { loadConfig } from './config.js';
import { createServices } from './firebase.js';
import { Respondent } from './respondent.js';
import { sourceLabel, adminInput, approvedInput } from './inference.js';
import { publicThemes, questionId } from './domain.js';
import { EXAMPLES, TEMPLATES } from './fixtures.js';
const $ = id => document.getElementById(id);
const $$ = selector => [...document.querySelectorAll(selector)];
const tell = message => { $('app-message').textContent = message; $('announcer').textContent = message; };
let config, services, respondent, checkin, admin = false, themes = [], questionResult = null, savedDraft = null;
let questionBusy = false, aggregateBusy = false, adminEpoch = 0;
function setTab(tab) {
  $$('[data-tab]').forEach(el => { const active = el.dataset.tab === tab; el.setAttribute('aria-selected', String(active)); el.tabIndex = active ? 0 : -1; $('panel-' + el.dataset.tab).hidden = !active; });
}
function setView(view) {
  const isAdmin = view === 'admin';
  $('admin-view').hidden = !isAdmin; $('respondent-view').hidden = isAdmin; $('admin-tabs').hidden = !isAdmin;
  $$('[data-view]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.view === view)));
  $('structured-mode').hidden = isAdmin;
  if (isAdmin && !admin) tell('Sign in with an authorized Google administrator account to view themes.');
}
function updateAuth() {
  $('admin-login').hidden = admin; $('sign-out').hidden = !admin;
  $('auth-status').textContent = admin ? (config.demo ? 'Demo administrator' : 'Administrator signed in') : (config.demo ? 'Fictional data · memory only' : 'Anonymous respondent');
  $('aggregate').disabled = !admin || aggregateBusy;
  $('generate-question').disabled = !admin || questionBusy;
  $('use-question').disabled = !admin || questionBusy || !questionResult || !$('question-draft').value.trim();
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
function renderThemes() {
  const safe = publicThemes(themes); const map = $('theme-map'); map.replaceChildren(); map.dataset.count = String(safe.length);
  for (const t of safe) {
    const li = document.createElement('li'); li.className = 'theme-island';
    const title = document.createElement('h2'); title.textContent = t.title;
    const summary = document.createElement('p'); summary.textContent = t.summary;
    const meta = document.createElement('div'); meta.className = 'island-meta';
    meta.textContent = `Strength: ${t.band === '9+' ? 'High' : 'Medium'} · Respondent band: ${t.band} anonymous sign-ins`;
    const track = document.createElement('div'); track.className = 'band-track'; track.setAttribute('aria-hidden', 'true');
    const level = ['3–5','6–8','9+'].indexOf(t.band) + 1;
    for (let i=1;i<=3;i++) { const span = document.createElement('span'); span.dataset.level = String(i); if(i<=level) span.className='active'; track.append(span); }
    li.append(title, summary, meta, track); map.append(li);
  }
  $('theme-count').textContent = safe.length ? `${safe.length} visible themes` : 'No themes to display';
}
async function login() {
  $('admin-login').disabled = true;
  try { await services.loginAdmin(); admin = true; const epoch = ++adminEpoch; updateAuth(); setView('admin'); const loaded = await services.themes(checkin.id); if (!admin || epoch !== adminEpoch) return; themes = loaded; renderThemes(); tell(config.demo ? 'Fictional themes. Cloud steps are simulated.' : 'Administrator ready. Group approved responses when ready.'); }
  catch { tell('Administrator sign-in failed or this Google account lacks the unsigned_admin claim.'); }
  finally { $('admin-login').disabled = false; }
}
async function aggregate() {
  if (!admin || aggregateBusy) return;
  aggregateBusy = true; const epoch = adminEpoch; updateAuth(); tell('Grouping approved rewrites…');
  try {
    const { rows, participants } = await services.approved(checkin.id);
    if (!admin || epoch !== adminEpoch) return;
    if (participants.length < 3) { tell('At least 3 distinct anonymous sign-ins with approved responses are required. No cloud inference ran.'); return; }
    const result = await services.infer('groupThemes', approvedInput(rows, participants));
    if (!admin || epoch !== adminEpoch) return;
    const saved = await services.saveThemes(checkin.id, result.value);
    if (!admin || epoch !== adminEpoch) return;
    themes = saved; renderThemes(); $('aggregate-source').textContent = sourceLabel(result); tell('Themes updated. Below 3 people: hidden.');
  } catch { tell('Could not group approved responses. No new themes were displayed.'); }
  finally { aggregateBusy = false; updateAuth(); }
}
async function draftQuestion() {
  if (!admin || questionBusy) return;
  const request = $('question-request').value.trim(); if (!request) { tell('Enter your request for next week’s question.'); return; }
  questionBusy = true; questionResult = null; const epoch = adminEpoch; updateAuth(); $('execution-location').textContent = 'Preparing question draft…';
  try {
    const result = await services.infer('draftQuestion', adminInput(request));
    if (!admin || epoch !== adminEpoch) return;
    questionResult = result; $('question-draft').value = result.value; $('execution-location').textContent = sourceLabel(result);
  } catch { $('execution-location').textContent = 'Draft failed · no result'; tell('Could not draft a question. Your request remains editable.'); }
  finally { questionBusy = false; updateAuth(); }
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
    newResponse(); updateAuth(); renderThemes();
    $$('[data-view]').forEach(el => el.addEventListener('click', () => { setView(el.dataset.view); if(config.demo && el.dataset.view === 'admin' && !admin) void login(); }));
    $$('[data-tab]').forEach((el,index,all) => {
      el.addEventListener('click', () => setTab(el.dataset.tab));
      el.addEventListener('keydown', event => { if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); const n = event.key==='Home'?0:event.key==='End'?all.length-1:(index+(event.key==='ArrowRight'?1:-1)+all.length)%all.length; setTab(all[n].dataset.tab); all[n].focus(); });
    });
    $('admin-login').addEventListener('click', login);
    $('sign-out').addEventListener('click', async () => {
      admin = false; adminEpoch++; themes=[]; questionResult=null; savedDraft=null; renderThemes();
      $('question-request').value=''; $('question-draft').value=''; $('saved-question').hidden=true; $('no-saved-question').hidden=false;
      $('execution-location').textContent='Not run yet'; $('aggregate-source').textContent='Not run yet'; $('adoption-message').hidden=true;
      updateAuth(); setView('respondent');
      try { await services.logoutAdmin(); tell('Administrator signed out.'); } catch { tell('Sign-out could not be confirmed. Close this tab.'); }
    });
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
    $('next-respondent').addEventListener('click', () => { services.nextDemoRespondent(); newResponse(); });
    $('receipt-admin').addEventListener('click', () => { setView('admin'); if(config.demo && !admin) void login(); });
    $('back-to-themes').addEventListener('click', () => setTab('themes'));
    $('aggregate').addEventListener('click', aggregate);
    $('generate-question').addEventListener('click', draftQuestion);
    $('question-draft').addEventListener('input', updateAuth);
    $('use-question').addEventListener('click', async () => {
      if(!admin || !questionResult || questionBusy) return;
      $('use-question').disabled=true;
      try {
        const epoch = adminEpoch;
        const draft = await services.saveDraft($('question-draft').value);
        if (!admin || epoch !== adminEpoch) return;
        savedDraft = draft;
        $('saved-question').querySelector('.pill').textContent = 'Draft only · Not scheduled'; $('saved-question-text').textContent=savedDraft.question; $('saved-question-location').textContent=sourceLabel(questionResult)+' · Human confirmation required before opening.';
        $('saved-question').hidden=false; $('no-saved-question').hidden=true; $('adoption-message').hidden=false;
        $('open-checkin').hidden=false; $('checkin-link').hidden=true;
        tell('Saved as a draft. Nothing has been scheduled or opened.');
      } catch { tell('Could not save the question draft.'); }
      finally { updateAuth(); }
    });
    $('open-checkin').addEventListener('click', async () => {
      if(!savedDraft || !admin) return; $('open-checkin').disabled=true;
      const epoch = adminEpoch, id = savedDraft.id;
      try { await services.openDraft(id); if (!admin || epoch !== adminEpoch) return; const link=new URL(location.href); link.search=''; link.searchParams.set('checkin',id); $('checkin-link').href=link.href; $('checkin-link').textContent=link.href; $('checkin-link').hidden=false; $('saved-question').querySelector('.pill').textContent = config.demo ? 'Demo open · Simulated' : 'Open for responses'; $('saved-question-location').textContent=config.demo?'Demo opening simulated. Share links are not persisted.':'Open for responses · Share this link with your team.'; $('open-checkin').hidden=true; }
      catch { tell('Could not open this check-in. The draft remains available.'); }
      finally { $('open-checkin').disabled=false; }
    });
    $('export-themes').addEventListener('click', () => {
      if(!admin) return;
      const blob = new Blob([JSON.stringify({ themes: publicThemes(themes) },null,2)], { type: 'application/json' });
      const href=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=href; a.download='themes.local.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(href),1000);
    });
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
